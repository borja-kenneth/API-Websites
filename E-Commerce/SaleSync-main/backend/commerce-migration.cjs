const {randomUUID}=require('node:crypto');
function migrateCommerce(db){
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>5)throw Error('Database schema is newer than this application.');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`
      CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,owner_id TEXT UNIQUE REFERENCES users(id),name TEXT UNIQUE NOT NULL COLLATE NOCASE,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','suspended')),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS product_meta(product_id TEXT PRIMARY KEY REFERENCES products(id),store_id TEXT NOT NULL REFERENCES stores(id),sku TEXT NOT NULL UNIQUE COLLATE NOCASE,revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS order_meta(order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,expires_at INTEGER,payment_mode TEXT NOT NULL,UNIQUE(user_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),store_id TEXT NOT NULL REFERENCES stores(id),quantity INTEGER NOT NULL CHECK(quantity>0),unit_cents INTEGER NOT NULL CHECK(unit_cents>0),data TEXT NOT NULL,UNIQUE(order_id,product_id));
      CREATE TABLE IF NOT EXISTS reservations(order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>0),state TEXT NOT NULL CHECK(state IN ('active','committed','released')),expires_at INTEGER NOT NULL,PRIMARY KEY(order_id,product_id));
      CREATE TABLE IF NOT EXISTS inventory_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),order_id TEXT REFERENCES orders(id),actor_id TEXT REFERENCES users(id),kind TEXT NOT NULL,delta INTEGER NOT NULL,reserved_delta INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS order_history(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL REFERENCES orders(id),actor_id TEXT REFERENCES users(id),status TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payment_attempts(id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),mode TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','expired','cancelled','refunded')),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),currency TEXT NOT NULL CHECK(currency='PHP'),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payment_attempts(id),outcome TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shipments(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),store_id TEXT NOT NULL REFERENCES stores(id),status TEXT NOT NULL,courier TEXT NOT NULL DEFAULT '',tracking TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL,UNIQUE(order_id,store_id));
      CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),phone TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS addresses(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1);
      CREATE UNIQUE INDEX IF NOT EXISTS one_default_address ON addresses(user_id) WHERE is_default=1;
      CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shopping(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,order_id TEXT REFERENCES orders(id),read_at INTEGER,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS return_requests(id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected','received','refunded')),revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS support_tickets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS support_messages(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES support_tickets(id),actor_id TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reservation_stock ON reservations(product_id,state,expires_at);
      CREATE INDEX IF NOT EXISTS order_customer_date ON orders(user_id,created_at);
      CREATE INDEX IF NOT EXISTS shipment_store ON shipments(store_id,updated_at);
      CREATE INDEX IF NOT EXISTS notification_user ON notifications(user_id,created_at);
      CREATE INDEX IF NOT EXISTS inventory_product ON inventory_movements(product_id,created_at);
      CREATE INDEX IF NOT EXISTS reset_user ON password_resets(user_id);
    `);
    const products=db.prepare('SELECT id,data FROM products').all();
    for(const row of products){
      if(db.prepare('SELECT product_id FROM product_meta WHERE product_id=?').get(row.id))continue;
      const product=JSON.parse(row.data),name=product.seller||'SaleSync';
      let store=db.prepare('SELECT * FROM stores WHERE name=? COLLATE NOCASE').get(name);
      if(!store){const id=randomUUID(),brands={'TechHub PH':{description:'Everyday tech, desk essentials, and devices selected for modern routines.',tagline:'Make every day smarter.',headline:'Find your next everyday upgrade.',accent:'#2265d2',specialty:'Tech & gadgets'},StyleHub:{description:'Wearable favorites and thoughtfully picked pieces for your home and routines.',tagline:'Good style. Real life.',headline:'A little more you, every day.',accent:'#bc5979',specialty:'Style & living'}},data=brands[name]||{description:'Discover products from '+name,tagline:'Selected for your everyday.',headline:'Explore '+name,accent:'#245ec4'};db.prepare("INSERT INTO stores(id,name,status,data,created_at) VALUES (?,?,'approved',?,?)").run(id,name,JSON.stringify(data),Date.now());store={id};}
      db.prepare('INSERT INTO product_meta(product_id,store_id,sku) VALUES (?,?,?)').run(row.id,store.id,product.sku||'SKU-'+row.id);
      db.prepare('INSERT INTO inventory_movements VALUES (?,?,NULL,NULL,?, ?,0,?,?)').run(randomUUID(),row.id,'opening',product.primary||0,'Opening balance from existing catalog',Date.now());
    }
    if(version<3)db.exec('PRAGMA user_version=3');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={migrateCommerce};
