// Isolated test-only mail capture; regular registration and mail settings are never changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomBytes,randomUUID}=require('node:crypto');
const {createApp,provisionAdmin}=require('../../backend/app.cjs');
const {loadConfig}=require('../../backend/config.cjs');
async function fixture({directory=fs.mkdtempSync(path.join(os.tmpdir(),'salesync-catalog-import-')),port=0}={}){
 const captured=[],password=randomBytes(24).toString('base64url'),tag=randomBytes(5).toString('hex');
 const config=loadConfig({DATABASE_PATH:path.join(directory,'qa.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),MAIL_MODE:'disabled',PAYMENT_MODE:'disabled',COURIER_MODE:'manual',PORT:String(port||3201),APP_ORIGIN:'http://127.0.0.1:'+(port||3201)});
 const app=await createApp(config,{mailer:{configured:true,sendVerification:async(to,code)=>captured.push({to,code})}});
 await new Promise((r,j)=>{app.server.once('error',j);app.server.listen(port,'127.0.0.1',r);});
 const base='http://127.0.0.1:'+app.server.address().port;
 function client(){const cookies=new Map();let csrf='';return async(route,method='GET',body)=>{
  const response=await fetch(base+'/api/v1'+route,{method,headers:{Origin:config.origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  for(const value of response.headers.getSetCookie()){const [key,...rest]=value.split(';')[0].split('=');const token=rest.join('=');if(token)cookies.set(key,token);else cookies.delete(key);}
  const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data};
 };}
 const managerEmail='catalogmanager'+tag+'@gmail.com',maintenanceEmail='catalogmaintenance'+tag+'@gmail.com';
 const manager=await provisionAdmin(app.db,{name:'Isolated Catalog Manager',email:managerEmail,password,role:'management'});
 await provisionAdmin(app.db,{name:'Isolated Catalog Maintenance',email:maintenanceEmail,password,role:'maintenance'});
 const sellers=[];
 for(const [seedKey,name] of [['sample-techhub','Demo TechHub owner'],['sample-stylehub','Demo StyleHub owner']]){
  const email=seedKey.replaceAll('-','')+tag+'@gmail.com',c=client();
  if((await c('/auth/register','POST',{name,email,password})).status!==201)throw Error('Isolated registration failed');
  if((await c('/auth/verify','POST',{code:captured.at(-1).code})).status!==200)throw Error('Isolated verification failed');
  sellers.push({seedKey,email,call:c});
 }
 const managerCall=client();await managerCall('/auth/login','POST',{email:managerEmail,password});
 let closed=false;
 return {...app,close:async()=>{if(!closed){closed=true;await app.close();}},config,base,directory,password,managerEmail,maintenanceEmail,managerCall,client,sellers,owners:{managerId:manager.id,sellers:Object.fromEntries(sellers.map(s=>[s.seedKey,s.email]))},manifest:JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../fixtures/seller-catalog-pack.json'),'utf8')),captured};
}
module.exports={fixture};
