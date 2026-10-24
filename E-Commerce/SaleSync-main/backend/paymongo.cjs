/* PayMongo test-only hosted checkout. Provider state lives in existing payment_events. */
const {createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
function paymongoService({s,db,config,now,audit,fail,fetchImpl=fetch}){
 const enabled=config.paymentMode==='paymongo-test',locks=new Set();
 const state=id=>{const row=db.prepare('SELECT outcome FROM payment_events WHERE id=?').get('pm_session:'+id);return row?JSON.parse(row.outcome):null;};
 const save=(id,value)=>db.prepare('INSERT INTO payment_events VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome').run('pm_session:'+id,id,JSON.stringify(value),now());
 async function request(path,method='GET',attributes){
  let response;try{response=await fetchImpl('https://api.paymongo.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(config.env.PAYMONGO_SECRET_KEY+':').toString('base64'),'Content-Type':'application/json'},...(attributes?{body:JSON.stringify({data:{attributes}})}:{})});}catch{fail(503,'PAYMONGO_UNAVAILABLE','PayMongo test checkout is unavailable. Payment state remains pending.');}
  if(!response.ok)fail(503,'PAYMONGO_REJECTED','PayMongo could not complete this request. Reconcile before retrying.');
  try{return (await response.json()).data;}catch{fail(503,'PAYMONGO_RESPONSE','Invalid provider response.');}
 }
 function validate(resource,payment,sessionId){
  const a=resource?.attributes;
  if(resource?.id!==sessionId||a?.livemode===true||a?.reference_number!==payment.order_id)fail(409,'PAYMONGO_MISMATCH','Provider session reference does not match.');
  const paid=(a.payments||[]).filter(p=>p.attributes?.status==='paid');
  if(!paid.length)return null;
  const p=paid[0],pi=a.payment_intent;
  if(paid.length!==1||!/^pay_[A-Za-z0-9]+$/.test(p.id)||p.attributes.livemode===true||pi?.attributes?.livemode===true||p.attributes.amount!==payment.amount_cents||p.attributes.currency!=='PHP'||pi?.attributes?.amount!==payment.amount_cents||pi.attributes.currency!=='PHP'||pi.attributes.status!=='succeeded'||p.attributes.payment_intent_id!==pi.id)fail(409,'PAYMONGO_MISMATCH','Provider payment details do not match the saved PHP order.');
  return p.id;
 }
 async function apply(resource,payment,eventId){
  const applied=s.transaction(()=>{
   const session=state(payment.id),providerId=validate(resource,payment,session?.sessionId);
   if(!providerId)return false;
   const existing=db.prepare('SELECT payment_id FROM payment_events WHERE id=?').get('pm_paid:'+providerId);
   if(existing){if(existing.payment_id!==payment.id)fail(409,'PAYMONGO_MISMATCH','Payment identifier is already assigned.');if(eventId)db.prepare('INSERT OR IGNORE INTO payment_events VALUES (?,?,?,?)').run(eventId,payment.id,'paymongo_verified',now());return true;}
   return {providerId};
  });
  if(!applied)return false;
  if(applied.providerId){
   await s.settleProviderPayment(payment.id,'success','pm_paid:'+applied.providerId);
   if(eventId)db.prepare('INSERT OR IGNORE INTO payment_events VALUES (?,?,?,?)').run(eventId,payment.id,'paymongo_verified',now());
   audit(null,'PAYMONGO_TEST_CONFIRMED',{});return true;
  }
  return true;
 }
 async function reconcile(payment,expire=false){
  const session=state(payment.id);if(!session?.sessionId)fail(409,'PAYMONGO_UNCERTAIN','Session creation is uncertain. Contact support; do not create another payment.');
  let resource=await request('/v1/checkout_sessions/'+session.sessionId);
  if(resource?.attributes?.livemode!==false)fail(409,'PAYMONGO_LIVE_PROHIBITED','Only test sessions are accepted.');
  if(await apply(resource,payment))return {paid:true};
  validate(resource,payment,session.sessionId);
  if(expire&&resource.attributes.status!=='expired'){
   try{resource=await request('/v1/checkout_sessions/'+session.sessionId+'/expire','POST');}
   catch{resource=await request('/v1/checkout_sessions/'+session.sessionId);}
   if(resource?.attributes?.livemode!==false)fail(409,'PAYMONGO_LIVE_PROHIBITED','Only test sessions are accepted.');
   if(await apply(resource,payment))return {paid:true};validate(resource,payment,session.sessionId);
  }
  if(resource.attributes.status==='expired'){s.settleProviderPayment(payment.id,'expired','pm_expired:'+session.sessionId);return {expired:true};}
  return {pending:true,checkoutUrl:session.checkoutUrl};
 }
 async function checkout(user,id,action){
  if(!enabled)fail(404,'NOT_FOUND','PayMongo test mode is disabled.');
  s.readOrder(user,id);const payment=db.prepare("SELECT * FROM payment_attempts WHERE order_id=? AND mode='paymongo-test'").get(id);
  if(!payment)fail(404,'NOT_FOUND','PayMongo payment not found.');
  if(locks.has(id))fail(409,'PAYMENT_BUSY','This payment is already being checked.');locks.add(id);
  try{
   if(payment.status!=='pending')return {order:s.readOrder(user,id)};
   const session=state(payment.id),order=s.readOrder(user,id);
   let result;
   if(session)result=await reconcile(payment,action==='cancel'||order.expiresAt<=now());
   else if(action==='refresh'){result={pending:true};}
   else if(action==='cancel'||order.expiresAt<=now()){s.settleProviderPayment(payment.id,'expired','pm_unstarted:'+payment.id);result={expired:true};}
   else{
    // Persist before the network request. Unknown creation outcomes must never create duplicates.
    if(!db.prepare('INSERT OR IGNORE INTO payment_events VALUES (?,?,?,?)').run('pm_session:'+payment.id,payment.id,JSON.stringify({creating:true}),now()).changes)fail(409,'PAYMENT_BUSY','A checkout creation is already recorded. Reconcile before retrying.');
    const resource=await request('/v2/checkout_sessions','POST',{line_items:[{name:'SaleSync TEST order '+id,amount:payment.amount_cents,currency:'PHP',quantity:1}],payment_method_types:config.env.PAYMONGO_PAYMENT_METHODS.split(',').map(v=>v.trim()),reference_number:id,success_url:config.origin+'/#/checkout?order='+encodeURIComponent(id),cancel_url:config.origin+'/#/checkout?order='+encodeURIComponent(id),send_email_receipt:false,show_line_items:true,description:'SaleSync TEST ONLY; includes saved discounts and shipping',pass_on_fees:false});
    const url=resource?.attributes?.checkout_url;
    if(!/^cs_[A-Za-z0-9]+$/.test(resource?.id||'')||resource.attributes.livemode!==false||typeof url!=='string'||!url.startsWith('https://checkout.paymongo.com/'))fail(503,'PAYMONGO_RESPONSE','Invalid test checkout response. Contact support before retrying.');
    save(payment.id,{sessionId:resource.id,checkoutUrl:url});result={pending:true,checkoutUrl:url};audit(user,'PAYMONGO_SESSION_CREATED',{});
   }
   return {...result,order:s.readOrder(user,id)};
  }finally{locks.delete(id);}
 }
 async function webhook(req){
  if(!enabled)fail(404,'NOT_FOUND','PayMongo is disabled.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>262144)fail(413,'BODY_TOO_LARGE','Webhook exceeds size limit.');chunks.push(chunk);}const raw=Buffer.concat(chunks);
  const parts=String(req.headers['paymongo-signature']||'').split(',').map(x=>x.trim().split('=')),header=Object.fromEntries(parts),t=header.t;
  const expected=createHmac('sha256',config.env.PAYMONGO_WEBHOOK_SECRET).update(String(t)+'.').update(raw).digest();
  if(parts.filter(p=>p[0]==='t').length!==1||parts.filter(p=>p[0]==='te').length!==1||!/^\d+$/.test(t||'')||Math.abs(now()/1000-Number(t))>300||header.li||!/^[a-f0-9]{64}$/.test(header.te||'')||!timingSafeEqual(expected,Buffer.from(header.te,'hex')))fail(401,'INVALID_SIGNATURE','Invalid test webhook signature.');
  let event;try{event=JSON.parse(raw).data;}catch{fail(400,'INVALID_JSON','Invalid webhook JSON.');}
  if(event?.attributes?.livemode!==false)fail(400,'LIVE_PROHIBITED','Only test webhooks are accepted.');
  if(event.attributes.type!=='checkout_session.payment.paid')return {ignored:true};
  if(!/^evt_[A-Za-z0-9]+$/.test(event.id||''))fail(400,'INVALID_EVENT','Invalid webhook event identifier.');
  const resource=event.attributes.data;
  const row=db.prepare("SELECT p.* FROM payment_events e JOIN payment_attempts p ON p.id=e.payment_id WHERE e.id LIKE 'pm_session:%' AND json_extract(CASE WHEN json_valid(e.outcome) THEN e.outcome ELSE '{}' END,'$.sessionId')=?").get(resource?.id||'');
  if(!row)fail(409,'UNKNOWN_SESSION','Session is not assigned to a saved order.');
  if(!validate(resource,row,resource.id))fail(409,'PAYMENT_NOT_PAID','No successful payment in the webhook.');
  const prior=db.prepare('SELECT payment_id FROM payment_events WHERE id=?').get('pm_evt:'+event.id);if(prior){if(prior.payment_id!==row.id)fail(409,'PAYMONGO_MISMATCH','Event already belongs to another payment.');return {received:true,replayed:true};}
  // Retrieve with the test key as an independent authoritative check.
  const current=await request('/v1/checkout_sessions/'+resource.id);if(current?.attributes?.livemode!==false)fail(409,'LIVE_PROHIBITED','Only test sessions are accepted.');
  if(validate(current,row,resource.id)!==validate(resource,row,resource.id))fail(409,'PAYMONGO_MISMATCH','Webhook and retrieved payment identifiers differ.');
  if(!await apply(current,row,'pm_evt:'+event.id))fail(409,'PAYMENT_NOT_PAID','Provider confirmation is still pending.');
  audit(null,'PAYMONGO_WEBHOOK_VERIFIED',{});return {received:true};
 }
 async function poll(){if(!enabled)return;const rows=db.prepare("SELECT p.* FROM payment_attempts p JOIN order_meta m ON m.order_id=p.order_id WHERE p.mode='paymongo-test' AND p.status='pending' AND m.expires_at<=? LIMIT 10").all(now());for(const row of rows){if(locks.has(row.order_id))continue;locks.add(row.order_id);try{const st=state(row.id);if(!st){s.settleProviderPayment(row.id,'expired','pm_unstarted:'+row.id);}else await reconcile(row,true);}catch{db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(randomUUID(),'PAYMONGO_RECONCILIATION_FAILED',now());}finally{locks.delete(row.order_id);}}}
 async function handle(ctx){const m=ctx.p.match(/^\/api\/orders\/([^/]+)\/payment\/(checkout|refresh|cancel)$/);if(!m)return false;if(ctx.req.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','Use POST.');const user=ctx.requireUser(ctx.session,'orders:own');s.fields(await ctx.body(ctx.req),[]);ctx.json(200,await checkout(user,m[1],m[2]));return true;}
 return {handle,webhook,poll};
}
module.exports={paymongoService};
