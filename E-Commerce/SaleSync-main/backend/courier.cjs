const {createHmac}=require('node:crypto');
const {digest,safeEqual}=require('./security.cjs');
const BASE='https://api.aftership.com/tracking/2026-07/trackings';
function aftershipAdapter({apiKey,fetchImpl=fetch}){
  async function request(path,method='GET',body){
    if(!apiKey)throw Error('COURIER_NOT_CONFIGURED');
    const response=await fetchImpl(BASE+path,{method,headers:{'as-api-key':apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
    const result=await response.json();if(!response.ok||result.meta?.code>=400)throw Object.assign(Error('COURIER_PROVIDER_ERROR'),{duplicate:response.status===409||result.meta?.code===4003});
    const data=result.data?.tracking||result.data;if(!data?.id)throw Error('COURIER_INVALID_RESPONSE');return data;
  }
  return {async register(sh,slug){try{return await request('','POST',{id:sh.id,tracking_number:sh.tracking,slug,order_id:sh.order_id,title:sh.order_id});}catch(error){if(error.duplicate)return request('/'+encodeURIComponent(sh.id));throw error;}},get:id=>request('/'+encodeURIComponent(id))};
}
function courierService({s,db,config,now,audit,fail,fetchImpl}){
  const adapter=aftershipAdapter({apiKey:config.env.AFTERSHIP_API_KEY,fetchImpl});
  const mode=config.courierMode;
  const tagStatus={Pending:'shipped',InfoReceived:'shipped',InTransit:'shipped',OutForDelivery:'out_for_delivery',AvailableForPickup:'out_for_delivery',Delivered:'delivered',AttemptFail:'exception',Exception:'exception',Expired:'exception'};
  function shipment(id){const sh=db.prepare('SELECT * FROM shipments WHERE id=?').get(id);if(!sh)fail(404,'NOT_FOUND','Shipment not found.');return sh;}
  function view(id){const row=db.prepare('SELECT * FROM tracking_subscriptions WHERE shipment_id=?').get(id);return row?{shipmentId:id,provider:row.provider,state:row.state,lastError:row.last_error,nextSyncAt:row.next_sync_at,events:db.prepare('SELECT id,status,description,occurred_at AS occurredAt FROM tracking_events WHERE shipment_id=? ORDER BY occurred_at DESC,created_at DESC LIMIT 50').all(id)}:null;}
  async function register(user,id,input){
    s.fields(input,['revision','slug']);const sh=shipment(id);s.ownedStore(user,sh.store_id);s.revision(input.revision,sh.revision);
    if(sh.status!=='shipped'||!sh.tracking||!sh.courier)fail(422,'DISPATCH_REQUIRED','Dispatch the packed shipment with its courier and tracking reference first.');
    if(mode==='manual')fail(503,'COURIER_NOT_CONFIGURED','Tracking integration is disabled.');
    const slug=input.slug||'';if(mode==='aftership'&&!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug))fail(422,'COURIER_SLUG_REQUIRED','Enter the courier slug from the AfterShip courier list.');
    const existing=db.prepare('SELECT * FROM tracking_subscriptions WHERE shipment_id=?').get(id);if(existing?.state==='active')return view(id);if(existing?.state==='registering'&&existing.created_at>now()-60000)fail(409,'COURIER_BUSY','Tracking registration is already running.');
    db.prepare("INSERT INTO tracking_subscriptions(shipment_id,provider,slug,state,created_at) VALUES (?,?,?,'registering',?) ON CONFLICT(shipment_id) DO UPDATE SET state='registering',created_at=excluded.created_at").run(id,mode,slug,now());
    try{
      const remote=mode==='local-test'?{id:'LOCAL-'+id}:await adapter.register(sh,slug);
      const current=shipment(id);if(current.tracking!==sh.tracking||current.courier!==sh.courier)throw Error('SHIPMENT_CHANGED');
      db.prepare("UPDATE tracking_subscriptions SET tracker_id=?,slug=?,state='active',next_sync_at=?,last_error=NULL WHERE shipment_id=?").run(remote.id,slug,now()+config.courierStepSeconds*1000,id);audit(user,'TRACKING_REGISTERED',{shipmentId:id,provider:mode});return view(id);
    }catch{db.prepare("UPDATE tracking_subscriptions SET state='error',last_error='REGISTRATION_FAILED' WHERE shipment_id=?").run(id);fail(503,'COURIER_UNAVAILABLE','Tracking registration failed. Check the server configuration and retry.');}
  }
  function applyEvent(id,{eventId,tag,occurredAt,description}){
    if(typeof eventId!=='string'||eventId.length<1||eventId.length>180||!tagStatus[tag]||!Number.isSafeInteger(occurredAt)||occurredAt<0||occurredAt>now()+300000||typeof description!=='string'||description.length>300)fail(422,'INVALID_TRACKING_EVENT','Invalid tracking event.');
    return s.transaction(()=>{
      const sh=shipment(id),sub=db.prepare('SELECT * FROM tracking_subscriptions WHERE shipment_id=?').get(id);if(!sub||sub.state!=='active')fail(404,'NOT_FOUND','Active tracking subscription not found.');
      const eventKey=digest(sub.provider+':'+eventId),prior=db.prepare('SELECT shipment_id FROM tracking_events WHERE id=?').get(eventKey);if(prior){if(prior.shipment_id!==id)fail(409,'EVENT_CONFLICT','Tracking event belongs to another shipment.');return {replayed:true,tracking:view(id)};}
      const status=tagStatus[tag],stale=occurredAt<sub.last_event_at;db.prepare('INSERT INTO tracking_events VALUES (?,?,?,?,?,?)').run(eventKey,id,status,description.trim()||tag,occurredAt,now());
      if(!stale&&['shipped','out_for_delivery'].includes(sh.status)){
        const target=['shipped','out_for_delivery','delivered'].indexOf(status),current=['shipped','out_for_delivery','delivered'].indexOf(sh.status);
        // Courier updates may skip a checkpoint; advance through the existing legal stages.
        for(let stage=current+1;stage<=target;stage++){const currentSh=shipment(id);s.transitionShipment({id:null,role:'management'},id,{revision:currentSh.revision,status:['shipped','out_for_delivery','delivered'][stage]});}
        if(status==='exception')s.notification(s.orderRow(sh.order_id).user_id,'Courier reported a delivery exception. See order tracking.',sh.order_id);
      }
      db.prepare('UPDATE tracking_subscriptions SET last_event_at=MAX(last_event_at,?),next_sync_at=?,last_error=NULL WHERE shipment_id=?').run(occurredAt,now()+config.courierStepSeconds*1000,id);audit(null,'TRACKING_EVENT',{shipmentId:id,status,stale});return {replayed:false,tracking:view(id)};
    });
  }
  async function sync(id){
    const sh=shipment(id),sub=db.prepare('SELECT * FROM tracking_subscriptions WHERE shipment_id=?').get(id);if(!sub||sub.state!=='active')fail(404,'NOT_FOUND','Active tracking subscription not found.');
    if(sub.provider==='local-test'){const tag=sh.status==='shipped'?'OutForDelivery':sh.status==='out_for_delivery'?'Delivered':null;return tag?applyEvent(id,{eventId:'local:'+id+':'+tag,tag,occurredAt:now(),description:'Local courier simulation: '+tag}):{tracking:view(id)};}
    try{const remote=await adapter.get(sub.tracker_id);if(remote.id!==sub.tracker_id||remote.tracking_number!==sh.tracking)throw Error('TRACKING_MISMATCH');const tag=remote.tag,at=Date.parse(remote.updated_at||'');if(!tagStatus[tag]||!Number.isFinite(at))throw Error('INVALID_TRACKING');return applyEvent(id,{eventId:'poll:'+sub.tracker_id+':'+remote.updated_at+':'+tag,tag,occurredAt:at,description:'Courier update: '+tag});}catch{db.prepare("UPDATE tracking_subscriptions SET last_error='SYNC_FAILED',next_sync_at=? WHERE shipment_id=?").run(now()+300000,id);fail(503,'COURIER_UNAVAILABLE','Courier refresh failed; existing tracking is retained.');}
  }
  async function poll(){const rows=db.prepare("SELECT t.shipment_id FROM tracking_subscriptions t JOIN shipments sh ON sh.id=t.shipment_id WHERE t.state='active' AND t.next_sync_at<=? AND sh.status IN ('shipped','out_for_delivery') ORDER BY t.next_sync_at LIMIT 10").all(now());for(const row of rows)try{await sync(row.shipment_id);}catch{/* Sanitized state is persisted by sync. */}}
  async function webhook(req){
    if(mode!=='aftership'||!config.env.AFTERSHIP_WEBHOOK_SECRET)fail(404,'NOT_FOUND','Webhook is not configured.');
    if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON_REQUIRED','Send JSON.');
    let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>262144)fail(413,'BODY_TOO_LARGE','Webhook payload is too large.');chunks.push(chunk);}const raw=Buffer.concat(chunks);
    const expected=createHmac('sha256',config.env.AFTERSHIP_WEBHOOK_SECRET).update(raw).digest('base64');if(!safeEqual(expected,req.headers['aftership-hmac-sha256']||''))fail(401,'INVALID_SIGNATURE','Invalid webhook signature.');
    let input;try{input=JSON.parse(raw);}catch{fail(400,'INVALID_JSON','Invalid webhook JSON.');}
    if(input.event!=='tracking_update')return {ignored:true};const msg=input.msg;if(!msg||typeof msg.id!=='string')fail(422,'INVALID_TRACKING_EVENT','Tracking ID is required.');const sub=db.prepare("SELECT t.*,sh.tracking FROM tracking_subscriptions t JOIN shipments sh ON sh.id=t.shipment_id WHERE t.provider='aftership' AND t.tracker_id=?").get(msg.id);if(!sub) return {ignored:true};if(msg.tracking_number!==sub.tracking)fail(422,'TRACKING_MISMATCH','Tracking reference does not match.');
    return applyEvent(sub.shipment_id,{eventId:input.event_id,tag:msg.tag,occurredAt:Math.round(Number(input.ts)*1000),description:'Courier update: '+msg.tag});
  }
  return {mode,register,view,applyEvent,sync,poll,webhook,shipment};
}
module.exports={courierService,aftershipAdapter};
