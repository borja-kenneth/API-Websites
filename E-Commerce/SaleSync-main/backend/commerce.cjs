const {randomUUID}=require('node:crypto');
const {digest}=require('./security.cjs');
const CATEGORIES=['Electronics','Fashion','Home & Living','Beauty','Sports','Accessories'];
const DELIVERY_FIELDS=['name','phone','address','barangay','city','province','postal'];
const STAGES=['paid','processing','packed','shipped','out_for_delivery','delivered'];
function commerceService({db,config,settings,now,audit,fail,pos:initialPos}){
  let pos=initialPos;
  let features={};
  let transactionDepth=0;
  const orderLocks=new Set();
  function transaction(work){if(transactionDepth)return work();db.exec('BEGIN IMMEDIATE');transactionDepth++;try{const value=work();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}finally{transactionDepth--;}}
  function text(value,min,max){return typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
  function fields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail(422,'UNKNOWN_FIELD','The request contains unsupported fields.');}
  function revision(input,current){if(!Number.isInteger(input)||input!==current)fail(409,'REVISION_CONFLICT','This record changed. Reload it before saving.',{revision:current});}
  function delivery(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||!['name','address','barangay','city','province'].every(key=>text(input[key],2,160))||typeof input.phone!=='string'||!/^09\d{9}$/.test(input.phone)||typeof input.postal!=='string'||!/^\d{4}$/.test(input.postal))fail(422,'INVALID_DELIVERY','Enter a complete Philippine address, an 11-digit mobile beginning 09, and a four-digit postal code.');
    return Object.fromEntries(DELIVERY_FIELDS.map(key=>[key,input[key].trim()]));
  }
  function notification(userId,message,orderId=null){db.prepare('INSERT INTO notifications VALUES (?,?,?,?,NULL,?)').run(randomUUID(),userId,message,orderId,now());}
  function history(orderId,user,status,note){db.prepare('INSERT INTO order_history(order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)').run(orderId,user?.id||null,status,note,now());}
  function move(productId,user,kind,delta,reservedDelta,reason,orderId=null){db.prepare('INSERT INTO inventory_movements VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),productId,orderId,user?.id||null,kind,delta,reservedDelta,reason,now());}
  const storeRow=id=>db.prepare('SELECT * FROM stores WHERE id=?').get(id);
  // Public catalog visibility is independent of staff access and historical records.
  function publicStoreSql(alias='s'){
    const pos=`json_extract(${alias}.data,'$.source')='salesync_pos'`;
    if(config.catalogDemo)return `${alias}.status='approved' AND (${pos})`;
    const regular=`(EXISTS (SELECT 1 FROM users catalog_owner WHERE catalog_owner.id=${alias}.owner_id AND catalog_owner.role='customer' AND catalog_owner.status='active' AND catalog_owner.verified_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM audit demo_owner WHERE demo_owner.actor_id=${alias}.owner_id AND demo_owner.action IN ('LOCAL_DEMO_ACCOUNT_CREATED','LOCAL_CATALOG_FIXTURE_CREATED')))`;
    return `${alias}.status='approved' AND ((${pos}) OR ${regular})`;
  }
  function storeIsPublic(id){return !!db.prepare('SELECT 1 FROM stores s WHERE s.id=? AND '+publicStoreSql()).get(id);}
  function storeView(row){return row&&{...JSON.parse(row.data),id:row.id,name:row.name,status:row.status,revision:row.revision,productCount:db.prepare("SELECT COUNT(*) n FROM products p JOIN product_meta m ON m.product_id=p.id WHERE m.store_id=? AND json_extract(p.data,'$.published')=1 AND NOT EXISTS(SELECT 1 FROM product_variants pv WHERE pv.variant_id=p.id)").get(row.id).n};}
  function publicStores(){return db.prepare('SELECT s.* FROM stores s WHERE '+publicStoreSql()+' ORDER BY s.name').all().map(storeView);}
  function stores(all=false){return db.prepare(`SELECT * FROM stores ${all?'':"WHERE status='approved'"} ORDER BY name`).all().map(storeView);}
  function sellerStore(user,approved=true){const row=db.prepare('SELECT * FROM stores WHERE owner_id=?').get(user.id);if(!row||(approved&&row.status!=='approved'))fail(403,'SELLER_APPROVAL_REQUIRED','An approved seller store is required.');return row;}
  const isManager=user=>user?.role==='management';
  function ownedStore(user,id){const row=storeRow(id);if(!row)fail(404,'NOT_FOUND','Store not found.');if(!isManager(user)&&(row.owner_id!==user.id||row.status!=='approved'))fail(403,'FORBIDDEN','You cannot manage this store.');return row;}
  function productRow(id){const row=db.prepare('SELECT p.*,m.store_id,m.sku,m.revision,s.name AS store_name,s.status AS store_status FROM products p JOIN product_meta m ON m.product_id=p.id JOIN stores s ON s.id=m.store_id WHERE p.id=?').get(id);if(!row)fail(404,'NOT_FOUND','Product not found.');return row;}
  function reserved(id){return db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM reservations WHERE product_id=? AND state='active'").get(id).n;}
  function productView(row){const p=JSON.parse(row.data),held=reserved(row.id);return variants.describe(row,{...p,rating:features.ratingSummary?.(row.id)||{average:0,count:0},seller:row.store_name,storeId:row.store_id,sku:row.sku,revision:row.revision,onHand:p.primary,reserved:held,primary:Math.max(0,p.primary-held),published:p.published&&row.store_status==='approved'});}
  function publicProduct(p){return p.variants?{...p,variants:p.variants.filter(v=>v.published)}:p;}
  function products({all=false,storeId,includeVariants=false}={}){return db.prepare('SELECT p.*,m.store_id,m.sku,m.revision,s.name AS store_name,s.status AS store_status FROM products p JOIN product_meta m ON m.product_id=p.id JOIN stores s ON s.id=m.store_id ORDER BY p.rowid').all().filter(row=>(!storeId||row.store_id===storeId)&&(all||storeIsPublic(row.store_id))&&(includeVariants||!variants.relation(row.id))).map(productView).filter(p=>all||p.published);}
  function syncPosCatalog(items,storeName='SaleSync'){
    if(!Array.isArray(items))fail(502,'POS_INVALID_CATALOG','SaleSync returned an invalid product list.');
    return transaction(()=>{
      const storeId='POS-MASTER',name=(String(storeName||'SaleSync').trim().slice(0,120)||'SaleSync')+' Inventory';
      const storeData=JSON.stringify({source:'salesync_pos',description:'Products, prices and available stock are managed by the SaleSync POS.'});
      db.prepare("INSERT INTO stores(id,owner_id,name,status,data,created_at) VALUES (?,NULL,?,'approved',?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='approved',data=excluded.data,revision=stores.revision+1").run(storeId,name,storeData,now());
      const seen=new Set();
      for(const item of items){
        const id='POS-'+item.productId,sku=String(item.sku).trim().slice(0,64);if(!sku||seen.has(sku.toLowerCase()))fail(502,'POS_INVALID_CATALOG','SaleSync returned duplicate product codes.');seen.add(sku.toLowerCase());
        const prior=db.prepare('SELECT p.data,m.sku FROM products p JOIN product_meta m ON m.product_id=p.id WHERE p.id=?').get(id);
        const held=reserved(id),photo=typeof item.image==='string'&&/^(https?:\/\/|\/assets\/uploads\/)/i.test(item.image)?item.image:'';
        const data={id,posProductId:item.productId,name:String(item.name).trim().slice(0,120),description:String(item.description||'').slice(0,2000),category:String(item.category||'General').trim().slice(0,80),subcategory:'',sku,price:Number(item.price),was:Number(item.price),primary:Number(item.stock)+held,published:true,photo:photo||'assets/logo-email.png',fallback:'assets/logo-email.png',spec:{},badge:'',lowThreshold:5,seller:name};
        if(prior){
          const old=JSON.parse(prior.data);data.photo=photo||old.photo||data.photo;data.fallback=old.fallback||data.fallback;
          if(prior.sku!==sku)db.prepare('UPDATE product_meta SET sku=?,store_id=?,revision=revision+1 WHERE product_id=?').run(sku,storeId,id);
          else db.prepare('UPDATE product_meta SET store_id=?,revision=revision+1 WHERE product_id=?').run(storeId,id);
          db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(data),id);
        }else{
          db.prepare('INSERT INTO products(id,data) VALUES (?,?)').run(id,JSON.stringify(data));
          db.prepare('INSERT INTO product_meta(product_id,store_id,sku) VALUES (?,?,?)').run(id,storeId,sku);
        }
      }
      for(const r of db.prepare("SELECT p.id,p.data FROM products p WHERE json_extract(p.data,'$.posProductId') IS NOT NULL").all()){
        if(seen.has(String(JSON.parse(r.data).sku||'').toLowerCase()))continue;
        const data=JSON.parse(r.data);data.published=false;data.primary=reserved(r.id);db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(data),r.id);
      }
      return items.length;
    });
  }
  function validPhoto(photo){return photo===''||typeof photo==='string'&&( /^assets\/(?:products\/[a-z0-9-]+\.svg|logo-email\.png)$/.test(photo)||/^\/assets\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(photo)||/^https:\/\/images\.unsplash\.com\/[a-zA-Z0-9/_?=&.%+-]+$/.test(photo));}
  function validateProduct(p){
    const money=value=>Number.isFinite(value)&&value>=0.01&&value<=10000000&&Math.round(value*100)===Math.round(value*10000)/100;
    if(!text(p.name,2,120)||!text(p.description,0,2000)||!CATEGORIES.includes(p.category)||!text(p.sku,2,64)||!money(p.price)||!money(p.was)||p.was<p.price||!Number.isInteger(p.primary)||p.primary<0||p.primary>1000000||typeof p.published!=='boolean'||!validPhoto(p.photo))fail(422,'INVALID_PRODUCT','Check the product name, category, SKU, two-decimal prices, stock, description and image.');
    if(!p.spec||typeof p.spec!=='object'||Array.isArray(p.spec)||Object.keys(p.spec).length>20||Object.entries(p.spec).some(([key,value])=>!text(key,1,50)||!text(value,0,200)))fail(422,'INVALID_PRODUCT','Use at most 20 specifications with short text values.');
  }
  function saveProduct(user,id,input,variantWrite=false){
    fields(input,['revision','name','description','category','sku','price','was','primary','published','photo','spec','storeId','reason','subcategory']);
      if(pos?.enabled){
        if(!id)fail(409,'POS_OWNS_CATALOG','Products, prices, images and stock are managed in SaleSync POS while the POS connection is enabled.');
        const linked=JSON.parse(productRow(id).data);
        if(linked.posProductId)fail(409,'POS_OWNS_CATALOG','Edit this product in SaleSync POS. The online catalog updates from POS automatically.');
      }
    return transaction(()=>{
      const row=id?productRow(id):null;
      if(row&&variants.relation(id)&&!variantWrite)fail(422,'USE_VARIATIONS','Edit this stock item through its parent variation editor.');
      const current=row?JSON.parse(row.data):{id:'P-'+randomUUID(),name:'',description:'',category:'Electronics',price:1,was:1,primary:0,published:false,photo:'',fallback:'assets/logo-email.png',spec:{},badge:'',lowThreshold:5};
      if(row){ownedStore(user,row.store_id);revision(input.revision,row.revision);}
      const storeId=row?(input.storeId||row.store_id):(isManager(user)?input.storeId:sellerStore(user).id);
      if(typeof storeId!=='string')fail(422,'STORE_REQUIRED','Choose an approved store.');
      const store=ownedStore(user,storeId);if(store.status!=='approved')fail(409,'STORE_UNAVAILABLE','Approve the store before publishing products.');
      if(row&&store.id!==row.store_id)fail(422,'STORE_FIXED','Create a new listing to move a product to another store.');
      if(!isManager(user)&&input.storeId&&input.storeId!==store.id)fail(403,'FORBIDDEN','Products must belong to your approved store.');
      const next={...current,...Object.fromEntries(Object.entries(input).filter(([key])=>!['revision','storeId','reason'].includes(key))),seller:store.name};
      next.sku=input.sku||row?.sku||'';next.name=typeof next.name==='string'?next.name.trim():next.name;
      if(next.photo==='')next.photo=next.fallback;
      if(row&&variants.groups(id).length&&next.primary!==current.primary)fail(422,'VARIANT_STOCK','Manage stock for individual combinations.');
      if(input.subcategory&&(!text(input.subcategory,1,80)||!db.prepare("SELECT 1 FROM products WHERE json_extract(data,'$.category')=? AND json_extract(data,'$.subcategory')=? LIMIT 1").get(next.category,input.subcategory)))fail(422,'INVALID_SUBCATEGORY','Choose an existing category subcategory.');
      validateProduct(next);if(row&&isManager(user)&&next.published!==current.published&&!text(input.reason,5,200))fail(422,'REASON_REQUIRED','Record a reason for changing publication.');
      const duplicate=db.prepare('SELECT product_id FROM product_meta WHERE sku=? COLLATE NOCASE AND product_id<>?').get(next.sku,next.id);if(duplicate)fail(409,'DUPLICATE_SKU','This SKU is already in use.');
      const delta=next.primary-current.primary;
      if(row&&next.primary<reserved(id))fail(409,'RESERVED_STOCK','Stock cannot be reduced below active reservations.');
      if(row&&delta&&!text(input.reason,5,200))fail(422,'REASON_REQUIRED','Enter a stock adjustment reason of 5–200 characters.');
      if(row){db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(next),id);db.prepare('UPDATE product_meta SET store_id=?,sku=?,revision=revision+1 WHERE product_id=?').run(store.id,next.sku,id);}
      else {db.prepare('INSERT INTO products(id,data) VALUES (?,?)').run(next.id,JSON.stringify(next));db.prepare('INSERT INTO product_meta(product_id,store_id,sku) VALUES (?,?,?)').run(next.id,store.id,next.sku);}
      if(delta||!row)move(next.id,user,row?'adjustment':'opening',row?delta:next.primary,0,input.reason||'New product opening stock');
      audit(user,row?'PRODUCT_UPDATED':'PRODUCT_CREATED',{productId:next.id,storeId:store.id,fields:Object.keys(input),reason:input.reason||''});if(row&&isManager(user)&&store.owner_id)notification(store.owner_id,'Management updated '+next.name+(input.reason?': '+input.reason:''));
      return productView(productRow(next.id));
    });
  }
  function adjustStock(user,id,input){fields(input,['revision','delta','reason']);if(!Number.isInteger(input.delta)||!input.delta||Math.abs(input.delta)>1000000)fail(422,'INVALID_ADJUSTMENT','Use a non-zero whole-number adjustment.');const p=productRow(id);return saveProduct(user,id,{revision:input.revision,primary:JSON.parse(p.data).primary+input.delta,reason:input.reason},!!variants.relation(id));}
  function applyStore(user,input){
    fields(input,['name','description','tagline']);
    if(user.role!=='customer')fail(403,'FORBIDDEN','Only verified customer accounts can apply to sell.');
    if(!text(input.name,2,60)||!text(input.description,10,1000)||!text(input.tagline,2,140))fail(422,'INVALID_STORE','Enter a store name, description and tagline.');
    return transaction(()=>{
      if(db.prepare('SELECT id FROM stores WHERE owner_id=?').get(user.id))fail(409,'STORE_EXISTS','Your account already has a seller application or store.');
      if(db.prepare('SELECT id FROM stores WHERE name=? COLLATE NOCASE').get(input.name.trim()))fail(409,'STORE_NAME_TAKEN','Choose a different store name.');
      const id=randomUUID(),data={description:input.description.trim(),tagline:input.tagline.trim(),headline:'Discover '+input.name.trim(),accent:'#245ec4'};
      db.prepare("INSERT INTO stores(id,owner_id,name,status,data,created_at) VALUES (?,?,?,'pending',?,?)").run(id,user.id,input.name.trim(),JSON.stringify(data),now());audit(user,'SELLER_APPLIED',{storeId:id});return storeView(storeRow(id));
    });
  }
  function updateStore(user,id,input){
    fields(input,isManager(user)?['revision','status','reason','name','description','tagline','headline','logo','banner']:['revision','description','tagline','headline','logo','banner']);
    return transaction(()=>{
      const row=storeRow(id);if(!row)fail(404,'NOT_FOUND','Store not found.');if(!isManager(user))ownedStore(user,id);revision(input.revision,row.revision);
      const data=JSON.parse(row.data);for(const key of ['logo','banner'])if(key in input){if(!validPhoto(input[key]))fail(422,'INVALID_IMAGE','Choose a supported store image.');data[key]=input[key];}for(const key of ['description','tagline','headline'])if(key in input){if(!text(input[key],2,key==='description'?1000:140))fail(422,'INVALID_STORE','Store text is invalid.');data[key]=input[key].trim();}
      let status=row.status;
      if('status' in input){if(!['approved','rejected','suspended'].includes(input.status)||!text(input.reason,5,200))fail(422,'INVALID_STORE','Choose an approval status and give a reason.');status=input.status;}
      const name=input.name||row.name;if(!text(name,2,60))fail(422,'INVALID_STORE','Store name is invalid.');
      if(db.prepare('SELECT id FROM stores WHERE name=? COLLATE NOCASE AND id<>?').get(name.trim(),id))fail(409,'STORE_NAME_TAKEN','Choose another store name.');
      db.prepare('UPDATE stores SET name=?,status=?,data=?,revision=revision+1 WHERE id=?').run(name.trim(),status,JSON.stringify(data),id);
      if(row.owner_id)notification(row.owner_id,'Your seller store is '+status+'.'+(input.reason?' Reason: '+input.reason.trim():''));
      audit(user,'STORE_UPDATED',{storeId:id,status,reason:input.reason||'Store profile update'});return storeView(storeRow(id));
    });
  }
  function quote(items,address,cfg=settings.current().data,context){
    if(!Array.isArray(items)||!items.length||items.length>30||items.some(line=>!line||typeof line!=='object'||Array.isArray(line)))fail(422,'INVALID_CART','Choose 1–30 valid cart lines.');
    const shippingAddress=delivery(address),ids=new Set();
    const lines=items.map(line=>{
      if(typeof line.id!=='string'||!line.id||line.id.length>100)fail(409,'INVALID_STOCK','Choose valid product IDs.');
      const p=productView(productRow(line.id));
      if(p.variationGroups?.length)fail(422,'VARIATION_REQUIRED','Choose a configured product variation.');
      if(ids.has(p.id)||!p.published||!Number.isInteger(line.qty)||line.qty<1||line.qty>99||line.qty>p.primary)fail(409,'INVALID_STOCK','An item is unavailable or its quantity exceeds available stock.');
      ids.add(p.id);return {id:p.id,name:p.name,seller:p.seller,storeId:p.storeId,sku:p.sku,price:p.price,qty:line.qty,...(p.variantId?{productId:p.productId,variantId:p.variantId,options:p.options}:{}),photo:p.photo};
    });
    const shippingCents=Math.round(cfg.store.shippingPerSeller*100)*new Set(lines.map(line=>line.storeId)).size;
    const result={lines,delivery:shippingAddress,shipping:shippingCents/100,totalCents:lines.reduce((sum,line)=>sum+Math.round(line.price*100)*line.qty,shippingCents)};return context?features.discountQuote(result,context):result;
  }
  function orderRow(id){const row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!row)fail(404,'NOT_FOUND','Order not found.');return row;}
  function orderView(row){
    const meta=db.prepare('SELECT * FROM order_meta WHERE order_id=?').get(row.id),payment=db.prepare('SELECT id,mode,status,amount_cents,currency FROM payment_attempts WHERE order_id=?').get(row.id);
    const shipments=db.prepare('SELECT sh.*,s.name AS seller FROM shipments sh JOIN stores s ON s.id=sh.store_id WHERE sh.order_id=? ORDER BY sh.id').all(row.id).map(({store_id,order_id,updated_at,...rest})=>({...rest,storeId:store_id,orderId:order_id,updatedAt:updated_at}));
    const record={...JSON.parse(row.data),id:row.id,status:row.status,total:row.total_cents/100,customerEmail:db.prepare('SELECT email FROM users WHERE id=?').get(row.user_id)?.email,createdAt:row.created_at,revision:meta?.revision||1,expiresAt:meta?.expires_at||null,payment:payment?{...payment,amount:payment.amount_cents/100}:null,shipments,history:db.prepare('SELECT status,note,created_at AS createdAt FROM order_history WHERE order_id=? ORDER BY id').all(row.id),returnRequest:db.prepare('SELECT id,status,reason,revision FROM return_requests WHERE order_id=?').get(row.id)||null};
    record.inventoryReserved=!!db.prepare("SELECT 1 FROM reservations WHERE order_id=? AND state='active' LIMIT 1").get(row.id);
    return features.describeOrder?features.describeOrder(row,record):record;
  }
  function readOrder(user,id){const row=orderRow(id);if(!isManager(user)&&row.user_id!==user.id)fail(404,'NOT_FOUND','Order not found.');return orderView(row);}
  function orders(user){return (isManager(user)?db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all():db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 500').all(user.id)).map(orderView);}
  async function createOrder(user,input,key){
    fields(input,['items','delivery','voucherCode']);if(settings.current().data.maintenance.enabled)fail(503,'MAINTENANCE',settings.current().data.maintenance.message);
    // Validate input types before normalization; numeric postal codes are rejected with 422.
    const address=delivery(input.delivery);
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(key))fail(422,'IDEMPOTENCY_REQUIRED','Send an Idempotency-Key header of 16–100 letters, digits, hyphens or underscores.');
    const requestHash=digest(JSON.stringify({items:input.items,delivery:address,...(input.voucherCode?{voucherCode:String(input.voucherCode).trim().toUpperCase()}:{})}));
    const lockKey=user.id+':'+key;if(orderLocks.has(lockKey))fail(409,'ORDER_IN_PROGRESS','This checkout is already being processed. Try again shortly.');orderLocks.add(lockKey);
    let reservedAtPos=false,id=null;
    try{
      const prior=db.prepare('SELECT * FROM order_meta WHERE user_id=? AND idempotency_key=?').get(user.id,key);
      if(prior){if(prior.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','This checkout key was used for different order details.');return {order:orderView(orderRow(prior.order_id)),replayed:true};}
      if(pos?.enabled){if(!['local-test','paymongo-test'].includes(config.paymentMode))fail(503,'PAYMENT_REQUIRED','Configure the e-commerce test payment method before accepting online orders.');await pos.syncCatalog();}
      const priced=quote(input.items,address,settings.current().data,{user,code:input.voucherCode});if(priced.totalCents<=0)fail(422,'ZERO_TOTAL','Checkout requires a positive total.');id='EC-'+randomUUID().toUpperCase();const test=['local-test','paymongo-test'].includes(config.paymentMode),status=test?'pending_payment':'awaiting_gateway',expiresAt=test?now()+config.reservationSeconds*1000:null;
        if(pos?.enabled&&priced.lines.some(line=>!Number.isSafeInteger(JSON.parse(productRow(line.id).data).posProductId)))fail(409,'POS_PRODUCT_LINK_MISSING','This item is not in the SaleSync POS catalog. Add products in POS before selling them online.');
      const posOrder={id,totalCents:priced.totalCents,total:priced.totalCents/100,lines:priced.lines,delivery:priced.delivery,shipping:priced.shipping,subtotal:priced.subtotal,discount:priced.discount,customerEmail:user.email};
      if(pos?.enabled){await pos.reserve(posOrder);reservedAtPos=true;}
      try{return transaction(()=>{
        const data={lines:priced.lines,delivery:priced.delivery,shipping:priced.shipping,subtotal:priced.subtotal,discount:priced.discount,promotion:priced.promotion,paymentProvider:test?(config.paymentMode==='paymongo-test'?'PayMongo TEST':'Local test simulator'):null,paymentConfigured:test,inventoryReserved:test,posIntegration:!!pos?.enabled};
        db.prepare('INSERT INTO orders(id,user_id,status,total_cents,data,created_at) VALUES (?,?,?,?,?,?)').run(id,user.id,status,priced.totalCents,JSON.stringify(data),now());
        db.prepare('INSERT INTO order_meta(order_id,user_id,idempotency_key,request_hash,expires_at,payment_mode) VALUES (?,?,?,?,?,?)').run(id,user.id,key,requestHash,expiresAt,config.paymentMode);
        for(const line of priced.lines){db.prepare('INSERT INTO order_items VALUES (?,?,?,?,?,?,?)').run(randomUUID(),id,line.id,line.storeId,line.qty,Math.round(line.price*100),JSON.stringify(line));if(test){db.prepare("INSERT INTO reservations VALUES (?,?,?,'active',?)").run(id,line.id,line.qty,expiresAt);db.prepare('UPDATE product_meta SET revision=revision+1 WHERE product_id=?').run(line.id);move(line.id,user,'reservation',0,line.qty,'Pending online payment',id);}}
        for(const storeId of new Set(priced.lines.map(line=>line.storeId)))db.prepare('INSERT INTO shipments(id,order_id,store_id,status,updated_at) VALUES (?,?,?,?,?)').run(randomUUID(),id,storeId,status,now());
        if(test)db.prepare("INSERT INTO payment_attempts VALUES (?,?,?,'pending',?,'PHP',?,?)").run(randomUUID(),id,config.paymentMode,priced.totalCents,now(),now());
        features.holdPromotion?.(id,user,priced);features.enqueueEmail?.('order_created',id);history(id,user,status,test?'Order created; SaleSync POS stock reserved pending payment.':'Unpaid request saved; payment is disabled.');audit(user,'ORDER_CREATED',{orderId:id,mode:config.paymentMode,posConnected:!!pos?.enabled});notification(user.id,test?'Your order is awaiting payment.':'Your unpaid order request was saved.',id);
        return {order:orderView(orderRow(id)),replayed:false};
      });}catch(error){if(reservedAtPos)try{await pos.cancel(id);}catch{}throw error;}
    }finally{orderLocks.delete(lockKey);}
  }
  function release(orderId,user,reason){
    features.promotionState?.(orderId,'released');
    for(const reservation of db.prepare("SELECT * FROM reservations WHERE order_id=? AND state='active'").all(orderId)){db.prepare("UPDATE reservations SET state='released' WHERE order_id=? AND product_id=?").run(orderId,reservation.product_id);db.prepare('UPDATE product_meta SET revision=revision+1 WHERE product_id=?').run(reservation.product_id);move(reservation.product_id,user,'release',0,-reservation.quantity,reason,orderId);}
  }
  function expire(){
    const expired=db.prepare("SELECT o.* FROM orders o JOIN order_meta m ON m.order_id=o.id WHERE o.status='pending_payment' AND m.payment_mode<>'paymongo-test' AND m.expires_at<=?").all(now());
    if(!expired.length)return;
    transaction(()=>{for(const order of expired){if(!db.prepare("SELECT 1 FROM orders o JOIN order_meta m ON m.order_id=o.id WHERE o.id=? AND o.status='pending_payment' AND m.expires_at<=?").get(order.id,now()))continue;release(order.id,null,'Payment reservation expired');db.prepare("UPDATE orders SET status='payment_expired' WHERE id=? AND status='pending_payment'").run(order.id);db.prepare('UPDATE order_meta SET revision=revision+1 WHERE order_id=?').run(order.id);db.prepare("UPDATE payment_attempts SET status='expired',updated_at=? WHERE order_id=? AND status='pending'").run(now(),order.id);db.prepare("UPDATE shipments SET status='payment_expired',revision=revision+1,updated_at=? WHERE order_id=?").run(now(),order.id);history(order.id,null,'payment_expired','Reservation expired; no payment collected.');notification(order.user_id,'Your payment reservation expired; stock was released.',order.id);}});
  }
  async function simulatePayment(user,paymentId,outcome,providerEvent){
    if(!providerEvent&&(config.production||config.paymentMode!=='local-test'))fail(404,'NOT_FOUND','Local payment simulation is disabled.');
    if(!['success','failed','expired','cancelled'].includes(outcome))fail(422,'INVALID_OUTCOME','Choose success, failed, expired or cancelled.');
    expire();
    const result=transaction(()=>{
      const payment=db.prepare('SELECT * FROM payment_attempts WHERE id=?').get(paymentId);if(!payment)fail(404,'NOT_FOUND','Payment not found.');
      const row=orderRow(payment.order_id);if(!providerEvent&&(row.user_id!==user.id||user.role!=='customer'))fail(404,'NOT_FOUND','Payment not found.');
      if(payment.mode!==(providerEvent?'paymongo-test':'local-test'))fail(403,'FORBIDDEN','This endpoint accepts only local test payments.');
      const eventId=providerEvent||digest(payment.id+':'+outcome),prior=db.prepare('SELECT id FROM payment_events WHERE id=?').get(eventId);
      if(prior)return {order:orderView(row),replayed:true};
      if(payment.status!=='pending'||row.status!=='pending_payment')fail(409,'PAYMENT_FINAL','This payment is already completed or expired.');
      if(payment.amount_cents!==row.total_cents||payment.currency!=='PHP')fail(409,'PAYMENT_MISMATCH','Payment amount does not match the saved order.');
      let status;
      if(outcome==='success'){
        const holds=db.prepare("SELECT * FROM reservations WHERE order_id=? AND state='active' AND (? OR expires_at>?)").all(row.id,!!providerEvent?1:0,now());
        const lines=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(row.id);if(holds.length!==lines.length)fail(409,'RESERVATION_LOST','The stock reservation is no longer valid.');
        for(const line of lines){const hold=holds.find(h=>h.product_id===line.product_id),p=productRow(line.product_id),data=JSON.parse(p.data);if(!hold||hold.quantity!==line.quantity||data.primary<line.quantity||p.store_status!=='approved')fail(409,'INVALID_STOCK','Reserved stock is unavailable.');data.primary-=line.quantity;db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(data),p.id);db.prepare('UPDATE product_meta SET revision=revision+1 WHERE product_id=?').run(p.id);db.prepare("UPDATE reservations SET state='committed' WHERE order_id=? AND product_id=?").run(row.id,p.id);move(p.id,user,'sale',-line.quantity,-line.quantity,providerEvent?'PayMongo TEST payment verified':'Local test payment confirmed',row.id);}
        status='paid';features.promotionState?.(row.id,'used');
      }else{release(row.id,user,'Local test payment '+outcome);status=outcome==='failed'?'payment_failed':outcome==='expired'?'payment_expired':'cancelled';}
      const paymentStatus=outcome==='success'?'paid':outcome;
      db.prepare('UPDATE payment_attempts SET status=?,updated_at=? WHERE id=?').run(paymentStatus,now(),payment.id);db.prepare('INSERT INTO payment_events VALUES (?,?,?,?)').run(eventId,payment.id,outcome,now());db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,row.id);db.prepare('UPDATE order_meta SET revision=revision+1 WHERE order_id=?').run(row.id);db.prepare('UPDATE shipments SET status=?,revision=revision+1,updated_at=? WHERE order_id=?').run(status,now(),row.id);history(row.id,user,status,(providerEvent?'PayMongo TEST payment verified: ':'Local test payment ')+outcome+'; no real money moved.');notification(row.user_id,(providerEvent?'PayMongo TEST order ':'Local test order ')+row.id+' is '+status+'.',row.id);audit(user,'TEST_PAYMENT_'+outcome.toUpperCase(),{orderId:row.id,paymentId});return {order:orderView(orderRow(row.id)),replayed:false};
    });
    if(pos?.enabled){try{if(outcome==='success')await pos.complete(result.order.id);else await pos.cancel(result.order.id);}catch{db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(result.order.id,'POS_ORDER_SYNC_PENDING',now());}}
    return result;
  }
  async function cancelOrder(user,id,input){if(db.prepare("SELECT 1 FROM payment_attempts WHERE order_id=? AND mode='paymongo-test' AND status='pending'").get(id))fail(409,'PROVIDER_CONFIRMATION_REQUIRED','Expire and reconcile the PayMongo session before releasing stock.');fields(input,['revision','status']);const result=transaction(()=>{const row=orderRow(id);if(!isManager(user)&&row.user_id!==user.id)fail(404,'NOT_FOUND','Order not found.');const meta=db.prepare('SELECT revision FROM order_meta WHERE order_id=?').get(id);if(meta)revision(input.revision,meta.revision);if(!['pending_payment','awaiting_gateway'].includes(row.status))fail(422,'INVALID_TRANSITION','Only unpaid orders can be cancelled directly. Request a return or contact the store for a paid order.');release(id,user,'Unpaid order cancelled');db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(id);db.prepare('UPDATE order_meta SET revision=revision+1 WHERE order_id=?').run(id);db.prepare("UPDATE payment_attempts SET status='cancelled',updated_at=? WHERE order_id=? AND status='pending'").run(now(),id);db.prepare("UPDATE shipments SET status='cancelled',revision=revision+1,updated_at=? WHERE order_id=?").run(now(),id);history(id,user,'cancelled','Unpaid order cancelled.');notification(row.user_id,'Your unpaid order was cancelled.',id);audit(user,'ORDER_CANCELLED',{orderId:id});return orderView(orderRow(id));});if(pos?.enabled){try{await pos.cancel(id);}catch{db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(id,'POS_ORDER_SYNC_PENDING',now());}}return result;}
  function transitionShipment(user,id,input){
    fields(input,['revision','status','courier','tracking']);
    return transaction(()=>{
      const sh=db.prepare('SELECT * FROM shipments WHERE id=?').get(id);if(!sh)fail(404,'NOT_FOUND','Shipment not found.');ownedStore(user,sh.store_id);revision(input.revision,sh.revision);
      const row=orderRow(sh.order_id);if(!STAGES.includes(row.status))fail(422,'INVALID_TRANSITION','Only paid orders can be fulfilled.');
      const expected=STAGES[STAGES.indexOf(sh.status)+1];if(!expected||input.status!==expected)fail(422,'INVALID_TRANSITION','Follow the shipment stages in order.');
      const remaining=orderView(row).lines.filter(line=>line.storeId===sh.store_id).reduce((sum,line)=>sum+line.fulfillableQty,0);
      if(!remaining&&['paid','processing','packed'].includes(sh.status))fail(422,'NOTHING_TO_FULFILL','All shipment units have been refunded or cancelled.');
      const courier=input.courier??sh.courier,tracking=input.tracking??sh.tracking;
      if(!text(courier,0,100)||!text(tracking,0,100)||(input.status==='shipped'&&(!text(courier,2,100)||!text(tracking,2,100))))fail(422,'TRACKING_REQUIRED','Enter a courier and tracking reference before dispatch.');
      db.prepare('UPDATE shipments SET status=?,courier=?,tracking=?,revision=revision+1,updated_at=? WHERE id=?').run(input.status,courier.trim(),tracking.trim(),now(),id);
      const remainingLines=orderView(row).lines;const statuses=db.prepare('SELECT status,store_id FROM shipments WHERE order_id=?').all(row.id).filter(sh=>['shipped','out_for_delivery','delivered'].includes(sh.status)||remainingLines.some(line=>line.storeId===sh.store_id&&line.fulfillableQty>0)).map(sh=>STAGES.indexOf(sh.status)),status=statuses.length?STAGES[Math.min(...statuses)]:row.status;
      db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,row.id);db.prepare('UPDATE order_meta SET revision=revision+1 WHERE order_id=?').run(row.id);history(row.id,user,status,storeRow(sh.store_id).name+' shipment marked '+input.status.replaceAll('_',' ')+'.');notification(row.user_id,'Shipment update: '+input.status.replaceAll('_',' ')+'.',row.id);audit(user,'SHIPMENT_UPDATED',{orderId:row.id,shipmentId:id,status:input.status});if(['shipped','delivered'].includes(input.status))features.enqueueEmail?.(input.status,row.id,id);const result=orderView(orderRow(row.id));return isManager(user)?result:sellerOrderView(user,result);
    });
  }
  function sellerOrderView(user,order){const store=sellerStore(user);const lines=order.lines.filter(line=>line.storeId===store.id);return {id:order.id,status:order.status,createdAt:order.createdAt,delivery:order.shipments.some(sh=>sh.storeId===store.id&&['paid','processing','packed','shipped','out_for_delivery','delivered'].includes(sh.status))?order.delivery:undefined,returns:(order.returnRequests||[]).map(r=>({id:r.id,status:r.status,items:r.items.filter(item=>lines.some(line=>line.id===item.id))})).filter(r=>r.items.length),lines,shipments:order.shipments.filter(sh=>sh.storeId===store.id),total:lines.reduce((sum,line)=>sum+(line.netCents??Math.round(line.price*100)*line.qty),0)/100,paymentMode:order.payment?.mode||'disabled'};}
  function sellerOrders(user){const store=sellerStore(user);return db.prepare('SELECT DISTINCT o.* FROM orders o JOIN shipments s ON s.order_id=o.id WHERE s.store_id=? ORDER BY o.created_at DESC LIMIT 300').all(store.id).map(row=>{const order=orderView(row);const lines=order.lines.filter(line=>line.storeId===store.id);return {id:order.id,status:order.status,createdAt:order.createdAt,delivery:order.delivery,lines,shipments:order.shipments.filter(sh=>sh.storeId===store.id),total:lines.reduce((sum,line)=>sum+line.price*line.qty,0),paymentMode:order.payment?.mode||'disabled'};});}
  function requestReturn(...args){return features.requestReturn(...args);}
  function updateReturn(...args){return features.updateReturn(...args);}
  function refundOrder(...args){return features.refundOrder(...args);}
  function reports(...args){return features.reports(...args);}
  const variants=require('./variants.cjs').variantService({db,s:{productRow,productView,saveProduct,ownedStore,revision,fields,text,transaction,reserved,move},fail});
  return {settleProviderPayment:(paymentId,outcome,eventId)=>simulatePayment(null,paymentId,'success',eventId),setPosConnector:value=>{pos=value;},syncPosCatalog,publicStoreSql,storeIsPublic,publicStores,publicProduct,variants,reserved,setFeatures:value=>{features=value;},sellerOrderView,transaction,text,fields,revision,delivery,notification,history,move,products,productRow,productView,stores,storeView,storeRow,sellerStore,ownedStore,saveProduct,adjustStock,applyStore,updateStore,quote,createOrder,orders,readOrder,orderRow,orderView,cancelOrder,expire,simulatePayment,transitionShipment,sellerOrders,requestReturn,updateReturn,refundOrder,reports};
}
module.exports={commerceService,CATEGORIES};
