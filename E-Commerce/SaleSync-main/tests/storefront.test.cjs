const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loadConfig}=require('../backend/config.cjs');
const {createApp}=require('../backend/app.cjs');
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-storefront-'));
 const config=loadConfig({DATABASE_PATH:path.join(directory,'test.sqlite'),APP_SECRET:'x'.repeat(64),MAIL_MODE:'disabled'});
 const app=await createApp(config,{mailer:{configured:false}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
 const get=async route=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/v1'+route);return {status:r.status,data:await r.json()};};
 function owner(id){app.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,'customer','active',?,?)").run(id,id,id+'@gmail.com',id+'@gmail.com','unused',Date.now(),Date.now());return {id,role:'customer'};}
 const manager={id:null,role:'management'};
 function store(id){const user=owner(id);const pending=app.commerce.applyStore(user,{name:id+' Store',description:'Seller supplied description for '+id,tagline:'Seller supplied tagline'});const approved=app.commerce.updateStore(manager,pending.id,{revision:pending.revision,status:'approved',reason:'Reviewed seller application'});return {user,store:approved};}
 function product(user,sku,published=true,extra={}){return app.commerce.saveProduct(user,null,{name:sku,description:'Seller supplied product details',category:'Electronics',sku,price:100,was:100,primary:10,published,photo:'/assets/uploads/11111111-1111-1111-1111-111111111111.png',spec:{},...extra});}
 return {...app,config,get,store,product,manager};
}
test('regular catalog hides seeded and demo accounts without deleting records or changing staff access',async t=>{
 const f=await fixture(t),before=f.db.prepare('SELECT COUNT(*) n FROM products').get().n;
 let catalog=await f.get('/catalog?limit=20');assert.equal(catalog.data.products.length,0);assert.equal(catalog.data.stores.length,0);assert.equal(catalog.data.demo,false);assert.deepEqual(catalog.data.facets.sellers,[]);
 assert.equal((await f.get('/products/p1')).status,404);assert.deepEqual((await f.get('/products/lookup?ids=p1,p2')).data.products,[]);assert.equal(f.commerce.products({all:true}).length,before);
 const demo=f.store('Development');f.db.prepare("INSERT INTO audit(actor_id,actor_role,action,details,created_at) VALUES (?,'customer','LOCAL_DEMO_ACCOUNT_CREATED','{}',?)").run(demo.user.id,Date.now());const dp=f.product(demo.user,'DEMO-EXPLICIT');
 assert.equal((await f.get('/products/'+dp.id)).status,404);assert.equal((await f.get('/catalog')).data.stores.length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,before+1);assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,5);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('approved owned stores expose only their published products with database counts and pagination',async t=>{
 const f=await fixture(t),first=f.store('First'),second=f.store('Second');
 const records=Array.from({length:23},(_,i)=>f.product(first.user,'REAL-'+i));f.product(first.user,'PRIVATE',false);f.product(second.user,'OTHER');
 let catalog=(await f.get('/catalog?limit=20')).data;assert.equal(catalog.pagination.total,24);assert.equal(catalog.products.length,20);assert.equal(catalog.stores.find(s=>s.id===first.store.id).productCount,23);assert.equal(catalog.stores.find(s=>s.id===first.store.id).description,'Seller supplied description for First');
 const page=(await f.get('/products?'+new URLSearchParams({seller:first.store.name,limit:'20',page:'2'}))).data;assert.equal(page.products.length,3);assert.equal(page.pagination.total,23);assert.ok(page.products.every(p=>p.storeId===first.store.id));assert.ok(page.products.every(p=>p.photo===records[0].photo));
 assert.equal((await f.get('/products/'+records[0].id)).status,200);assert.equal((await f.get('/products/lookup?ids='+records[0].id+',p1')).data.products.length,1);
 f.db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(first.user.id);assert.equal((await f.get('/products/'+records[0].id)).status,404);assert.equal((await f.get('/catalog')).data.products.length,1);assert.deepEqual((await f.get('/products?limit=20')).data.facets.sellers,[second.store.name]);
});
test('store product counts exclude variant stock rows and demo mode cannot be enabled in production',async t=>{
 const f=await fixture(t),seller=f.store('Variation');const p=f.product(seller.user,'PARENT');
 f.commerce.variants.save(seller.user,p.id,{revision:p.revision,groups:[{name:'Package',values:['One','Two']}],variants:[{options:{Package:'One'},sku:'PACK-ONE',price:100,primary:5,active:true},{options:{Package:'Two'},sku:'PACK-TWO',price:200,primary:5,active:true}],reason:'Allocate existing stock for test'});
 const catalog=(await f.get('/catalog?limit=20')).data;assert.equal(catalog.stores[0].productCount,1);assert.equal(catalog.pagination.total,1);assert.equal(catalog.products[0].variants.length,2);
 assert.throws(()=>loadConfig({DATABASE_PATH:f.config.dbPath,APP_SECRET:'x'.repeat(64),NODE_ENV:'production',COOKIE_SECURE:'true',APP_ORIGIN:'https://example.test',CATALOG_DEMO:'true'}),/isolated development/);
});
test('category facets expose only published category stores, subcategories and meaningful specifications',async t=>{
 const f=await fixture(t),electronics=f.store('Electronics Seller'),fashion=f.store('Fashion Seller'),home=f.store('Home Seller'),hidden=f.store('Hidden Seller');
 function item(seller,sku,category,subcategory,spec,published=true){const p=f.product(seller.user,sku,published,{category,spec});const data=JSON.parse(f.commerce.productRow(p.id).data);data.subcategory=subcategory;f.db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(data),p.id);return p;}
 item(electronics,'AUDIO-A','Electronics','Audio',{Brand:'Orion',Warranty:'Not specified',Model:'Same model'});
 item(electronics,'AUDIO-B','Electronics','Chargers',{Brand:'Summit',Warranty:'N/A',Model:'Same model'});
 item(fashion,'SHIRT-A','Fashion','Shirts',{Material:'Cotton'});item(fashion,'SHIRT-B','Fashion','Shirts',{Material:'Linen'});
 item(home,'HOME-A','Home & Living','Storage',{Material:'Wood'});item(home,'HOME-B','Home & Living','Storage',{Material:'Steel'});
 item(electronics,'PRIVATE-FILTER','Electronics','Private category',{Brand:'Private brand'},false);item(hidden,'HIDDEN-FILTER','Electronics','Hidden category',{Brand:'Hidden brand'});f.db.prepare("UPDATE stores SET status='suspended' WHERE id=?").run(hidden.store.id);
 const e=(await f.get('/products?category=Electronics&max=0&limit=1')).data;assert.equal(e.pagination.total,0);assert.deepEqual(e.facets.sellers,[electronics.store.name]);assert.deepEqual(e.facets.subcategories,['Audio','Chargers']);assert.deepEqual(e.facets.attributes,[{name:'Brand',values:['Orion','Summit']}]);assert.equal(e.facets.availability,true);
 const fashionData=(await f.get('/products?category=Fashion')).data;assert.deepEqual(fashionData.facets.sellers,[fashion.store.name]);assert.deepEqual(fashionData.facets.subcategories,['Shirts']);assert.deepEqual(fashionData.facets.attributes,[{name:'Material',values:['Cotton','Linen']}]);
 assert.deepEqual((await f.get('/products?category=Home%20%26%20Living')).data.facets.attributes,[{name:'Material',values:['Steel','Wood']}]);
 const empty=(await f.get('/products?category=Beauty')).data;assert.equal(empty.pagination.total,0);assert.deepEqual(empty.facets,{category:'Beauty',sellers:[],subcategories:[],attributes:[],availability:false});
 const global=(await f.get('/products')).data;assert.deepEqual(global.facets.attributes,[]);assert.deepEqual(global.facets.subcategories,[]);
});
test('attribute filtering combines authoritative prices, availability, sorting, counts and pagination',async t=>{
 const f=await fixture(t),seller=f.store('Attribute Seller');
 for(let i=0;i<16;i++)f.product(seller.user,'ATTR-'+i,true,{price:100.5+i,was:200,primary:i===0?0:5,spec:{Brand:i===15?'Summit':'Orion',Connectivity:i%2?'Wireless':'Wired'}});
 const query=new URLSearchParams({category:'Electronics',attributes:JSON.stringify({Brand:'Orion'}),seller:seller.store.name,max:'200',stock:'1',sort:'low',limit:'5',page:'3'});
 const result=(await f.get('/products?'+query)).data;assert.equal(result.pagination.total,14);assert.equal(result.products.length,4);assert.ok(result.products.every(p=>p.spec.Brand==='Orion'&&p.primary>0&&p.price<=200));assert.deepEqual(result.products.map(p=>p.price),[111.5,112.5,113.5,114.5]);
 query.set('attributes',JSON.stringify({Brand:'Orion',Connectivity:'Wireless'}));query.set('page','1');assert.equal((await f.get('/products?'+query)).data.pagination.total,7);
 query.set('attributes',JSON.stringify({Brand:"Orion' OR 1=1 --"}));assert.equal((await f.get('/products?'+query)).data.pagination.total,0);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('invalid attribute selections return client errors without database changes',async t=>{
 const f=await fixture(t),before=f.db.prepare('SELECT COUNT(*) n FROM products').get().n;
 for(const raw of ['["Brand"]','null','{"Brand":2}','{"Brand":""}','{bad',JSON.stringify(Object.fromEntries(Array.from({length:9},(_,i)=>['Field'+i,'Value'])))])assert.equal((await f.get('/products?attributes='+encodeURIComponent(raw))).status,422,raw);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,before);assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,5);
});
