// Isolated localhost demonstration. This entry point never loads .env or uses SMTP.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { loadConfig } = require('../backend/config.cjs');
const { createApp } = require('../backend/app.cjs');
const { hashPassword, gmailAddress } = require('../backend/security.cjs');
const { verificationEmail } = require('../backend/emails/verification.cjs');
const { recoveryEmail } = require('../backend/emails/recovery.cjs');
const { orderEmail } = require('../backend/emails/order.cjs');
const { createMailer } = require('../backend/mailer.cjs');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const style = 'body{font:16px/1.6 Arial,sans-serif;background:#f3f6fb;color:#173351;margin:0;padding:24px}main{max-width:900px;margin:auto;background:white;padding:28px;border:1px solid #dce4ed;border-radius:16px}h1{margin-top:0}a{color:#225fc8}table{border-collapse:collapse;width:100%}th,td{padding:12px;text-align:left;border-bottom:1px solid #dce4ed;overflow-wrap:anywhere}code{font-size:14px}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}.scroll{overflow-x:auto}.notice{padding:12px;background:#eff5ff;border-radius:8px}';
const page = (title, content) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${style}</style></head><body><main><h1>${escape(title)}</h1>${content}</main></body></html>`;

function createLocalInbox(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const inboxFile = path.join(directory, 'index.html');
  const indexFile = path.join(directory, 'messages.json');
  function render(messages) {
    fs.writeFileSync(inboxFile, page('SaleSync local demo inbox', `<p class="notice">Captured on this PC only. No email was sent to Gmail. Refresh this page after requesting a code or reset link.</p><nav><a href="index.html">Refresh inbox</a><a href="../accounts.html">Demo accounts</a></nav><ul>${messages.map(m => `<li><a href="${escape(m.file)}">${escape(m.subject)}</a> — ${escape(m.to)} <small>${escape(m.at)}</small></li>`).join('') || '<li>No messages yet.</li>'}</ul>`), { mode: 0o600 });
  }
  render(fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : []);
  async function capture(to, message) {
    const id = randomUUID(), file = id + '.html';
    let html = message.html;
    for (const attachment of message.attachments || []) {
      if (attachment.cid) html = html.replaceAll('cid:' + attachment.cid, 'data:' + attachment.contentType + ';base64,' + attachment.content.toString('base64'));
    }
    html = html.replace(/(<body[^>]*>)/i, '$1<div style="padding:12px;background:#fff3cf;color:#173351;font:14px Arial">LOCAL DEMO · No email was sent. <a href="index.html">Back to inbox</a></div>');
    fs.writeFileSync(path.join(directory, file), html, { mode: 0o600 });
    const messages = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
    messages.unshift({ to, subject: message.subject, at: new Date().toISOString(), file });
    fs.writeFileSync(indexFile, JSON.stringify(messages, null, 2), { mode: 0o600 });
    render(messages);
  }
  return { inboxFile, mailer: {
    localCapture: true,
    configured: true,
    sendVerification: (to, code, ttlSeconds) => capture(to, verificationEmail({ code, ttlSeconds })),
    sendPasswordReset: (to, url) => capture(to, recoveryEmail(url)),
    sendOrder: (to, data) => capture(to, orderEmail(data)),
    sandboxEmail: createMailer({ MAIL_MODE: 'disabled' }).sandboxEmail
  } };
}

async function seedDemo(app, directory) {
  const file = path.join(directory, 'accounts.json');
  const existing = app.db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (existing) {
    if (!fs.existsSync(file)) throw Error('Demo accounts file is missing. Existing demo data was left unchanged.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const accounts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : ['customer', 'seller', 'management', 'maintenance'].map(label => ({
    id: randomUUID(), label, name: 'Demo ' + label, email: `salesync.demo.${label}@gmail.com`,
    role: label === 'seller' ? 'customer' : label, password: randomBytes(18).toString('base64url')
  }));
  const hashes = await Promise.all(accounts.map(account => hashPassword(account.password)));
  fs.writeFileSync(file, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  app.commerce.transaction(() => {
    accounts.forEach((a, index) => {
      app.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,'active',?,?)").run(a.id, a.name, a.email, gmailAddress(a.email).key, hashes[index], a.role, Date.now(), Date.now());
      app.audit({ id: a.id, role: a.role }, 'LOCAL_DEMO_ACCOUNT_CREATED', { method: 'isolated demo launcher' });
    });
    const seller = accounts.find(a => a.label === 'seller'), manager = accounts.find(a => a.label === 'management');
    const store = app.commerce.applyStore(seller, { name: 'SaleSync Demo Store', description: 'A sample seller store for local demonstration.', tagline: 'Local demonstration products.' });
    app.commerce.updateStore(manager, store.id, { revision: store.revision, status: 'approved', reason: 'Approved sample store for isolated local demo.' });
    app.commerce.saveProduct(seller, null, { name: 'Demo Everyday Headphones', description: 'Sample product for testing seller inventory and checkout.', sku: 'DEMO-HEADPHONES', category: 'Electronics', price: 499, was: 599, primary: 25, published: true, photo: 'assets/products/p1.svg', spec: { Mode: 'Local demonstration' } });
  });
  return accounts;
}

async function startDemo({ directory = path.resolve(__dirname, '../data/demo'), port = 3001, presentation = false } = {}) {
  if (presentation) require('./presentation-catalog.cjs').preparePresentationDirectory(directory);
  // Only these explicit values reach the demo: inherited Gmail, production DB,
  // courier keys and .env values cannot be used by this process.
  const config = loadConfig({ NODE_ENV: 'development', CATALOG_DEMO: 'true', HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: `http://localhost:${port}`, DATABASE_PATH: path.join(directory, 'salesync.sqlite'), MAIL_MODE: 'disabled', PAYMENT_MODE: 'local-test', COURIER_MODE: 'local-test' });
  const inbox = createLocalInbox(path.join(directory, 'mail'));
  // A presentation starts empty: do not import the legacy demonstration catalog.
  const db = presentation ? require('../backend/database.cjs').openDatabase({ ...config, catalogDemo: false }) : undefined;
  const app = await createApp(config, { mailer: inbox.mailer, ...(db ? { db } : {}) });
  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(port, '127.0.0.1', () => { app.server.removeListener('error', reject); resolve(); });
    });
    const accounts = presentation ? await require('./presentation-catalog.cjs').seedPresentation(app, directory, config) : await seedDemo(app, directory);
    const accountsFile = path.join(directory, 'accounts.html');
    fs.writeFileSync(accountsFile, page('SaleSync demo — ready to test', `<p class="notice">Local demonstration only. These randomly generated passwords belong to this PC. Payments and courier updates are simulated. Email is captured in the local inbox.</p><nav><a href="${escape(config.origin)}" target="_blank" rel="noopener">Open SaleSync</a><a href="mail/index.html" target="_blank" rel="noopener">Open local inbox</a></nav><p>Sign in with an account below. Seller tools belong to the seller account; management and maintenance have separate permissions.</p><div class="scroll"><table><thead><tr><th>Account</th><th>Email</th><th>Initial password</th></tr></thead><tbody>${accounts.map(a => `<tr><td>${escape(a.label)}</td><td>${escape(a.email)}</td><td><code>${escape(a.password)}</code></td></tr>`).join('')}</tbody></table></div><p>For registration or password recovery, request it on the website, then refresh the local inbox to read the message. Passwords above remain the initial values if you change them.</p><p>Keep the starter window open. Your demo changes persist in <code>${presentation ? 'data/presentation/' : 'data/demo/'}</code>. Your regular database and Gmail configuration are separate.</p>`), { mode: 0o600 });
    app.startWorkers();
    return { ...app, config, accountsFile, inboxFile: inbox.inboxFile };
  } catch (error) {
    await app.close();
    if (error.code === 'EADDRINUSE') throw Error(`Demo port ${port} is already in use. Close the previous demo window, then try again.`);
    throw error;
  }
}

module.exports = { startDemo, createLocalInbox };
