// Explicit local fixture. Never loaded by the regular application or its migrations.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { hashPassword, gmailAddress } = require('../backend/security.cjs');
const { backupDatabase } = require('./backup-database.cjs');
const MARKER = 'salesync-isolated-presentation-v1';

function preparePresentationDirectory(directory) {
  directory = path.resolve(directory);
  const data = path.resolve(__dirname, '../data');
  if ([data, path.join(data, 'demo')].includes(directory)) throw Error('Presentation data must remain separate from regular and demo databases.');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) throw Error('Use a real, isolated presentation directory.');
  const marker = path.join(directory, 'presentation.json');
  if (fs.existsSync(marker)) {
    if (JSON.parse(fs.readFileSync(marker, 'utf8')).kind !== MARKER) throw Error('Unrecognized presentation directory; existing data was left unchanged.');
  } else {
    if (fs.existsSync(path.join(directory, 'salesync.sqlite'))) throw Error('An existing database without a presentation marker was left unchanged.');
    fs.writeFileSync(marker, JSON.stringify({ kind: MARKER }), { flag: 'wx', mode: 0o600 });
  }
}

async function seedPresentation(app, directory, config) {
  const file = path.join(directory, 'accounts.json');
  if (app.db.prepare('SELECT COUNT(*) n FROM users').get().n) {
    if (!fs.existsSync(file)) throw Error('Presentation account file is missing; existing records were left unchanged.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  // Snapshot the initialized WAL database before adding the explicitly requested fixture.
  await backupDatabase(config.dbPath, path.join(directory, 'before-fixture-' + randomUUID() + '.sqlite'));
  const accounts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : ['customer', 'seller', 'seller-two', 'management', 'maintenance'].map(label => ({
    id: randomUUID(), label, name: 'Presentation ' + label,
    email: `salesync.presentation.${label.replaceAll('-', '')}@gmail.com`,
    role: label.startsWith('seller') ? 'customer' : label, password: randomBytes(18).toString('base64url')
  }));
  const hashes = await Promise.all(accounts.map(a => hashPassword(a.password)));
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(accounts, null, 2), { flag: 'wx', mode: 0o600 });
  app.commerce.transaction(() => {
    accounts.forEach((a, i) => {
      app.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,'active',?,?)").run(a.id, a.name, a.email, gmailAddress(a.email).key, hashes[i], a.role, Date.now(), Date.now());
      app.audit({ id: a.id, role: a.role }, 'LOCAL_DEMO_ACCOUNT_CREATED', { method: MARKER });
      if (['management', 'maintenance'].includes(a.role)) app.audit({ id: a.id, role: a.role }, 'ADMIN_PROVISIONED', { role: a.role, method: 'isolated presentation fixture' });
    });
    const manager = accounts.find(a => a.label === 'management');
    for (const [index, label] of ['seller', 'seller-two'].entries()) {
      const seller = accounts.find(a => a.label === label);
      const store = app.commerce.applyStore(seller, {
        name: index ? 'Sample Accessories - Presentation Only' : 'Sample Electronics - Presentation Only',
        description: 'Demonstration store with illustrative products and sample prices. Not a genuine merchant. No real goods or money are involved.',
        tagline: 'Presentation samples only'
      });
      app.commerce.updateStore(manager, store.id, { revision: store.revision, status: 'approved', reason: 'Approved labeled isolated presentation fixture.' });
      const items = index ? [
        { name: 'Sample Watch', sku: 'PRESENT-WATCH', category: 'Accessories', price: 750, primary: 8, photo: 'assets/products/p3.svg' },
        { name: 'Sample Watch Gift Set', sku: 'PRESENT-WATCH-SET', category: 'Accessories', price: 950, primary: 4, photo: 'assets/products/p3.svg' }
      ] : [
        { name: 'Sample Headphones', sku: 'PRESENT-HEADPHONES', category: 'Electronics', price: 499, primary: 12, photo: 'assets/products/p1.svg' },
        { name: 'Sample Keyboard', sku: 'PRESENT-KEYBOARD', category: 'Electronics', price: 850, primary: 10, photo: 'assets/products/p2.svg' }
      ];
      for (const item of items) {
        const product = app.commerce.saveProduct(seller, null, { ...item, was: item.price, published: true,
          description: 'Presentation sample only. Illustration, price and inventory are demonstration data, not a real offer.', spec: { Purpose: 'Presentation sample', Image: 'Existing SaleSync illustration' } });
        if (item.sku === 'PRESENT-HEADPHONES') app.commerce.variants.save(seller, product.id, {
          revision: product.revision, reason: 'Allocate sample stock to exact presentation SKUs.',
          groups: [{ name: 'Package', values: ['Single', 'Pair'] }],
          variants: [
            { options: { Package: 'Single' }, sku: 'PRESENT-HEADPHONES-ONE', price: 499, primary: 8, active: true },
            { options: { Package: 'Pair' }, sku: 'PRESENT-HEADPHONES-PAIR', price: 899, primary: 4, active: true }
          ]
        });
      }
    }
  });
  return accounts;
}
module.exports = { preparePresentationDirectory, seedPresentation };
