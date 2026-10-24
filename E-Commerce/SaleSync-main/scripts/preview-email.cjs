/* Render the vector logo and a sample email locally. No credentials or SMTP are used. */
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const nodemailer=require('nodemailer');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.preview');
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'email-browser-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let browser,ws,seq=0;const pending=new Map();
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('Timeout: '+method));},12000).unref();});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function loaded(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Preview did not finish loading.');}
async function screenshot(file){const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(file,Buffer.from(r.data,'base64'));}
(async()=>{
  browser=spawn(process.env.CHROME_PATH||'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9224','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9224/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await delay(100);}
  if(!tab)throw Error('Could not start the isolated Chrome renderer.');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:512,height:512,deviceScaleFactor:1,mobile:false});
  await cdp('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
  await cdp('Page.navigate',{url:pathToFileURL(path.join(root,'SaleSync_Online_Alive_v5/assets/logo-email.svg')).href});
  await loaded("document.readyState==='complete' && !!document.querySelector('svg')");
  await screenshot(path.join(root,'SaleSync_Online_Alive_v5/assets/logo-email.png'));
  const {verificationEmail,LOGO_CID}=require('../backend/emails/verification.cjs');
  const message=verificationEmail({code:'4821',ttlSeconds:300});
  const html=message.html.replace('cid:'+LOGO_CID,'data:image/png;base64,'+message.attachments[0].content.toString('base64'));
  const file=path.join(out,'verification-email.html');fs.writeFileSync(file,html);
  const captured=await nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'}).sendMail({...message,from:'preview@example.test',to:'recipient@example.test'});
  fs.writeFileSync(path.join(out,'verification-email.eml'),captured.message);
  await cdp('Emulation.setDefaultBackgroundColorOverride',{color:{r:243,g:246,b:251,a:1}});
  const checks=[];
  for(const width of [320,390,720]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:940,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:pathToFileURL(file).href});
    await loaded("document.readyState==='complete' && document.querySelector('img')?.naturalWidth===512");
    const fits=await evaluate('document.documentElement.scrollWidth <= window.innerWidth');
    checks.push({width,noHorizontalOverflow:fits,embeddedLogoLoaded:true});
    if(!fits)throw Error('Email preview overflow at '+width+'px.');
    if(width===390||width===720)await screenshot(path.join(out,width===390?'verification-email-mobile.png':'verification-email-desktop.png'));
  }
  fs.writeFileSync(path.join(out,'email-preview-results.json'),JSON.stringify({checks},null,2));
  console.log('Generated 512px logo, HTML/MIME previews, and desktop/mobile screenshots. All 3 preview widths passed. No email was sent.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(ws){try{await cdp('Browser.close');}catch{}ws.close();}browser?.kill();});
