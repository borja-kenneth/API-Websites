/* Connected Chrome checkout checks with isolated PayMongo API and hosted-redirect mocks. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {createApp,provisionAdmin}=require('../backend/app.cjs');
const {loadConfig}=require('../backend/config.cjs');
const {createMailer}=require('../backend/mailer.cjs');
const OUT=path.resolve(__dirname,'../.preview'),ROOT=path.resolve(__dirname,'..');
fs.mkdirSync(OUT,{recursive:true});const directory=fs.mkdtempSync(path.join(OUT,'paymongo-browser-'));
const FEATURE_QA=process.env.SALESYNC_FEATURE_QA==='1';
const orderEmails=[];
const PASSWORD='Local commerce browser password 927!';
const ADDRESS={name:'Test Buyer',phone:'09123456789',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'};
const messages=[],resets=[],checks=[],errors=[],pending=new Map();
let app,browser,ws,sequence=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('CDP timeout: '+method));},15000).unref();});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function wait(expression){for(let i=0;i<150;i++){try{if(await evaluate(expression))return;}catch{}await delay(60);}throw Error('Condition not met: '+expression);}
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
 const config=loadConfig({CATALOG_DEMO:'true',DATABASE_PATH:path.join(directory,'qa.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),PORT:'3199',APP_ORIGIN:'http://127.0.0.1:3199',MAIL_MODE:'disabled',PAYMENT_MODE:'paymongo-test',PAYMONGO_SECRET_KEY:'sk_test_BrowserMock',PAYMONGO_WEBHOOK_SECRET:'isolated-browser-webhook',PAYMONGO_PAYMENT_METHODS:'qrph'});
 let session=null,redirects=0;
 app=await createApp(config,{paymongoFetch:async(url,options)=>{if(url.endsWith('/v2/checkout_sessions')){const a=JSON.parse(options.body).data.attributes;session={id:'cs_browser',attributes:{...a,livemode:false,status:'active',checkout_url:'https://checkout.paymongo.com/cs_browser',payments:[],payment_intent:{id:'pi_browser',attributes:{amount:a.line_items[0].amount,currency:'PHP',status:'awaiting_payment_method'}}}};}return {ok:true,json:async()=>({data:structuredClone(session)})};}});
 const {hashPassword,gmailAddress}=require('../backend/security.cjs'),email='paymongobrowser@gmail.com';app.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,'customer','active',?,?)").run('qa-pm-buyer','PayMongo QA',email,gmailAddress(email).key,await hashPassword(PASSWORD),Date.now(),Date.now());
 await new Promise(r=>app.server.listen(3199,'127.0.0.1',r));
 browser=spawn(process.env.CHROME_PATH,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9249','--user-data-dir='+path.join(directory,'chrome'),'about:blank'],{windowsHide:true,stdio:'ignore'});
 let tab;for(let i=0;i<100;i++){try{tab=(await(await fetch('http://127.0.0.1:9249/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await delay(100);}if(!tab)throw Error('Chrome launch failed');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused'){redirects++;cdp('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:302,responseHeaders:[{name:'Location',value:config.origin+'/#/checkout?order='+encodeURIComponent(session.attributes.reference_number)}],body:''}).catch(()=>{});}};
 await cdp('Runtime.enable');await cdp('Page.enable');await viewport(1440);await cdp('Page.navigate',{url:config.origin});await wait("!!document.querySelector('[data-page=login]') && document.body.classList.contains('api-mode') && !document.querySelector('.api-loading')");
 await signIn(email);await evaluate(`(async()=>{const r=await salesyncShopping.api('/orders',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:{items:[{id:'p1',qty:2}],delivery:${JSON.stringify(ADDRESS)}}});window.qaPayOrder=r.order;window.dispatchEvent(new CustomEvent('salesync:restore-payment',{detail:{orderId:r.order.id}}));})()`);await wait("!!document.querySelector('[data-commerce-hosted]')");
 await check('Provider view labels TEST and hides simulator buttons',"document.querySelector('.page').textContent.includes('PayMongo TEST ONLY') && !document.querySelector('[data-commerce-payment]')");for(const width of [320,390,768,1440]){await viewport(width);await check('Hosted payment view fits '+width,'document.documentElement.scrollWidth<=innerWidth');}
 await cdp('Fetch.enable',{patterns:[{urlPattern:'https://checkout.paymongo.com/*'}]});await action("document.querySelector('[data-commerce-hosted][data-operation=checkout]').click()","!!document.querySelector('[data-commerce-hosted][data-operation=refresh]')");await wait(`location.hash.includes('order=') && !!document.querySelector('[data-commerce-hosted]')`);for(let i=0;i<100&&redirects===0;i++)await delay(40);nodeCheck('Continue requests the backend and redirects to the provider URL',redirects===1);
 await wait("document.querySelector('.page').textContent.includes('PayMongo TEST ONLY')");await check('Return URL alone cannot mark payment paid',"salesyncShopping.state.checkoutDone.status==='pending_payment'");
 await action("document.querySelector('[data-commerce-hosted][data-operation=refresh]').click()","document.querySelector('.page').textContent.includes('Payment pending.') && !salesyncShopping.state.busy");
 await check('Pending reconciliation preserves the reservation',"salesyncShopping.state.checkoutDone.inventoryReserved===true");
 session.attributes.payment_intent.attributes.status='succeeded';session.attributes.payments=[{id:'pay_browser',attributes:{status:'paid',amount:session.attributes.line_items[0].amount,currency:'PHP',payment_intent_id:'pi_browser',livemode:false}}];
 await action("document.querySelector('[data-commerce-hosted][data-operation=refresh]').click()","salesyncShopping.state.checkoutDone.status==='paid' && !salesyncShopping.state.busy");await check('Provider retrieval confirms payment and removes payment actions',"!document.querySelector('[data-commerce-hosted]') && document.querySelector('.page').textContent.includes('Test payment confirmed')");
 nodeCheck('Confirmed provider payment creates one canonical stock movement',app.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='sale'").get().n===1);nodeCheck('No JavaScript errors',errors.length===0);console.log(checks.length+'/'+checks.length+' PayMongo browser checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(ws){try{await cdp('Browser.close');}catch{}ws.close();}browser?.kill();await app?.close();});
