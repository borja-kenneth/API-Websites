const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const {migrateCommerce}=require('./commerce-migration.cjs');
const {migrateFeatures}=require('./feature-migration.cjs');
function openDatabase(config) {
  const db = new DatabaseSync(config.dbPath);
  const fresh=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='products'").get().n===0;
  if(db.prepare('PRAGMA user_version').get().user_version>5){db.close();throw Error('Database schema is newer than this application.');}
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_key TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','management','maintenance')), status TEXT NOT NULL CHECK(status IN ('pending','active','suspended')), verified_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges (user_id TEXT PRIMARY KEY REFERENCES users(id), pending_hash TEXT NOT NULL, pending_expires_at INTEGER NOT NULL, nonce TEXT, code_hash TEXT, expires_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, last_sent_at INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'none', last_code_fingerprint TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, total_cents INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (actor_id TEXT PRIMARY KEY REFERENCES users(id), base_version INTEGER NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sandbox_records (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS config_history (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), changes TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, rolled_back INTEGER NOT NULL DEFAULT 0, rollback_of TEXT);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, actor_role TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS system_events (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL, category TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  // Additive migrations preserve existing accounts, orders, and verification records.
  const columns=db.prepare('PRAGMA table_info(challenges)').all().map(c=>c.name);
  if(!columns.includes('pending_expires_at'))db.exec('ALTER TABLE challenges ADD COLUMN pending_expires_at INTEGER NOT NULL DEFAULT 0');
  if(!columns.includes('last_code_fingerprint'))db.exec('ALTER TABLE challenges ADD COLUMN last_code_fingerprint TEXT');
  if (!db.prepare('SELECT id FROM settings WHERE id=1').get()) db.prepare('INSERT INTO settings VALUES (1,1,?)').run(JSON.stringify(config.initialSettings));
  if (fresh && config.catalogDemo) {
    const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'seed-products.json'),'utf8'));
    const insert = db.prepare('INSERT INTO products VALUES (?,?)');
    for (const p of seed) insert.run(p.id, JSON.stringify(p));
  }
  migrateCommerce(db);
  migrateFeatures(db);
  require('./variant-migration.cjs').migrateVariants(db);
  return db;
}
module.exports = { openDatabase };
