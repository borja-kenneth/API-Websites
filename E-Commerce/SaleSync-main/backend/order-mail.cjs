const {randomUUID}=require('node:crypto');
function orderMailService({s,db,config,now,audit,mailer}){
  let running=null;
  function enqueueEmail(kind,orderId,shipmentId){
    const order=s.orderRow(orderId);
    // These locally provisioned QA identifiers are not real owned mailboxes.
    if(db.prepare("SELECT 1 FROM audit WHERE actor_id=? AND action='LOCAL_QA_ACCOUNT_CREATED' LIMIT 1").get(order.user_id))return;
    const data=JSON.parse(order.data),sh=shipmentId&&db.prepare('SELECT sh.*,st.name AS seller FROM shipments sh JOIN stores st ON st.id=sh.store_id WHERE sh.id=?').get(shipmentId);
    const payload={kind,orderId,status:order.status,test:['local-test','paymongo-test'].includes(db.prepare('SELECT payment_mode FROM order_meta WHERE order_id=?').get(orderId)?.payment_mode),lines:data.lines,total:order.total_cents/100,discount:data.discount||0,shipment:sh?{seller:sh.seller,courier:sh.courier,tracking:sh.tracking}:null,url:config.origin+'/#/account'};
    db.prepare('INSERT OR IGNORE INTO email_outbox(id,event_key,user_id,order_id,kind,payload,next_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),(shipmentId||orderId)+':'+kind,order.user_id,orderId,kind,JSON.stringify(payload),now(),now());
  }
  function flush(){
    if(running)return running;
    running=(async()=>{
      if(!mailer.configured||typeof mailer.sendOrder!=='function')return;
      db.prepare("UPDATE email_outbox SET status='pending',lease_until=NULL WHERE status='sending' AND lease_until<=?").run(now());
      const rows=db.prepare("SELECT * FROM email_outbox WHERE status='pending' AND next_at<=? ORDER BY created_at,id LIMIT 10").all(now());
      for(const row of rows){
        const claimed=db.prepare("UPDATE email_outbox SET status='sending',attempts=attempts+1,lease_until=? WHERE id=? AND status='pending'").run(now()+60000,row.id);if(!claimed.changes)continue;
        try{const user=db.prepare('SELECT email FROM users WHERE id=?').get(row.user_id);await mailer.sendOrder(user.email,JSON.parse(row.payload),row.event_key);db.prepare("UPDATE email_outbox SET status='sent',sent_at=?,lease_until=NULL,last_error=NULL WHERE id=?").run(now(),row.id);audit(null,'ORDER_EMAIL_SENT',{orderId:row.order_id,kind:row.kind});}
        catch{const attempts=row.attempts+1;db.prepare("UPDATE email_outbox SET status=?,next_at=?,lease_until=NULL,last_error='DELIVERY_FAILED' WHERE id=?").run(attempts>=5?'failed':'pending',now()+Math.min(3600,30*2**(attempts-1))*1000,row.id);audit(null,'ORDER_EMAIL_FAILED',{orderId:row.order_id,kind:row.kind});}
      }
    })().finally(()=>{running=null;});return running;
  }
  return {enqueueEmail,flush,wait:()=>running||Promise.resolve()};
}
module.exports={orderMailService};
