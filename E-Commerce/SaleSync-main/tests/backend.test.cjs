const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {loadConfig}=require('../backend/config.cjs');

test('configuration validates ports, canonical callback origins and test credentials with sanitized actionable errors',()=>{
  const base={APP_SECRET:'a'.repeat(48),MAIL_MODE:'disabled',PAYMENT_MODE:'disabled'};
  for(const PORT of ['NaN','1.5','65536','-1','0'])assert.throws(()=>loadConfig({...base,PORT}),/PORT must be an integer/);
  for(const APP_ORIGIN of ['https://example.test/path','https://example.test/','https://user:private@example.test','javascript:private'])assert.throws(()=>loadConfig({...base,APP_ORIGIN}),error=>error.constructor.name==='ConfigurationError'&&!error.message.includes('private'));
  assert.throws(()=>loadConfig({...base,API_ALLOWED_ORIGINS:'http://localhost:3000,https://example.test/path'}),/API_ALLOWED_ORIGINS/);
  const config=loadConfig({...base,APP_ORIGIN:'https://example.ngrok-free.dev',API_ALLOWED_ORIGINS:'http://127.0.0.1:3000,http://localhost:3000'});
  assert.equal(config.origin,'https://example.ngrok-free.dev');
  const payment={...base,PAYMENT_MODE:'paymongo-test',PAYMONGO_SECRET_KEY:'sk_test_IsolatedOnly',PAYMONGO_WEBHOOK_SECRET:'isolated-endpoint-secret',PAYMONGO_PAYMENT_METHODS:'qrph'};
  for(const PAYMONGO_SECRET_KEY of ['strippedPrivateKey','sk_live_PrivateKey'])assert.throws(()=>loadConfig({...payment,PAYMONGO_SECRET_KEY}),error=>error.message.includes('sk_test_')&&!error.message.includes(PAYMONGO_SECRET_KEY));
  assert.throws(()=>loadConfig({...payment,PAYMONGO_WEBHOOK_SECRET:'pk_test_PrivateKey'}),/endpoint signing secret/);
  assert.equal(loadConfig(payment).paymentMode,'paymongo-test');
});
const {createApp,provisionAdmin}=require('../backend/app.cjs');
const {createMailer}=require('../backend/mailer.cjs');
const {digest}=require('../backend/security.cjs');
const PASSWORD='Secure test password 924!';
test('Google Workspace sender accepts a custom domain and normalizes grouped app passwords without sending real mail',async()=>{
  let options,message;
  const mailer=createMailer({MAIL_MODE:'gmail',GMAIL_USER:' Sender@School.Example ',GMAIL_APP_PASSWORD:' abcd efgh ijkl mnop  '},config=>{options=config;return {sendMail:async value=>{message=value;}};});
  assert.equal(mailer.configured,true);assert.equal(options.service,'gmail');assert.equal(options.auth.user,'sender@school.example');assert.equal(options.auth.pass,'abcdefghijklmnop');
  await mailer.sendVerification('recipient@gmail.com','1234',300);assert.equal(message.from.address,'sender@school.example');assert.equal(message.to,'recipient@gmail.com');
  assert.equal(createMailer({GMAIL_USER:'not-an-address',GMAIL_APP_PASSWORD:'placeholder'}).configured,false);
  assert.equal(createMailer({GMAIL_USER:'sender@school.example',GMAIL_APP_PASSWORD:'   '}).configured,false);
});
async function fixture(t,{mailFailure=false,admins=false,mailDelay=0,mailDisabled=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-test-'));
  let time=Date.now(),failMail=mailFailure;
  const sent=[];
  const config=loadConfig({CATALOG_DEMO:'true',DATABASE_PATH:path.join(directory,'test.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://127.0.0.1:3000',MAIL_MODE:'disabled',PAYMENT_MODE:'disabled'});
  const mailer=mailDisabled?createMailer({MAIL_MODE:'disabled'}):{configured:true,sendVerification:async(to,code,ttl)=>{if(mailDelay)await new Promise(r=>setTimeout(r,mailDelay));if(failMail)throw Error('private smtp details');sent.push({to,code,ttl});},sandboxEmail:createMailer({MAIL_MODE:'disabled'}).sandboxEmail};
  const app=await createApp(config,{now:()=>time,mailer});
  if(admins){await provisionAdmin(app.db,{name:'Management Person',email:'manager.test@gmail.com',password:PASSWORD,role:'management'},()=>time);await provisionAdmin(app.db,{name:'Maintenance Person',email:'maintainer.test@gmail.com',password:PASSWORD,role:'maintenance'},()=>time);}
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await app.close();const target=path.resolve(directory);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
  function client(){const cookies=new Map();let csrf;
    return {cookies,async request(route,{method='GET',body,headers={},noCsrf=false}={}){
      const response=await fetch(base+'/api/v1'+route,{method,headers:{Origin:config.origin,...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(route==='/orders'&&method==='POST'?{'Idempotency-Key':randomBytes(20).toString('hex')}:{}),...(!noCsrf&&csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');if(part.slice(i+1))cookies.set(part.slice(0,i),part.slice(i+1));else cookies.delete(part.slice(0,i));}
      const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;
      return {status:response.status,data,headers:response.headers};
    }};
  }
  const post=(c,route,body={})=>c.request(route,{method:'POST',body});
  async function customer(c,email='shopper.test@gmail.com'){
    assert.equal((await post(c,'/auth/register',{name:'Test Customer',email,password:PASSWORD})).status,201);
    const result=await post(c,'/auth/verify',{code:sent.at(-1).code});assert.equal(result.status,200);return result.data.user;
  }
  async function staff(role){const c=client();assert.equal((await post(c,'/auth/login',{email:role==='management'?'manager.test@gmail.com':'maintainer.test@gmail.com',password:PASSWORD})).status,200);return c;}
  return {...app,config,base,client,post,customer,staff,sent,advance:ms=>{time+=ms;},mailFailure:value=>{failMail=value;}};
}
test('registration stores password and code hashes, remains inactive until verification, and single-use codes activate a session',async t=>{
  const f=await fixture(t),c=f.client();
  const r=await f.post(c,'/auth/register',{name:'Test Customer',email:'shopper.test@gmail.com',password:PASSWORD});
  assert.equal(r.status,201);assert.equal(f.sent.length,1);assert.match(f.sent[0].code,/^\d{4}$/);
  assert.ok(!JSON.stringify(r.data).includes(f.sent[0].code));assert.ok(!('code' in r.data));
  const u=f.db.prepare('SELECT * FROM users').get(),challenge=f.db.prepare('SELECT * FROM challenges').get();
  assert.equal(u.role,'customer');assert.equal(u.status,'pending');assert.notEqual(u.password_hash,PASSWORD);assert.notEqual(challenge.code_hash,f.sent[0].code);
  assert.equal((await c.request('/auth/session')).data.user,null);
  assert.equal((await f.post(c,'/orders',{items:[]})).status,401);
  const verified=await f.post(c,'/auth/verify',{code:f.sent[0].code});
  assert.equal(verified.status,200);assert.equal(verified.data.user.verified,true);assert.match(verified.headers.getSetCookie().join(';'),/HttpOnly/);
  assert.equal((await f.post(c,'/auth/verify',{code:f.sent[0].code})).status,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM challenges').get().n,0);
  assert.equal((await c.request('/auth/session')).data.user.role,'customer');
});
test('Gmail aliases cannot create duplicate users; registration cannot assign privileged roles',async t=>{
  const f=await fixture(t),c=f.client();await f.customer(c,'someone.test@gmail.com');
  const other=f.client();assert.equal((await f.post(other,'/auth/register',{name:'Other Person',email:'s.o.m.e.o.n.e.test+tag@gmail.com',password:PASSWORD})).status,409);
  assert.equal((await f.post(other,'/auth/register',{name:'Other Person',email:'other@gmail.com',password:PASSWORD,role:'management'})).status,422);
  for(const email of ['person@outlook.com','not-an-email','person@gmail.com.attacker.com'])assert.equal((await f.post(other,'/auth/register',{name:'Other Person',email,password:PASSWORD})).status,422);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
});
test('incorrect codes lock after five attempts, valid code cannot bypass lock, and resends have cooldown and hourly quota',async t=>{
  const f=await fixture(t),c=f.client();await f.post(c,'/auth/register',{name:'Test Customer',email:'shopper@gmail.com',password:PASSWORD});
  const code=f.sent[0].code,wrong=code==='0000'?'0001':'0000';
  for(let i=0;i<5;i++){const r=await f.post(c,'/auth/verify',{code:wrong});assert.equal(r.status,i===4?429:422);assert.equal(r.data.error.attemptsRemaining,4-i);}
  assert.equal((await f.post(c,'/auth/verify',{code})).data.error.code,'TOO_MANY_ATTEMPTS');
  assert.equal((await f.post(c,'/auth/resend')).data.error.code,'RESEND_COOLDOWN');
  for(let i=0;i<4;i++){f.advance(61000);assert.equal((await f.post(c,'/auth/resend')).status,200);}
  f.advance(61000);assert.equal((await f.post(c,'/auth/resend')).status,429);assert.equal(f.sent.length,5);
});
test('expired codes fail and sending a new code invalidates the previous challenge',async t=>{
  const f=await fixture(t),c=f.client();await f.post(c,'/auth/register',{name:'Test Customer',email:'shopper@gmail.com',password:PASSWORD});
  const first=f.db.prepare('SELECT code_hash,nonce FROM challenges').get();f.advance(301000);
  assert.equal((await f.post(c,'/auth/verify',{code:f.sent[0].code})).data.error.code,'CODE_EXPIRED');
  assert.equal((await f.post(c,'/auth/resend')).status,200);
  const next=f.db.prepare('SELECT code_hash,nonce FROM challenges').get();assert.notEqual(next.code_hash,first.code_hash);assert.notEqual(next.nonce,first.nonce);
  assert.notEqual(f.sent[0].code,f.sent[1].code);assert.equal((await f.post(c,'/auth/verify',{code:f.sent[0].code})).status,422);
  assert.equal((await f.post(c,'/auth/verify',{code:f.sent[1].code})).status,200);
});
test('delivery failures preserve registration, disclose no SMTP secrets, and can be retried',async t=>{
  const f=await fixture(t,{mailFailure:true}),c=f.client();const r=await f.post(c,'/auth/register',{name:'Saved Name',email:'saved@gmail.com',password:PASSWORD});
  assert.equal(r.status,503);assert.equal(r.data.error.pending,true);assert.ok(!JSON.stringify(r).includes('private smtp'));
  const pending=await c.request('/auth/pending');assert.equal(pending.data.name,'Saved Name');assert.equal(pending.data.email,'saved@gmail.com');assert.equal(pending.data.state,'delivery_failed');
  assert.equal(f.db.prepare('SELECT code_hash FROM challenges').get().code_hash,null);
  f.mailFailure(false);f.advance(61000);assert.equal((await f.post(c,'/auth/resend')).status,200);assert.equal((await f.post(c,'/auth/verify',{code:f.sent[0].code})).status,200);
});

test('retrying saved registration during email cooldown reports pending state and never duplicates or activates the account',async t=>{
 const f=await fixture(t,{mailFailure:true}),c=f.client(),input={name:'Saved Retry Customer',email:'savedretry@gmail.com',password:PASSWORD};
 assert.equal((await f.post(c,'/auth/register',input)).status,503);
 const retry=await f.post(c,'/auth/register',input);assert.equal(retry.status,429);assert.equal(retry.data.error.code,'RESEND_COOLDOWN');assert.equal(retry.data.error.pending,true);assert.ok(retry.data.error.retryAfter>0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);assert.equal(f.db.prepare('SELECT status FROM users').get().status,'pending');assert.equal(f.db.prepare('SELECT code_hash FROM challenges').get().code_hash,null);
 assert.equal((await c.request('/auth/pending')).data.state,'delivery_failed');
 f.mailFailure(false);f.advance(61000);assert.equal((await f.post(c,'/auth/register',input)).status,201);assert.equal((await f.post(c,'/auth/verify',{code:f.sent[0].code})).status,200);
});
test('unverified login resumes the saved registration; authenticated sessions expire and logout revokes them',async t=>{
  const f=await fixture(t),c=f.client();await f.post(c,'/auth/register',{name:'Saved Name',email:'saved@gmail.com',password:PASSWORD});
  c.cookies.clear();const login=await f.post(c,'/auth/login',{email:'saved@gmail.com',password:PASSWORD});assert.equal(login.status,403);assert.equal(login.data.error.code,'EMAIL_UNVERIFIED');assert.equal((await c.request('/auth/pending')).data.name,'Saved Name');
  await f.post(c,'/auth/verify',{code:f.sent[0].code});const old=c.cookies.get('ss_session');
  assert.equal((await f.post(c,'/auth/logout')).status,200);assert.equal(f.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(digest(old)),undefined);
  assert.equal((await f.post(c,'/auth/login',{email:'saved@gmail.com',password:PASSWORD})).status,200);
  f.advance(28801000);assert.equal((await c.request('/auth/session')).data.user,null);
});
test('backend enforces both admin roles, session CSRF, origin checks, and prohibits role assignment',async t=>{
  const f=await fixture(t,{admins:true}),manager=await f.staff('management'),maintainer=await f.staff('maintenance'),guest=f.client();
  const customer=f.client();await f.customer(customer);
  assert.equal((await guest.request('/admin/settings')).status,401);assert.equal((await customer.request('/admin/settings')).status,403);
  for(const route of ['/admin/catalog','/admin/customers','/admin/reports','/orders'])assert.equal((await maintainer.request(route)).status,403);
  assert.equal((await manager.request('/admin/health')).status,403);assert.equal((await maintainer.request('/admin/health')).status,200);
  assert.equal((await manager.request('/admin/settings')).data.data.email,undefined);
  assert.equal((await maintainer.request('/admin/settings')).data.data.store,undefined);
  assert.equal((await manager.request('/admin/sandbox/draft',{method:'POST',body:{revision:0,settings:{store:{name:'Valid shop'}}},noCsrf:true})).status,403);
  assert.equal((await f.post(manager,'/admin/sandbox/draft',{revision:0,settings:{email:{maxAttempts:2}}})).status,403);
  assert.equal((await manager.request('/admin/settings',{headers:{Origin:'https://attacker.test'}})).status,403);
  assert.equal((await f.post(manager,'/admin/users',{role:'maintenance'})).status,404);
  assert.equal((await manager.request('/admin/customers/'+(await customer.request('/auth/session')).data.user.id,{method:'PATCH',body:{role:'maintenance'}})).status,422);
});
test('sandbox draft validation, preview, explicit apply, audit and rollback preserve role boundaries',async t=>{
  const f=await fixture(t,{admins:true}),c=await f.staff('management');
  const original=(await c.request('/admin/settings')).data;
  assert.equal((await f.post(c,'/admin/sandbox/draft',{revision:0,settings:{store:{shippingPerSeller:-1}}})).status,422);
  const saved=await f.post(c,'/admin/sandbox/draft',{revision:0,settings:{store:{name:'New SaleSync Name',shippingPerSeller:42}}});assert.equal(saved.status,200);
  assert.equal((await c.request('/catalog')).data.settings.store.name,'SaleSync Online');
  assert.equal((await c.request('/admin/sandbox/preview')).data.data.store.name,'New SaleSync Name');
  assert.equal((await f.post(c,'/admin/sandbox/validate')).data.valid,true);
  assert.equal((await f.post(c,'/admin/sandbox/apply',{revision:1,reason:'Store setup change'})).status,422);
  const applied=await f.post(c,'/admin/sandbox/apply',{revision:1,confirm:'APPLY',reason:'Store setup change'});assert.equal(applied.status,200);
  assert.equal((await c.request('/catalog')).data.settings.store.name,'New SaleSync Name');
  assert.equal((await c.request('/admin/settings')).data.draft,null);
  const rollback=await f.post(c,`/admin/settings/history/${applied.data.historyId}/rollback`,{version:2,confirm:'ROLLBACK',reason:'Restore previous store name'});assert.equal(rollback.status,200);
  assert.deepEqual((await c.request('/admin/settings')).data.data,original.data);
  const audit=(await c.request('/admin/audit')).data.events;assert.ok(audit.some(x=>x.action==='CONFIG_APPLIED'));assert.ok(audit.some(x=>x.action==='CONFIG_ROLLED_BACK'));assert.ok(audit.every(x=>x.actor_id));
  assert.equal((await f.post(c,`/admin/settings/history/${applied.data.historyId}/rollback`,{version:3,confirm:'ROLLBACK',reason:'Try rollback again'})).status,409);
});
test('stale drafts and overlapping rollback are rejected; one role cannot roll back another role’s settings',async t=>{
  const f=await fixture(t,{admins:true}),manager=await f.staff('management'),maintainer=await f.staff('maintenance');
  await f.post(manager,'/admin/sandbox/draft',{revision:0,settings:{store:{name:'Version Two'}}});
  await f.post(maintainer,'/admin/sandbox/draft',{revision:0,settings:{email:{maxAttempts:3}}});
  const first=await f.post(manager,'/admin/sandbox/apply',{revision:1,confirm:'APPLY',reason:'Update store name'});assert.equal(first.status,200);
  assert.equal((await f.post(maintainer,'/admin/sandbox/apply',{revision:1,confirm:'APPLY',reason:'Tighten email limits'})).status,409);
  assert.equal((await f.post(maintainer,`/admin/settings/history/${first.data.historyId}/rollback`,{version:2,confirm:'ROLLBACK',reason:'Unauthorized rollback'})).status,403);
  await f.post(manager,'/admin/sandbox/draft',{revision:0,settings:{store:{name:'Version Three'}}});await f.post(manager,'/admin/sandbox/apply',{revision:1,confirm:'APPLY',reason:'Update store name again'});
  assert.equal((await f.post(manager,`/admin/settings/history/${first.data.historyId}/rollback`,{version:3,confirm:'ROLLBACK',reason:'Overlapping rollback'})).status,409);
});
test('sandbox email and checkout use separate records, never affect accounts, real email, orders, stock or live settings',async t=>{
  const f=await fixture(t,{admins:true}),manager=await f.staff('management'),maintainer=await f.staff('maintenance');
  const snapshot=()=>({products:f.db.prepare('SELECT * FROM products').all(),orders:f.db.prepare('SELECT * FROM orders').all(),users:f.db.prepare('SELECT * FROM users').all(),settings:f.db.prepare('SELECT * FROM settings').all()});
  const before=snapshot();const checkout=await f.post(manager,'/admin/sandbox/test',{kind:'checkout'});const email=await f.post(maintainer,'/admin/sandbox/test',{kind:'email'});
  assert.equal(checkout.status,200);assert.equal(checkout.data.result.charged,false);assert.equal(email.status,200);assert.equal(email.data.result.realEmailSent,false);assert.equal(f.sent.length,0);assert.deepEqual(snapshot(),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sandbox_records').get().n,2);
  assert.equal((await manager.request('/admin/sandbox/preview')).data.records.length,1);assert.equal((await maintainer.request('/admin/sandbox/preview')).data.records.length,1);
  assert.equal((await f.post(manager,'/admin/sandbox/test',{kind:'email'})).status,403);
  await f.post(manager,'/admin/sandbox/draft',{revision:0,settings:{store:{name:'Discard this draft'}}});assert.equal((await manager.request('/admin/sandbox/draft',{method:'DELETE',body:{revision:1}})).status,200);assert.equal((await manager.request('/admin/settings')).data.draft,null);
});
test('browse → cart payload → order validates prices/stock on the server, preserves unpaid stock, and restricts customer order reads',async t=>{
  const f=await fixture(t,{admins:true}),c=f.client(),other=f.client(),manager=await f.staff('management');await f.customer(c);await f.customer(other,'secondcustomer@gmail.com');
  const catalog=(await c.request('/catalog')).data;assert.equal(catalog.products.length,12);
  const p=catalog.products[0],delivery={name:'Test Person',phone:'09171234567',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'};
  assert.equal((await f.post(c,'/orders',{items:[{id:p.id,qty:999}],delivery})).status,409);
  assert.equal((await f.post(c,'/orders',{items:[{id:p.id,qty:1}],delivery,total:1})).status,422);
  const order=await f.post(c,'/orders',{items:[{id:p.id,qty:2,price:0.01}],delivery});assert.equal(order.status,201);assert.equal(order.data.order.total,p.price*2+69);assert.equal(order.data.order.status,'awaiting_gateway');
  assert.equal((await c.request('/catalog')).data.products[0].primary,p.primary);
  assert.equal((await c.request('/orders')).data.orders.length,1);assert.equal((await other.request('/orders')).data.orders.length,0);
  const cancelled=await manager.request('/admin/orders/'+order.data.order.id,{method:'PATCH',body:{status:'cancelled',revision:order.data.order.revision}});assert.equal(cancelled.status,200);
  assert.equal((await manager.request('/admin/orders/'+order.data.order.id,{method:'PATCH',body:{status:'paid',revision:cancelled.data.order.revision}})).status,422);
});
test('catalog updates and customer suspension are role protected, audited, and revoke customer sessions',async t=>{
  const f=await fixture(t,{admins:true}),c=f.client(),manager=await f.staff('management'),maintainer=await f.staff('maintenance'),u=await f.customer(c);
  const product=(await manager.request('/admin/catalog')).data.products[0];
  assert.equal((await manager.request('/admin/catalog/'+product.id,{method:'PATCH',body:{primary:7,revision:product.revision,reason:'Correct counted warehouse stock'}})).status,200);
  assert.equal((await c.request('/catalog')).data.products[0].primary,7);
  assert.equal((await maintainer.request('/admin/catalog/'+product.id,{method:'PATCH',body:{primary:0}})).status,403);
  assert.equal((await manager.request('/admin/customers/'+u.id,{method:'PATCH',body:{status:'suspended',reason:'Reviewed account support request'}})).status,200);
  assert.equal((await c.request('/auth/session')).data.user,null);
  assert.equal((await f.post(c,'/auth/login',{email:u.email,password:PASSWORD})).status,401);
  assert.ok((await manager.request('/admin/audit')).data.events.some(x=>x.action==='PRODUCT_UPDATED'));
});
test('applied maintenance prevents new orders and email settings control future challenge TTL',async t=>{
  const f=await fixture(t,{admins:true}),maintainer=await f.staff('maintenance'),c=f.client();await f.customer(c);
  await f.post(maintainer,'/admin/sandbox/draft',{revision:0,settings:{maintenance:{enabled:true,message:'Store maintenance is in progress.'},email:{ttlSeconds:60,maxAttempts:2}}});
  assert.equal((await f.post(maintainer,'/admin/sandbox/apply',{revision:1,confirm:'APPLY',reason:'Planned system maintenance'})).status,200);
  assert.equal((await f.post(c,'/orders',{items:[]})).data.error.code,'MAINTENANCE');
  const fresh=f.client();await f.post(fresh,'/auth/register',{name:'New Customer',email:'newcustomer@gmail.com',password:PASSWORD});assert.equal(f.sent.at(-1).ttl,60);f.advance(61000);
  assert.equal((await f.post(fresh,'/auth/verify',{code:f.sent.at(-1).code})).data.error.code,'CODE_EXPIRED');
});
test('private files are never served and request validation rejects cross-site and invalid bodies',async t=>{
  const f=await fixture(t),c=f.client();
  for(const target of ['/.env','/data/salesync.sqlite','/backend/app.cjs','/checkpoints/before-fullstack-upgrade-2026-10-22.zip','/assets/../README.md'])assert.equal((await fetch(f.base+target)).status,404);
  assert.equal((await fetch(f.base+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(f.base+'/api/v1/auth/register',{method:'POST',headers:{Origin:f.config.origin,'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await c.request('/auth/register',{method:'POST',body:{name:'X',email:'no',password:'short'}})).status,422);
  assert.equal((await fetch(f.base+'/api/v1/auth/register',{method:'POST',headers:{Origin:f.config.origin,'Content-Type':'application/json'},body:'{'})).status,400);
  const definition=await c.request('/openapi.json');assert.equal(definition.status,200);assert.equal(definition.data.openapi,'3.0.3');assert.ok(definition.data.paths['/admin/sandbox/apply']);
});
test('concurrent verification consumes one code once and concurrent resends issue one replacement',async t=>{
  const f=await fixture(t,{mailDelay:30}),c=f.client();
  await f.post(c,'/auth/register',{name:'Concurrent Customer',email:'concurrent@gmail.com',password:PASSWORD});f.advance(61000);
  const resends=await Promise.all([f.post(c,'/auth/resend'),f.post(c,'/auth/resend'),f.post(c,'/auth/resend')]);
  assert.equal(resends.filter(r=>r.status===200).length,1);assert.equal(f.sent.length,2);
  const verifications=await Promise.all([f.post(c,'/auth/verify',{code:f.sent.at(-1).code}),f.post(c,'/auth/verify',{code:f.sent.at(-1).code})]);
  assert.equal(verifications.filter(r=>r.status===200).length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
});
test('missing Gmail credentials are reported honestly without activating an account',async t=>{
  const f=await fixture(t,{mailDisabled:true}),c=f.client();assert.equal((await c.request('/catalog')).data.mailConfigured,false);
  const result=await f.post(c,'/auth/register',{name:'Pending Customer',email:'pending@gmail.com',password:PASSWORD});assert.equal(result.status,503);assert.equal(result.data.error.code,'MAIL_NOT_CONFIGURED');
  assert.equal((await c.request('/auth/pending')).data.state,'delivery_failed');assert.equal(f.db.prepare('SELECT status FROM users').get().status,'pending');
});
test('IP registration and mailbox login rate limits are enforced on the backend',async t=>{
  const f=await fixture(t),c=f.client();
  for(let i=0;i<10;i++)assert.equal((await f.post(c,'/auth/register',{name:'X'})).status,422);
  assert.equal((await f.post(c,'/auth/register',{name:'Valid Person',email:'valid@gmail.com',password:PASSWORD})).status,429);
  for(let i=0;i<8;i++)assert.equal((await f.post(c,'/auth/login',{email:'unknown@gmail.com',password:PASSWORD})).status,401);
  const throttled=await f.post(c,'/auth/login',{email:'unknown@gmail.com',password:PASSWORD});assert.equal(throttled.status,429);assert.ok(Number(throttled.headers.get('Retry-After'))>0);
});
test('database migrations preserve account and order records across a reopened connection',async t=>{
  const {openDatabase}=require('../backend/database.cjs');const f=await fixture(t),c=f.client();await f.customer(c);
  const order=await f.post(c,'/orders',{items:[{id:'p1',qty:1}],delivery:{name:'Test Person',phone:'09171234567',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'}});assert.equal(order.status,201);
  const before=f.db.prepare('SELECT id,email,password_hash FROM users').all(),ordersBefore=f.db.prepare('SELECT * FROM orders').all();
  f.db.exec('ALTER TABLE challenges DROP COLUMN last_code_fingerprint; PRAGMA user_version=1;');
  const reopened=openDatabase(f.config);
  try{assert.deepEqual(reopened.prepare('SELECT id,email,password_hash FROM users').all(),before);assert.deepEqual(reopened.prepare('SELECT * FROM orders').all(),ordersBefore);assert.ok(reopened.prepare('PRAGMA table_info(challenges)').all().some(c=>c.name==='last_code_fingerprint'));assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,5);}finally{reopened.close();}
});

test('phase1 JSON decoding preserves UTF-8 across network chunks',async t=>{
 const app=await fixture(t),http=require('node:http');const payload=Buffer.from(JSON.stringify({name:'Jos\u00e9 Audit',email:'utfphaseone@gmail.com',password:PASSWORD}));const split=payload.indexOf(Buffer.from('\u00e9'))+1;
 const response=await new Promise((resolve,reject)=>{const req=http.request(app.base+'/api/v1/auth/register',{method:'POST',headers:{Origin:app.config.origin,'Content-Type':'application/json','Content-Length':payload.length}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.write(payload.subarray(0,split));setTimeout(()=>req.end(payload.subarray(split)),30);});
 assert.equal(response.status,201);assert.equal(app.db.prepare('SELECT name FROM users WHERE email=?').get('utfphaseone@gmail.com').name,'Jos\u00e9 Audit');
});


test('regular initialization is empty, WAL-safe, writable and persistent without demo seeding',async t=>{
 const {openDatabase}=require('../backend/database.cjs'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-regular-'));
 t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const config=loadConfig({DATABASE_PATH:path.join(directory,'regular.sqlite'),APP_SECRET:'r'.repeat(64),MAIL_MODE:'disabled',PAYMENT_MODE:'disabled'});
 let db=openDatabase(config);
 try{for(const table of ['users','stores','products','orders'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);db.prepare("INSERT INTO audit(actor_role,action,details,created_at) VALUES ('system','PERSISTENCE_TEST','{}',?)").run(Date.now());}finally{db.close();}
 db=openDatabase(config);try{assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='PERSISTENCE_TEST'").get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
});
test('central permissions deny unknown roles and immutable grants cannot expand privileges',()=>{
 const {PERMISSIONS,hasPermission}=require('../backend/permissions.cjs');assert.ok(Object.isFrozen(PERMISSIONS));for(const grants of Object.values(PERMISSIONS))assert.ok(Object.isFrozen(grants));for(const role of ['seller','admin','constructor','__proto__','unknown'])assert.equal(hasPermission(role,'catalog:write'),false);assert.equal(hasPermission('maintenance','catalog:write'),false);assert.equal(hasPermission('management','health:read'),false);assert.equal(hasPermission('customer','orders:own'),true);
});
test('role boundaries reject public promotion and cross-store reads and writes without mutation',async t=>{
 const f=await fixture(t,{admins:true}),manager=await f.staff('management'),maintenance=await f.staff('maintenance'),one=f.client(),two=f.client();await f.customer(one,'boundaryone@gmail.com');await f.customer(two,'boundarytwo@gmail.com');
 for(const route of ['/admin/catalog','/admin/sellers','/admin/customers','/admin/reports']){assert.equal((await f.client().request(route)).status,401);assert.equal((await one.request(route)).status,403);assert.equal((await maintenance.request(route)).status,403);assert.equal((await manager.request(route)).status,200);}
 assert.equal((await manager.request('/admin/health')).status,403);assert.equal((await maintenance.request('/admin/health')).status,200);assert.equal((await maintenance.request('/orders')).status,403);
 assert.equal((await f.post(f.client(),'/auth/register',{name:'Invalid Promotion',email:'invalidpromotion@gmail.com',password:PASSWORD,role:'management'})).status,422);
 for(const [client,name] of [[one,'Boundary One'],[two,'Boundary Two']]){const made=await f.post(client,'/seller/application',{name,tagline:'Isolated test store',description:'Store used only by isolated permission tests'});assert.equal(made.status,201);assert.equal((await client.request('/seller/catalog')).status,403);assert.equal((await manager.request('/admin/sellers/'+made.data.store.id,{method:'PATCH',body:{revision:made.data.store.revision,status:'approved',reason:'Reviewed isolated permission fixture'}})).status,200);}
 const made=await f.post(one,'/seller/catalog',{name:'Boundary fixture',description:'Isolated product',category:'Electronics',sku:'BOUNDARY-ONE',price:100,was:100,primary:5,published:false,photo:'',spec:{}});assert.equal(made.status,201);const product=made.data.product;
 for(const route of ['/seller/inventory/'+product.id,'/seller/catalog/'+product.id+'/variations']){const denied=await two.request(route);assert.equal(denied.status,403);assert.ok(!denied.data.product&&!denied.data.movements);}
 assert.equal((await two.request('/seller/catalog/'+product.id,{method:'PATCH',body:{revision:product.revision,price:1}})).status,403);
 assert.equal((await f.post(two,'/seller/inventory/'+product.id+'/adjustments',{revision:product.revision,delta:100,reason:'Unauthorized adjustment'})).status,403);
 assert.equal(f.commerce.productView(f.commerce.productRow(product.id)).price,100);assert.equal(f.commerce.productView(f.commerce.productRow(product.id)).onHand,5);
 assert.equal((await one.request('/account',{method:'PATCH',body:{role:'management'}})).status,422);assert.equal(f.db.prepare('SELECT role FROM users WHERE email=?').get('boundaryone@gmail.com').role,'customer');
});
test('maintenance technical audit omits customer identifiers while preserving business audit access',async t=>{
 const f=await fixture(t,{admins:true}),customer=f.client(),user=await f.customer(customer,'auditscope@gmail.com'),maintenance=await f.staff('maintenance');
 f.db.prepare("INSERT INTO audit(actor_id,actor_role,action,details,created_at) VALUES (?,'customer','RECOVERY_DELIVERED',?,?)").run(user.id,JSON.stringify({accountId:user.id,email:'auditscope@gmail.com'}),Date.now());
 const result=await maintenance.request('/admin/audit');assert.equal(result.status,200);const event=result.data.events.find(e=>e.action==='RECOVERY_DELIVERED');assert.ok(event);assert.equal(event.actor_id,null);assert.equal(event.actor_name,null);assert.deepEqual(event.details,{});assert.ok(!JSON.stringify(result.data).includes('auditscope@gmail.com'));
});

test('administrator provisioning cannot leave an unaudited account or promote an existing customer',async t=>{
 const f=await fixture(t),c=f.client();await f.customer(c,'nopromotion@gmail.com');await assert.rejects(provisionAdmin(f.db,{name:'Invalid Promotion',email:'nopromotion@gmail.com',password:PASSWORD,role:'management'}));assert.equal(f.db.prepare("SELECT role FROM users WHERE email='nopromotion@gmail.com'").get().role,'customer');
 f.db.exec("CREATE TEMP TRIGGER reject_admin_audit BEFORE INSERT ON audit WHEN NEW.action='ADMIN_PROVISIONED' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
 await assert.rejects(provisionAdmin(f.db,{name:'Atomic Administrator',email:'atomicadmin@gmail.com',password:PASSWORD,role:'management'}));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM users WHERE email='atomicadmin@gmail.com'").get().n,0);f.db.exec('DROP TRIGGER reject_admin_audit');
});
