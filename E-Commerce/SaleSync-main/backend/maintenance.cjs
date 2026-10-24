/* Essential technical operations. Backups remain local and are never downloadable. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { backupDatabase, verifyDatabase } = require('../scripts/backup-database.cjs');
function maintenanceOperations({ db, config, mailer, settings, now, audit, fail, jobs, pos }) {
  const directory = path.join(path.dirname(config.dbPath), 'backups');
  const backupName = /^backup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite$/;
  let busy = false;
  function backupDirectory() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== path.join(fs.realpathSync(path.dirname(config.dbPath)), 'backups')) throw Error('Invalid backup directory.');
    return directory;
  }
  function backupList() {
    if (!fs.existsSync(directory)) return [];
    const root = backupDirectory();
    return fs.readdirSync(root).filter(id => backupName.test(id)).flatMap(id => {
      const stat = fs.lstatSync(path.join(root, id));
      return stat.isFile() && !stat.isSymbolicLink() ? [{ id, bytes: stat.size, createdAt: stat.mtimeMs }] : [];
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }
  function health() {
    db.prepare('SELECT 1').get();
    const errors = db.prepare('SELECT reference,category,created_at FROM system_events ORDER BY id DESC LIMIT 30').all().map(r => ({ reference: /^[a-f0-9-]{36}$/.test(r.reference) ? r.reference : 'REDACTED', category: /^[A-Z][A-Z0-9_]{0,63}$/.test(r.category) ? r.category : 'INTERNAL_ERROR', created_at: r.created_at }));
    return { database: 'ok', databaseDetails: { schema: db.prepare('PRAGMA user_version').get().user_version, journal: db.prepare('PRAGMA journal_mode').get().journal_mode, foreignKeys: !!db.prepare('PRAGMA foreign_keys').get().foreign_keys, check: 'Connection check only; run integrity verification for a full check.' }, uptimeSeconds: Math.floor(process.uptime()), mailConfigured: !!mailer.configured, maintenance: settings.current().data.maintenance, payment: config.paymentMode, courier: { mode: config.courierMode, configured: config.courierMode === 'local-test' || !!config.env.AFTERSHIP_API_KEY }, integrations: { email: { mode: config.env.MAIL_MODE === 'disabled' ? (mailer.configured ? 'local-capture' : 'disabled') : 'smtp', configured: !!mailer.configured, verified: false, lastDelivery: mailer.deliveryStatus?.() || { status: 'not-attempted', category: null, at: null } }, payment: { mode: config.paymentMode, simulated: config.paymentMode === 'local-test', testConfigured:config.paymentMode==='paymongo-test', realMoneyReady: false }, courier: { mode: config.courierMode, configured: config.courierMode === 'local-test' || !!config.env.AFTERSHIP_API_KEY, verified: false }, pos: pos.status() }, jobs: jobs(), orderEmailQueue: db.prepare('SELECT status,COUNT(*) count FROM email_outbox GROUP BY status').all(), errors };
  }
  async function handle(ctx) {
    const { p, req, json } = ctx;
    const verify = p.match(/^\/api\/admin\/backups\/([^/]+)\/verify$/);
    if (!['/api/admin/health', '/api/admin/backups', '/api/admin/database/verify'].includes(p) && !verify) return false;
    const user = ctx.requireUser(ctx.session, req.method === 'GET' ? 'health:read' : 'maintenance:operate');
    if (p === '/api/admin/health' && req.method === 'GET') { json(200, health()); return true; }
    if (p === '/api/admin/backups' && req.method === 'GET') {
      try { json(200, { backups: backupList(), busy }); } catch { fail(503, 'BACKUP_STORAGE_UNAVAILABLE', 'Backup storage is unavailable. Check local directory access.'); }
      return true;
    }
    if (req.method !== 'POST' || p === '/api/admin/health') fail(405, 'METHOD_NOT_ALLOWED', 'Use a supported maintenance operation.');
    const input = await ctx.body(req);
    if (Object.keys(input).some(key => key !== 'reason') || typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 200) fail(422, 'REASON_REQUIRED', 'Record a maintenance reason of 5-200 characters.');
    ctx.rate('maintenance:' + user.id, 10, 60);
    if (busy) fail(409, 'MAINTENANCE_BUSY', 'A backup or integrity check is already running.');
    const operation = p === '/api/admin/backups' ? 'DATABASE_BACKUP' : 'DATABASE_INTEGRITY';
    let id = verify?.[1];
    if (id) {
      if (!backupName.test(id)) fail(404, 'NOT_FOUND', 'Backup not found.');
      let found = false;
      try { const file = path.join(backupDirectory(), id); if (fs.existsSync(file)) { const stat = fs.lstatSync(file); found = stat.isFile() && !stat.isSymbolicLink(); } }
      catch { fail(503, 'BACKUP_STORAGE_UNAVAILABLE', 'Backup storage is unavailable. Check local directory access.'); }
      if (!found) fail(404, 'NOT_FOUND', 'Backup not found.');
    }
    busy = true;
    try {
      audit(user, operation + '_STARTED', { reason: input.reason.trim(), ...(id ? { backupId: id } : {}) });
      let result;
      if (operation === 'DATABASE_BACKUP') {
        id = 'backup-' + randomUUID() + '.sqlite';
        await backupDatabase(config.dbPath, path.join(backupDirectory(), id));
        const stat = fs.statSync(path.join(directory, id));
        result = { ok: true, backup: { id, bytes: stat.size, createdAt: stat.mtimeMs }, message: 'WAL-safe backup created and integrity verified. Stored locally; not downloadable.' };
      } else {
        result = verifyDatabase(id ? path.join(backupDirectory(), id) : config.dbPath);
        result.message = result.ok ? 'Integrity and foreign-key checks passed.' : 'Integrity verification failed. Preserve the database and investigate locally.';
      }
      audit(user, operation + '_COMPLETED', { ...(id ? { backupId: id } : {}), ok: result.ok });
      json(200, result);
    } catch {
      audit(user, operation + '_FAILED', {});
      fail(503, 'MAINTENANCE_OPERATION_FAILED', 'Operation failed. Check local database/storage access and sanitized technical events.');
    } finally { busy = false; }
    return true;
  }
  return { handle };
}
module.exports = { maintenanceOperations };
