const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const {buildPlan,applyImport,validateManifest}=require('../scripts/import-seller-catalog.cjs');
const {fixture}=require('./helpers/catalog-import-fixture.cjs');
const {verifyDatabase}=require('../scripts/backup-database.cjs');
async function setup(t){const f=await fixture();t.after(async()=>{await f.close();assert.ok(f.directory.startsWith(os.tmpdir()+path.sep));fs.rmSync(f.directory,{recursive:true,force:true});});return f;}
const content=db=>JSON.stringify(['users','stores','products','product_meta','inventory_movements','orders','audit','settings'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));

test('readonly plan validates supplied pack, rejects shared Gmail identities and unverified owners without changing records',async t=>{
 const f=await setup(t),before=content(f.db),plan=buildPlan(f.db,f.manifest,f.owners);
 assert.deepEqual(plan.summary,{createStores:2,skipStores:0,createProducts:12,skipProducts:0,createVariants:26,allocateUnits:124,createAccounts:0});assert.deepEqual(plan.blockers,[]);assert.equal(content(f.db),before);
 const aliases=buildPlan(f.db,f.manifest,{...f.owners,sellers:{'sample-techhub':'sample.mailbox+tech@gmail.com','sample-stylehub':'samplemailbox+style@gmail.com'}});assert.ok(aliases.blockers.some(s=>s.includes('same Gmail identity')));
 const first=f.sellers[0],row=f.db.prepare('SELECT id FROM users WHERE email=?').get(first.email);f.db.prepare("UPDATE users SET status='pending',verified_at=NULL WHERE id=?").run(row.id);
 const invalid=buildPlan(f.db,f.manifest,f.owners);assert.ok(invalid.blockers.some(s=>s.includes('register and verify')));await assert.rejects(applyImport({dbPath:f.config.dbPath,manifest:f.manifest,owners:f.owners,approval:invalid.approval}),/blocked/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stores').get().n,0);
 const bad=structuredClone(f.manifest);bad.products[0].totalStockOnHand++;assert.throws(()=>validateManifest(bad),/exactly equal/);
 const traversal=structuredClone(f.manifest);traversal.products[0].existingLocalFallback='../private.svg';assert.throws(()=>validateManifest(traversal),/authorized local/);
});

test('import requires reviewed approval, preserves accounts/settings/orders, backs up WAL and uses approved owned stores with exact variant inventory',async t=>{
 const f=await setup(t),plan=buildPlan(f.db,f.manifest,f.owners),users=JSON.stringify(f.db.prepare('SELECT * FROM users ORDER BY id').all()),settings=JSON.stringify(f.db.prepare('SELECT * FROM settings').all());
 const args={dbPath:f.config.dbPath,manifest:f.manifest,owners:f.owners};await assert.rejects(applyImport({...args,approval:'unapproved'}),/confirmation/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stores').get().n,0);
 const result=await applyImport({...args,approval:plan.approval});assert.equal(result.createProducts,12);assert.equal(result.createVariants,26);assert.equal(verifyDatabase(result.backup).ok,true);
 const backup=new DatabaseSync(result.backup,{readOnly:true});assert.equal(backup.prepare('SELECT COUNT(*) n FROM stores').get().n,0);assert.equal(backup.prepare('SELECT COUNT(*) n FROM users').get().n,4);backup.close();
 assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM users ORDER BY id').all()),users);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM settings').all()),settings);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,38);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM product_variants').get().n,26);
 assert.equal(f.db.prepare("SELECT SUM(json_extract(data,'$.primary')) n FROM products").get().n,124);assert.equal(f.db.prepare('SELECT SUM(delta) n FROM inventory_movements').get().n,124);
 for(const p of f.manifest.products){const row=f.db.prepare('SELECT product_id FROM product_meta WHERE sku=?').get(p.baseSku),product=f.commerce.productView(f.commerce.productRow(row.product_id));assert.equal(product.unallocatedOnHand,0);assert.equal(product.onHand,p.totalStockOnHand);assert.equal(product.variants.length,p.variants.length);assert.equal(product.price,p.pricePHP);assert.equal(product.was,p.compareAtPHP);for(const v of p.variants){const actual=product.variants.find(x=>x.sku===v.sku);assert.equal(actual.onHand,v.stockOnHand);assert.deepEqual(actual.options,v.optionValues);}}
 const catalog=(await f.client()('/catalog')).data;assert.equal(catalog.demo,false);assert.equal(catalog.products.length,12);assert.equal(catalog.stores.length,2);assert.ok(catalog.stores.every(s=>s.name.includes('Demo')&&s.status==='approved'));
 assert.equal((await f.sellers[0].call('/seller/catalog')).data.products.length,5);assert.equal((await f.sellers[1].call('/seller/catalog')).data.products.length,7);
 const other=(await f.sellers[1].call('/seller/catalog')).data.products[0];assert.equal((await f.sellers[0].call('/seller/catalog/'+other.id,'PATCH',{revision:other.revision,price:1})).status,403);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='SELLER_APPLIED'").get().n,2);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='STORE_UPDATED'").get().n,2);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('repeated imports skip fixtures without resetting seller-adjusted stock or creating another backup',async t=>{
 const f=await setup(t),args={dbPath:f.config.dbPath,manifest:f.manifest,owners:f.owners};await applyImport({...args,approval:buildPlan(f.db,f.manifest,f.owners).approval});
 const v=f.db.prepare("SELECT product_id FROM product_meta WHERE sku='TH-HP-BLK'").get(),row=f.commerce.productRow(v.product_id),seller=f.db.prepare('SELECT * FROM users WHERE email=?').get(f.sellers[0].email);f.commerce.adjustStock(seller,v.product_id,{revision:row.revision,delta:-1,reason:'Isolated counted stock adjustment'});
 const before=content(f.db),plan=buildPlan(f.db,f.manifest,f.owners),result=await applyImport({...args,approval:plan.approval});assert.equal(result.createProducts,0);assert.equal(result.skipProducts,12);assert.equal(result.skipStores,2);assert.equal(result.backup,null);assert.equal(content(f.db),before);assert.equal(f.commerce.productView(f.commerce.productRow(v.product_id)).onHand,9);assert.equal(fs.readdirSync(path.join(f.directory,'backups')).filter(name=>name.endsWith('.sqlite')).length,1);
});

test('SKU/name collisions are blocked, and a late inventory failure rolls the complete import back',async t=>{
 const f=await setup(t),args={dbPath:f.config.dbPath,manifest:f.manifest,owners:f.owners};
 const seller=f.db.prepare('SELECT * FROM users WHERE email=?').get(f.sellers[0].email),pending=f.commerce.applyStore(seller,{name:f.manifest.stores[0].name,description:'An unrelated store record must be preserved.',tagline:'Existing store'});let plan=buildPlan(f.db,f.manifest,f.owners);assert.ok(plan.blockers.some(s=>s.includes('unrelated record')));await assert.rejects(applyImport({...args,approval:plan.approval}),/blocked/);
 // Remove only this isolated test's deliberately conflicting fixture before the rollback scenario.
 f.db.prepare('DELETE FROM stores WHERE id=?').run(pending.id);
 f.db.exec("CREATE TRIGGER isolated_inventory_failure BEFORE INSERT ON product_meta WHEN NEW.sku='DEMO-EC-P12' BEGIN SELECT RAISE(ABORT,'isolated inventory failure'); END");
 const before=content(f.db);plan=buildPlan(f.db,f.manifest,f.owners);await assert.rejects(applyImport({...args,approval:plan.approval}),/isolated inventory failure/);assert.equal(content(f.db),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(verifyDatabase(f.config.dbPath).ok,true);
});

test('catalog and variant quantities persist after reopening without seeding or migrations',async t=>{
 const f=await setup(t);await applyImport({dbPath:f.config.dbPath,manifest:f.manifest,owners:f.owners,approval:buildPlan(f.db,f.manifest,f.owners).approval});
 await f.close();
 const reader=new DatabaseSync(f.config.dbPath,{readOnly:true});try{assert.equal(reader.prepare('PRAGMA user_version').get().user_version,5);assert.equal(reader.prepare('SELECT COUNT(*) n FROM stores').get().n,2);assert.equal(reader.prepare('SELECT COUNT(*) n FROM product_variants').get().n,26);assert.equal(reader.prepare("SELECT SUM(json_extract(data,'$.primary')) n FROM products").get().n,124);assert.equal(reader.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(reader.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reader.close();}
});

test('variant SKU collisions and non-Management approvers cannot change existing inventory',async t=>{
 const f=await setup(t),owner=f.db.prepare('SELECT * FROM users WHERE email=?').get(f.sellers[0].email),manager=f.db.prepare('SELECT * FROM users WHERE id=?').get(f.owners.managerId);
 const store=f.commerce.applyStore(owner,{name:'Existing unrelated fixture shop',description:'Existing isolated records must remain intact.',tagline:'Existing inventory'});f.commerce.updateStore(manager,store.id,{revision:store.revision,status:'approved',reason:'Reviewed isolated existing fixture'});
 f.commerce.saveProduct(owner,null,{name:'Existing SKU record',description:'Unrelated record',sku:'TH-HP-BLK',category:'Electronics',price:100,was:100,primary:3,published:true,photo:'assets/products/p1.svg',spec:{}});
 const before=content(f.db),plan=buildPlan(f.db,f.manifest,f.owners);assert.ok(plan.blockers.some(s=>s.includes('variant SKU collision')));await assert.rejects(applyImport({dbPath:f.config.dbPath,manifest:f.manifest,owners:f.owners,approval:plan.approval}),/blocked/);assert.equal(content(f.db),before);
 const maintenance=f.db.prepare("SELECT id FROM users WHERE role='maintenance'").get();assert.ok(buildPlan(f.db,f.manifest,{...f.owners,managerId:maintenance.id}).blockers.some(s=>s.includes('Management account')));
});

test('CLI refuses implicit targets, presentation targets and production before opening a database',()=>{
 const script=path.resolve(__dirname,'../scripts/import-seller-catalog.cjs');
 for(const args of [['--apply'],['--target=presentation','--apply']]){const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true});assert.equal(result.status,1);assert.match(result.stderr,/target=regular/);}
 const production=spawnSync(process.execPath,[script,'--target=regular','--dry-run'],{encoding:'utf8',windowsHide:true,env:{...process.env,NODE_ENV:'production'}});assert.equal(production.status,1);assert.match(production.stderr,/developer-only/);
});
