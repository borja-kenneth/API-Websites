const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {provisionLocalCatalog,startLocalCatalog,ownersFor}=require('../scripts/local-seller-catalog.cjs');
const {createApp}=require('../backend/app.cjs');
const {buildPlan}=require('../scripts/import-seller-catalog.cjs');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function client(app){const cookies=new Map();let csrf='';return async(route,method='GET',body,headers={})=>{const r=await fetch(app.config.origin+'/api/v1'+route,{method,headers:{Origin:app.config.origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const v of r.headers.getSetCookie()){const [key,...rest]=v.split(';')[0].split('=');if(rest.join('='))cookies.set(key,rest.join('='));else cookies.delete(key);}const data=await r.json();if(data.csrfToken)csrf=data.csrfToken;return {status:r.status,data,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')};};}
async function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-local-sellers-')),port=await freePort();let app; t.after(async()=>{await app?.close();assert.ok(directory.startsWith(os.tmpdir()+path.sep));fs.rmSync(directory,{recursive:true,force:true});});const report=await provisionLocalCatalog({directory,port,apply:true,confirmation:'LOCAL-CATALOG-DEMO'});app=await startLocalCatalog({directory,port});return {app,report,directory,port,accounts:JSON.parse(fs.readFileSync(path.join(directory,'accounts.json'),'utf8')),restart:async()=>{await app.close();app=await startLocalCatalog({directory,port});return app;}};}

test('local fixture provisioning refuses missing confirmation, production and regular database targets without writing data',async t=>{
 const directory=path.join(os.tmpdir(),'salesync-no-provision-'+randomBytes(8).toString('hex'));
 assert.equal((await provisionLocalCatalog({directory})).plannedUnits,124);assert.equal(fs.existsSync(directory),false);
 await assert.rejects(provisionLocalCatalog({directory,apply:true}),/confirmation|confirm=/);assert.equal(fs.existsSync(directory),false);
 await assert.rejects(provisionLocalCatalog({directory,apply:true,confirmation:'LOCAL-CATALOG-DEMO',env:{NODE_ENV:'production'}}),/production/);
 await assert.rejects(provisionLocalCatalog({directory:path.resolve(__dirname,'../data'),apply:true,confirmation:'LOCAL-CATALOG-DEMO'}),/separate local/);
});

test('synthetic local identities have distinct hashed passwords, honest activation labels and exact catalog ownership',async t=>{
 const f=await setup(t);assert.equal(f.report.createdAccounts,5);assert.equal(f.report.createStores,2);assert.equal(f.report.createProducts,12);assert.equal(f.report.createVariants,26);assert.equal(f.report.integrity.ok,true);assert.equal(new Set(f.accounts.map(a=>a.password)).size,5);
 for(const [label,count] of [['techhub',5],['stylehub',7]]){const a=f.accounts.find(a=>a.label===label),c=client(f.app),login=await c('/auth/login','POST',{email:a.email,password:a.password});assert.equal(login.status,200);assert.equal(login.data.user.verified,false);assert.equal(login.data.user.localFixture,true);assert.equal(login.data.user.activation,'local-development-only');assert.ok(!f.app.db.prepare('SELECT password_hash FROM users WHERE id=?').get(a.id).password_hash.includes(a.password));const catalog=(await c('/seller/catalog')).data;assert.equal(catalog.products.length,count);assert.ok(catalog.products.every(p=>p.storeId===catalog.stores[0].id));assert.equal((await c('/seller/orders')).status,200);assert.equal((await c('/seller/reports')).status,200);}
 assert.equal(f.app.commerce.products().length,12);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM product_variants').get().n,26);assert.equal(f.app.db.prepare("SELECT SUM(json_extract(data,'$.primary')) n FROM products").get().n,124);
 const customer=client(f.app),catalog=await customer('/catalog');assert.equal(catalog.data.demo,true);assert.equal(catalog.data.stores.length,2);
 const unrelated=await customer('/auth/register','POST',{name:'Unapproved synthetic signup',email:'techhub@catalog.salesync.invalid',password:randomBytes(20).toString('hex')});assert.equal(unrelated.status,422);
});

test('fixture sessions, proxy requests, public hosts, CSRF and role boundaries remain isolated',async t=>{
 const f=await setup(t),seller=f.accounts.find(a=>a.label==='techhub'),other=f.accounts.find(a=>a.label==='stylehub'),c=client(f.app);const login=await c('/auth/login','POST',{email:seller.email,password:seller.password});assert.equal(login.status,200);
 for(const headers of [{'X-Forwarded-For':'203.0.113.2'},{Forwarded:'for=203.0.113.2'},{'X-Forwarded-Host':'public.example.test'},{Via:'proxy'}])assert.equal((await c('/auth/session','GET',undefined,headers)).status,403,Object.keys(headers)[0]);
 const hostStatus=await new Promise((resolve,reject)=>{require('node:http').get({hostname:'127.0.0.1',port:f.port,path:'/api/v1/health',headers:{Host:'public.example.test'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});assert.equal(hostStatus,403);
 assert.equal((await c('/seller/store','PATCH',{revision:1,tagline:'Unauthorized change'},{'X-CSRF-Token':'wrong'})).status,403);
 const otherStore=f.app.db.prepare('SELECT id FROM stores WHERE owner_id=?').get(other.id),p=f.app.commerce.products({all:true,storeId:otherStore.id})[0];assert.equal((await c('/seller/catalog/'+p.id,'PATCH',{revision:p.revision,price:1})).status,403);
 for(const role of ['management','maintenance']){const a=f.accounts.find(a=>a.label===role),api=client(f.app);await api('/auth/login','POST',{email:a.email,password:a.password});assert.equal((await api('/admin/'+(role==='management'?'sellers':'health'))).status,200);assert.equal((await api('/admin/'+(role==='management'?'health':'sellers'))).status,403);}
 await assert.rejects(createApp({...f.app.config,catalogDemo:false},{mailer:{configured:false}}),/dedicated loopback-only/);
 const regular=await createApp({...f.app.config,dbPath:path.join(f.directory,'regular-control.sqlite'),catalogDemo:false},{mailer:{configured:false}});try{await new Promise(r=>regular.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+regular.server.address().port;const session=await(await fetch(url+'/api/v1/auth/session',{headers:{Origin:f.app.config.origin,Cookie:login.cookie}})).json();assert.equal(session.user,null);const r=await fetch(url+'/api/v1/auth/login',{method:'POST',headers:{Origin:f.app.config.origin,'Content-Type':'application/json'},body:JSON.stringify({email:seller.email,password:seller.password})});assert.equal(r.status,401);assert.equal(regular.commerce.products().length,0);assert.equal(regular.commerce.publicStores().length,0);}finally{await regular.close();}
});

test('idempotent restart preserves accounts, edited inventory, audits and records, and ordinary importer refuses synthetic owners',async t=>{
 const f=await setup(t),before=fs.readFileSync(path.join(f.directory,'accounts.json'),'utf8'),row=f.app.db.prepare("SELECT product_id FROM product_meta WHERE sku='TH-HP-BLK'").get(),owner=f.app.db.prepare('SELECT * FROM users WHERE id=?').get(f.accounts.find(a=>a.label==='techhub').id);f.app.commerce.adjustStock(owner,row.product_id,{revision:f.app.commerce.productRow(row.product_id).revision,delta:-1,reason:'Counted sample stock locally'});
 const result=await provisionLocalCatalog({directory:f.directory,port:f.port,apply:true,confirmation:'LOCAL-CATALOG-DEMO'});assert.equal(result.createdAccounts,0);assert.equal(result.createProducts,0);assert.equal(result.skipProducts,12);assert.equal(result.skipStores,2);assert.equal(fs.readFileSync(path.join(f.directory,'accounts.json'),'utf8'),before);
 const app=await f.restart();assert.equal(app.commerce.productView(app.commerce.productRow(row.product_id)).onHand,9);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n,5);assert.equal(app.db.prepare('PRAGMA user_version').get().user_version,5);assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 const plan=buildPlan(app.db,require('../fixtures/seller-catalog-pack.json'),ownersFor(f.accounts));assert.ok(plan.blockers.length>0);
});

test('wishlists and four-product comparison retain variant parents while cart still requires an exact purchasable SKU',async t=>{
 const f=await setup(t),a=f.accounts.find(a=>a.label==='customer'),c=client(f.app);await c('/auth/login','POST',{email:a.email,password:a.password});
 const products=f.app.commerce.products(),p=products.find(p=>p.sku==='DEMO-EC-P1'),v=p.variants[0];const shopping={cart:{[v.id]:1},wish:[p.id],compare:products.slice(0,4).map(p=>p.id),saved:[v.id]};
 const saved=await c('/account/shopping','PUT',{ownerId:a.id,revision:0,shopping});assert.equal(saved.status,200);assert.deepEqual(saved.data.shopping,shopping);assert.deepEqual((await c('/account/shopping')).data.shopping,shopping);
 const invalid=await c('/account/shopping','PUT',{ownerId:a.id,revision:saved.data.revision,shopping:{...shopping,cart:{[p.id]:1}}});assert.equal(invalid.status,422);assert.equal(invalid.data.error.code,'VARIATION_REQUIRED');assert.deepEqual((await c('/account/shopping')).data.shopping,shopping);
});
