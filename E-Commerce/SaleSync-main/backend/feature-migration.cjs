function migrateFeatures(db){
  if(db.prepare('PRAGMA user_version').get().user_version>=4)return;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`
      CREATE TABLE IF NOT EXISTS promotions(id TEXT PRIMARY KEY,code TEXT UNIQUE COLLATE NOCASE,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS promotion_redemptions(order_id TEXT PRIMARY KEY REFERENCES orders(id),promotion_id TEXT NOT NULL REFERENCES promotions(id),user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL CHECK(state IN ('held','used','released')));
      CREATE INDEX IF NOT EXISTS promotion_usage ON promotion_redemptions(promotion_id,user_id,state);
      CREATE TABLE IF NOT EXISTS return_cases(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected','received','refunded')),revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS return_items(return_id TEXT NOT NULL REFERENCES return_cases(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(return_id,product_id));
      CREATE INDEX IF NOT EXISTS returns_order ON return_cases(order_id,status);
      CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),actor_id TEXT REFERENCES users(id),idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),shipping_cents INTEGER NOT NULL DEFAULT 0,restock INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(order_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS refund_items(refund_id TEXT NOT NULL REFERENCES refunds(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>0),amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),PRIMARY KEY(refund_id,product_id));
      CREATE INDEX IF NOT EXISTS refunds_order ON refunds(order_id);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),user_id TEXT NOT NULL REFERENCES users(id),order_id TEXT NOT NULL REFERENCES orders(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),moderation_reason TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(product_id,user_id));
      CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id,status,created_at);
      CREATE TABLE IF NOT EXISTS tracking_subscriptions(shipment_id TEXT PRIMARY KEY REFERENCES shipments(id),provider TEXT NOT NULL CHECK(provider IN ('local-test','aftership')),tracker_id TEXT UNIQUE,slug TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'active',last_event_at INTEGER NOT NULL DEFAULT 0,next_sync_at INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tracking_events(id TEXT PRIMARY KEY,shipment_id TEXT NOT NULL REFERENCES shipments(id),status TEXT NOT NULL,description TEXT NOT NULL,occurred_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tracking_history ON tracking_events(shipment_id,occurred_at);
      CREATE TABLE IF NOT EXISTS email_outbox(id TEXT PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),order_id TEXT NOT NULL REFERENCES orders(id),kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_until INTEGER,last_error TEXT,created_at INTEGER NOT NULL,sent_at INTEGER);
      CREATE INDEX IF NOT EXISTS email_pending ON email_outbox(status,next_at);
    `);
    // Preserve historical full-return records and make their item selection explicit.
    db.exec(`INSERT OR IGNORE INTO return_cases SELECT * FROM return_requests;
      INSERT OR IGNORE INTO return_items SELECT r.id,i.product_id,i.quantity FROM return_requests r JOIN order_items i ON i.order_id=r.order_id;
      PRAGMA user_version=4; COMMIT;`);
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={migrateFeatures};
