const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {token,digest,hashPassword,verifyPassword,passwordValid,gmailAddress,publicUser}=require('./security.cjs');
function commerceRoutes({service:s,db,config,settings,now,audit,fail,mailer,productPage,pos}){
  const business=require('./operations.cjs').operations({db,s,config,now,audit,fail});
  const clearShopping=()=>({cart:{},wish:[],compare:[],saved:[]});
  const customer=(ctx)=>{const u=ctx.requireUser(ctx.session,'orders:own');if(u.role!=='customer')fail(403,'FORBIDDEN','Customer account required.');return u;};
  const manager=(ctx)=>ctx.requireUser(ctx.session,'catalog:write');
  const profile=user=>({...publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)),phone:db.prepare('SELECT phone FROM profiles WHERE user_id=?').get(user.id)?.phone||'',store:s.storeView(db.prepare('SELECT * FROM stores WHERE owner_id=?').get(user.id))||null});
  function addresses(user){return db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,rowid').all(user.id).map(row=>({id:row.id,...JSON.parse(row.data),default:!!row.is_default,revision:row.revision}));}
  function shopping(user){const row=db.prepare('SELECT * FROM shopping WHERE user_id=?').get(user.id);return {shopping:row?JSON.parse(row.data):clearShopping(),revision:row?.revision||0};}
  function ticketView(row){return {id:row.id,subject:row.subject,status:row.status,revision:row.revision,createdAt:row.created_at,messages:db.prepare('SELECT m.id,m.message,m.created_at AS createdAt,u.name,u.role FROM support_messages m JOIN users u ON u.id=m.actor_id WHERE ticket_id=? ORDER BY m.created_at,m.rowid').all(row.id)};}
  async function handle(ctx){
    const {p,req,session,body,json,rate,ip,cookie}=ctx;
    if(await business.handle(ctx))return true;
    const send=(status,value)=>{json(status,value);return true;};
    if(req.method==='GET'&&p==='/api/catalog'){const params=new URL(req.url,config.origin).searchParams;if(pos?.enabled){try{await pos.syncCatalog();}catch{if(!s.products().length)fail(503,'POS_CATALOG_UNAVAILABLE','SaleSync products are temporarily unavailable. Check the POS connection and try again.');}}return send(200,{...(params.has('limit')?productPage(params):{products:s.products().map(s.publicProduct)}),stores:s.publicStores(),posImageOrigin:pos?.imageOrigin||null,demo:config.catalogDemo,settings:{store:settings.current().data.store,maintenance:settings.current().data.maintenance},version:settings.current().version,payment:{provider:config.paymentMode==='paymongo-test'?'PayMongo TEST':config.paymentMode==='local-test'?'Local test simulator':null,configured:['local-test','paymongo-test'].includes(config.paymentMode),mode:config.paymentMode,reservationSeconds:config.reservationSeconds,realMoney:false},courier:{mode:config.courierMode,configured:config.courierMode==='local-test'||!!config.env.AFTERSHIP_API_KEY,simulated:config.courierMode==='local-test'},mailConfigured:!!mailer.configured});}
    if(p==='/api/admin/online-pos/status'){manager(ctx);if(req.method==='GET')return send(200,{...pos.status()});if(req.method==='POST'){await body(req);return send(200,await pos.check());}}
    if(req.method==='POST'&&p==='/api/auth/forgot-password'){
      const input=await body(req);s.fields(input,['email']);const email=gmailAddress(input.email);rate('recovery-ip:'+ip,10,3600);rate('recovery-mail:'+(email?.key||'invalid'),3,3600);
      const user=email&&db.prepare("SELECT * FROM users WHERE email_key=? AND status='active' AND verified_at IS NOT NULL").get(email.key);
      if(user){const raw=token(),hash=digest(raw);s.transaction(()=>{db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);db.prepare('INSERT INTO password_resets VALUES (?,?,?)').run(hash,user.id,now()+30*60000);});
        try{if(!mailer.sendPasswordReset)throw Error('MAIL_UNAVAILABLE');await mailer.sendPasswordReset(user.email,config.origin+'/#/reset-password?token='+encodeURIComponent(raw),1800);audit(null,'RECOVERY_DELIVERED',{accountId:user.id});}
        catch{db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(hash);audit(null,'RECOVERY_DELIVERY_FAILED',{accountId:user.id});}
      }
      return send(202,{message:'If an active account matches that address, a password-reset link will be sent. Check your inbox and spam folder.'});
    }
    if(req.method==='POST'&&p==='/api/auth/reset-password'){
      rate('reset-ip:'+ip,20,900);const input=await body(req);s.fields(input,['token','password']);
      if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token)||!passwordValid(input.password))fail(422,'INVALID_RESET','Use a valid reset link and a password of at least 12 characters (128 bytes maximum).');
      const hash=digest(input.token),record=db.prepare("SELECT r.*,u.password_hash FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.status='active' AND u.verified_at IS NOT NULL").get(hash,now());if(!record)fail(410,'RESET_EXPIRED','This password-reset link is invalid, expired or already used.');
      const passwordHash=await hashPassword(input.password);
      s.transaction(()=>{const consumed=db.prepare('DELETE FROM password_resets WHERE token_hash=? AND expires_at>?').run(hash,now());if(!consumed.changes)fail(410,'RESET_EXPIRED','This reset link has already been used or expired.');const updated=db.prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND status='active'").run(passwordHash,record.user_id,record.password_hash);if(!updated.changes)fail(409,'ACCOUNT_CHANGED','Account details changed. Request a new reset link.');db.prepare('DELETE FROM password_resets WHERE user_id=?').run(record.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.user_id);audit(null,'PASSWORD_RESET',{accountId:record.user_id});});
      cookie(ctx.res,'ss_session','',0);return send(200,{message:'Password updated. Sign in with your new password.'});
    }
    if(p==='/api/account'){
      const user=ctx.requireUser(session);
      if(req.method==='GET')return send(200,{profile:profile(user)});
      if(req.method==='PATCH'){const input=await body(req);s.fields(input,['name','phone']);if(!s.text(input.name,2,80)||typeof input.phone!=='string'||(input.phone&&!/^09\d{9}$/.test(input.phone)))fail(422,'INVALID_PROFILE','Enter a name and an optional Philippine mobile number.');s.transaction(()=>{db.prepare('UPDATE users SET name=? WHERE id=?').run(input.name.trim(),user.id);db.prepare('INSERT INTO profiles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone').run(user.id,input.phone);audit(user,'PROFILE_UPDATED');});return send(200,{profile:profile(user)});}
    }
    if(req.method==='POST'&&p==='/api/account/password'){
      const user=ctx.requireUser(session),input=await body(req);s.fields(input,['currentPassword','password']);rate('change-password:'+user.id,5,900);
      if(typeof input.currentPassword!=='string'||Buffer.byteLength(input.currentPassword)>128||!passwordValid(input.password))fail(422,'INVALID_PASSWORD','Enter your current password and a new password of at least 12 characters.');
      if(!await verifyPassword(input.currentPassword,user.password_hash))fail(422,'CURRENT_PASSWORD_INCORRECT','Current password is incorrect.');
      const hash=await hashPassword(input.password);s.transaction(()=>{if(!db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(hash,user.id,user.password_hash).changes)fail(409,'ACCOUNT_CHANGED','Account changed; sign in again.');db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);audit(user,'PASSWORD_CHANGED');});cookie(ctx.res,'ss_session','',0);return send(200,{message:'Password changed. Please sign in again.'});
    }
    if(p==='/api/account/addresses'||/^\/api\/account\/addresses\/[^/]+$/.test(p)){
      const user=customer(ctx),id=p.split('/')[4];
      if((req.method==='DELETE'||req.method==='PATCH')&&!id)fail(405,'METHOD_NOT_ALLOWED','An address ID is required.');
      if(req.method==='GET'&&!id)return send(200,{addresses:addresses(user)});
      if(['POST','PATCH','DELETE'].includes(req.method)){
        const input=await body(req);s.fields(input,req.method==='DELETE'?['revision']:['revision','default','name','phone','address','barangay','city','province','postal']);
        s.transaction(()=>{
          const old=id&&db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(id,user.id);if(id&&!old)fail(404,'NOT_FOUND','Address not found.');if(old)s.revision(input.revision,old.revision);
          if(req.method==='DELETE'){db.prepare('DELETE FROM addresses WHERE id=?').run(id);if(old.is_default){const next=db.prepare('SELECT id FROM addresses WHERE user_id=? ORDER BY rowid LIMIT 1').get(user.id);if(next)db.prepare('UPDATE addresses SET is_default=1,revision=revision+1 WHERE id=?').run(next.id);}return;}
          if((req.method==='POST'&&id)||(req.method==='PATCH'&&!id))fail(405,'METHOD_NOT_ALLOWED','Use the correct address endpoint.');
          const value=s.delivery(input);if(typeof input.default!=='boolean')fail(422,'INVALID_ADDRESS','Choose whether this is your default address.');
          if(!old&&db.prepare('SELECT COUNT(*) n FROM addresses WHERE user_id=?').get(user.id).n>=20)fail(422,'ADDRESS_LIMIT','Keep at most 20 saved addresses.');
          const makeDefault=input.default||!!old?.is_default||!db.prepare('SELECT id FROM addresses WHERE user_id=? AND is_default=1').get(user.id);
          if(makeDefault)db.prepare('UPDATE addresses SET is_default=0,revision=revision+1 WHERE user_id=? AND is_default=1 AND id<>?').run(user.id,id||'');
          if(old)db.prepare('UPDATE addresses SET data=?,is_default=?,revision=revision+1 WHERE id=?').run(JSON.stringify(value),makeDefault?1:0,id);
          else db.prepare('INSERT INTO addresses(id,user_id,data,is_default) VALUES (?,?,?,?)').run(randomUUID(),user.id,JSON.stringify(value),makeDefault?1:0);
          audit(user,'ADDRESS_SAVED');
        });return send(req.method==='POST'?201:200,{addresses:addresses(user)});
      }
    }
    if(p==='/api/account/shopping'){
      const user=customer(ctx);if(req.method==='GET')return send(200,shopping(user));
      if(req.method==='PUT'){
        const input=await body(req);s.fields(input,['ownerId','revision','shopping']);if(input.ownerId!==user.id)fail(409,'SHOPPING_OWNER_CHANGED','Shopping account changed. Reload before saving.');
        const data=input.shopping;s.fields(data,['cart','wish','saved','compare']);
        if(!data.cart||typeof data.cart!=='object'||Array.isArray(data.cart)||Object.keys(data.cart).length>30||Object.values(data.cart).some(qty=>!Number.isInteger(qty)||qty<1||qty>99)||!['wish','saved','compare'].every(key=>Array.isArray(data[key])&&data[key].length<=(key==='compare'?4:200)&&data[key].every(id=>typeof id==='string')))fail(422,'INVALID_SHOPPING','Shopping data has invalid items or quantities.');
        for(const [id,qty] of Object.entries(data.cart)){if(db.prepare('SELECT 1 FROM variation_groups WHERE product_id=?').get(id))fail(422,'VARIATION_REQUIRED','Select a variation before saving this cart line.');const link=s.variants.relation(id);if(link){const variant=s.productView(s.productRow(id));if(!variant.published||qty>variant.primary)fail(409,'INVALID_STOCK','A selected variation is unavailable or exceeds current stock.');}}
        const published=s.products({includeVariants:true}),available=new Set(published.map(p=>p.id)),cartAvailable=new Set(published.filter(p=>!p.variationGroups?.length).map(p=>p.id)),clean={cart:Object.fromEntries(Object.entries(data.cart).filter(([id])=>cartAvailable.has(id))),...Object.fromEntries(['wish','saved','compare'].map(key=>[key,[...new Set(data[key])].filter(id=>available.has(id))]))};
        s.transaction(()=>{const old=shopping(user);s.revision(input.revision,old.revision);db.prepare('INSERT INTO shopping VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at').run(user.id,JSON.stringify(clean),old.revision+1,now());});return send(200,shopping(user));
      }
    }
    if(p==='/api/account/notifications'){
      const user=customer(ctx);if(req.method==='PATCH'){const input=await body(req);s.fields(input,['read']);if(input.read!==true)fail(422,'INVALID_NOTIFICATION','Use read:true to mark notifications read.');db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(),user.id);}
      if(['GET','PATCH'].includes(req.method))return send(200,{notifications:db.prepare('SELECT id,message,order_id AS orderId,read_at AS readAt,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(user.id)});
    }
    if(p==='/api/seller/application'&&req.method==='POST'){const user=customer(ctx);rate('seller-application:'+user.id,3,3600);return send(201,{store:s.applyStore(user,await body(req))});}
    if(p==='/api/seller/store'){
      const user=customer(ctx),store=s.sellerStore(user,false);if(req.method==='GET')return send(200,{store:s.storeView(store)});if(req.method==='PATCH')return send(200,{store:s.updateStore(user,store.id,await body(req))});
    }
    if(p==='/api/admin/sellers'){
      manager(ctx);if(req.method==='GET')return send(200,{stores:db.prepare('SELECT s.*,u.name AS owner_name,u.email AS owner_email,u.status AS owner_status FROM stores s LEFT JOIN users u ON u.id=s.owner_id ORDER BY s.created_at DESC').all().map(row=>({...s.storeView(row),ownerName:row.owner_name||'Store managed by SaleSync',ownerEmail:row.owner_email?row.owner_email.slice(0,1)+'***@'+row.owner_email.split('@')[1]:null,ownerStatus:row.owner_status||null,decisions:db.prepare("SELECT details,created_at AS createdAt FROM audit WHERE action='STORE_UPDATED' AND json_extract(details,'$.storeId')=? ORDER BY id DESC LIMIT 10").all(row.id).map(a=>({...JSON.parse(a.details),createdAt:a.createdAt}))}))});
    }
    if(req.method==='PATCH'&&/^\/api\/admin\/sellers\/[^/]+$/.test(p)){const user=manager(ctx);return send(200,{store:s.updateStore(user,p.split('/').at(-1),await body(req))});}
    const catalogBase=p==='/api/admin/catalog'||p==='/api/seller/catalog';
    const productMatch=p.match(/^\/api\/(admin|seller)\/catalog\/([^/]+)$/);
    if(catalogBase||productMatch){
      const user=p.startsWith('/api/admin/')?manager(ctx):customer(ctx),store=p.startsWith('/api/seller/')?s.sellerStore(user):null;
      if(req.method==='GET'&&catalogBase)return send(200,{products:s.products({all:true,storeId:store?.id}),stores:store?[s.storeView(store)]:s.stores()});
      if(req.method==='POST'&&catalogBase)return send(201,{product:s.saveProduct(user,null,await body(req))});
      if(req.method==='PATCH'&&productMatch)return send(200,{product:s.saveProduct(user,productMatch[2],await body(req))});
    }
    const stockMatch=p.match(/^\/api\/(admin|seller)\/inventory\/([^/]+)(\/adjustments)?$/);
    if(stockMatch){const user=stockMatch[1]==='admin'?manager(ctx):customer(ctx),row=s.productRow(stockMatch[2]);s.ownedStore(user,row.store_id);
      if(req.method==='GET'&&!stockMatch[3])return send(200,{product:s.productView(row),movements:db.prepare('SELECT id,kind,delta,reserved_delta AS reservedDelta,reason,order_id AS orderId,created_at AS createdAt FROM inventory_movements WHERE product_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200').all(row.id)});
      if(req.method==='POST'&&stockMatch[3])return send(200,{product:s.adjustStock(user,row.id,await body(req))});
    }
    if(req.method==='POST'&&(p==='/api/admin/media'||p==='/api/seller/media')){
      if(p.startsWith('/api/admin/'))manager(ctx);else s.sellerStore(customer(ctx));
      rate('image-upload:'+session.user.id,30,3600);const input=await body(req,1100000);s.fields(input,['base64']);if(typeof input.base64!=='string'||!/^[a-zA-Z0-9+/]+={0,2}$/.test(input.base64))fail(422,'INVALID_IMAGE','Upload a PNG, JPEG or WebP image.');const bytes=Buffer.from(input.base64,'base64');if(bytes.length<16||bytes.length>750000)fail(422,'IMAGE_SIZE','Use an image smaller than 750 KB.');
      let ext;if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=24&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(16)<=4096&&bytes.readUInt32BE(20)>0&&bytes.readUInt32BE(20)<=4096)ext='png';else if(bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217)ext='jpg';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')ext='webp';else fail(422,'INVALID_IMAGE','Image format is unsupported or invalid. SVG uploads are not accepted.');
      const folder=config.uploadDir;fs.mkdirSync(folder,{recursive:true});const filename=randomUUID()+'.'+ext;fs.writeFileSync(path.join(folder,filename),bytes,{flag:'wx'});audit(session.user,'PRODUCT_IMAGE_UPLOADED',{file:filename});return send(201,{url:'/assets/uploads/'+filename});
    }
    if(p==='/api/orders'){
      if(req.method==='GET'){const user=ctx.requireUser(session);if(user.role==='maintenance')fail(403,'FORBIDDEN','Maintenance cannot read customer orders.');return send(200,{orders:s.orders(user)});}
      if(req.method==='POST'){const user=customer(ctx),input=await body(req);rate('orders:'+user.id,30,3600);const result=await s.createOrder(user,input,req.headers['idempotency-key']);return send(result.replayed?200:201,{...result,message:pos?.enabled?'SaleSync stock reserved. Complete the online test payment to record the sale in SaleSync.':config.paymentMode==='local-test'?'Order created. Complete the local test payment; no real money is charged.':'Order saved. Payment is disabled; no payment collected and stock is not reserved.'});}
    }
    if(req.method==='GET'&&/^\/api\/orders\/[^/]+$/.test(p))return send(200,{order:s.readOrder(customer(ctx),p.split('/').at(-1))});
    if(req.method==='POST'&&/^\/api\/orders\/[^/]+\/cancel$/.test(p))return send(200,{order:await s.cancelOrder(customer(ctx),p.split('/')[3],await body(req))});
    if(req.method==='POST'&&/^\/api\/orders\/[^/]+\/returns$/.test(p))return send(201,{returnRequest:s.requestReturn(customer(ctx),p.split('/')[3],await body(req))});
    if(req.method==='POST'&&/^\/api\/payments\/[^/]+\/simulate$/.test(p)){const input=await body(req);s.fields(input,['outcome']);return send(200,await s.simulatePayment(customer(ctx),p.split('/')[3],input.outcome));}
    if(req.method==='GET'&&p==='/api/seller/orders')return send(200,{orders:s.sellerOrders(customer(ctx))});
    const shipmentMatch=p.match(/^\/api\/(admin|seller)\/shipments\/([^/]+)$/);
    if(req.method==='PATCH'&&shipmentMatch){const user=shipmentMatch[1]==='admin'?manager(ctx):customer(ctx);return send(200,{order:s.transitionShipment(user,shipmentMatch[2],await body(req))});}
    if(req.method==='PATCH'&&/^\/api\/admin\/orders\/[^/]+$/.test(p)){
      const user=manager(ctx),id=p.split('/').at(-1),input=await body(req);
      if(input.status==='cancelled')return send(200,{order:await s.cancelOrder(user,id,input)});
      const order=s.readOrder(user,id);s.revision(input.revision,order.revision);if(order.shipments.length!==1)fail(422,'USE_SHIPMENTS','Update each seller shipment separately.');return send(200,{order:s.transitionShipment(user,order.shipments[0].id,{...input,revision:order.shipments[0].revision})});
    }
    if(req.method==='POST'&&/^\/api\/admin\/orders\/[^/]+\/refund$/.test(p))return send(200,{order:s.refundOrder(manager(ctx),p.split('/')[4],await body(req),req.headers['idempotency-key'])});
    if(p==='/api/admin/returns'&&req.method==='GET'){manager(ctx);return send(200,{returns:db.prepare('SELECT r.*,u.name AS customer FROM return_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 300').all()});}
    if(req.method==='PATCH'&&/^\/api\/admin\/returns\/[^/]+$/.test(p))return send(200,{returnRequest:s.updateReturn(manager(ctx),p.split('/').at(-1),await body(req))});
    if((p==='/api/account/support'||p==='/api/admin/support')&&req.method==='GET'){const user=p.startsWith('/api/admin/')?manager(ctx):customer(ctx),rows=user.role==='management'?db.prepare('SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 300').all():db.prepare('SELECT * FROM support_tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(user.id);return send(200,{tickets:rows.map(ticketView)});}
    if(p==='/api/account/support'&&req.method==='POST'){
      const user=customer(ctx),input=await body(req);s.fields(input,['subject','message']);rate('support:'+user.id,10,3600);if(!s.text(input.subject,3,120)||!s.text(input.message,10,2000))fail(422,'INVALID_TICKET','Enter a subject and a message of 10–2,000 characters.');const id=randomUUID();s.transaction(()=>{db.prepare('INSERT INTO support_tickets(id,user_id,subject,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,user.id,input.subject.trim(),now(),now());db.prepare('INSERT INTO support_messages VALUES (?,?,?,?,?)').run(randomUUID(),id,user.id,input.message.trim(),now());audit(user,'SUPPORT_OPENED',{ticketId:id});});return send(201,{ticket:ticketView(db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id))});
    }
    const ticketMatch=p.match(/^\/api\/(account|admin)\/support\/([^/]+)$/);
    if(ticketMatch&&req.method==='POST'){
      const user=ticketMatch[1]==='admin'?manager(ctx):customer(ctx),input=await body(req);s.fields(input,['revision','message','status']);if(!s.text(input.message,2,2000)||!['open','closed'].includes(input.status))fail(422,'INVALID_MESSAGE','Enter a reply and a valid ticket status.');
      const ticket=s.transaction(()=>{const row=db.prepare('SELECT * FROM support_tickets WHERE id=?').get(ticketMatch[2]);if(!row||(user.role!=='management'&&row.user_id!==user.id))fail(404,'NOT_FOUND','Ticket not found.');s.revision(input.revision,row.revision);db.prepare('INSERT INTO support_messages VALUES (?,?,?,?,?)').run(randomUUID(),row.id,user.id,input.message.trim(),now());db.prepare('UPDATE support_tickets SET status=?,revision=revision+1,updated_at=? WHERE id=?').run(input.status,now(),row.id);if(user.role==='management')s.notification(row.user_id,'There is a reply to your support request.');audit(user,'SUPPORT_REPLIED',{ticketId:row.id});return ticketView(db.prepare('SELECT * FROM support_tickets WHERE id=?').get(row.id));});return send(200,{ticket});
    }
    return false;
  }
  return {handle,profile,shopping};
}
module.exports={commerceRoutes};
