const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { startDemo, createLocalInbox } = require('../scripts/local-demo.cjs');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'salesync-launcher-'));
}
function removeTemporary(directory) {
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(directory, { recursive: true, force: true });
}
function client(app) {
  let cookie = '', csrf = '';
  return async (route, method = 'GET', body) => {
    const response = await fetch(app.config.origin + '/api/v1' + route, {
      method, headers: { Origin: app.config.origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(route === '/orders' && method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map(c => c.split(';')[0]).join('; ');
    const data = await response.json();
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
}

test('isolated demo provisions all roles with unique passwords, serves the real UI and APIs, and preserves state on restart', async t => {
  const directory = temporary(t), port = await freePort();
  let app = await startDemo({ directory, port });
  t.after(async () => { if (app) await app.close(); removeTemporary(directory); });
  const accounts = JSON.parse(fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8'));
  assert.equal(accounts.length, 4);
  assert.equal(new Set(accounts.map(a => a.password)).size, 4);
  assert.ok(accounts.every(a => a.password.length >= 12));
  assert.equal(app.config.host, '127.0.0.1');
  assert.equal(app.config.env.GMAIL_USER, undefined);
  assert.equal(app.config.env.GMAIL_APP_PASSWORD, undefined);
  assert.equal(app.config.env.AFTERSHIP_API_KEY, undefined);
  assert.equal(app.config.dbPath, path.join(directory, 'salesync.sqlite'));
  assert.equal((await fetch(app.config.origin)).status, 200);
  const privateFile = await fetch(app.config.origin + '/data/demo/accounts.json');
  assert.equal(privateFile.status, 404);
  for (const a of accounts) {
    const c = client(app);
    const login = await c('/auth/login', 'POST', { email: a.email, password: a.password });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, a.role);
    if (a.label === 'seller') assert.equal((await c('/seller/catalog')).data.products.length, 1);
    if (a.label === 'management') assert.equal((await c('/admin/reports')).status, 200);
    if (a.label === 'maintenance') {
      assert.equal((await c('/admin/health')).status, 200);
      assert.equal((await c('/admin/reports')).status, 403);
    }
  }
  assert.equal((await client(app)('/catalog')).data.products.length, 13);
  const buyer = client(app), customer = accounts.find(a => a.label === 'customer');
  await buyer('/auth/login', 'POST', { email: customer.email, password: customer.password });
  const made = await buyer('/orders', 'POST', { items: [{ id: 'p1', qty: 1 }], delivery: { name: 'Demo Customer', phone: '09123456789', address: '123 Demo Street', barangay: 'Demo Barangay', city: 'Pasig', province: 'Metro Manila', postal: '1609' } });
  assert.equal(made.status, 201);
  assert.equal((await buyer('/payments/' + made.data.order.payment.id + '/simulate', 'POST', { outcome: 'success' })).data.order.status, 'paid');
  await app.runWorkers();
  const messages = JSON.parse(fs.readFileSync(path.join(directory, 'mail/messages.json'), 'utf8'));
  const orderMessage = messages.find(m => m.to === customer.email && m.subject === 'Your SaleSync order was received');
  assert.ok(orderMessage);
  assert.ok(fs.readFileSync(path.join(directory, 'mail', orderMessage.file), 'utf8').includes(made.data.order.id));
  const persistedProduct=app.commerce.productView(app.commerce.productRow('p1'));
  const persistedOrder=app.commerce.orderView(app.commerce.orderRow(made.data.order.id));
  const before = fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8');
  await app.close(); app = null;
  app = await startDemo({ directory, port });
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n, 4);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM products').get().n, 13);
  assert.equal(fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8'), before);
  assert.deepEqual(app.commerce.productView(app.commerce.productRow('p1')),persistedProduct);
  assert.deepEqual(app.commerce.orderView(app.commerce.orderRow(made.data.order.id)),persistedOrder);
  const returning=client(app);await returning('/auth/login','POST',{email:customer.email,password:customer.password});
  const history=await returning('/orders');assert.equal(history.status,200);assert.ok(history.data.orders.some(order=>order.id===made.data.order.id&&order.status==='paid'));
  assert.equal(app.db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);

});

test('demo registration and single-use password recovery work through captured local emails without SMTP', async t => {
  const directory = temporary(t);
  const app = await startDemo({ directory, port: await freePort() });
  t.after(async () => { await app.close(); removeTemporary(directory); });
  const c = client(app), email = 'newdemocustomer@gmail.com', password = 'Local demo password 928!';
  assert.equal((await c('/auth/register', 'POST', { name: 'New demo customer', email, password })).status, 201);
  const mailbox = path.join(directory, 'mail');
  let messages = JSON.parse(fs.readFileSync(path.join(mailbox, 'messages.json'), 'utf8'));
  const verification = fs.readFileSync(path.join(mailbox, messages[0].file), 'utf8');
  assert.ok(verification.includes('LOCAL DEMO'));
  assert.ok(verification.includes('data:image/png;base64,'));
  // Code is stored only in this isolated file inbox, never the API response.
  const code = verification.match(/class="email-code"[^>]*>\s*(\d{4})/)[1];
  assert.equal((await c('/auth/verify', 'POST', { code })).status, 200);
  const guest = client(app);
  assert.equal((await guest('/auth/forgot-password', 'POST', { email })).status, 202);
  messages = JSON.parse(fs.readFileSync(path.join(mailbox, 'messages.json'), 'utf8'));
  const reset = fs.readFileSync(path.join(mailbox, messages[0].file), 'utf8');
  const token = reset.match(/reset-password\?token=([A-Za-z0-9_-]+)/)[1];
  assert.ok(reset.includes(app.config.origin));
  assert.equal((await guest('/auth/reset-password', 'POST', { token, password: 'Changed demo password 328!' })).status, 200);
  assert.equal((await guest('/auth/reset-password', 'POST', { token, password })).status, 410);
  assert.equal((await guest('/auth/login', 'POST', { email, password: 'Changed demo password 328!' })).status, 200);
});

test('local inbox persists escaped recipients and order notifications between launches', async t => {
  const directory = temporary(t);
  t.after(() => removeTemporary(directory));
  const inbox = createLocalInbox(directory);
  await inbox.mailer.sendOrder('<script>bad</script>@gmail.com', { kind: 'order_created', orderId: 'DEMO-123', status: 'paid', test: true, lines: [{ name: 'Test item', qty: 1, price: 100 }], total: 100, discount: 0, url: 'http://localhost:3001/#/account' });
  const index = fs.readFileSync(inbox.inboxFile, 'utf8');
  assert.ok(index.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!index.includes('<script>bad</script>'));
  createLocalInbox(directory);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'messages.json'), 'utf8')).length, 1);
});

test('presentation fixture isolates two labeled stores and exact variant stock, survives restart without reseeding, and cannot enter regular browsing', async t => {
  const directory = temporary(), port = await freePort();
  let app = await startDemo({ directory, port, presentation: true });
  t.after(async () => { if (app) await app.close(); removeTemporary(directory); });
  const accounts = JSON.parse(fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8'));
  assert.equal(accounts.length, 5);
  assert.equal(new Set(accounts.map(a => a.password)).size, 5);
  const catalog = (await client(app)('/catalog')).data;
  assert.equal(catalog.demo, true);
  assert.equal(catalog.products.length, 4);
  assert.equal(catalog.stores.length, 2);
  assert.ok(catalog.stores.every(s => s.name.includes('Presentation Only') && s.description.includes('Not a genuine merchant')));
  assert.ok(catalog.products.every(p => p.name.startsWith('Sample ') && p.description.includes('not a real offer')));
  const product = catalog.products.find(p => p.sku === 'PRESENT-HEADPHONES');
  assert.equal(product.unallocatedOnHand, 0);
  assert.equal(product.primary, 12);
  assert.deepEqual(product.variants.map(v => v.primary), [8, 4]);
  assert.equal(app.config.env.PAYMONGO_SECRET_KEY, undefined);
  assert.equal(app.config.env.GMAIL_APP_PASSWORD, undefined);
  const seller = accounts.find(a => a.label === 'seller'), c = client(app);
  assert.equal((await c('/auth/login', 'POST', { email: seller.email, password: seller.password })).status, 200);
  assert.equal((await c('/seller/catalog')).data.products.length, 2);
  const second = catalog.products.find(p => p.sku === 'PRESENT-WATCH');
  assert.equal((await c('/seller/catalog/' + second.id, 'PATCH', { revision: second.revision, price: 1 })).status, 403);
  const buyer = client(app), customer = accounts.find(a => a.label === 'customer');
  await buyer('/auth/login', 'POST', { email: customer.email, password: customer.password });
  const made = await buyer('/orders', 'POST', { items: [{ id: product.variants[1].id, qty: 1 }, { id: second.id, qty: 1 }], delivery: { name: 'Sample Buyer', phone: '09123456789', address: '123 Sample Street', barangay: 'Sample Barangay', city: 'Pasig', province: 'Metro Manila', postal: '1609' } });
  assert.equal(made.status, 201);
  assert.equal(made.data.order.shipments.length, 2);
  assert.equal(made.data.order.total, 899 + 750 + 138);
  const count = app.db.prepare('SELECT COUNT(*) n FROM products').get().n;
  const before = fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8');
  assert.ok(fs.readdirSync(directory).some(f => f.startsWith('before-fixture-') && require('../scripts/backup-database.cjs').verifyDatabase(path.join(directory, f)).ok));
  await app.close(); app = null;
  app = await startDemo({ directory, port, presentation: true });
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM products').get().n, count);
  assert.equal(fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8'), before);
  assert.equal(app.commerce.productView(app.commerce.productRow(product.variants[1].id)).reserved, 1);
  assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(), []);
  // Removing development publication mode must hide all fixture merchants/products.
  app.config.catalogDemo = false;
  assert.equal((await client(app)('/catalog')).data.products.length, 0);
  assert.equal((await client(app)('/catalog')).data.stores.length, 0);
});

test('presentation refuses unmarked existing databases without changing their contents', async t => {
  const directory = temporary();
  t.after(() => removeTemporary(directory));
  const file = path.join(directory, 'salesync.sqlite');
  fs.writeFileSync(file, 'Existing data sentinel');
  await assert.rejects(startDemo({ directory, port: await freePort(), presentation: true }), /existing database/i);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Existing data sentinel');
  assert.equal(fs.existsSync(path.join(directory, 'presentation.json')), false);
});
