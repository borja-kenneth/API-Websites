/* Connected Chrome POS reference views against isolated backend and provider mocks. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {createApp,provisionAdmin}=require('../backend/app.cjs');
const {loadConfig}=require('../backend/config.cjs');
const {createMailer}=require('../backend/mailer.cjs');
const OUT=path.resolve(__dirname,'../.preview'),ROOT=path.resolve(__dirname,'..');
fs.mkdirSync(OUT,{recursive:true});const directory=fs.mkdtempSync(path.join(OUT,'pos-browser-'));
const FEATURE_QA=process.env.SALESYNC_FEATURE_QA==='1';
const orderEmails=[];
const PASSWORD='Local commerce browser password 927!';
const ADDRESS={name:'Test Buyer',phone:'09123456789',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'};
const messages=[],resets=[],checks=[],errors=[],pending=new Map();
let app,browser,ws,sequence=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('CDP timeout: '+method));},15000).unref();});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(60);}throw Error('Condition not met: '+expression);}
async function action(expression,condition){await evaluate(expression);if(condition)await wait(condition);}
async function check(name,expression){const actual=await evaluate(expression);checks.push({name,passed:actual===true,actual});console.log((actual===true?'PASS ':'FAIL ')+name);assert.equal(actual,true,name);}
function nodeCheck(name,value){checks.push({name,passed:!!value});console.log((value?'PASS ':'FAIL ')+name);assert.ok(value,name);}
async function fill(selector,values){await evaluate(`(()=>{const form=document.querySelector(${JSON.stringify(selector)});for(const [name,value] of Object.entries(${JSON.stringify(values)})){const input=form.elements.namedItem(name);if(input.type==='checkbox')input.checked=!!value;else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);}
async function submit(selector,condition){await action(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`,condition);await wait('!salesyncShopping.state.busy');}
async function shot(name){const result=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(OUT,'commerce-'+name+'.png'),Buffer.from(result.data,'base64'));}
async function viewport(width){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});}
async function responsive(name){for(const width of [320,390,768,1024,1440]){await viewport(width);await check(name+' fits '+width,'document.documentElement.scrollWidth<=innerWidth');}}
async function signIn(email,password=PASSWORD){await action("document.querySelector('[data-page=login]').click()","!!document.querySelector('#apiLoginForm')");await fill('#apiLoginForm',{email,password});await submit('#apiLoginForm',email==='qacommercemanager@gmail.com'?"!!document.querySelector('[data-api-tab]')":"!!document.querySelector('.commerce-account')");}
async function signOut(){if(!await evaluate("!!document.querySelector('[data-api-logout]')"))await action("document.querySelector('[data-page=account]').click()","!!document.querySelector('[data-api-logout]')");await action("document.querySelector('[data-api-logout]').click()","ui.role==='guest' && !!document.querySelector('[data-page=login]')");}
async function accountTab(tab){await action(`document.querySelector('[data-commerce-tab=${tab}]').click()`);}
async function staffTab(tab,condition){await action(`document.querySelector('[data-api-tab=${tab}]').click()`,condition);}
async function reload(condition){await evaluate('window.commerceOldDocument=true');await cdp('Page.reload');await wait('!window.commerceOldDocument && ('+condition+')');}
(async()=>{
 const {openDatabase}=require('../backend/database.cjs'),{hashPassword,gmailAddress}=require('../backend/security.cjs');
 const env={CATALOG_DEMO:'true',DATABASE_PATH:path.join(directory,'qa.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),PORT:'3198',APP_ORIGIN:'http://127.0.0.1:3198',MAIL_MODE:'disabled',PAYMENT_MODE:'disabled',POS_ENABLED:'true',POS_BASE_URL:'https://pos.example.test',POS_AUTH_TOKEN:randomBytes(32).toString('base64url')};
 const config=loadConfig(env),dbConnection=openDatabase(config),p=dbConnection.prepare("SELECT * FROM product_meta WHERE product_id='p1'").get();env.POS_MAPPINGS=JSON.stringify([{storeId:p.store_id,posStoreId:'POS-ONE',skus:[{sku:p.sku,posSku:'REMOTE-BROWSER'}]}]);let unavailable=false;
 app=await createApp(config,{db:dbConnection,posFetch:async(url)=>{if(unavailable)throw Error('private provider error');return {ok:true,json:async()=>new URL(url).pathname.endsWith('/health')?{apiVersion:'1',status:'ok'}:{apiVersion:'1',storeId:'POS-ONE',asOf:new Date().toISOString(),items:[{sku:'REMOTE-BROWSER',quantity:37,updatedAt:new Date().toISOString()}]}};}});
 await provisionAdmin(app.db,{name:'POS Browser Manager',email:'qacommercemanager@gmail.com',password:PASSWORD,role:'management'});await provisionAdmin(app.db,{name:'POS Browser Maintenance',email:'posbrowsermaintenance@gmail.com',password:PASSWORD,role:'maintenance'});
 const email='posbrowserseller@gmail.com';app.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,'customer','active',?,?)").run('pos-browser-seller','POS Browser Seller',email,gmailAddress(email).key,await hashPassword(PASSWORD),Date.now(),Date.now());app.db.prepare('UPDATE stores SET owner_id=? WHERE id=?').run('pos-browser-seller',p.store_id);
 await new Promise(r=>app.server.listen(3198,'127.0.0.1',r));
 browser=spawn(process.env.CHROME_PATH,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9248','--user-data-dir='+path.join(directory,'chrome'),'about:blank'],{windowsHide:true,stdio:'ignore'});
 let tab;for(let i=0;i<100;i++){try{tab=(await(await fetch('http://127.0.0.1:9248/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await delay(100);}if(!tab)throw Error('Chrome launch failed');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
 await cdp('Runtime.enable');await cdp('Page.enable');await viewport(1440);await cdp('Page.navigate',{url:config.origin});await wait("!!document.querySelector('[data-page=login]') && document.body.classList.contains('api-mode') && !document.querySelector('.api-loading')");
 await signIn(email);await accountTab('seller');await action("document.querySelector('[data-commerce-seller-open]').click()","!!document.querySelector('[data-commerce-pos-refresh]')");
 await check('Seller sees an honest unrefreshed reference state',"document.querySelector('.page').textContent.includes('not updated') && document.querySelector('.page').textContent.includes('Reference only.') && !document.querySelector('.page').textContent.includes('POS-ONE')");
 const before=app.commerce.productView(app.commerce.productRow('p1')).onHand;
 await action("document.querySelector('[data-commerce-pos-refresh]').click()","!!document.querySelector('#apiCommercePosRefresh')");await fill('#apiCommercePosRefresh',{reason:'Read POS backup reference from browser'});await submit('#apiCommercePosRefresh',"!document.querySelector('#modal').classList.contains('show') && document.querySelector('.page').textContent.includes('REMOTE-BROWSER')");
 await check('Seller refresh displays separate backup quantity and source timestamps',"document.querySelector('.page').textContent.includes('37') && document.querySelector('.page').textContent.includes('reference only') && !document.querySelector('.page').textContent.includes('Last successful refresh: Never')");
 nodeCheck('Reference refresh did not change canonical online stock',app.commerce.productView(app.commerce.productRow('p1')).onHand===before);
 for(const width of [320,390,768,1440]){await viewport(width);await check('POS seller view fits '+width,'document.documentElement.scrollWidth<=innerWidth');}
 await evaluate('window.qaOriginalNow=Date.now;Date.now=()=>window.qaOriginalNow()+600000');await wait("document.querySelector('[data-pos-status] .pill')?.textContent==='stale'");await check('Visible POS reference ages into stale status without a stock mutation',"document.querySelector('[data-pos-stale]').hidden===false");await evaluate('Date.now=window.qaOriginalNow');
 unavailable=true;await action("document.querySelector('[data-commerce-pos-refresh]').click()","!!document.querySelector('#apiCommercePosRefresh')");await fill('#apiCommercePosRefresh',{reason:'Check failure and stale-data feedback'});await submit('#apiCommercePosRefresh',"!document.querySelector('#modal').classList.contains('show') && document.querySelector('.api-status.error')?.textContent.includes('POS reference unavailable')");await check('Failure retains previous quantity as stale without exposing provider details',"document.querySelector('.page').textContent.includes('37') && document.querySelector('.page').textContent.includes('Stale or unavailable') && !document.querySelector('.page').textContent.includes('private provider error')");
 await signOut();await signIn('qacommercemanager@gmail.com');await staffTab('catalog',"!!document.querySelector('[data-commerce-pos-refresh]')");await check('Management catalog includes the same separate reference snapshot',"document.querySelector('.page').textContent.includes('REMOTE-BROWSER') && document.querySelector('.page').textContent.includes('POS backup inventory')");
 unavailable=false;await action("document.querySelector('[data-commerce-pos-refresh]').click()","!!document.querySelector('#apiCommercePosRefresh')");await fill('#apiCommercePosRefresh',{reason:'Management checks a store reference'});await submit('#apiCommercePosRefresh',"!document.querySelector('#modal').classList.contains('show') && !document.querySelector('.api-status.error')");await shot('pos-management');
 await signOut();await action("document.querySelector('[data-page=login]').click()","!!document.querySelector('#apiLoginForm')");await fill('#apiLoginForm',{email:'posbrowsermaintenance@gmail.com',password:PASSWORD});await submit('#apiLoginForm',"!!document.querySelector('[data-api-maintenance=pos]')");
 await check('Maintenance sees diagnostics without inventory quantities or mappings',"!document.querySelector('.page').textContent.includes('REMOTE-BROWSER') && !document.querySelector('.page').textContent.includes('POS-ONE') && !document.querySelector('[data-commerce-pos-refresh]')");
 await viewport(390);await action("document.querySelector('[data-api-maintenance=pos]').click()","!!document.querySelector('#apiMaintenanceForm')");await fill('#apiMaintenanceForm',{reason:'Check the authenticated POS connection'});await submit('#apiMaintenanceForm',"!document.querySelector('#modal').classList.contains('show') && document.querySelector('.page').textContent.includes('POS authenticated health check passed')");await check('Maintenance check succeeds on mobile with accurate connection status',"document.querySelector('.page').textContent.includes('last authenticated check connected') && document.documentElement.scrollWidth<=innerWidth");await shot('pos-maintenance-mobile');
 nodeCheck('No JavaScript errors',errors.length===0);console.log(checks.length+'/'+checks.length+' POS browser checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(ws){try{await cdp('Browser.close');}catch{}ws.close();}browser?.kill();await app?.close();});
