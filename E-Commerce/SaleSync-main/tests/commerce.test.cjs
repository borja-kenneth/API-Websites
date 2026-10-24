const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {randomBytes,randomUUID}=require('node:crypto');
const {createApp,provisionAdmin}=require('../backend/app.cjs');
const {loadConfig}=require('../backend/config.cjs');
const {createMailer}=require('../backend/mailer.cjs');
const PASSWORD='Commerce test password 972!';
const ADDRESS={name:'Test Customer',phone:'09123456789',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'};
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-commerce-'));let time=Date.now();const mail=[],resets=[];
  const config=loadConfig({CATALOG_DEMO:'true',DATABASE_PATH:path.join(directory,'commerce.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),MAIL_MODE:'disabled',APP_ORIGIN:'http://127.0.0.1:3000',PAYMENT_MODE:'local-test'});
  const app=await createApp(config,{now:()=>time,mailer:{configured:true,sendVerification:async(to,code)=>mail.push({to,code}),sendPasswordReset:async(to,url)=>resets.push({to,url}),sandboxEmail:createMailer({MAIL_MODE:'disabled'}).sandboxEmail}});
  await provisionAdmin(app.db,{name:'Test Manager',email:'commercemanager@gmail.com',password:PASSWORD,role:'management'},()=>time);
  await provisionAdmin(app.db,{name:'Test Maintainer',email:'commercemaintainer@gmail.com',password:PASSWORD,role:'maintenance'},()=>time);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await app.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  function client(){let csrf;const cookies=new Map();return async(route,{method='GET',body,headers={},noKey=false}={})=>{
    const response=await fetch(base+'/api/v1'+route,{method,headers:{Origin:config.origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(route==='/orders'&&method==='POST'&&!noKey?{'Idempotency-Key':randomUUID()}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    for(const entry of response.headers.getSetCookie()){const pair=entry.split(';')[0],i=pair.indexOf('=');if(pair.slice(i+1))cookies.set(pair.slice(0,i),pair.slice(i+1));else cookies.delete(pair.slice(0,i));}
    const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data};
  };}
  const post=(client,route,body={})=>client(route,{method:'POST',body});
  async function buyer(email='commercebuyer@gmail.com'){const c=client();assert.equal((await post(c,'/auth/register',{name:'Test Customer',email,password:PASSWORD})).status,201);assert.equal((await post(c,'/auth/verify',{code:mail.at(-1).code})).status,200);return c;}
  async function staff(role='management'){const c=client();assert.equal((await post(c,'/auth/login',{email:role==='management'?'commercemanager@gmail.com':'commercemaintainer@gmail.com',password:PASSWORD})).status,200);return c;}
  async function create(c,items=[{id:'p1',qty:1}]){const result=await post(c,'/orders',{items,delivery:ADDRESS});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.order;}
  async function pay(c,order,outcome='success'){return post(c,'/payments/'+order.payment.id+'/simulate',{outcome});}
  return {...app,config,base,client,post,buyer,staff,create,pay,resets,advance:ms=>{time+=ms;}};
}
test('numeric postal input is a validation error, and order keys deduplicate retries without leaking other customer orders',async t=>{
  const f=await fixture(t),c=await f.buyer(),other=await f.buyer('othercommercebuyer@gmail.com'),key=randomUUID(),body={items:[{id:'p1',qty:1}],delivery:ADDRESS};
  assert.equal((await f.post(c,'/orders',{...body,delivery:{...ADDRESS,postal:1609}})).status,422);
  assert.equal((await c('/orders',{method:'POST',body,noKey:true})).data.error.code,'IDEMPOTENCY_REQUIRED');
  const first=await c('/orders',{method:'POST',body,headers:{'Idempotency-Key':key}}),again=await c('/orders',{method:'POST',body,headers:{'Idempotency-Key':key}});assert.equal(first.status,201);assert.equal(again.status,200);assert.equal(first.data.order.id,again.data.order.id);
  assert.equal((await c('/orders',{method:'POST',body:{...body,items:[{id:'p1',qty:2}]},headers:{'Idempotency-Key':key}})).status,409);
  assert.equal((await other('/orders/'+first.data.order.id)).status,404);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
});
test('seller approval is enforced, new products have ownership and unique SKUs, and stale edits are rejected',async t=>{
  const f=await fixture(t),seller=await f.buyer(),other=await f.buyer('secondstoreseller@gmail.com'),manager=await f.staff(),maintainer=await f.staff('maintenance');
  const applied=await f.post(seller,'/seller/application',{name:'Test Seller Shop',description:'A complete test seller store.',tagline:'Made for testing.'});assert.equal(applied.status,201);const store=applied.data.store;
  assert.equal((await seller('/seller/catalog')).status,403);assert.equal((await seller('/admin/sellers/'+store.id,{method:'PATCH',body:{revision:1,status:'approved',reason:'Attempt self approval'}})).status,403);
  assert.equal((await maintainer('/admin/sellers')).status,403);
  assert.equal((await manager('/admin/sellers/'+store.id,{method:'PATCH',body:{revision:store.revision,status:'approved',reason:'Reviewed seller application'}})).status,200);
  const input={name:'Test product',description:'A real database product.',sku:'TEST-SKU-1',category:'Electronics',price:123.45,was:150,primary:5,published:true,photo:'',spec:{Color:'Blue'}};
  const made=await f.post(seller,'/seller/catalog',input);assert.equal(made.status,201,JSON.stringify(made.data));const p=made.data.product;assert.equal(p.storeId,store.id);
  assert.equal((await other('/seller/catalog/'+p.id,{method:'PATCH',body:{revision:p.revision,name:'Stolen name'}})).status,403);
  assert.equal((await f.post(seller,'/seller/catalog',input)).status,409);
  const edited=await seller('/seller/catalog/'+p.id,{method:'PATCH',body:{revision:p.revision,name:'Updated product'}});assert.equal(edited.status,200);assert.equal((await seller('/seller/catalog/'+p.id,{method:'PATCH',body:{revision:p.revision,price:10}})).status,409);
  assert.equal((await seller('/seller/catalog/'+p.id,{method:'PATCH',body:{name:'Missing revision'}})).status,409);
  const archived=await seller('/seller/catalog/'+p.id,{method:'PATCH',body:{revision:edited.data.product.revision,published:false,reason:'Archive isolated test listing'}});assert.equal(archived.status,200);assert.ok(!(await seller('/catalog')).data.products.some(item=>item.id===p.id));
  assert.equal((await seller('/auth/session')).data.user.role,'customer');
});
test('reservations prevent overselling, cancellation releases stock, and adjustments cannot consume reserved units',async t=>{
  const f=await fixture(t),c=await f.buyer(),other=await f.buyer('stocksecondbuyer@gmail.com'),manager=await f.staff();const before=(await c('/catalog')).data.products.find(p=>p.id==='p1');
  const order=await f.create(c,[{id:'p1',qty:before.primary}]);assert.equal(order.status,'pending_payment');assert.equal(order.inventoryReserved,true);
  const held=(await manager('/admin/catalog')).data.products.find(p=>p.id==='p1');assert.equal(held.primary,0);assert.equal(held.onHand,before.onHand);assert.equal(held.reserved,before.primary);
  assert.equal((await f.post(other,'/orders',{items:[{id:'p1',qty:1}],delivery:ADDRESS})).status,409);
  assert.equal((await f.post(manager,'/admin/inventory/p1/adjustments',{revision:held.revision,delta:-1,reason:'Attempt to consume a reserved unit'})).status,409);
  const cancelled=await f.post(c,'/orders/'+order.id+'/cancel',{revision:order.revision});assert.equal(cancelled.status,200);assert.equal(cancelled.data.order.status,'cancelled');assert.equal((await c('/catalog')).data.products.find(p=>p.id==='p1').primary,before.primary);
  assert.equal((await f.pay(c,order)).status,409);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='sale'").get().n,0);
});
test('success commits stock exactly once, rejects forged amounts, and records test-only revenue',async t=>{
  const f=await fixture(t),c=await f.buyer(),manager=await f.staff(),other=await f.buyer('paymentattacker@gmail.com');const before=(await c('/catalog')).data.products.find(p=>p.id==='p1'),order=await f.create(c,[{id:'p1',qty:2}]);
  assert.equal((await f.pay(other,order)).status,404);
  assert.equal((await f.post(c,'/payments/'+order.payment.id+'/simulate',{outcome:'success',amount:1})).status,422);
  const results=await Promise.all([f.pay(c,order),f.pay(c,order)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].data.order.status,'paid');assert.equal(results[1].data.replayed,true);
  const p=(await c('/catalog')).data.products.find(p=>p.id==='p1');assert.equal(p.onHand,before.onHand-2);assert.equal(p.reserved,0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='sale'").get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  assert.equal((await f.pay(c,order,'failed')).status,409);const report=(await manager('/admin/reports')).data;assert.equal(report.testRevenue,order.total);assert.equal(report.liveRevenue,0);
});
test('failed, cancelled, explicit-expired and clock-expired payments release reservations without deducting physical stock',async t=>{
  const f=await fixture(t),c=await f.buyer(),before=(await c('/catalog')).data.products.find(p=>p.id==='p1');
  for(const outcome of ['failed','cancelled','expired']){const order=await f.create(c);assert.equal((await f.pay(c,order,outcome)).status,200);const p=(await c('/catalog')).data.products.find(p=>p.id==='p1');assert.equal(p.primary,before.primary);assert.equal(p.reserved,0);}
  const expired=await f.create(c);f.advance(901000);assert.equal((await c('/orders/'+expired.id)).data.order.status,'payment_expired');assert.equal((await f.pay(c,expired)).status,409);assert.equal((await c('/catalog')).data.products.find(p=>p.id==='p1').onHand,before.onHand);
});
test('fulfillment enforces stages, tracking, ownership and multi-store aggregate status',async t=>{
  const f=await fixture(t),c=await f.buyer(),manager=await f.staff(),maintainer=await f.staff('maintenance');let order=await f.create(c,[{id:'p1',qty:1},{id:'p5',qty:1}]);order=(await f.pay(c,order)).data.order;assert.equal(order.shipments.length,2);
  const first=order.shipments[0];assert.equal((await manager('/admin/shipments/'+first.id,{method:'PATCH',body:{revision:first.revision,status:'shipped'}})).status,422);assert.equal((await maintainer('/admin/shipments/'+first.id,{method:'PATCH',body:{revision:first.revision,status:'processing'}})).status,403);
  for(const original of order.shipments){let sh=original;for(const status of ['processing','packed','shipped','out_for_delivery','delivered']){
    if(status==='shipped')assert.equal((await manager('/admin/shipments/'+sh.id,{method:'PATCH',body:{revision:sh.revision,status}})).status,422);
    const result=await manager('/admin/shipments/'+sh.id,{method:'PATCH',body:{revision:sh.revision,status,...(status==='shipped'?{courier:'Test Courier',tracking:'TRACK-TEST-123'}:{})}});assert.equal(result.status,200,JSON.stringify(result.data));sh=result.data.order.shipments.find(value=>value.id===sh.id);order=result.data.order;
  }if(original.id===first.id)assert.equal(order.status,'paid');}
  assert.equal(order.status,'delivered');assert.ok(order.history.some(event=>event.note.includes('shipment marked shipped')));assert.ok((await c('/account/notifications')).data.notifications.length>0);
});
test('returns require delivery and received goods before a test refund; restocking is atomic and cannot repeat',async t=>{
  const f=await fixture(t),c=await f.buyer(),manager=await f.staff(),before=(await c('/catalog')).data.products.find(p=>p.id==='p1');let order=await f.create(c);order=(await f.pay(c,order)).data.order;
  assert.equal((await f.post(c,'/orders/'+order.id+'/returns',{reason:'I would like to return this item.'})).status,422);
  for(const status of ['processing','packed','shipped','out_for_delivery','delivered']){const sh=order.shipments[0];order=(await manager('/admin/shipments/'+sh.id,{method:'PATCH',body:{revision:sh.revision,status,courier:'Test Courier',tracking:'RETURN-TEST'}})).data.order;}
  assert.equal((await f.post(manager,'/admin/orders/'+order.id+'/refund',{revision:order.revision,reason:'Not received return yet',restock:true})).status,422);
  let request=(await f.post(c,'/orders/'+order.id+'/returns',{reason:'Delivered item needs to be returned.'})).data.returnRequest;
  for(const status of ['approved','received']){const result=await manager('/admin/returns/'+request.id,{method:'PATCH',body:{revision:request.revision,status}});assert.equal(result.status,200);request=result.data.returnRequest;}
  const refund=await f.post(manager,'/admin/orders/'+order.id+'/refund',{revision:order.revision,reason:'Returned goods received and checked',restock:true});assert.equal(refund.status,200);assert.equal(refund.data.order.status,'refunded');assert.equal((await c('/catalog')).data.products.find(p=>p.id==='p1').onHand,before.onHand);
  assert.equal((await f.post(manager,'/admin/orders/'+order.id+'/refund',{revision:refund.data.order.revision,reason:'Attempt duplicate refund',restock:true})).status,422);assert.equal((await manager('/admin/reports')).data.testRevenue,0);
});
test('profile, addresses and shopping persist per account with ownership and revision checks',async t=>{
  const f=await fixture(t),c=await f.buyer(),other=await f.buyer('privatesecondbuyer@gmail.com'),user=(await c('/auth/session')).data.user;
  assert.equal((await c('/account',{method:'PATCH',body:{name:'Changed Customer',phone:'09171234567'}})).status,200);assert.equal((await c('/account')).data.profile.name,'Changed Customer');assert.equal((await c('/account',{method:'PATCH',body:{name:'Changed',phone:'',role:'management'}})).status,422);
  const made=await f.post(c,'/account/addresses',{...ADDRESS,default:true});assert.equal(made.status,201);const a=made.data.addresses[0];assert.equal((await other('/account/addresses/'+a.id,{method:'DELETE',body:{revision:a.revision}})).status,404);assert.equal((await other('/account/addresses')).data.addresses.length,0);
  const saved=await c('/account/shopping',{method:'PUT',body:{ownerId:user.id,revision:0,shopping:{cart:{p1:2},wish:['p2'],compare:[],saved:[]}}});assert.equal(saved.status,200);assert.equal((await c('/account/shopping')).data.shopping.cart.p1,2);assert.deepEqual((await other('/account/shopping')).data.shopping.cart,{});
  assert.equal((await other('/account/shopping',{method:'PUT',body:{ownerId:user.id,revision:0,shopping:saved.data.shopping}})).status,409);assert.equal((await c('/account/shopping',{method:'PUT',body:{ownerId:user.id,revision:0,shopping:saved.data.shopping}})).status,409);
});
test('password recovery is private, single use, expiring, and revokes existing sessions',async t=>{
  const f=await fixture(t),c=await f.buyer(),guest=f.client();const reply=await f.post(guest,'/auth/forgot-password',{email:'commercebuyer@gmail.com'});assert.equal(reply.status,202);assert.deepEqual((await f.post(guest,'/auth/forgot-password',{email:'doesnotexist@gmail.com'})).data,reply.data);
  const raw=new URLSearchParams(f.resets[0].url.split('?')[1]).get('token');assert.ok(raw);assert.ok(!JSON.stringify(reply).includes(raw));assert.notEqual(f.db.prepare('SELECT token_hash FROM password_resets').get().token_hash,raw);
  const changed=await f.post(guest,'/auth/reset-password',{token:raw,password:'A new safe password 123!'});assert.equal(changed.status,200);assert.equal((await c('/auth/session')).data.user,null);assert.equal((await f.post(guest,'/auth/reset-password',{token:raw,password:PASSWORD})).status,410);
  assert.equal((await f.post(c,'/auth/login',{email:'commercebuyer@gmail.com',password:'A new safe password 123!'})).status,200);
  await f.post(guest,'/auth/forgot-password',{email:'commercebuyer@gmail.com'});const expired=new URLSearchParams(f.resets.at(-1).url.split('?')[1]).get('token');f.advance(1801000);assert.equal((await f.post(guest,'/auth/reset-password',{token:expired,password:PASSWORD})).status,410);
});
test('support messages are private and Management can reply without granting Maintenance access',async t=>{
  const f=await fixture(t),c=await f.buyer(),other=await f.buyer('supportotherbuyer@gmail.com'),manager=await f.staff(),maintainer=await f.staff('maintenance');const made=await f.post(c,'/account/support',{subject:'Order question',message:'Please help me with this test order.'});assert.equal(made.status,201);const ticket=made.data.ticket;
  assert.equal((await other('/account/support')).data.tickets.length,0);assert.equal((await f.post(other,'/account/support/'+ticket.id,{revision:ticket.revision,message:'Try unauthorized reply',status:'open'})).status,404);assert.equal((await maintainer('/admin/support')).status,403);
  assert.equal((await f.post(manager,'/admin/support/'+ticket.id,{revision:ticket.revision,message:'We can help with your order.',status:'closed'})).status,200);assert.equal((await c('/account/support')).data.tickets[0].messages.length,2);
});
test('Sandbox pricing uses the shared quote service and draft shipping without side effects',async t=>{
  const f=await fixture(t),manager=await f.staff(),before=f.db.prepare('SELECT * FROM products').all(),first=(await manager('/catalog')).data.products.find(p=>p.primary>0);const initial=await f.post(manager,'/admin/sandbox/test',{kind:'checkout'});assert.equal(initial.data.result.total,first.price+69);
  assert.equal((await f.post(manager,'/admin/sandbox/draft',{revision:0,settings:{store:{shippingPerSeller:999}}})).status,200);const changed=await f.post(manager,'/admin/sandbox/test',{kind:'checkout'});assert.equal(changed.data.result.total,first.price+999);assert.deepEqual(f.db.prepare('SELECT * FROM products').all(),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
});
test('archived or empty featured catalog renders a safe homepage fallback',async t=>{
  const f=await fixture(t),manager=await f.staff();const source=fs.readFileSync(path.join(f.config.root,'SaleSync_Online_Alive_v5/SaleSync_Online_Alive.html'),'utf8').split(/\r?\n/).find(line=>line.startsWith('function home(){'));let catalog=(await manager('/catalog')).data.products;
  const context={ui:{heroSlide:0},product:id=>catalog.find(p=>p.id===id),e:String,section:()=>'',card:()=>'',storeHighlights:()=>'',visibleProducts:()=>catalog,CATS:[]};
  const p=catalog.find(p=>p.id==='p1');assert.equal((await manager('/admin/catalog/p1',{method:'PATCH',body:{revision:p.revision,published:false,reason:'Archive isolated test listing'}})).status,200);catalog=(await manager('/catalog')).data.products;assert.equal(typeof vm.runInNewContext(source+';home()',context),'string');catalog=[];assert.equal(typeof vm.runInNewContext(source+';home()',context),'string');
});
test('production rejects local payment simulation configuration',()=>{
  assert.throws(()=>loadConfig({APP_SECRET:'a'.repeat(96),DATABASE_PATH:':memory:',NODE_ENV:'production',APP_ORIGIN:'https://example.test',COOKIE_SECURE:'true',PAYMENT_MODE:'local-test'}),/local-test/);
});
test('reserved orders retain their original price and refuse mismatched saved payment amounts',async t=>{
  const f=await fixture(t),c=await f.buyer(),manager=await f.staff(),order=await f.create(c);const p=(await manager('/admin/catalog')).data.products.find(p=>p.id==='p1');
  assert.equal((await manager('/admin/catalog/p1',{method:'PATCH',body:{revision:p.revision,price:p.price-100}})).status,200);
  f.db.prepare('UPDATE payment_attempts SET amount_cents=amount_cents-1 WHERE id=?').run(order.payment.id);
  assert.equal((await f.pay(c,order)).data.error.code,'PAYMENT_MISMATCH');assert.equal(f.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='sale'").get().n,0);
  f.db.prepare('UPDATE payment_attempts SET amount_cents=? WHERE id=?').run(Math.round(order.total*100),order.payment.id);
  const paid=await f.pay(c,order);assert.equal(paid.status,200);assert.equal(paid.data.order.total,order.total);assert.equal(paid.data.order.lines[0].price,order.lines[0].price);
});
test('uploads require catalog permissions, reject SVG, and serve only generated image filenames',async t=>{
  const f=await fixture(t),c=await f.buyer(),manager=await f.staff();const base64=fs.readFileSync(path.join(f.config.root,'SaleSync_Online_Alive_v5/assets/logo-email.png')).toString('base64');
  assert.equal((await f.post(c,'/admin/media',{base64})).status,403);assert.equal((await f.post(c,'/seller/media',{base64})).status,403);
  assert.equal((await f.post(manager,'/admin/media',{base64:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')})).status,422);
  const uploaded=await f.post(manager,'/admin/media',{base64});assert.equal(uploaded.status,201);const image=await fetch(f.base+uploaded.data.url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal((await fetch(f.base+'/assets/uploads/qa.sqlite')).status,404);assert.ok(fs.existsSync(path.join(f.config.uploadDir,path.basename(uploaded.data.url))));
});
test('changing a password requires the current password and revokes sessions and outstanding reset links',async t=>{
  const f=await fixture(t),c=await f.buyer(),other=f.client();await f.post(other,'/auth/login',{email:'commercebuyer@gmail.com',password:PASSWORD});await f.post(f.client(),'/auth/forgot-password',{email:'commercebuyer@gmail.com'});
  assert.equal((await f.post(c,'/account/password',{currentPassword:'Incorrect password',password:'New commerce password 927!'})).status,422);
  assert.equal((await f.post(c,'/account/password',{currentPassword:PASSWORD,password:'New commerce password 927!'})).status,200);
  assert.equal((await c('/auth/session')).data.user,null);assert.equal((await other('/auth/session')).data.user,null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM password_resets').get().n,0);
});
test('default-address changes are conflict checked and deleting the default promotes a remaining address',async t=>{
  const f=await fixture(t),c=await f.buyer();const first=(await f.post(c,'/account/addresses',{...ADDRESS,default:true})).data.addresses[0];const two=await f.post(c,'/account/addresses',{...ADDRESS,address:'456 Other Street',default:true});assert.equal(two.status,201);assert.equal(two.data.addresses.filter(a=>a.default).length,1);
  assert.equal((await c('/account/addresses/'+first.id,{method:'PATCH',body:{...ADDRESS,default:false,revision:first.revision}})).status,409);
  const current=two.data.addresses.find(a=>a.default);const removed=await c('/account/addresses/'+current.id,{method:'DELETE',body:{revision:current.revision}});assert.equal(removed.status,200);assert.equal(removed.data.addresses.length,1);assert.equal(removed.data.addresses[0].default,true);
});

test('phase1 refund quantities preserve history and prevent empty shipment dispatch',async t=>{
 const app=await fixture(t),c=await app.buyer(),m=await app.staff();let order=await app.create(c,[{id:'p1',qty:2}]);order=(await app.pay(c,order)).data.order;
 let response=await m('/admin/orders/'+order.id+'/refund',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:{revision:order.revision,reason:'Partial cancellation before shipping',restock:true,items:[{id:'p1',qty:1}],refundShipping:false}});
 assert.equal(response.status,200);order=response.data.order;assert.equal(order.lines[0].qty,2);assert.equal(order.lines[0].fulfillableQty,1);
 response=await m('/admin/orders/'+order.id+'/refund',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:{revision:order.revision,reason:'Cancel remaining merchandise units',restock:true,items:[{id:'p1',qty:1}],refundShipping:false}});
 assert.equal(response.status,200);order=response.data.order;assert.equal(order.lines[0].fulfillableQty,0);
 const sh=order.shipments[0];assert.equal((await m('/admin/shipments/'+sh.id,{method:'PATCH',body:{revision:sh.revision,status:'processing'}})).status,422);
 assert.equal(app.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('phase1 seller shipment mutation returns only owned lines and shipments',async t=>{
 const app=await fixture(t),buyer=await app.buyer(),seller=await app.buyer('phaseoneseller@gmail.com');const user=(await seller('/account')).data.profile;
 const store=app.commerce.productRow('p1').store_id;app.db.prepare('UPDATE stores SET owner_id=? WHERE id=?').run(user.id,store);
 let order=await app.create(buyer,[{id:'p1',qty:1},{id:'p5',qty:1}]);order=(await app.pay(buyer,order)).data.order;const sh=order.shipments.find(s=>s.storeId===store);
 const response=await seller('/seller/shipments/'+sh.id,{method:'PATCH',body:{revision:sh.revision,status:'processing'}});
 assert.equal(response.status,200);assert.deepEqual(response.data.order.lines.map(l=>l.id),['p1']);assert.equal(response.data.order.shipments.length,1);assert.equal(response.data.order.customerEmail,undefined);assert.equal(response.data.order.history,undefined);
 const other=order.shipments.find(s=>s.storeId!==store);assert.equal((await seller('/seller/shipments/'+other.id,{method:'PATCH',body:{revision:other.revision,status:'processing'}})).status,403);
});
test('phase1 address collection deletion is a client error',async t=>{const app=await fixture(t),c=await app.buyer();assert.equal((await c('/account/addresses',{method:'DELETE',body:{}})).status,405);assert.equal(app.db.prepare('PRAGMA foreign_key_check').all().length,0);});
test('phase1 online backup captures WAL and reopening does not reseed an empty catalog',async t=>{
 const app=await fixture(t);const {backupDatabase}=require('../scripts/backup-database.cjs');const target=path.join(path.dirname(app.config.dbPath),'snapshot.sqlite');
 await backupDatabase(app.config.dbPath,target);const {DatabaseSync}=require('node:sqlite');const copy=new DatabaseSync(target);assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.equal(copy.prepare('SELECT COUNT(*) n FROM products').get().n,12);copy.exec('PRAGMA foreign_keys=OFF; DELETE FROM product_meta; DELETE FROM inventory_movements; DELETE FROM products;');copy.close();
 const reopened=require('../backend/database.cjs').openDatabase({...app.config,dbPath:target});assert.equal(reopened.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,5);reopened.close();await assert.rejects(backupDatabase(app.config.dbPath,target));
});

test('phase1 account adoption clears private checkout and account caches on identity changes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../SaleSync_Online_Alive_v5/assets/live.js'),'utf8');const fn=source.slice(source.indexOf('function adoptSession('),source.indexOf('async function ensureProducts('));
 const state={user:{id:'old'},orders:[{id:'private'}],adminData:{private:true},settings:{private:true},checkoutDone:{id:'private'},checkoutKey:'old',checkoutSignature:'old'};const ui={shipping:{address:'private'},paymentOrderId:'private'};let resets=0;
 const context={state,ui,db:{},commerceUI:{afterLogout(){resets++;ui.paymentOrderId=null;}},session:{user:{id:'new',role:'customer',name:'New',email:'new@gmail.com'},csrfToken:'new-csrf',permissions:[]}};vm.createContext(context);vm.runInContext(fn+';adoptSession(session);',context);
 assert.equal(resets,1);assert.equal(Object.keys(ui.shipping).length,0);assert.equal(state.orders.length,0);assert.equal(state.checkoutDone,null);assert.equal(state.checkoutKey,null);assert.equal(ui.paymentOrderId,null);assert.equal(state.user.id,'new');vm.runInContext('adoptSession(session)',context);assert.equal(resets,1);
});

test('phase1 refunded seller units do not block another seller fulfillment',async t=>{
 const app=await fixture(t),c=await app.buyer(),m=await app.staff();let order=await app.create(c,[{id:'p1',qty:1},{id:'p5',qty:1}]);order=(await app.pay(c,order)).data.order;
 const result=await m('/admin/orders/'+order.id+'/refund',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:{revision:order.revision,reason:'Cancel first seller merchandise',restock:true,items:[{id:'p1',qty:1}],refundShipping:false}});assert.equal(result.status,200);order=result.data.order;
 const store=app.commerce.productRow('p5').store_id;let sh=order.shipments.find(sh=>sh.storeId===store);
 for(const status of ['processing','packed','shipped','out_for_delivery','delivered']){const result=await m('/admin/shipments/'+sh.id,{method:'PATCH',body:{revision:sh.revision,status,courier:'Test courier',tracking:'TEST-123'}});assert.equal(result.status,200);order=result.data.order;sh=order.shipments.find(value=>value.id===sh.id);}
 assert.equal(order.status,'delivered');assert.equal(order.lines.find(line=>line.id==='p1').fulfillableQty,0);assert.equal(app.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
