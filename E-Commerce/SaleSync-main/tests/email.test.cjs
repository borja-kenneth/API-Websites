const {test}=require('node:test');
const assert=require('node:assert/strict');
const nodemailer=require('nodemailer');
const {verificationEmail,LOGO_CID}=require('../backend/emails/verification.cjs');
const {createMailer}=require('../backend/mailer.cjs');
const {orderEmail}=require('../backend/emails/order.cjs');
const {inspectSenderDns}=require('../scripts/check-email-dns.cjs');

test('SMTP diagnostics classify rejected authentication without exposing sender, credentials, recipient or provider messages',async()=>{
  let fail=true;
  const mailer=createMailer({MAIL_MODE:'gmail',GMAIL_USER:'private-sender@gmail.com',GMAIL_APP_PASSWORD:'isolated-test-password'},()=>({sendMail:async()=>{if(fail)throw Object.assign(Error('private provider response with credentials'),{code:'EAUTH'});}}));
  assert.equal(mailer.deliveryStatus().status,'not-attempted');
  await assert.rejects(mailer.sendVerification('private-recipient@gmail.com','1234',300));
  assert.equal(mailer.deliveryStatus().category,'AUTHENTICATION_FAILED');
  assert.equal(mailer.deliveryStatus().status,'failed');
  assert.ok(mailer.deliveryStatus().at>0);
  assert.ok(!/private|password|1234|gmail/.test(JSON.stringify(mailer.deliveryStatus())));
  fail=false;
  await mailer.sendPasswordReset('private-recipient@gmail.com','https://example.test/#/reset-password?token=private-token');
  assert.equal(mailer.deliveryStatus().status,'provider-accepted');
  assert.equal(mailer.deliveryStatus().category,null);
  const copy=mailer.deliveryStatus();copy.status='tampered';assert.equal(mailer.deliveryStatus().status,'provider-accepted');
});

test('verification email contains selectable highlighted code, accurate expiry, and an embedded high-resolution logo',()=>{
  const message=verificationEmail({code:'0123',ttlSeconds:90});
  assert.match(message.html,/<p class="email-code"[^>]*>0123<\/p>/);
  assert.match(message.text,/verification code: 0123/);
  assert.ok(message.html.includes('1 minute 30 seconds'));assert.ok(message.text.includes('1 minute 30 seconds'));
  assert.ok(message.html.includes('cid:'+LOGO_CID));assert.equal(message.attachments.length,1);
  const logo=message.attachments[0];assert.equal(logo.cid,LOGO_CID);assert.equal(logo.contentDisposition,'inline');
  assert.equal(logo.content.readUInt32BE(16),512);assert.equal(logo.content.readUInt32BE(20),512);
  assert.ok(!/src="https?:/i.test(message.html));assert.ok(!message.subject.includes('0123'));
  assert.ok(!message.html.match(/<div style="display:none[\s\S]*?<\/div>/)[0].includes('0123'));
  assert.ok(!/<script|<form|<svg|localhost|127\.0\.0\.1/i.test(message.html));
  assert.equal(message.disableFileAccess,true);assert.equal(message.disableUrlAccess,true);
});
test('Nodemailer composes HTML, plain text and inline PNG into a related MIME message without network access',async()=>{
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const captured=await transport.sendMail({...verificationEmail({code:'4821',ttlSeconds:300}),from:'sender@example.test',to:'recipient@example.test'});
  const raw=captured.message.toString('utf8');
  assert.match(raw,/multipart\/alternative/);assert.match(raw,/multipart\/related/);assert.match(raw,/Content-Type: text\/plain/);assert.match(raw,/Content-Type: text\/html/);assert.match(raw,/Content-Type: image\/png/);
  assert.ok(raw.includes('Content-ID: <'+LOGO_CID+'>'));assert.match(raw,/Content-Disposition: inline/);
});
test('the configured sender uses the branded template and the Sandbox keeps email isolated',async()=>{
  let message,options;
  const mailer=createMailer({GMAIL_USER:'sender@gmail.com',GMAIL_APP_PASSWORD:'abcdefghijklmnop'},config=>{options=config;return {sendMail:async m=>{message=m;}};});
  await mailer.sendVerification('recipient@gmail.com','4821',300);
  assert.match(message.html,/SaleSync/);assert.match(message.html,/YOUR VERIFICATION CODE/);assert.equal(message.attachments[0].cid,LOGO_CID);
  assert.equal(message.from.address,'sender@gmail.com');assert.equal(message.replyTo.address,message.from.address);assert.equal(message.envelope.from,message.from.address);assert.deepEqual(message.envelope.to,['recipient@gmail.com']);
  assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.minVersion,'TLSv1.2');
  const sandbox=await mailer.sandboxEmail();assert.equal(sandbox.realEmailSent,false);assert.equal(sandbox.recipient,'recipient@example.test');
  const sample=verificationEmail({code:'4821',ttlSeconds:300,sandbox:true});assert.match(sample.html,/SANDBOX PREVIEW/);assert.match(sample.text,/not a usable account code/);
});
test('verification MIME has honest automatic-message headers and no forged authentication or priority claims',async()=>{
  let captured;
  const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const mailer=createMailer({GMAIL_USER:'sender@school.example',GMAIL_APP_PASSWORD:'abcdefghijklmnop'},()=>({sendMail:async m=>{captured=await stream.sendMail(m);}}));
  await mailer.sendVerification('recipient@gmail.com','4821',300);
  const raw=captured.message.toString('utf8'),headers=raw.split('\r\n\r\n')[0];
  assert.match(headers,/Auto-Submitted: auto-generated/);assert.match(headers,/X-Auto-Response-Suppress: All/);
  assert.match(headers,/Message-ID: <[^>]+@school\.example>/);assert.match(headers,/Reply-To: SaleSync Online <sender@school\.example>/);
  assert.doesNotMatch(headers,/(?:^|\r\n)(?:Authentication-Results|Received-SPF|Importance|X-Priority):/i);
  assert.deepEqual(captured.envelope,{from:'sender@school.example',to:['recipient@gmail.com']});
  const content=verificationEmail({code:'4821',ttlSeconds:300});assert.ok(!/favorite find|Tech, style/i.test(content.text+content.html));
});
test('verification template rejects malformed codes and invalid expiration values',()=>{
  for(const code of ['123','12345','<img>','12 3',1234])assert.throws(()=>verificationEmail({code,ttlSeconds:300}));
  for(const ttlSeconds of [0,-1,901,NaN,1.5,'300'])assert.throws(()=>verificationEmail({code:'4821',ttlSeconds}));
});
test('DNS diagnostics distinguish missing records from failed lookups and do not assume another DKIM selector is absent',async()=>{
  const report=await inspectSenderDns({domain:'school.example',resolveTxt:async name=>{
    if(name==='school.example')return [['v=spf1 include:', '_spf.google.com ~all'],['unrelated-site-verification']];
    const e=Error();e.code=name.startsWith('_dmarc.')?'ENODATA':'ESERVFAIL';throw e;
  }});
  assert.equal(report.spf.found,true);assert.deepEqual(report.spf.records,['v=spf1 include:_spf.google.com ~all']);assert.equal(report.dmarc.found,false);assert.equal(report.dkim.found,null);assert.equal(report.dkim.error,'DNS_LOOKUP_FAILED');
  assert.ok(report.notes.some(n=>n.includes('different selector')));assert.ok(report.notes.some(n=>n.includes('cannot prove')));
});
test('DNS diagnostic uses a specified DKIM selector and rejects invalid query inputs',async()=>{
  const names=[];
  const report=await inspectSenderDns({domain:'school.example',selector:'custom2026',resolveTxt:async name=>{names.push(name);return name.startsWith('custom2026.')?[['v=DKIM1; k=rsa; p=publictestkey']]:[];}});
  assert.ok(names.includes('custom2026._domainkey.school.example'));assert.equal(report.dkim.found,true);assert.equal(report.spf.found,false);
  await assert.rejects(inspectSenderDns({domain:'invalid domain',resolveTxt:async()=>[]}));await assert.rejects(inspectSenderDns({domain:'school.example',selector:'bad selector',resolveTxt:async()=>[]}));
});
test('password recovery composes a branded HTML/plain-text message with a single-use link and inline logo without SMTP',async()=>{
  const {recoveryEmail}=require('../backend/emails/recovery.cjs');
  const rawToken='A'.repeat(43),url='http://127.0.0.1:3000/#/reset-password?token='+rawToken;
  let sent,mime;
  const capture=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const sender=createMailer({MAIL_MODE:'gmail',GMAIL_USER:'sender@gmail.com',GMAIL_APP_PASSWORD:'abcdefghijklmnop'},()=>({sendMail:async message=>{sent=message;mime=await capture.sendMail(message);}}));
  await sender.sendPasswordReset('buyer@gmail.com',url,1800);
  assert.equal(sent.from.address,'sender@gmail.com');assert.equal(sent.to,'buyer@gmail.com');assert.ok(sent.text.includes(url));assert.ok(sent.text.includes('30 minutes'));assert.ok(sent.html.includes('href="'+url+'"'));assert.ok(sent.html.includes('cid:'+LOGO_CID));assert.ok(!sent.subject.includes(rawToken));assert.equal(sent.headers['Auto-Submitted'],'auto-generated');assert.equal(sent.attachments[0].content.readUInt32BE(16),512);assert.match(mime.message.toString(),/multipart\/related/);assert.throws(()=>recoveryEmail('javascript:alert(1)'),/INVALID_RECOVERY_URL/);
});

test('local recovery emails explain device access without adding local instructions to hosted emails',()=>{
  const {recoveryEmail}=require('../backend/emails/recovery.cjs');
  for(const host of ['127.0.0.1','localhost','[::1]']){
    const email=recoveryEmail('http://'+host+':3000/#/reset-password?token='+'A'.repeat(43));
    assert.match(email.text,/PC running SaleSync/);assert.match(email.html,/cannot reach that PC from your phone/);
  }
  for(const host of ['192.168.100.207','10.0.0.5','172.16.1.2','172.31.1.2']){
    const url='http://'+host+':3000/#/reset-password?token='+'A'.repeat(43),email=recoveryEmail(url);
    assert.match(email.text,/same Wi-Fi\/network/);assert.match(email.html,/same Wi-Fi\/network/);assert.ok(email.html.includes('href="'+url+'"'));
  }
  for(const host of ['store.example','172.32.1.2']){
    const email=recoveryEmail('https://'+host+'/#/reset-password?token='+'A'.repeat(43));
    assert.doesNotMatch(email.text+email.html,/Local development|same Wi-Fi/);
  }
});

test('order, shipping and delivery mail use branded MIME, escaped text, stable event identifiers and honest test/payment labels',async()=>{
  const data={orderId:'EC-TEST',lines:[{name:'<script>unsafe</script>',qty:2}],discount:10,total:59,status:'pending_payment',test:true,url:'http://127.0.0.1:3000/#/account',shipment:{seller:'Test & Store',courier:'Test Courier',tracking:'LOCAL-ONLY'}};
  for(const kind of ['order_created','shipped','delivered']){
    const template=orderEmail({...data,kind});assert.match(template.text,/no real money/);assert.match(template.html,/cid:/);assert.doesNotMatch(template.html,/<script>/);assert.match(template.text,/PHP 59.00/);assert.ok(template.html.includes(data.url));
  }
  assert.match(orderEmail({...data,test:false,status:'awaiting_gateway',kind:'order_created'}).text,/Unpaid order request/);
  let message;const sender=createMailer({GMAIL_USER:'sender@gmail.com',GMAIL_APP_PASSWORD:'abcdefghijklmnop'},()=>({sendMail:async m=>{message=m;}}));await sender.sendOrder('buyer@gmail.com',{...data,kind:'shipped'},'shipment-event');const firstId=message.messageId;await sender.sendOrder('buyer@gmail.com',{...data,kind:'shipped'},'shipment-event');assert.equal(message.messageId,firstId);assert.equal(message.envelope.from,'sender@gmail.com');assert.equal(message.to,'buyer@gmail.com');
  const capture=nodemailer.createTransport({streamTransport:true,buffer:true});const mime=await capture.sendMail(message);assert.match(mime.message.toString(),/multipart\/related/);assert.throws(()=>orderEmail({...data,kind:'unexpected'}));assert.throws(()=>orderEmail({...data,kind:'shipped',url:'javascript:alert(1)'}));
});
