// Opt-in local developer operation. No registration, verification, credentials or external calls.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { gmailAddress } = require('../backend/security.cjs');
const { hasPermission } = require('../backend/permissions.cjs');
const fixtures = require('../backend/local-fixtures.cjs');
const { commerceService } = require('../backend/commerce.cjs');
const { backupDatabase, verifyDatabase } = require('./backup-database.cjs');
const ROOT = path.resolve(__dirname, '..');
const PACK = 'salesync-seller-catalog-v1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const money = value => Number.isFinite(value) && value > 0 && value <= 10000000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;

function validateManifest(manifest) {
  if (manifest.manifestVersion !== '1.0' || manifest.stores?.length !== 2 || manifest.products?.length !== 12) throw Error('Expected the supplied version-1 pack with two stores and twelve listings.');
  const keys = new Set(), skus = new Set();
  for (const store of manifest.stores) {
    if (!text(store.seedKey, 60) || keys.has(store.seedKey) || !text(store.name, 60) || !/demo/i.test(store.name) || store.demoOnly !== true || !text(store.description, 1000) || !text(store.tagline, 140) || !text(store.headline, 140)) throw Error('Invalid or unlabeled demonstration store.');
    keys.add(store.seedKey);
  }
  const products = new Set();
  for (const p of manifest.products) {
    if (!text(p.seedKey, 60) || products.has(p.seedKey) || !keys.has(p.storeSeedKey) || p.demoOnly !== true || !text(p.name, 120) || !text(p.description, 1800) || !/demo|fictional/i.test(p.description) || !text(p.category, 60) || !money(p.pricePHP) || !money(p.compareAtPHP) || p.compareAtPHP < p.pricePHP || p.published !== true || p.variantMode !== 'variant-level-stock') throw Error('Invalid demonstration product, ownership or pricing.');
    products.add(p.seedKey);
    const photo = p.existingLocalFallback;
    if (!/^assets\/products\/p(?:[1-9]|1[0-2])\.svg$/.test(photo) || !fs.existsSync(path.join(ROOT, 'SaleSync_Online_Alive_v5', photo))) throw Error('A matching authorized local product illustration is required.');
    if (!Array.isArray(p.variants) || !p.variants.length || p.variants.length > 100 || !Number.isSafeInteger(p.totalStockOnHand) || p.totalStockOnHand < 0 || p.totalStockOnHand > 1000000 || p.variants.reduce((n, v) => n + v.stockOnHand, 0) !== p.totalStockOnHand) throw Error('Variant quantities must exactly equal the parent allocation.');
    const dimensions = Object.keys(p.variants[0].optionValues || {}), combinations = new Set();
    if (!dimensions.length || dimensions.length > 2 || dimensions.some(key => !text(key, 40))) throw Error('Use one or two configured variation dimensions.');
    for (const v of p.variants) {
      if (!v.optionValues || Object.keys(v.optionValues).length !== dimensions.length || dimensions.some(key => !text(v.optionValues[key], 60)) || !Number.isSafeInteger(v.stockOnHand) || v.stockOnHand < 0 || v.stockOnHand > 1000000) throw Error('Invalid variant combination or quantity.');
      const combination = JSON.stringify(dimensions.map(key => v.optionValues[key]));
      if (combinations.has(combination)) throw Error('Duplicate variation combination.');
      combinations.add(combination);
    }
    for (const sku of [p.baseSku, ...p.variants.map(v => v.sku)]) {
      if (!text(sku, 64) || skus.has(sku.toLowerCase())) throw Error('Every parent and variant SKU must be unique.');
      skus.add(sku.toLowerCase());
    }
    if (!p.specifications || Array.isArray(p.specifications) || Object.keys(p.specifications).length > 19 || Object.entries(p.specifications).some(([k, v]) => !text(k, 50) || !text(v, 200))) throw Error('Invalid product specifications.');
  }
  if (manifest.products.reduce((n, p) => n + p.variants.length, 0) !== 26) throw Error('Expected twenty-six variant SKUs from the supplied pack.');
  return manifest;
}

function buildPlan(db, manifest, owners = {}, fixtureConfig) {
  const fixtureMode = !!fixtureConfig && fixtures.validateFixtureMode(fixtureConfig);
  validateManifest(manifest);
  if (db.prepare('PRAGMA user_version').get().user_version !== 5) throw Error('This importer requires an existing schema-5 database; it does not initialize or migrate databases.');
  const blockers = [], stores = [], products = [], ownerKeys = new Set();
  const managers = db.prepare("SELECT id,role,status,verified_at FROM users WHERE role='management' AND status='active' AND verified_at IS NOT NULL").all();
  const manager = owners.managerId ? managers.find(m => m.id === owners.managerId) : managers.length === 1 ? managers[0] : null;
  if (!manager || !hasPermission(manager.role, 'catalog:write')) blockers.push('Select an existing active, verified Management account using managerId in the private owners file.');
  function marked(action, key, id) {
    return !!db.prepare("SELECT 1 FROM audit WHERE action=? AND json_extract(details,'$.pack')=? AND json_extract(details,'$.seedKey')=? AND json_extract(details,'$.recordId')=?").get(action, PACK, key, id);
  }
  for (const store of manifest.stores) {
    const address = gmailAddress(owners.sellers?.[store.seedKey]) || (fixtureMode && fixtures.fixtureAddress(owners.sellers?.[store.seedKey]));
    if (!address) blockers.push(store.seedKey + ': provide a dedicated Gmail customer account in the private owners file.');
    if (address && ownerKeys.has(address.key)) blockers.push('Seller addresses resolve to the same Gmail identity; use distinct base mailboxes, not dots or plus-tags.');
    if (address) ownerKeys.add(address.key);
    const owner = address && db.prepare('SELECT id,role,status,verified_at FROM users WHERE email_key=?').get(address.key);
    if (address && (!owner || owner.role !== 'customer' || owner.status !== 'active' || !owner.verified_at)) blockers.push(store.seedKey + ': register and verify the selected customer through normal authentication first.');
    if (owner && db.prepare("SELECT 1 FROM audit WHERE actor_id=? AND action='LOCAL_DEMO_ACCOUNT_CREATED'").get(owner.id)) blockers.push(store.seedKey + ': isolated-demo accounts cannot be used in the regular catalog.');
    if (owner && db.prepare('SELECT 1 FROM audit WHERE actor_id=? AND action=?').get(owner.id, fixtures.ACTION) && !fixtureMode) blockers.push(store.seedKey + ': local synthetic fixtures are prohibited in the regular importer.');
    if (address && fixtures.fixtureAddress(address.email) && owner && !db.prepare('SELECT 1 FROM audit WHERE actor_id=? AND action=?').get(owner.id, fixtures.ACTION)) blockers.push(store.seedKey + ': synthetic owner lacks a local provisioning audit.');
    const row = db.prepare('SELECT * FROM stores WHERE name=? COLLATE NOCASE').get(store.name);
    if (row && (!owner || row.owner_id !== owner.id || !marked('CATALOG_PACK_STORE_IMPORTED', store.seedKey, row.id))) blockers.push(store.seedKey + ': store name is occupied by an unrelated record; it will not be adopted or overwritten.');
    if (row && row.status !== 'approved') blockers.push(store.seedKey + ': existing imported store is not approved; review it in Management, not through this importer.');
    if (owner && db.prepare('SELECT id FROM stores WHERE owner_id=? AND id<>?').get(owner.id, row?.id || '')) blockers.push(store.seedKey + ': account already owns another store; no ownership will be changed.');
    stores.push({ seedKey: store.seedKey, name: store.name, description: store.description, tagline: store.tagline, headline: store.headline, ownerId: owner?.id || null, ownerStatus: owner?.status || null, verified: !!owner?.verified_at, id: row?.id || null, action: row ? 'skip' : 'create' });
  }
  for (const p of manifest.products) {
    const row = db.prepare('SELECT product_id,store_id FROM product_meta WHERE sku=? COLLATE NOCASE').get(p.baseSku);
    const store = stores.find(s => s.seedKey === p.storeSeedKey);
    if (row && (row.store_id !== store.id || !marked('CATALOG_PACK_PRODUCT_IMPORTED', p.seedKey, row.product_id))) blockers.push(p.baseSku + ': SKU is occupied by an unrelated product; it will not be overwritten.');
    for (const v of p.variants) {
      const existing = db.prepare('SELECT m.product_id,v.product_id AS parent_id FROM product_meta m LEFT JOIN product_variants v ON v.variant_id=m.product_id WHERE m.sku=? COLLATE NOCASE').get(v.sku);
      if (existing && (!row || existing.parent_id !== row.product_id)) blockers.push(v.sku + ': variant SKU collision; existing inventory will not be changed.');
      if (row && !existing) blockers.push(p.baseSku + ': existing listing has changed variant identities; manual review is required.');
    }
    products.push({ seedKey: p.seedKey, storeSeedKey: p.storeSeedKey, name: p.name, sku: p.baseSku, id: row?.product_id || null, action: row ? 'skip' : 'create', pricePHP: p.pricePHP, compareAtPHP: p.compareAtPHP, description: p.description + ' Image is a SaleSync illustration; finishes are illustrative, not product photographs.', specifications: { ...p.specifications, Image: 'Illustration for demonstration only' }, category: p.category, units: p.totalStockOnHand, variants: p.variants.map(v => ({ sku: v.sku, quantity: v.stockOnHand, options: v.optionValues })), photo: p.existingLocalFallback });
  }
  const summary = { createStores: stores.filter(s => s.action === 'create').length, skipStores: stores.filter(s => s.action === 'skip').length, createProducts: products.filter(p => p.action === 'create').length, skipProducts: products.filter(p => p.action === 'skip').length, createVariants: products.filter(p => p.action === 'create').reduce((n, p) => n + p.variants.length, 0), allocateUnits: products.filter(p => p.action === 'create').reduce((n, p) => n + p.units, 0), createAccounts: 0 };
  const plan = { pack: PACK, manifestHash: hash(manifest), managerId: manager?.id || null, stores, products, summary, blockers, preservesExistingInventory: true };
  return { ...plan, approval: hash(plan) };
}

function services(db) {
  const audit = (user, action, details = {}) => db.prepare('INSERT INTO audit(actor_id,actor_role,action,details,created_at) VALUES (?,?,?,?,?)').run(user?.id || null, user?.role || 'anonymous', action, JSON.stringify(details), Date.now());
  const fail = (status, code, message) => { throw Object.assign(Error(message), { status, code }); };
  const settings = { current: () => ({ data: JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data) }) };
  return { audit, s: commerceService({ db, config: { catalogDemo: false }, settings, now: Date.now, audit, fail }) };
}

async function applyImport({ dbPath, manifest, owners, approval, backupDir = path.join(path.dirname(dbPath), 'backups'), fixtureConfig }) {
  if (fixtureConfig && path.resolve(dbPath) !== fixtureConfig.dbPath) throw Error('Fixture capability cannot target a different database.');
  // A separate readonly preflight is completed before any write-capable connection opens.
  let reader = new DatabaseSync(dbPath, { readOnly: true }), reviewed;
  try { reviewed = buildPlan(reader, manifest, owners, fixtureConfig); } finally { reader.close(); }
  if (reviewed.blockers.length) throw Error('Import blocked: ' + reviewed.blockers.join(' '));
  if (!approval || approval !== reviewed.approval) throw Error('Explicit confirmation must match the latest dry-run approval digest.');
  if (!reviewed.summary.createStores && !reviewed.summary.createProducts) return { ...reviewed.summary, backup: null, message: 'All matching records already exist. No writes or stock resets performed.' };
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.lstatSync(backupDir).isSymbolicLink() || fs.realpathSync(backupDir) !== path.resolve(backupDir)) throw Error('Use a real local backup directory, not a symlink.');
  const backup = path.join(backupDir, 'backup-' + randomUUID() + '.sqlite');
  await backupDatabase(dbPath, backup);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    const { s, audit } = services(db);
    s.transaction(() => {
      const current = buildPlan(db, manifest, owners, fixtureConfig);
      if (current.approval !== approval || current.blockers.length) throw Error('Catalog or account state changed after review; run a new dry-run.');
      const manager = db.prepare('SELECT * FROM users WHERE id=?').get(current.managerId);
      for (const store of current.stores.filter(s => s.action === 'create')) {
        const input = manifest.stores.find(s => s.seedKey === store.seedKey), owner = db.prepare('SELECT * FROM users WHERE id=?').get(store.ownerId);
        const pending = s.applyStore(owner, { name: input.name, description: input.description, tagline: input.tagline });
        const approved = s.updateStore(manager, pending.id, { revision: pending.revision, status: 'approved', headline: input.headline, reason: fixtureConfig ? 'Local-only fixture approval; no real-world merchant review performed.' : 'Explicitly approved developer import of labeled demonstration store.' });
        store.id = approved.id;
        audit(manager, 'CATALOG_PACK_STORE_IMPORTED', { pack: PACK, seedKey: store.seedKey, recordId: store.id, ownerId: owner.id });
      }
      for (const p of current.products.filter(p => p.action === 'create')) {
        const input = manifest.products.find(x => x.seedKey === p.seedKey), store = current.stores.find(s => s.seedKey === p.storeSeedKey), owner = db.prepare('SELECT * FROM users WHERE id=?').get(store.ownerId);
        const product = s.saveProduct(owner, null, { name: input.name, description: input.description + ' Image is a SaleSync illustration; finishes are illustrative, not product photographs.', category: input.category, sku: input.baseSku, price: input.pricePHP, was: input.compareAtPHP, primary: input.totalStockOnHand, published: true, photo: input.existingLocalFallback, spec: { ...input.specifications, Image: 'Illustration for demonstration only' } });
        const dimensions = Object.keys(input.variants[0].optionValues);
        s.variants.save(owner, product.id, { revision: product.revision, reason: 'Allocate exact catalog-pack quantities to variant SKUs; no duplicate parent stock.', groups: dimensions.map(name => ({ name, values: [...new Set(input.variants.map(v => v.optionValues[name]))] })), variants: input.variants.map(v => ({ options: v.optionValues, sku: v.sku, price: input.pricePHP, was: input.compareAtPHP, primary: v.stockOnHand, active: true, photo: input.existingLocalFallback })) });
        audit(manager, 'CATALOG_PACK_PRODUCT_IMPORTED', { pack: PACK, seedKey: input.seedKey, recordId: product.id, storeId: store.id });
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Foreign-key validation failed; import rolled back.');
      audit(manager, 'CATALOG_PACK_IMPORTED', { pack: PACK, manifestHash: current.manifestHash, approval, ...current.summary });
    });
    if (!verifyDatabase(dbPath).ok) throw Error('Post-import integrity check failed; preserve the verified backup for investigation.');
    return { ...reviewed.summary, backup, message: 'Import committed through seller application, Management approval, product and variant inventory services.' };
  } finally { db.close(); }
}

async function main(args = process.argv.slice(2)) {
  const options = {};
  for (const arg of args) {
    const match = arg.match(/^--(target|owners|confirm)=(.+)$/);
    if (match) { if (options[match[1]]) throw Error('Duplicate importer option.'); options[match[1]] = match[2]; }
    else if (['--apply', '--dry-run'].includes(arg)) options[arg.slice(2)] = true;
    else throw Error('Use --target=regular --dry-run --owners=PRIVATE.json, or --apply --confirm=DRY_RUN_DIGEST.');
  }
  if (options.target !== 'regular' || options.apply && options['dry-run']) throw Error('Explicit --target=regular is required; choose either dry-run or apply.');
  const env = { ...(fs.existsSync(path.join(ROOT, '.env')) ? parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')) : {}), ...process.env };
  if (env.NODE_ENV === 'production' || env.CATALOG_DEMO === 'true') throw Error('This importer is developer-only and cannot run in production or demo mode.');
  const dbPath = path.resolve(ROOT, env.DATABASE_PATH || 'data/salesync.sqlite');
  if (dbPath !== path.join(ROOT, 'data/salesync.sqlite') || !fs.existsSync(dbPath) || fs.realpathSync(dbPath) !== dbPath || fs.lstatSync(dbPath).isSymbolicLink()) throw Error('Target must be the existing regular data/salesync.sqlite; presentation/demo databases cannot be imported.');
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/seller-catalog-pack.json'), 'utf8')));
  let owners = {};
  if (options.owners) {
    try { owners = JSON.parse(fs.readFileSync(path.resolve(options.owners), 'utf8')); }
    catch { throw Error('Unable to read the private owners JSON. File contents were not logged.'); }
    if (!owners || Array.isArray(owners) || Object.keys(owners).some(key => !['managerId', 'sellers'].includes(key))) throw Error('Private owners JSON accepts only managerId and sellers; never include passwords or verification codes.');
  }
  if (options.apply) {
    console.log(JSON.stringify(await applyImport({ dbPath, manifest, owners, approval: options.confirm }), null, 2));
  } else {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try { console.log(JSON.stringify({ database: dbPath, mode: 'read-only dry-run', ...buildPlan(db, manifest, owners) }, null, 2)); } finally { db.close(); }
  }
}
if (require.main === module) main().catch(error => { console.error(error.code && !error.status ? 'Catalog import failed safely: ' + error.code : error.message); process.exitCode = 1; });
module.exports = { validateManifest, buildPlan, applyImport };
