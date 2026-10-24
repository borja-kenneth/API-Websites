/* Real Chromium integration checks against an isolated backend and captured mailer. */
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {loadConfig}=require('../backend/config.cjs');
const {createApp,provisionAdmin}=require('../backend/app.cjs');
const {createMailer}=require('../backend/mailer.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.preview');
fs.mkdirSync(OUT,{recursive:true});
const directory=fs.mkdtempSync(path.join(OUT,'browser-qa-'));
const PASSWORD='QA isolated password 872!';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[],errors=[],messages=[];
let app,browser,ws,sequence=0,mailFailure=false,verificationGate=null,releaseVerification,heldCatalogRequest=null;
const pending=new Map();
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('Timeout: '+method));},15000).unref();});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Condition not met: '+expression);}
async function check(name,expression){const value=await evaluate(expression);checks.push({name,passed:value===true,actual:value});console.log((value===true?'PASS ':'FAIL ')+name);if(value!==true)throw Error(name+': '+JSON.stringify(value));}
async function action(expression,condition){await evaluate(expression);if(condition)await wait(condition);}
async function shot(name){await evaluate("document.querySelector('#toast')?.classList.remove('show')");await delay(300);const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(OUT,name+'.png'),Buffer.from(r.data,'base64'));}
async function login(email){await action("document.querySelector('[data-page=login]').click()","!!document.querySelector('#apiLoginForm')");await action(`document.querySelector('#loginEmail').value=${JSON.stringify(email)}; document.querySelector('#loginPassword').value=${JSON.stringify(PASSWORD)}; document.querySelector('#apiLoginForm').requestSubmit()`,'!!document.querySelector("[data-api-tab]")');}
(async()=>{
  const config=loadConfig({CATALOG_DEMO:'true',DATABASE_PATH:path.join(directory,'qa.sqlite'),APP_SECRET:randomBytes(48).toString('hex'),PORT:'3100',APP_ORIGIN:'http://127.0.0.1:3100',MAIL_MODE:'disabled',PAYMENT_MODE:'disabled'});
  app=await createApp(config,{mailer:{configured:true,sendVerification:async(to,code)=>{if(verificationGate)await verificationGate;if(mailFailure)throw Error('delivery failed');messages.push({to,code});},sandboxEmail:createMailer({MAIL_MODE:'disabled'}).sandboxEmail}});
  for(const role of ['management','maintenance'])await provisionAdmin(app.db,{name:role==='management'?'Mara Reyes':'Paolo Santos',email:`qa${role}@gmail.com`,password:PASSWORD,role});
  await new Promise(resolve=>app.server.listen(3100,'127.0.0.1',resolve));
  const executable=process.env.CHROME_PATH||'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1','--user-data-dir='+path.join(directory,'chrome'),'about:blank'],{windowsHide:true,stdio:'ignore'});
  let tab;
  for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9223/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await delay(100);}
  if(!tab)throw Error('Could not start Chrome.');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused')heldCatalogRequest=m.params.requestId;};
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Fetch.enable',{patterns:[{urlPattern:'*/api/v1/catalog*',requestStage:'Request'}]});
  await cdp('Page.navigate',{url:config.origin});
  for(let i=0;i<100&&!heldCatalogRequest;i++)await delay(50);
  if(!heldCatalogRequest)throw Error('Catalog request was not intercepted.');
  await check('Initial request displays a skeleton and retains store header',"!!document.querySelector('.api-loading[aria-busy=true] .ui-skeleton') && !!document.querySelector('.header .brand')");
  await shot('polished-loading');
  await cdp('Fetch.continueRequest',{requestId:heldCatalogRequest});await cdp('Fetch.disable');
  await wait("document.body.classList.contains('api-mode') && !!document.querySelector('[data-page=login]') && document.querySelectorAll('article.product').length === 12");
  await check('API storefront displays original catalog',"document.querySelectorAll('article.product').length === 12 && !document.body.classList.contains('preview-roles-enabled')");
  await check('Homepage uses a compact navy merchandising composition',"getComputedStyle(document.querySelector('.home-main-promo')).backgroundColor==='rgb(21, 51, 79)'&&document.querySelectorAll('.home-promo-tile').length===2&&document.querySelector('.home-categories').getBoundingClientRect().top<850");
  await check('Homepage cards do not repeat products between merchandising sections',"(()=>{let ids=[...document.querySelectorAll('article.product [data-add]')].map(el=>el.dataset.add);return ids.length===12&&new Set(ids).size===12})()");
  await check('Category photos come from corresponding catalog categories',"[...document.querySelectorAll('.home-category')].every(el=>{const img=el.querySelector('img');return !img||window.salesyncShopping.state.catalog.products.some(p=>p.category===el.dataset.category&&img.getAttribute('src')===p.photo)})");
  await check('Detached payment note is removed',"!document.querySelector('.storefront-payment-note')");
  await action("window.fullHomeCatalog=window.salesyncShopping.state.catalog.products;window.salesyncShopping.state.catalog.products=fullHomeCatalog.slice(0,1);render()");await check('Single-product hero has no blank complementary panels',"!document.querySelector('.home-secondary')&&!document.querySelector('.home-offers')&&document.querySelectorAll('.home-discovery article.product').length===1");await action("window.salesyncShopping.state.catalog.products=fullHomeCatalog;render()");
  await check('Dedicated demo store cards clearly disclose development mode',"[...document.querySelectorAll('.store-discovery-card')].every(card=>card.querySelector('.store-demo-label')?.textContent==='Development catalog')");
  await shot('homepage-after-desktop');
  await shot('connected-desktop');
  for(const width of [320,360,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Connected storefront fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');if([320,390,768].includes(width))await shot('homepage-after-'+width);if(width===390)await shot('polished-mobile-home');}
  await check('Navigation icons and homepage indicator are accessible',"document.querySelectorAll('.actions .ui-icon').length===3 && !!document.querySelector('.navline [data-page=home][aria-current=page]')");
  await action("document.querySelector('.ui-skip').click()");
  await check('Skip link reaches the main content',"document.activeElement.id==='main-content'");
  await action("window.qaNavigationSentinel=true;document.querySelector('[data-category=Electronics]').click();document.querySelector('#sortFilter').value='high';document.querySelector('#sortFilter').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('Category and sort appear in a directly usable URL',"location.hash.includes('/shop?') && location.hash.includes('Electronics') && location.hash.includes('sort=high') && ui.sort==='high'");
  await action("document.querySelector('[data-page=cart]').click()");
  await action("history.back()","ui.page==='shop' && ui.category==='Electronics' && ui.sort==='high'");
  await check('Browser Back restores filters without reloading',"window.qaNavigationSentinel===true && !!document.querySelector('.navline [data-category=Electronics][aria-current=page]')");
  await action("history.forward()","ui.page==='cart'");
  await check('Browser Forward restores the cart page',"document.querySelector('.page h1').textContent==='Your cart'");
  await action("history.back()","ui.page==='shop'");
  await cdp('Page.reload');await wait("document.querySelector('#sortFilter')?.value==='high'");
  await check('Refresh restores the direct catalog link and filters',"ui.page==='shop' && ui.category==='Electronics' && ui.sort==='high'");
  for(const width of [320,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Catalog fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');if(width===1440)await shot('polished-catalog');}
  await action("document.querySelector('[data-detail=p1]').focus();document.querySelector('[data-detail=p1]').click()","document.querySelector('#modal').classList.contains('show')");
  await check('Product details retain shopping actions',"!!document.querySelector('#modalBody [data-add=p1]') && !!document.querySelector('#modalBody [data-wish=p1]') && !!document.querySelector('#modalBody [data-compare=p1]')");
  await shot('polished-product-details');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});
  await check('Product dialog fits mobile viewport',"document.querySelector('#modal').getBoundingClientRect().left>=0 && document.querySelector('#modal').getBoundingClientRect().right<=innerWidth && document.querySelector('#modal').scrollWidth<=document.querySelector('#modal').clientWidth");
  await shot('polished-mobile-details');
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await check('Escape closes the dialog and restores focus',"!document.querySelector('#modal').classList.contains('show') && document.activeElement.dataset.detail==='p1'");
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await check('Reduced motion disables progress animation',"getComputedStyle(document.querySelector('.ui-network'),'::after').animationName==='none'");
  await cdp('Emulation.setEmulatedMedia',{features:[]});
  await action("document.querySelector('[data-page=login]').click();document.querySelector('[data-page=register]').click()","!!document.querySelector('#apiRegisterForm')");
  await check('Registration fields are labeled and require a strong password',"document.querySelector('#regPassword').minLength === 12 && document.querySelector('label[for=regEmail]') !== null");
  verificationGate=new Promise(resolve=>{releaseVerification=resolve;});
  await action(`document.querySelector('#regName').value='Ana Garcia';document.querySelector('#regEmail').value='qacustomer@gmail.com';document.querySelector('#regPassword').value=${JSON.stringify(PASSWORD)};document.querySelector('#apiRegisterForm').requestSubmit()`,"document.body.classList.contains('request-pending')");
  await check('Pending registration announces loading and disables submit',"document.querySelector('#apiRegisterForm').getAttribute('aria-busy')==='true' && document.querySelector('#apiRegisterForm button:not([type=button])').disabled && document.querySelector('#regEmail').value==='qacustomer@gmail.com'");
  await action("document.querySelector('#apiRegisterForm').requestSubmit()");
  releaseVerification();verificationGate=null;await wait("!!document.querySelector('#apiVerifyForm')");
  checks.push({name:'Repeated pending submission sends one verification email',passed:messages.length===1});if(messages.length!==1)throw Error('Duplicate verification delivery.');
  await check('Registration shows verification and cooldown',"document.querySelector('#app').textContent.includes('qacustomer@gmail.com') && document.querySelector('[data-api-resend]').disabled");
  await shot('verification');
  const code=messages.at(-1).code,wrong=code==='0000'?'0001':'0000';
  await action(`document.querySelector('#emailCode').value=${JSON.stringify(wrong)};document.querySelector('#apiVerifyForm').requestSubmit()`,"document.querySelector('[role=alert]')?.textContent.includes('incorrect')");
  await check('Incorrect code has a clear error and preserves registration',"document.querySelector('#app').textContent.includes('qacustomer@gmail.com') && document.querySelector('#app').textContent.includes('4 attempts remaining')");
  await action(`document.querySelector('#emailCode').value=${JSON.stringify(code)};document.querySelector('#apiVerifyForm').requestSubmit()`,"document.querySelector('#app').textContent.includes('Email verified')");
  await check('Verified account activates and displays orders',"document.querySelector('#app').textContent.includes('Ana Garcia') && document.querySelector('#app').textContent.includes('No orders yet')");
  await action("document.querySelector('[data-page=shop]').click();document.querySelector('[data-add=p1]').click();document.querySelector('[data-page=cart]').click()","!!document.querySelector('[data-page=checkout]')");
  await check('Live cart shows selected product',"document.querySelector('#app').textContent.includes('Wireless Noise-Cancelling Headphones') && document.querySelector('#app').textContent.includes('Order summary')");
  await action("document.querySelector('[data-qty=\"p1|1\"]').focus();document.querySelector('[data-qty=\"p1|1\"]').click()");
  await check('Cart quantity updates and keyboard focus survives redraw',"db.cart.p1===2 && document.activeElement.dataset.qty==='p1|1'");
  await action("document.querySelector('[data-qty=\"p1|-1\"]').click()");
  await cdp('Page.reload');await wait("!!document.querySelector('[data-page=checkout]') && ui.page==='cart'");
  await check('Cart and authenticated account survive refresh',"db.cart.p1===1 && ui.role==='customer' && !!document.querySelector('[data-page=account]')");
  for(const width of [320,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Cart fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');if(width===390)await shot('polished-mobile-cart');}
  await shot('polished-cart');
  await action("document.querySelector('[data-page=checkout]').click()","!!document.querySelector('#apiCheckoutForm')");
  await action("document.querySelector('#ship-address').value='123 Test Street';document.querySelector('#ship-address').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-page=cart]').click();history.back()","!!document.querySelector('#apiCheckoutForm')");
  await check('Back navigation preserves the in-progress delivery address',"document.querySelector('#ship-address').value==='123 Test Street'");
  for(const width of [320,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Checkout fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');if(width===390)await shot('polished-mobile-checkout');}
  await shot('polished-checkout');
  await action("Object.entries({name:'Ana Garcia',phone:'09171234567',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'}).forEach(([k,v])=>document.querySelector('#apiCheckoutForm [name='+k+']').value=v);document.querySelector('#apiCheckoutForm').requestSubmit()","document.querySelector('#app').textContent.includes('Order request saved')");
  await check('Checkout saves server order without claiming payment',"document.querySelector('#app').textContent.includes('No payment was collected') && document.querySelector('#app').textContent.includes('EC-')");
  await action("document.querySelector('[data-page=account]').click()","document.querySelector('#app').textContent.includes('Awaiting payment availability')");
  await check('Customer order persists through the API',"document.querySelector('#app').textContent.includes('Wireless Noise-Cancelling Headphones')");
  for(const width of [320,390,768,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Account fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');}
  await shot('polished-account');
  await action("document.querySelector('[data-api-logout]').click()","!!document.querySelector('[data-page=login]')");
  await login('qamanagement@gmail.com');
  await check('Individual Management sign-in has business navigation only',"document.querySelector('#app').textContent.includes('Mara Reyes') && !!document.querySelector('[data-api-tab=catalog]') && !document.querySelector('[data-api-tab=health]')");
  await action("document.querySelector('[data-api-tab=catalog]').click()","!!document.querySelector('[data-api-edit-product]')");
  await action("document.querySelector('[data-api-edit-product]').click()","!!document.querySelector('#apiCommerceProductForm')");
  await action("document.querySelector('#apiCommerceProductForm [name=primary]').value='21';document.querySelector('#apiCommerceProductForm [name=reason]').value='Update counted warehouse stock';document.querySelector('#apiCommerceProductForm').requestSubmit()","!document.querySelector('#modal').classList.contains('show')");
  await wait("document.querySelector('#app').textContent.includes('Product updated.')");await check('Management can update inventory through API',"document.querySelector('#app').textContent.includes('Product updated.')");
  for(const width of [320,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Management catalog fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');}
  await shot('polished-management-catalog');
  await action("document.querySelector('[data-api-tab=settings]').click()","!!document.querySelector('#apiSettingsForm')");
  await check('Management settings expose store fields only',"!!document.querySelector('[data-section=store]') && !document.querySelector('[data-section=email]')");
  await check('Staff tab URL identifies settings',"location.hash==='#/admin/settings'");
  await action("document.querySelector('[data-api-tab=catalog]').click()","!!document.querySelector('[data-api-edit-product]')");
  await action("history.back()","!!document.querySelector('#apiSettingsForm')");
  await check('Browser Back restores the staff tab through existing actions',"!!document.querySelector('[data-api-tab=settings][aria-current=page]')");
  await cdp('Page.reload');await wait("!!document.querySelector('#apiSettingsForm')");
  await check('Staff session and selected tab survive refresh',"!!document.querySelector('[data-section=store]') && location.hash==='#/admin/settings'");
  await action("document.querySelector('#setting-name').value='SaleSync QA Preview';document.querySelector('#apiSettingsForm').requestSubmit()","!!document.querySelector('[data-api-apply]')");
  await check('Saved draft is labeled as isolated Sandbox',"document.querySelector('#app').textContent.includes('Sandbox active') && document.querySelector('#app').textContent.includes('live website has not changed')");
  await action("document.querySelector('[data-api-preview]').click()","document.querySelector('#modal').classList.contains('show')");
  await check('Sandbox preview displays draft store identity',"document.querySelector('#modalBody').textContent.includes('SaleSync QA Preview') && document.querySelector('#modalBody').textContent.includes('private') === false");
  await action("closeOverlay();document.querySelector('[data-api-validate]').click()","document.querySelector('#app').textContent.includes('Draft is valid')");
  await action("document.querySelector('[data-api-apply]').click()","!!document.querySelector('#apiConfirmForm')");
  await check('Applying settings requires explicit text and reason',"document.querySelector('#applyConfirmation').pattern === 'APPLY' && document.querySelector('#applyReason').minLength === 5");
  await action("document.querySelector('#applyReason').value='QA store identity review';document.querySelector('#applyConfirmation').value='APPLY';document.querySelector('#apiConfirmForm').requestSubmit()","document.querySelector('#app').textContent.includes('Configuration applied')");
  await check('Applied configuration has rollback history',"!!document.querySelector('[data-api-rollback]')");
  await check('Applied store name is visible to public catalog consumers',"fetch('/api/v1/catalog').then(r=>r.json()).then(r=>r.settings.store.name === 'SaleSync QA Preview')");
  await shot('connected-management');
  await action("document.querySelector('details.api-history:last-of-type').open=true;document.querySelector('[data-api-rollback]').click()","!!document.querySelector('#apiConfirmForm')");
  await action("document.querySelector('#applyReason').value='Restore original store configuration';document.querySelector('#applyConfirmation').value='ROLLBACK';document.querySelector('#apiConfirmForm').requestSubmit()","document.querySelector('#app').textContent.includes('Configuration rolled back')");
  await check('Rollback restores configuration',"document.querySelector('#setting-name').value === 'SaleSync Online'");
  await action("document.querySelector('[data-api-test=checkout]').click()","document.querySelector('#app').textContent.includes('Checkout simulation passed')");
  await check('Sandbox checkout identifies isolation',"document.querySelector('#app').textContent.includes('No charge, stock change, or live order')");
  for(const width of [320,360,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Settings dashboard fits '+width,'document.documentElement.scrollWidth <= window.innerWidth');if(width===390)await shot('polished-mobile-management');}
  await action("document.querySelector('[data-api-logout]').click()","!!document.querySelector('[data-page=login]')");await login('qamaintenance@gmail.com');
  await check('Maintenance sign-in has technical navigation only',"document.querySelector('#app').textContent.includes('Paolo Santos') && !!document.querySelector('[data-api-tab=health]') && !document.querySelector('[data-api-tab=catalog]')");
  await check('Technical dashboard uses live scheduler and database metadata',"salesyncShopping.state.adminData.overview.databaseDetails.schema===5 && salesyncShopping.state.adminData.overview.jobs.background.scheduled===false && document.querySelector('.page').textContent.includes('Not started') && document.querySelector('.page').textContent.includes('Order email queue')");
  for(const width of [320,390,768,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await check('Maintenance health fits '+width,'document.documentElement.scrollWidth<=innerWidth');}
  await check('Email queue totals match backend records without recipient details',`salesyncShopping.state.adminData.overview.orderEmailQueue.reduce((sum,r)=>sum+r.count,0)===${app.db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n} && !JSON.stringify(salesyncShopping.state.adminData.overview).includes('qacustomer@gmail.com')`);
  await action("document.querySelector('[data-api-maintenance=backup]').click()","!!document.querySelector('#apiMaintenanceForm')");await check('Backup confirmation requires a labeled reason',"document.querySelector('#maintenance-reason').required && !!document.querySelector('label[for=maintenance-reason]')");
  await action("document.querySelector('#maintenance-reason').value='Browser verified operational snapshot';document.querySelector('#apiMaintenanceForm').requestSubmit()","!document.querySelector('#modal').classList.contains('show') && document.querySelector('.page').textContent.includes('WAL-safe backup created') && !salesyncShopping.state.busy");
  await check('Backup is listed locally with a working verification control',"salesyncShopping.state.adminData.backups.backups.length===1 && !!document.querySelector('[data-api-maintenance=verify]') && !document.querySelector('a[download]')");
  await action("document.querySelector('[data-api-maintenance=verify]').click()","!!document.querySelector('#apiMaintenanceForm')");await action("document.querySelector('#maintenance-reason').value='Browser checks snapshot integrity';document.querySelector('#apiMaintenanceForm').requestSubmit()","document.querySelector('.page').textContent.includes('Integrity and foreign-key checks passed.') && !salesyncShopping.state.busy");
  await check('Snapshot verification has accurate success feedback',"!document.querySelector('.api-status.error') && document.querySelector('.api-status.success').textContent.includes('checks passed')");
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});await action("document.querySelector('[data-api-maintenance=database]').click()","!!document.querySelector('#apiMaintenanceForm')");await check('Integrity confirmation fits mobile','document.documentElement.scrollWidth<=innerWidth');await action("document.querySelector('#maintenance-reason').value='Browser checks active database';document.querySelector('#apiMaintenanceForm').requestSubmit()","!document.querySelector('#modal').classList.contains('show') && document.querySelector('.page').textContent.includes('checks passed') && !salesyncShopping.state.busy");
  await check('Maintenance remains denied business reports from the real backend',"salesyncShopping.api('/admin/reports').then(()=>false,error=>error.code==='FORBIDDEN')");
  const backupId=(await evaluate('salesyncShopping.state.adminData.backups.backups[0].id'));fs.writeFileSync(path.join(directory,'backups',backupId),'damaged isolated snapshot');
  await action("document.querySelector('[data-api-maintenance=verify]').click()","!!document.querySelector('#apiMaintenanceForm')");await action("document.querySelector('#maintenance-reason').value='Browser detects corrupt test snapshot';document.querySelector('#apiMaintenanceForm').requestSubmit()","!!document.querySelector('#apiMaintenanceForm [role=alert]') && !salesyncShopping.state.busy");await check('Failed verification reports a sanitized error and preserves the reason',"document.querySelector('#apiMaintenanceForm [role=alert]').textContent.includes('Operation failed') && document.querySelector('#maintenance-reason').value==='Browser detects corrupt test snapshot'");await evaluate('closeOverlay()');
  await action("document.querySelector('[data-api-tab=audit]').click()","document.querySelector('.page').textContent.includes('DATABASE_BACKUP_COMPLETED')");await check('Maintenance audit displays operations without raw reasons',"!document.querySelector('.page').textContent.includes('Browser verified operational snapshot') && document.querySelector('.page').textContent.includes('DATABASE_INTEGRITY_FAILED')");
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await action("document.querySelector('[data-api-tab=health]').click()","!!document.querySelector('[data-api-maintenance=backup]')");await shot('maintenance-operations-desktop');await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});await shot('maintenance-operations-mobile');
  await action("document.querySelector('[data-api-tab=settings]').click()","!!document.querySelector('#setting-ttlSeconds')");
  await check('Maintenance settings hide store configuration',"!!document.querySelector('[data-section=email]') && !!document.querySelector('[data-section=maintenance]') && !document.querySelector('[data-section=store]')");
  await action("document.querySelector('[data-api-test=email]').click()","document.querySelector('#app').textContent.includes('Test email captured')");
  await check('Sandbox email is captured without delivery',"document.querySelector('#app').textContent.includes('No message was sent')");
  await shot('connected-maintenance');
  await action("document.querySelector('[data-api-logout]').click()","!!document.querySelector('[data-page=login]')");
  mailFailure=true;
  await action("document.querySelector('[data-page=login]').click();document.querySelector('[data-page=register]').click()","!!document.querySelector('#apiRegisterForm')");
  await action(`document.querySelector('#regName').value='Saved Person';document.querySelector('#regEmail').value='savedperson@gmail.com';document.querySelector('#regPassword').value=${JSON.stringify(PASSWORD)};document.querySelector('#apiRegisterForm').requestSubmit()`,"!!document.querySelector('#apiVerifyForm')");
  await check('Failed delivery preserves email and provides retry state',"document.querySelector('#app').textContent.includes('savedperson@gmail.com') && document.querySelector('#app').textContent.includes('could not be delivered')");
  await action("setPage('register')","!!document.querySelector('#apiRegisterForm')");
  await action(`document.querySelector('#regPassword').value=${JSON.stringify(PASSWORD)};document.querySelector('#apiRegisterForm').requestSubmit()`,"!!document.querySelector('#apiVerifyForm') && !salesyncShopping.state.busy");
  await check('Registration retry during cooldown resumes saved verification without false success',"document.querySelector('#app').textContent.includes('savedperson@gmail.com') && document.querySelector('#app').textContent.includes('could not be delivered') && document.querySelector('[data-api-resend]').disabled");
  checks.push({name:'Zero JavaScript page errors',passed:errors.length===0,errors});
  fs.writeFileSync(path.join(OUT,'connected-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks},null,2));
  console.log(`${checks.filter(c=>c.passed).length}/${checks.length} browser checks passed; ${errors.length} JavaScript errors.`);
  if(errors.length)process.exitCode=1;
})().catch(async e=>{console.error(e);if(ws){try{await shot('browser-failure');console.log(await evaluate('document.body.innerText.slice(0,1500)'));}catch{}}checks.push({name:'Browser flow completed',passed:false,error:e.message});fs.writeFileSync(path.join(OUT,'connected-browser-results.json'),JSON.stringify({checks,errors},null,2));process.exitCode=1;}).finally(async()=>{if(ws){try{await cdp('Browser.close');}catch{}ws.close();}browser?.kill();await app?.close();});
