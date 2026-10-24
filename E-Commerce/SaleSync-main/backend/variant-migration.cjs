function migrateVariants(db){
 if(db.prepare('PRAGMA user_version').get().user_version>=5)return;
 try{db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS variation_groups(product_id TEXT PRIMARY KEY REFERENCES products(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS product_variants(variant_id TEXT PRIMARY KEY REFERENCES products(id),product_id TEXT NOT NULL REFERENCES products(id),options TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),CHECK(variant_id<>product_id),UNIQUE(product_id,options));
 CREATE INDEX IF NOT EXISTS variant_parent ON product_variants(product_id,active);
 PRAGMA user_version=5; COMMIT;`);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
module.exports={migrateVariants};
