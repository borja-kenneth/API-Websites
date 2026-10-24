function featureRoutes({s,f,courier,mail,db,config,settings,now,audit,fail}){
  const customer=ctx=>ctx.requireUser(ctx.session,'orders:own');
  const manager=ctx=>ctx.requireUser(ctx.session,'catalog:write');
  async function handle(ctx){
    const {req,p,json,body}=ctx,params=new URL(req.url,config.origin).searchParams;
    const send=(status,value)=>{json(status,value);return true;};
    const variation=p.match(/^\/api\/(admin|seller)\/catalog\/([^/]+)\/variations$/);
    if(variation){const user=variation[1]==='admin'?manager(ctx):customer(ctx),row=s.productRow(variation[2]);s.ownedStore(user,row.store_id);if(req.method==='GET')return send(200,{product:s.productView(row)});if(req.method==='PUT')return send(200,{product:s.variants.save(user,row.id,await body(req))});}
    if(req.method==='GET'&&p==='/api/products')return send(200,f.productPage(params));
    if(req.method==='GET'&&p==='/api/products/lookup'){
      const ids=[...new Set((params.get('ids')||'').split(',').filter(Boolean))];if(ids.length>200||ids.some(id=>id.length>100))fail(422,'INVALID_IDS','Look up at most 200 product IDs per request.');
      const products=ids.length?db.prepare("SELECT p.*,m.store_id,m.sku,m.revision,s.name AS store_name,s.status AS store_status FROM products p JOIN product_meta m ON m.product_id=p.id JOIN stores s ON s.id=m.store_id WHERE "+s.publicStoreSql()+" AND json_extract(p.data,'$.published')=1 AND p.id IN ("+ids.map(()=>'?').join(',')+')').all(...ids).map(s.productView).filter(p=>p.published).map(s.publicProduct):[];return send(200,{products});
    }
    const product=p.match(/^\/api\/products\/([^/]+)$/);
    if(product&&req.method==='GET'){const row=s.productRow(product[1]),value=s.productView(row);if(!value.published||!s.storeIsPublic(value.storeId))fail(404,'NOT_FOUND','Product not found.');return send(200,{product:s.publicProduct(value)});}
    const reviews=p.match(/^\/api\/products\/([^/]+)\/reviews$/);
    if(reviews){
      const id=reviews[1];if(req.method==='GET'){const value=s.productView(s.productRow(id));if(!value.published||!s.storeIsPublic(value.storeId))fail(404,'NOT_FOUND','Product not found.');const result=f.paginateSql("SELECT * FROM reviews WHERE product_id=? AND status='visible' ORDER BY created_at DESC,id","SELECT COUNT(*) n FROM reviews WHERE product_id=? AND status='visible'",[id],params,row=>f.reviewView(row));const own=ctx.session&&db.prepare('SELECT * FROM reviews WHERE user_id=? AND product_id=?').get(ctx.session.user.id,id);return send(200,{reviews:result.items,pagination:result.pagination,rating:f.ratingSummary(id),ownReview:own?f.reviewView(own,true):null});}
      if(req.method==='PUT'){const user=customer(ctx);ctx.rate('review:'+user.id,20,3600);return send(200,{review:f.saveReview(user,id,await body(req))});}
    }
    if(p==='/api/admin/reviews'&&req.method==='GET'){manager(ctx);const result=f.paginateSql('SELECT * FROM reviews ORDER BY created_at DESC,id','SELECT COUNT(*) n FROM reviews',[],params,row=>f.reviewView(row,true));return send(200,{reviews:result.items,pagination:result.pagination});}
    if(/^\/api\/admin\/reviews\/[^/]+$/.test(p)&&req.method==='PATCH'){
      const user=manager(ctx),input=await body(req);s.fields(input,['revision','status','reason']);if(!['visible','hidden'].includes(input.status)||!s.text(input.reason,5,200))fail(422,'INVALID_MODERATION','Choose a visibility and provide a moderation reason.');
      const review=s.transaction(()=>{const row=db.prepare('SELECT * FROM reviews WHERE id=?').get(p.split('/').at(-1));if(!row)fail(404,'NOT_FOUND','Review not found.');s.revision(input.revision,row.revision);db.prepare('UPDATE reviews SET status=?,moderation_reason=?,revision=revision+1,updated_at=? WHERE id=?').run(input.status,input.reason.trim(),now(),row.id);audit(user,'REVIEW_MODERATED',{reviewId:row.id,status:input.status,reason:input.reason});return f.reviewView(db.prepare('SELECT * FROM reviews WHERE id=?').get(row.id),true);});return send(200,{review});
    }
    if(p==='/api/admin/promotions'){
      const user=manager(ctx);if(req.method==='GET'){const result=f.paginateSql('SELECT * FROM promotions ORDER BY created_at DESC,id','SELECT COUNT(*) n FROM promotions',[],params,f.promotionView);return send(200,{promotions:result.items,pagination:result.pagination});}if(req.method==='POST')return send(201,{promotion:f.savePromotion(user,null,await body(req))});
    }
    if(/^\/api\/admin\/promotions\/[^/]+$/.test(p)&&req.method==='PATCH')return send(200,{promotion:f.savePromotion(manager(ctx),p.split('/').at(-1),await body(req))});
    if(p==='/api/orders/quote'&&req.method==='POST'){const user=customer(ctx),input=await body(req);s.fields(input,['items','delivery','voucherCode']);s.expire();return send(200,{quote:s.quote(input.items,input.delivery,settings.current().data,{user,code:input.voucherCode})});}
    if(p==='/api/orders'&&req.method==='GET'){const user=ctx.requireUser(ctx.session);if(user.role==='maintenance')fail(403,'FORBIDDEN','Maintenance cannot read customer orders.');return send(200,f.orderPage(user,params));}
    if(p==='/api/seller/orders'&&req.method==='GET')return send(200,f.orderPage(customer(ctx),params,true));
    if((p==='/api/admin/catalog'||p==='/api/seller/catalog')&&req.method==='GET'){const user=p.startsWith('/api/admin/')?manager(ctx):customer(ctx),store=user.role==='customer'?s.sellerStore(user):null;return send(200,{...f.productPage(params,{all:true,storeId:store?.id}),stores:store?[s.storeView(store)]:s.stores()});}
    if(p==='/api/admin/returns'&&req.method==='GET'){manager(ctx);const result=f.paginateSql('SELECT * FROM return_cases ORDER BY created_at DESC,id','SELECT COUNT(*) n FROM return_cases',[],params,f.returnView);return send(200,{returns:result.items,pagination:result.pagination});}
    const tracking=p.match(/^\/api\/(admin|seller)\/shipments\/([^/]+)\/tracking(?:\/(sync|simulate))?$/);
    if(tracking){
      const user=tracking[1]==='admin'?manager(ctx):customer(ctx),id=tracking[2],sh=courier.shipment(id);s.ownedStore(user,sh.store_id);
      if(req.method==='GET'&&!tracking[3])return send(200,{tracking:courier.view(id)});
      if(req.method==='POST'){
        ctx.rate('tracking:'+user.id,30,60);const input=await body(req);
        if(!tracking[3])return send(200,{tracking:await courier.register(user,id,input)});
        if(tracking[3]==='sync'){s.fields(input,[]);return send(200,await courier.sync(id));}
        if(config.production||config.courierMode!=='local-test')fail(404,'NOT_FOUND','Local tracking simulation is disabled.');s.fields(input,['tag']);if(!['OutForDelivery','Delivered','Exception'].includes(input.tag))fail(422,'INVALID_TRACKING_EVENT','Choose OutForDelivery, Delivered or Exception.');return send(200,courier.applyEvent(id,{eventId:'simulation:'+id+':'+input.tag,tag:input.tag,occurredAt:now(),description:'Local courier simulation: '+input.tag}));
      }
    }
    if(p==='/api/admin/email-outbox'&&req.method==='GET'){manager(ctx);const result=f.paginateSql('SELECT id,order_id AS orderId,kind,status,attempts,next_at AS nextAt,last_error AS lastError,sent_at AS sentAt FROM email_outbox ORDER BY created_at DESC,id','SELECT COUNT(*) n FROM email_outbox',[],params,row=>row);return send(200,{messages:result.items,pagination:result.pagination,configured:!!mail.configured});}
    if(/^\/api\/admin\/email-outbox\/[^/]+\/retry$/.test(p)&&req.method==='POST'){const user=manager(ctx);s.fields(await body(req),[]);const id=p.split('/')[4],updated=db.prepare("UPDATE email_outbox SET status='pending',attempts=0,next_at=?,last_error=NULL WHERE id=? AND status='failed'").run(now(),id);if(!updated.changes)fail(409,'RETRY_UNAVAILABLE','Only failed messages can be retried.');audit(user,'ORDER_EMAIL_RETRY',{messageId:id});return send(200,{message:'Message queued for another delivery attempt.'});}
    return false;
  }
  return {handle};
}
module.exports={featureRoutes};
