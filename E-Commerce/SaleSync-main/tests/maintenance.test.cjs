const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {createApp,provisionAdmin}=require('../backend/app.cjs');
const {loadConfig}=require('../backend/config.cjs');
const {backupDatabase,verifyDatabase}=require('../scripts/backup-database.cjs');
const PASSWORD='Isolated maintenance test password 825!';
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-maintenance-'));
 const config=loadConfig({DATABASE_PATH:path.join(directory,'qa.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),MAIL_MODE:'disabled',PAYMENT_MODE:'disabled',AFTERSHIP_API_KEY:'private-api-key-should-not-appear',APP_ORIGIN:'http://127.0.0.1:3000'});
 const app=await createApp(config);
 await provisionAdmin(app.db,{name:'Local Maintainer',email:'isolatedmaintainer@gmail.com',password:PASSWORD,role:'maintenance'});
 await provisionAdmin(app.db,{name:'Local Manager',email:'isolatedmanager@gmail.com',password:PASSWORD,role:'management'});
 const hash=app.db.prepare("SELECT password_hash FROM users LIMIT 1").get().password_hash;
 app.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,'customer','active',?,?)").run(randomUUID(),'Private Buyer','privatebuyer@gmail.com','privatebuyer@gmail.com',hash,Date.now(),Date.now());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await app.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 function client(){let cookie='',csrf='';return async(route,method='GET',body,noCsrf=false)=>{const r=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:config.origin,Cookie:cookie,...(!noCsrf&&csrf?{'X-CSRF-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});if(r.headers.getSetCookie().length)cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const data=await r.json();if(data.csrfToken)csrf=data.csrfToken;return {status:r.status,data};};}
 async function login(email){const c=client();assert.equal((await c('/auth/login','POST',{email,password:PASSWORD})).status,200);return c;}
 return {...app,config,directory,client,maintenance:await login('isolatedmaintainer@gmail.com'),manager:await login('isolatedmanager@gmail.com'),buyer:await login('privatebuyer@gmail.com')};
}
test('technical health reports actual WAL, role-scoped queues, readiness and scheduler lifecycle without secrets',async t=>{
 const f=await fixture(t);let r=await f.maintenance('/admin/health');assert.equal(r.status,200);assert.equal(r.data.databaseDetails.schema,5);assert.equal(r.data.databaseDetails.journal,'wal');assert.equal(r.data.databaseDetails.foreignKeys,true);assert.equal(r.data.jobs.background.scheduled,false);assert.equal(r.data.jobs.background.lastCompletedAt,null);assert.equal(r.data.jobs.reservations.scheduled,true);assert.ok(r.data.uptimeSeconds>=0);assert.deepEqual(r.data.orderEmailQueue,[]);assert.equal(r.data.integrations.payment.realMoneyReady,false);assert.equal(r.data.integrations.email.configured,false);assert.equal(r.data.integrations.pos.configured,false);
 f.startWorkers();await f.runWorkers();r=await f.maintenance('/admin/health');assert.equal(r.data.jobs.background.scheduled,true);assert.equal(r.data.jobs.background.status,'completed');assert.equal(r.data.jobs.background.running,false);assert.ok(r.data.jobs.background.lastCompletedAt);f.courier.poll=async()=>{throw Error('private provider failure');};await f.runWorkers();const failed=(await f.maintenance('/admin/health')).data;assert.equal(failed.jobs.background.status,'failed');assert.equal(failed.jobs.background.running,false);assert.ok(failed.errors.some(e=>e.category==='BACKGROUND_JOB_FAILED'));for(const secret of [f.config.secret,f.directory,'privatebuyer@gmail.com','private-api-key-should-not-appear','password_hash'])assert.ok(!JSON.stringify(r.data).includes(secret));
});
test('maintenance backup and integrity operations deny every other role and enforce reasons, CSRF and method validation',async t=>{
 const f=await fixture(t);for(const c of [f.client(),f.manager,f.buyer])for(const route of ['/admin/health','/admin/backups','/admin/database/verify']){const r=await c(route,route.endsWith('/verify')?'POST':'GET',route.endsWith('/verify')?{reason:'Authorized technical check'}:undefined);assert.equal(r.status,c===f.manager||c===f.buyer?403:401);}
 for(const route of ['/admin/customers','/admin/reports','/admin/sellers','/seller/reports','/orders'])assert.equal((await f.maintenance(route)).status,403);
 assert.equal((await f.maintenance('/admin/backups','POST',{})).status,422);assert.equal((await f.maintenance('/admin/backups','POST',{reason:'Valid reason',destination:'../../other.sqlite'})).status,422);assert.equal((await f.maintenance('/admin/backups','POST',{reason:'Authorized local backup'},true)).status,403);assert.equal((await f.maintenance('/admin/backups','DELETE',{reason:'Invalid method'})).status,405);assert.equal((await f.maintenance('/admin/backups/not-a-backup/verify','POST',{reason:'Reject arbitrary file'})).status,404);
});
test('manual backup captures committed WAL, reopens independently, verifies integrity and records a privacy-safe audit',async t=>{
 const f=await fixture(t);f.db.exec('PRAGMA wal_autocheckpoint=0');f.audit(null,'QA_COMMITTED_WAL',{marker:'durable snapshot'});
 const created=await f.maintenance('/admin/backups','POST',{reason:'Operational snapshot before a local update'});assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.data.ok,true);const id=created.data.backup.id,copy=path.join(f.directory,'backups',id);assert.ok(created.data.backup.bytes>0);assert.equal(verifyDatabase(copy).ok,true);
 const db=new DatabaseSync(copy,{readOnly:true});try{assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='QA_COMMITTED_WAL'").get().n,1);assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);}finally{db.close();}
 assert.equal((await f.maintenance('/admin/backups')).data.backups[0].id,id);assert.equal((await f.maintenance('/admin/backups/'+id+'/verify','POST',{reason:'Read-only restore readiness check'})).data.ok,true);assert.equal((await f.maintenance('/admin/database/verify','POST',{reason:'Verify the active database'})).data.ok,true);
 assert.ok(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='DATABASE_BACKUP_COMPLETED'").get().n);const audit=JSON.stringify((await f.maintenance('/admin/audit')).data);assert.ok(audit.includes('DATABASE_BACKUP_COMPLETED'));assert.ok(!audit.includes('Operational snapshot'));assert.ok(!audit.includes(f.directory));
 const blocked=await fetch('http://127.0.0.1:'+f.server.address().port+'/data/backups/'+id);assert.equal(blocked.status,404);
});
test('backup failure leaves no misleading snapshot, existing files survive and corrupted snapshots fail safely',async t=>{
 const f=await fixture(t),bad=path.join(f.directory,'failed.sqlite');await assert.rejects(backupDatabase(path.join(f.directory,'missing.sqlite'),bad));assert.equal(fs.existsSync(bad),false);const sentinel=path.join(f.directory,'keep.sqlite');fs.writeFileSync(sentinel,'existing');await assert.rejects(backupDatabase(f.config.dbPath,sentinel));assert.equal(fs.readFileSync(sentinel,'utf8'),'existing');
 const id='backup-'+randomUUID()+'.sqlite';fs.mkdirSync(path.join(f.directory,'backups'));fs.writeFileSync(path.join(f.directory,'backups',id),'PRIVATE SQLITE CORRUPTION');const r=await f.maintenance('/admin/backups/'+id+'/verify','POST',{reason:'Inspect a damaged local snapshot'});assert.equal(r.status,503);assert.ok(!JSON.stringify(r.data).includes('PRIVATE'));assert.ok(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='DATABASE_INTEGRITY_FAILED'").get().n);assert.equal((await f.maintenance('/admin/database/verify','POST',{reason:'Confirm service remains healthy'})).data.ok,true);
});
test('integrity verification detects foreign-key violations without disclosing damaged records',async t=>{
 const f=await fixture(t);f.db.exec('PRAGMA foreign_keys=OFF');f.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('private-session-token','private-orphan-customer',Date.now()+1000);f.db.exec('PRAGMA foreign_keys=ON');const r=await f.maintenance('/admin/database/verify','POST',{reason:'Inspect database consistency'});assert.equal(r.status,200);assert.equal(r.data.ok,false);assert.equal(r.data.foreignKeyErrors,1);assert.ok(!JSON.stringify(r.data).includes('private-'));await assert.rejects(backupDatabase(f.config.dbPath,path.join(f.directory,'inconsistent.sqlite')));assert.equal(fs.existsSync(path.join(f.directory,'inconsistent.sqlite')),false);
});
test('technical errors and audit details redact free-text credentials and unrelated customer information',async t=>{
 const f=await fixture(t),user=f.db.prepare("SELECT * FROM users WHERE role='maintenance'").get();f.audit(user,'TECHNICAL_TEST',{password:'private-password',email:'privatebuyer@gmail.com',customerId:'private-id',reason:'private-secret'});f.db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run('privatebuyer@gmail.com','private-password diagnostic',Date.now());const health=(await f.maintenance('/admin/health')).data;assert.equal(health.errors[0].reference,'REDACTED');assert.equal(health.errors[0].category,'INTERNAL_ERROR');const report=(await f.maintenance('/admin/audit')).data;const item=report.events.find(e=>e.action==='TECHNICAL_TEST');assert.deepEqual(item.details,{});assert.equal(item.actor_id,null);for(const v of ['private-password','privatebuyer@gmail.com','private-id','private-secret'])assert.ok(!JSON.stringify(report).includes(v));
});
test('local admin command refuses piped credentials before opening or creating a database',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-cli-'));try{const dbPath=path.join(directory,'untouched.sqlite');const r=spawnSync(process.execPath,[path.resolve(__dirname,'../backend/create-admin.cjs')],{input:'A name\nemail@gmail.com\nmaintenance\nDo not echo this secret\n',encoding:'utf8',env:{...process.env,DATABASE_PATH:dbPath}});assert.equal(r.status,1);assert.equal(fs.existsSync(dbPath),false);assert.ok(!r.stdout.includes('Do not echo'));assert.ok(r.stderr.includes('local interactive terminal'));}finally{assert.ok(directory.startsWith(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
});

test('unavailable backup storage returns actionable sanitized failures and records the failed action',async t=>{
 const f=await fixture(t);fs.writeFileSync(path.join(f.directory,'backups'),'storage path occupied');assert.equal((await f.maintenance('/admin/backups')).status,503);const result=await f.maintenance('/admin/backups','POST',{reason:'Check local storage failure handling'});assert.equal(result.status,503);assert.ok(!JSON.stringify(result.data).includes(f.directory));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='DATABASE_BACKUP_FAILED'").get().n,1);assert.equal((await f.maintenance('/admin/health')).data.database,'ok');
});
