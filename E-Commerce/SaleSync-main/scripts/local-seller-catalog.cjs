// Authorized local fixtures. This process never loads Gmail, PayMongo or POS credentials.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {randomUUID,randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {loadConfig}=require('../backend/config.cjs');
const {openDatabase}=require('../backend/database.cjs');
const {hashPassword,passwordValid}=require('../backend/security.cjs');
const {MARKER,ACTION,validateFixtureMode}=require('../backend/local-fixtures.cjs');
const {backupDatabase,verifyDatabase}=require('./backup-database.cjs');
const {buildPlan,applyImport,validateManifest}=require('./import-seller-catalog.cjs');
const ROOT=path.resolve(__dirname,'..'),DEFAULT=path.join(ROOT,'data/catalog-presentation');
const CONFIRM='LOCAL-CATALOG-DEMO';
const manifest=()=>validateManifest(JSON.parse(fs.readFileSync(path.join(ROOT,'fixtures/seller-catalog-pack.json'),'utf8')));
function guardEnvironment(env=process.env){if(env.NODE_ENV==='production')throw Error('Local fixture provisioning is prohibited in production.');}
function directoryGuard(directory,create=false){
 directory=path.resolve(directory);
 if([path.join(ROOT,'data'),path.join(ROOT,'data/demo'),path.join(ROOT,'data/presentation')].includes(directory))throw Error('Use a separate local catalog database; regular and existing demo records cannot be targeted.');
 if(create)fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(!fs.existsSync(directory)||fs.realpathSync(directory)!==directory||fs.lstatSync(directory).isSymbolicLink())throw Error('Use a real isolated local directory.');
 const marker=path.join(directory,'local-fixtures.json'),database=path.join(directory,'salesync.sqlite');
 if(fs.existsSync(marker)){const saved=JSON.parse(fs.readFileSync(marker,'utf8'));if(saved.kind!==MARKER||saved.database!==database)throw Error('Unrecognized existing database marker.');}
 else if(create){if(fs.existsSync(database)||fs.existsSync(path.join(directory,'accounts.json')))throw Error('Existing unmarked data was left unchanged.');fs.writeFileSync(marker,JSON.stringify({kind:MARKER,database}),{flag:'wx',mode:0o600});}
 else throw Error('Provision the isolated local catalog explicitly before starting it.');
 return directory;
}
function protectDirectory(directory){
 if(process.platform!=='win32'){fs.chmodSync(directory,0o700);return;}
 if(!process.env.USERNAME)throw Error('Cannot identify the local Windows account; refusing to store credentials.');
 const user=(process.env.USERDOMAIN?process.env.USERDOMAIN+'\\':'')+process.env.USERNAME;
 const result=spawnSync('icacls.exe',[directory,'/inheritance:r','/grant:r',user+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('Unable to restrict the private fixture directory; no credentials were written.');
}
function configuration(directory,port){return loadConfig({NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:'http://localhost:'+port,DATABASE_PATH:path.join(directory,'salesync.sqlite'),CATALOG_DEMO:'true',MAIL_MODE:'disabled',PAYMENT_MODE:'local-test',COURIER_MODE:'local-test',POS_ENABLED:'false'});}
function ownersFor(accounts){return {managerId:accounts.find(a=>a.label==='management').id,sellers:{'sample-techhub':accounts.find(a=>a.label==='techhub').email,'sample-stylehub':accounts.find(a=>a.label==='stylehub').email}};}
function readAccounts(directory,db){
 const accounts=JSON.parse(fs.readFileSync(path.join(directory,'accounts.json'),'utf8'));
 const labels=['techhub','stylehub','customer','management','maintenance'];
 if(accounts.length!==5||new Set(accounts.map(a=>a.id)).size!==5||new Set(accounts.map(a=>a.password)).size!==5||labels.some(label=>!accounts.some(a=>a.label===label)))throw Error('Private fixture account file requires review; existing accounts were not changed.');
 for(const a of accounts){if(a.email!==a.label+'@catalog.salesync.invalid'||a.role!==(['management','maintenance'].includes(a.label)?a.label:'customer')||!passwordValid(a.password))throw Error('Invalid private fixture identity.');if(db){const u=db.prepare('SELECT id,role,email FROM users WHERE id=?').get(a.id);if(!u||u.email!==a.email||u.role!==a.role||!db.prepare('SELECT 1 FROM audit WHERE actor_id=? AND action=?').get(a.id,ACTION))throw Error('Existing fixture identity does not match its provisioning audit.');}}
 return accounts;
}
function writeAccountsPage(directory,port,accounts){
 const e=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 fs.writeFileSync(path.join(directory,'accounts.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SaleSync private local fixtures</title><style>body{font:16px/1.6 Arial;background:#f3f6fb;color:#173351;padding:24px}main{max-width:1000px;margin:auto;background:white;padding:24px;border-radius:12px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}div{overflow:auto}</style><main><h1>SaleSync — local catalog presentation</h1><p>Synthetic, non-deliverable identities activated locally. These are not verified Gmail mailboxes. Never expose this server through a proxy or tunnel. Payments and tracking are simulated; no real money.</p><p><a href="http://localhost:'+port+'">Open SaleSync</a> · <a href="mail/index.html">Private captured inbox</a></p><div><table><tr><th>Account</th><th>Login identifier</th><th>Initial password</th></tr>'+accounts.map(a=>'<tr><td>'+e(a.label)+'</td><td>'+e(a.email)+'</td><td><code>'+e(a.password)+'</code></td></tr>').join('')+'</table></div><p>Keep this file private. Passwords listed here are initial values; existing passwords are never reset on restart.</p></main></html>',{mode:0o600});
}
async function provisionLocalCatalog({directory=DEFAULT,port=3003,apply=false,confirmation,env=process.env}={}){
 guardEnvironment(env);
 const data=manifest();
 if(!apply)return {mode:'dry-run',database:path.join(path.resolve(directory),'salesync.sqlite'),plannedAccounts:5,plannedStores:data.stores.map(s=>s.name),plannedProducts:12,plannedVariants:26,plannedUnits:124,confirmationRequired:CONFIRM,regularDatabaseChanged:false};
 if(confirmation!==CONFIRM)throw Error('Explicit --apply and --confirm=LOCAL-CATALOG-DEMO are required.');
 directory=directoryGuard(directory,true);protectDirectory(directory);
 const config=configuration(directory,port);
 // Initialize an empty isolated database, without legacy catalog seeds.
 const db=openDatabase({...config,catalogDemo:false});let accounts,createdAccounts=0,accountBackup=null;
 try{
  const count=db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if(count)accounts=readAccounts(directory,db);
  else{
   accountBackup=path.join(directory,'before-accounts-'+randomUUID()+'.sqlite');await backupDatabase(config.dbPath,accountBackup);
   const file=path.join(directory,'accounts.json');
   accounts=fs.existsSync(file)?readAccounts(directory):['techhub','stylehub','customer','management','maintenance'].map(label=>({id:randomUUID(),label,name:'Demo '+label,email:label+'@catalog.salesync.invalid',role:['management','maintenance'].includes(label)?label:'customer',password:randomBytes(24).toString('base64url')}));
   const hashes=await Promise.all(accounts.map(a=>hashPassword(a.password)));
   if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(accounts,null,2),{flag:'wx',mode:0o600});
   db.exec('BEGIN IMMEDIATE');
   try{accounts.forEach((a,i)=>{
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,'active',?,?)").run(a.id,a.name,a.email,a.email,hashes[i],a.role,Date.now(),Date.now());
    db.prepare("INSERT INTO audit(actor_id,actor_role,action,details,created_at) VALUES (?,'system',?,?,?)").run(a.id,ACTION,JSON.stringify({method:'explicit local fixture CLI',activation:'local-development-only',mailboxVerified:false,role:a.role}),Date.now());
   });db.exec('COMMIT');createdAccounts=accounts.length;}catch(error){db.exec('ROLLBACK');throw error;}
  }
 }finally{db.close();}
 validateFixtureMode(config);
 const owners=ownersFor(accounts),reader=new DatabaseSync(config.dbPath,{readOnly:true});let plan;
 try{plan=buildPlan(reader,data,owners,config);}finally{reader.close();}
 fs.writeFileSync(path.join(directory,'import-plan.json'),JSON.stringify(plan,null,2),{mode:0o600});
 if(plan.blockers.length)throw Error('Local catalog preflight failed; existing records preserved.');
 const imported=await applyImport({dbPath:config.dbPath,manifest:data,owners,approval:plan.approval,fixtureConfig:config});
 writeAccountsPage(directory,port,accounts);
 const {createAccounts:importerAccounts,...catalogResult}=imported;
 return {database:config.dbPath,createdAccounts,...catalogResult,accountBackup,integrity:verifyDatabase(config.dbPath),credentialsFile:path.join(directory,'accounts.html'),origin:config.origin,regularDatabaseChanged:false};
}
async function startLocalCatalog({directory=DEFAULT,port=3003,env=process.env}={}){
 guardEnvironment(env);directory=directoryGuard(directory);const config=configuration(directory,port);validateFixtureMode(config);
 const check=new DatabaseSync(config.dbPath,{readOnly:true});try{readAccounts(directory,check);}finally{check.close();}
 const inbox=require('./local-demo.cjs').createLocalInbox(path.join(directory,'mail'));
 const app=await require('../backend/app.cjs').createApp(config,{localFixtures:true,mailer:inbox.mailer});
 try{await new Promise((r,j)=>{app.server.once('error',j);app.server.listen(port,'127.0.0.1',r);});app.startWorkers();return {...app,config,directory};}catch(error){await app.close();throw error;}
}
async function main(){
 const flags=new Set(process.argv.slice(2));if([...flags].some(f=>!['--apply','--dry-run','--confirm='+CONFIRM,'--serve'].includes(f)))throw Error('Use --dry-run, or --apply --confirm=LOCAL-CATALOG-DEMO; --serve starts the local server.');
 if(flags.has('--dry-run')&&(flags.has('--apply')||flags.has('--serve')))throw Error('Choose dry-run or explicit apply/serve.');
 if(fs.existsSync(path.join(ROOT,'.env'))&&require('node:util').parseEnv(fs.readFileSync(path.join(ROOT,'.env'),'utf8')).NODE_ENV==='production')throw Error('Refusing local fixture provisioning from a production installation.');
 if(!flags.has('--serve')||flags.has('--apply'))console.log(JSON.stringify(await provisionLocalCatalog({apply:flags.has('--apply'),confirmation:flags.has('--confirm='+CONFIRM)?CONFIRM:undefined}),null,2));
 if(flags.has('--serve')){const app=await startLocalCatalog();console.log('LOCAL ONLY: '+app.config.origin+' | Synthetic fixtures; no real payments.');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});}
}
if(require.main===module)main().catch(error=>{console.error(error.code?'Local catalog operation failed: '+error.code:error.message);process.exitCode=1;});
module.exports={provisionLocalCatalog,startLocalCatalog,ownersFor};
