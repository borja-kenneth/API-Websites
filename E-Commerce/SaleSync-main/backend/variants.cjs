const {randomUUID}=require('node:crypto');
function variantService({db,s,fail}){
 const relation=id=>db.prepare('SELECT * FROM product_variants WHERE variant_id=?').get(id);
 const groups=id=>JSON.parse(db.prepare('SELECT data FROM variation_groups WHERE product_id=?').get(id)?.data||'[]');
 function describe(row,value){const link=relation(row.id);
  if(link){const parent=s.productRow(link.product_id),p=JSON.parse(parent.data),options=JSON.parse(link.options);return {...value,productId:parent.id,variantId:row.id,active:!!link.active,options,name:p.name+' - '+Object.entries(options).map(([k,v])=>k+': '+v).join(' / '),category:p.category,subcategory:p.subcategory,description:p.description,spec:p.spec,photo:value.photo||p.photo,published:value.published&&!!link.active&&!!p.published&&parent.store_status==='approved'};}
  const dimensions=groups(row.id);if(!dimensions.length)return value;
  const variants=db.prepare('SELECT variant_id FROM product_variants WHERE product_id=? ORDER BY rowid').all(row.id).map(v=>s.productView(s.productRow(v.variant_id)));
  const active=variants.filter(v=>v.published),cheapest=[...(active.some(v=>v.primary>0)?active.filter(v=>v.primary>0):active)].sort((a,b)=>a.price-b.price)[0];
  return {...value,variationGroups:dimensions,variants,unallocatedOnHand:value.onHand,onHand:variants.reduce((n,v)=>n+v.onHand,0),reserved:variants.reduce((n,v)=>n+v.reserved,0),primary:active.reduce((n,v)=>n+v.primary,0),price:cheapest?.price??value.price,was:cheapest?.was??value.was};
 }
 function save(user,id,input){s.fields(input,['revision','groups','variants','reason','allocateUnassigned']);return s.transaction(()=>{
  const parent=s.productRow(id);s.ownedStore(user,parent.store_id);s.revision(input.revision,parent.revision);if(relation(id))fail(422,'VARIANT_PARENT_REQUIRED','Configure variations on the parent product.');
  if(!s.text(input.reason,5,200))fail(422,'REASON_REQUIRED','Give a reason for variation changes.');
  const gs=input.groups;if(!Array.isArray(gs)||gs.length<1||gs.length>2||gs.some(g=>!g||!s.text(g.name,1,40)||!Array.isArray(g.values)||!g.values.length||g.values.length>20||g.values.some(v=>!s.text(v,1,60)||v!==v.trim())||new Set(g.values).size!==g.values.length)||new Set(gs.map(g=>g.name)).size!==gs.length)fail(422,'INVALID_VARIATIONS','Use one or two distinct groups with unique text values.');
  if(!Array.isArray(input.variants)||!input.variants.length||input.variants.length>100)fail(422,'INVALID_VARIATIONS','Supply 1-100 configured combinations.');
  const prior=db.prepare('SELECT * FROM product_variants WHERE product_id=?').all(id),oldGroups=groups(id);
  if(prior.length&&(gs.length!==oldGroups.length||oldGroups.some((g,i)=>gs[i].name!==g.name||g.values.some(v=>!gs[i].values.includes(v)))))fail(409,'VARIATION_GROUPS_FIXED','Keep existing group names and values; extend values or deactivate combinations instead.');
  if(!prior.length&&s.reserved(id))fail(409,'RESERVED_STOCK','Wait for existing reservations before allocating variations.');
  const data=JSON.parse(parent.data),seen=new Set(),ids=new Set();
  for(const v of input.variants){s.fields(v,['id','revision','options','sku','price','was','primary','photo','active']);if(!v.options||typeof v.options!=='object'||Array.isArray(v.options)||Object.keys(v.options).length!==gs.length||gs.some(g=>!g.values.includes(v.options[g.name]))||typeof v.active!=='boolean')fail(422,'INVALID_VARIATIONS','Choose valid group values and activation state.');
   v.options=Object.fromEntries(gs.map(g=>[g.name,v.options[g.name]]));const key=JSON.stringify(v.options);if(seen.has(key))fail(422,'DUPLICATE_COMBINATION','Each combination must be unique.');seen.add(key);
   const old=v.id&&prior.find(p=>p.variant_id===v.id);if(old)s.revision(v.revision,s.productRow(v.id).revision);if(v.id&&!old)fail(403,'FORBIDDEN','Variation does not belong to this product.');if(old&&old.options!==key)fail(409,'VARIATION_OPTIONS_FIXED','A saved combination cannot change identity.');if(v.id&&ids.has(v.id))fail(422,'DUPLICATE_COMBINATION','Duplicate variant identifier.');ids.add(v.id);
   if(old&&s.reserved(v.id)&&!v.active)fail(409,'RESERVED_STOCK','Cannot deactivate a reserved combination.');
  }
  if(prior.some(p=>!ids.has(p.variant_id)))fail(422,'VARIATION_HISTORY','Retain existing combinations and deactivate them instead of deleting.');
  const allocation=!prior.length||input.allocateUnassigned===true,oldTotal=prior.reduce((n,p)=>n+JSON.parse(s.productRow(p.variant_id).data).primary,0),newTotal=input.variants.reduce((n,v)=>n+v.primary,0);
  if(allocation&&newTotal-oldTotal!==data.primary)fail(422,'STOCK_ALLOCATION','Variation stock increases must exactly allocate the unassigned parent stock. Adjust parent stock first when creating variations.');
  if(allocation&&data.primary){data.primary=0;db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(data),id);s.move(id,user,'variant_allocation',- (newTotal-oldTotal),0,input.reason);}
  db.prepare('INSERT INTO variation_groups VALUES (?,?) ON CONFLICT(product_id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(gs));
  for(const v of input.variants){const old=v.id&&s.productRow(v.id),created=s.saveProduct(user,v.id||null,{...(old?{revision:old.revision}:{storeId:parent.store_id}),name:data.name,description:data.description,category:data.category,sku:v.sku,price:v.price,was:v.was??v.price,primary:v.primary,published:v.active,photo:v.photo||data.photo,spec:data.spec,reason:input.reason},true);
   db.prepare('INSERT INTO product_variants VALUES (?,?,?,?) ON CONFLICT(variant_id) DO UPDATE SET active=excluded.active').run(created.id,id,JSON.stringify(v.options),v.active?1:0);
  }
  db.prepare('UPDATE product_meta SET revision=revision+1 WHERE product_id=?').run(id);return s.productView(s.productRow(id));
 });}
 return {relation,groups,describe,save};
}
module.exports={variantService};
