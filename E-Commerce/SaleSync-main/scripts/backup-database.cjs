const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
function verifyDatabase(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all().length;
    return { ok: integrity.length === 1 && integrity[0].integrity_check === 'ok' && foreignKeyErrors === 0, integrityErrors: integrity.filter(r => r.integrity_check !== 'ok').length, foreignKeyErrors, schema: db.prepare('PRAGMA user_version').get().user_version };
  } finally { db.close(); }
}
async function backupDatabase(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (source === destination || fs.existsSync(destination)) throw Error('Choose a new backup destination.');
  const reservation = fs.openSync(destination, 'wx', 0o600); fs.closeSync(reservation);
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    await backup(db, destination);
    if (!verifyDatabase(destination).ok) throw Error('Backup integrity validation failed.');
  } catch (error) {
    // Only the new destination reserved by this invocation may be removed.
    fs.unlinkSync(destination);
    throw error;
  } finally { db?.close(); }
  return destination;
}
if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) { console.error('Usage: node scripts/backup-database.cjs SOURCE.sqlite NEW-BACKUP.sqlite'); process.exitCode = 1; }
  else backupDatabase(source, destination).then(console.log).catch(() => { console.error('Backup failed. Check database access, integrity and the new destination.'); process.exitCode = 1; });
}
module.exports = { backupDatabase, verifyDatabase };
