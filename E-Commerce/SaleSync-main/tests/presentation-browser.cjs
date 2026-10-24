/* Real regular-site smoke plus the isolated, backend-connected presentation profile. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {startDemo}=require('../scripts/local-demo.cjs');
const OUT=path.resolve(__dirname,'../.preview');
fs.mkdirSync(OUT,{recursive:true});
const directory=fs.mkdtempSync(path.join(OUT,'presentation-browser-'));
const checks=[],errors=[],pending=new Map();let app,browser,ws,sequence=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('CDP timeout: '+method));},15000).unref();});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(70);}throw Error('Browser condition not met: '+expression);}
async function check(name,expression){assert.equal(await evaluate(expression),true,name);checks.push(name);console.log('PASS '+name);}
async function viewport(width){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});}
async function navigate(url){await cdp('Page.navigate',{url});await wait("window.salesyncShopping?.state.ready&&!document.querySelector('.api-loading')");}
async function shot(name){const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(OUT,name+'.png'),Buffer.from(r.data,'base64'));}
(async()=>{
 app=await startDemo({directory,port:3199,presentation:true});
 const accounts=JSON.parse(fs.readFileSync(path.join(directory,'accounts.json'),'utf8'));
 browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9257','--user-data-dir='+path.join(directory,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});
 let tab;for(let i=0;i<100;i++){try{tab=(await(await fetch('http://127.0.0.1:9257/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await delay(100);}assert.ok(tab,'Chrome started');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error('CDP error')):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 await cdp('Page.enable');await cdp('Runtime.enable');
 await navigate(process.env.REGULAR_URL||'http://127.0.0.1:3000');
 await check('Regular site remains backend connected and hides demo merchants',"document.body.classList.contains('api-mode')&&!salesyncShopping.state.catalog.demo&&!document.querySelector('.store-demo-label')");
 for(const width of [320,390,1440]){await viewport(width);await check('Regular site fits '+width,'document.documentElement.scrollWidth<=innerWidth');}
 await shot('master-regular-mobile');
 await navigate(app.config.origin);
 await check('Presentation has exactly four real API product records',"salesyncShopping.state.catalog.products.length===4&&salesyncShopping.state.catalog.demo===true");
 await evaluate("setPage('sellers')");
 await wait("document.querySelectorAll('.store-discovery-card').length===2");
 await check('Both sample stores are visibly labeled',"[...document.querySelectorAll('.store-discovery-card')].every(c=>c.textContent.includes('Presentation Only')&&c.textContent.includes('Development catalog'))");
 await evaluate("document.querySelector('.store-card-action').click()");await wait("!!document.querySelector('.storefront-hero h1')");
 for(const width of [320,390,1440]){await viewport(width);await check('Presentation store fits '+width,"document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.storefront-hero h1').textContent.includes('Presentation Only')");}
 await evaluate("setPage('shop')");await wait("document.querySelectorAll('[data-compare]').length>=4");
 const ids=app.commerce.products().map(p=>p.id);
 for(const id of ids){await evaluate(`document.querySelector('[data-compare="${id}"]').click()`);await wait(`db.compare.includes(${JSON.stringify(id)})`);}
 await evaluate("setPage('compare')");
 for(const width of [320,390,1440]){await viewport(width);await check('Four sample products compare at '+width,"document.querySelectorAll('.comparetable thead th').length===5&&document.documentElement.scrollWidth<=innerWidth");}
 await shot('master-presentation-compare');
 await evaluate("setPage('shop')");const variant=app.commerce.products().find(p=>p.variationGroups?.length);
 await evaluate(`document.querySelector('[data-add="${variant.id}"]').click()`);await wait("!!document.querySelector('[data-variation-group]')");
 await check('Sample product requires its configured package selection',"document.querySelector('[data-variation-add]').disabled&&document.querySelectorAll('[data-variation-group]').length===1");
 await evaluate("const select=document.querySelector('[data-variation-group]');select.value='Pair';select.dispatchEvent(new Event('change',{bubbles:true}))");
 await check('Selected package resolves exact SKU and available stock',"document.querySelector('[data-variation-summary]').textContent.includes('PRESENT-HEADPHONES-PAIR')&&!document.querySelector('[data-variation-add]').disabled");
 await evaluate("document.querySelector('[data-variation-add]').click()");await wait("!!document.querySelector('[data-shopping-cart]')");
 await check('Cart confirmation keeps exact variation',"document.querySelector('.shopping-confirm-product').textContent.includes('Pair')");
 await evaluate("document.querySelector('[data-shopping-continue]').click()");
 for(const account of accounts){
   await evaluate("setPage('login')");await wait("!!document.querySelector('#apiLoginForm')");
   // Generated credentials stay in the private fixture and browser; never log them.
   await evaluate(`document.querySelector('#loginEmail').value=${JSON.stringify(account.email)};document.querySelector('#loginPassword').value=${JSON.stringify(account.password)};document.querySelector('#apiLoginForm').requestSubmit()`);
   await wait(`salesyncShopping.state.user?.id===${JSON.stringify(account.id)}&&!salesyncShopping.state.busy`);
   if(account.label.startsWith('seller')){
     await evaluate("document.querySelector('[data-commerce-tab=seller]').click()");await wait("!!document.querySelector('[data-commerce-seller-open]')");await evaluate("document.querySelector('[data-commerce-seller-open]').click()");await wait("!!document.querySelector('#seller-store')");
     await check(account.label+' manages only its own presentation catalog',"salesyncShopping.state.sellerData.products.length===2&&document.querySelector('.page h1').textContent.includes('Presentation Only')&&salesyncShopping.state.sellerData.products.every(p=>p.storeId===salesyncShopping.state.sellerData.store.id)");
   }else if(account.role==='maintenance'){
     await wait("!!document.querySelector('[data-api-maintenance=backup]')");
     await check('Maintenance sees real diagnostics and private backup actions',"document.querySelector('.page').textContent.includes('Schema 5')&&document.querySelector('.page').textContent.includes('not-attempted')&&!document.querySelector('[data-api-tab=customers]')");
   }else if(account.role==='management'){
     await wait("!!document.querySelector('[data-api-tab=catalog]')");
     await check('Management has business controls without maintenance actions',"!!document.querySelector('[data-api-tab=sellers]')&&!document.querySelector('[data-api-maintenance=backup]')");
   }else await check('Customer signs in and retains selected cart variant',`db.cart[${JSON.stringify(variant.variants[1].id)}]===1`);
   for(const width of [390,1440]){await viewport(width);await check(account.label+' workspace fits '+width,'document.documentElement.scrollWidth<=innerWidth');}
   if(account.role==='maintenance')await shot('master-presentation-maintenance');
   if(!await evaluate("!!document.querySelector('[data-api-logout]')"))await evaluate("setPage('account')");
   await wait("!!document.querySelector('[data-api-logout]')");await evaluate("document.querySelector('[data-api-logout]').click()");await wait('!salesyncShopping.state.user');
 }
 assert.deepEqual(errors,[],'No browser JavaScript errors');checks.push('No browser JavaScript errors');
 console.log(`${checks.length}/${checks.length} presentation and regular browser checks passed`);
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
 fs.writeFileSync(path.join(OUT,'master-presentation-browser-results.json'),JSON.stringify({checks,errors,failed:!!process.exitCode},null,2));
 if(ws){try{await cdp('Browser.close');}catch{}ws.close();}browser?.kill();await app?.close();
});
