/* Read-only API boundary: POS quantities never enter commerce inventory services. */
const {randomUUID}=require('node:crypto');
function posInventory({s,db,config,now,audit,fail,fetchImpl=fetch}){
 const env=config.env,enabled=env.POS_ENABLED==='true',cache=new Map(),pending=new Map();
 if(env.POS_ENABLED&&!['true','false'].includes(env.POS_ENABLED))throw Error('POS_ENABLED must be true or false.');
 let mappings=[],lastCheck=null,lastCheckAt=null;
 const integer=(name,fallback,min,max)=>{const n=Number(env[name]||fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid POS integration limits.');return n;};
 const timeout=integer('POS_TIMEOUT_MS',3000,100,10000),ttl=integer('POS_STALE_SECONDS',300,10,86400)*1000;
 let base;
 if(enabled){
  try{base=new URL(env.POS_BASE_URL);mappings=JSON.parse(env.POS_MAPPINGS||'[]');}catch{throw Error('Configure a valid POS URL and explicit store/SKU mappings.');}
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(env.POS_ALLOW_HTTP_LOOPBACK==='true'&&!config.production&&base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))||!/^\S{32,512}$/.test(env.POS_AUTH_TOKEN||''))throw Error('POS requires HTTPS and a private machine token of at least 32 characters.');
  const stores=new Set(),remote=new Set();
  if(!Array.isArray(mappings)||mappings.length>100)throw Error('Invalid POS mappings.');
  for(const m of mappings){if(!m||typeof m.storeId!=='string'||!m.storeId||typeof m.posStoreId!=='string'||!m.posStoreId||m.posStoreId.length>100||!Array.isArray(m.skus)||!m.skus.length||m.skus.length>100||stores.has(m.storeId)||remote.has(m.posStoreId))throw Error('Use unique, explicit POS store mappings.');stores.add(m.storeId);remote.add(m.posStoreId);const local=new Set(),external=new Set();for(const sku of m.skus){if(!sku||typeof sku.sku!=='string'||!sku.sku||sku.sku.length>64||typeof sku.posSku!=='string'||!sku.posSku||sku.posSku.length>100||local.has(sku.sku)||external.has(sku.posSku))throw Error('Use unique, explicit POS SKU mappings.');local.add(sku.sku);external.add(sku.posSku);}}
 }
 const mapping=id=>mappings.find(m=>m.storeId===id);
 function products(m){return m.skus.map(link=>{const p=db.prepare('SELECT p.id,p.data,m.sku FROM products p JOIN product_meta m ON m.product_id=p.id WHERE m.store_id=? AND m.sku=? COLLATE BINARY').get(m.storeId,link.sku);if(!p||db.prepare('SELECT 1 FROM variation_groups WHERE product_id=?').get(p.id))throw Error('Invalid local SKU mapping.');return {...link,id:p.id,name:JSON.parse(p.data).name,variantId:s.variants.relation(p.id)?p.id:null};});}
 const stamp=value=>{const n=typeof value==='string'&&Date.parse(value);if(!Number.isFinite(n)||n<=0||n>now()+60000)throw Error('Invalid POS source timestamp.');return n;};
 async function request(path,params){
  const url=new URL(path,base);if(params)url.search=params.toString();
  for(let attempt=0;attempt<2;attempt++){
   try{const r=await fetchImpl(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeout),headers:{Authorization:'Bearer '+env.POS_AUTH_TOKEN,Accept:'application/json','X-SaleSync-API-Version':'1'}});
    if(!r.ok){if(r.status>=500&&attempt===0)continue;return {error:r.status===401||r.status===403?'AUTH_FAILED':'PROVIDER_UNAVAILABLE'};}
    let data;if(r.body){const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>131072)throw Error('Oversized response');chunks.push(chunk);}data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}else data=await r.json();return {data};
   }catch{if(attempt===1)return {error:'CONNECTION_FAILED'};}
  }
 }
 function view(store){const m=mapping(store.id),entry=cache.get(store.id),expired=entry?.updatedAt==null||now()-entry.updatedAt>ttl;
  let links=[];if(m){try{links=products(m);}catch{return {storeId:store.id,storeName:store.name,status:'mapping_error',stale:true,items:[]};}}
  const stale=expired||!!entry?.error||!!entry?.sourceAt&&now()-entry.sourceAt>ttl||!!entry?.items?.some(i=>now()-i.sourceUpdatedAt>ttl);
  return {storeId:store.id,storeName:store.name,status:!enabled?'disabled':!m?'unmapped':entry?.error?'unavailable':!entry?.updatedAt?'not_updated':stale?'stale':'connected',stale:!enabled||!m||stale,freshUntil:entry?.updatedAt?Math.min(entry.updatedAt,entry.sourceAt,...(entry.items||[]).map(i=>i.sourceUpdatedAt))+ttl:null,lastAttemptAt:entry?.attemptedAt||null,lastUpdateAt:entry?.updatedAt||null,sourceAt:entry?.sourceAt||null,error:entry?.error||null,items:links.map(p=>{const item=entry?.items?.find(i=>i.posSku===p.posSku);return {productId:p.id,variantId:p.variantId,name:p.name,sku:p.sku,posSku:p.posSku,backupQuantity:item?.quantity??null,sourceUpdatedAt:item?.sourceUpdatedAt||null,status:!item?'unavailable':stale?'stale':'reference_only'};})};
 }
 function status(){return {configured:enabled,contractVersion:'1',mappedStores:mappings.length,cachedStores:cache.size,unavailableStores:[...cache.values()].filter(c=>c.error).length,staleStores:[...cache.values()].filter(c=>!c.updatedAt||now()-c.updatedAt>ttl||c.error||now()-c.sourceAt>ttl||c.items?.some(i=>now()-i.sourceUpdatedAt>ttl)).length,lastCheck,lastCheckAt,timeoutMs:timeout,staleAfterSeconds:ttl/1000};}
 async function refresh(store,user,reason){if(!enabled)fail(409,'POS_DISABLED','POS reference inventory is not configured.');const m=mapping(store.id);if(!m)fail(409,'POS_UNMAPPED','This store has no explicit POS mapping.');let links;try{links=products(m);}catch{fail(409,'POS_MAPPING_ERROR','Review this store\'s local SKU mappings.');}
  if(pending.has(store.id))return pending.get(store.id);
  const task=(async()=>{const attemptedAt=now(),prior=cache.get(store.id);const params=new URLSearchParams({store_id:m.posStoreId});for(const p of links)params.append('sku',p.posSku);const result=await request('/api/v1/inventory',params);let items,sourceAt,error=result.error;
   if(!error)try{const data=result.data;if(data?.apiVersion!=='1'||data.storeId!==m.posStoreId||!Array.isArray(data.items)||data.items.length>100)throw Error();sourceAt=stamp(data.asOf);const seen=new Set();items=data.items.map(i=>{if(!links.some(p=>p.posSku===i.sku)||seen.has(i.sku)||!Number.isSafeInteger(i.quantity)||i.quantity<0||i.quantity>1000000000)throw Error();seen.add(i.sku);const sourceUpdatedAt=stamp(i.updatedAt);if(sourceUpdatedAt>sourceAt+60000)throw Error();return {posSku:i.sku,quantity:i.quantity,sourceUpdatedAt};});}catch{error='INVALID_RESPONSE';}
   if(error){cache.set(store.id,{...prior,attemptedAt,error});db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(randomUUID(),'POS_REFERENCE_REFRESH_FAILED',now());}else cache.set(store.id,{attemptedAt,updatedAt:now(),sourceAt,items});
   audit(user,error?'POS_REFERENCE_FAILED':'POS_REFERENCE_REFRESHED',{storeId:store.id,reason:reason.trim()});return view(store);
  })();pending.set(store.id,task);try{return await task;}finally{pending.delete(store.id);}
 }
 async function handle(ctx){const {p,req,json}=ctx;const m=p.match(/^\/api\/(admin|seller)\/pos\/inventory(\/refresh)?$/);if(!m&&!['/api/admin/pos/status','/api/admin/pos/check'].includes(p))return false;
  if(!m){const user=ctx.requireUser(ctx.session,p.endsWith('/check')?'maintenance:operate':'health:read');if(req.method===(p.endsWith('/check')?'POST':'GET')){if(p.endsWith('/check')){const input=await ctx.body(req);s.fields(input,['reason']);if(!s.text(input.reason,5,200))fail(422,'REASON_REQUIRED','Record a technical check reason.');ctx.rate('pos-check:'+user.id,5,60);if(!enabled)fail(409,'POS_DISABLED','POS integration is not configured.');const r=await request('/api/v1/health');lastCheckAt=now();lastCheck=r.data?.apiVersion==='1'&&r.data?.status==='ok'?'connected':r.error||'INVALID_RESPONSE';audit(user,'POS_CONNECTION_CHECKED',{reason:input.reason.trim()});json(200,{ok:lastCheck==='connected',message:lastCheck==='connected'?'POS authenticated health check passed; inventory remains reference only.':'POS check failed. Check sanitized status and private configuration.',...status()});}else json(200,status());return true;}fail(405,'METHOD_NOT_ALLOWED','Unsupported POS operation.');}
  const user=ctx.requireUser(ctx.session,m[1]==='seller'?'orders:own':'catalog:write'),params=new URL(req.url,config.origin).searchParams;let stores;if(m[1]==='seller'){const own=s.sellerStore(user);if(params.get('storeId')&&params.get('storeId')!==own.id)fail(403,'FORBIDDEN','Only your store is available.');stores=[s.storeView(own)];}else{stores=s.stores(true);if(params.get('storeId')){stores=stores.filter(v=>v.id===params.get('storeId'));if(!stores.length)fail(404,'NOT_FOUND','Store not found.');}}
  if(!m[2]&&req.method==='GET'){json(200,{referenceOnly:true,stores:stores.map(view)});return true;}
  if(m[2]&&req.method==='POST'){const input=await ctx.body(req);s.fields(input,['reason']);if(!s.text(input.reason,5,200))fail(422,'REASON_REQUIRED','Record an inventory reference refresh reason.');if(stores.length!==1)fail(422,'STORE_REQUIRED','Choose one store to refresh.');ctx.rate('pos-refresh:'+user.id,10,60);json(200,{referenceOnly:true,stores:[await refresh(stores[0],user,input.reason)]});return true;}
  fail(405,'METHOD_NOT_ALLOWED','Unsupported POS operation.');
 }
 return {handle,status};
}
module.exports={posInventory};
