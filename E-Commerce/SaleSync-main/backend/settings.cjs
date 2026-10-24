const { randomUUID } = require('node:crypto');
const {PERMISSIONS,sectionsFor}=require('./permissions.cjs');
const filterSettings = (data, role) => Object.fromEntries(sectionsFor(role).map(k => [k, data[k]]));
function validateSettings(data) {
  const errors = [];
  const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max && !/[\u0000-\u001f]/.test(v);
  if (!str(data.store?.name, 2, 60)) errors.push('Store name must contain 2–60 characters.');
  if (!str(data.store?.tagline, 2, 140)) errors.push('Tagline must contain 2–140 characters.');
  if (typeof data.store?.supportEmail !== 'string' || (data.store.supportEmail && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.store.supportEmail) || data.store.supportEmail.length > 254))) errors.push('Support email is invalid.');
  if (!Number.isFinite(data.store?.shippingPerSeller) || data.store.shippingPerSeller < 0 || data.store.shippingPerSeller > 1000 || Math.round(data.store.shippingPerSeller * 100) / 100 !== data.store.shippingPerSeller) errors.push('Shipping must be a PHP amount from 0–1,000, with up to two decimal places.');
  const ranges = { ttlSeconds: [60,900], maxAttempts: [1,5], resendSeconds: [60,600], maxSendsPerHour: [1,5] };
  for (const [k,[min,max]] of Object.entries(ranges)) if (!Number.isInteger(data.email?.[k]) || data.email[k] < min || data.email[k] > max) errors.push(`${k} must be an integer from ${min}–${max}.`);
  if (typeof data.maintenance?.enabled !== 'boolean') errors.push('Maintenance enabled must be true or false.');
  if (!str(data.maintenance?.message, 5, 200)) errors.push('Maintenance message must contain 5–200 characters.');
  return errors;
}
function diffSettings(before, after) {
  const changes = [];
  for (const section of ['store','email','maintenance']) for (const key of Object.keys(before[section])) if (before[section][key] !== after[section][key]) changes.push({ section, key, before: before[section][key], after: after[section][key] });
  return changes;
}
function settingsService(db, now, audit, fail) {
  const current = () => { const row = db.prepare('SELECT * FROM settings WHERE id=1').get(); return { version: row.version, data: JSON.parse(row.data) }; };
  const draft = user => { const row = db.prepare('SELECT * FROM drafts WHERE actor_id=?').get(user.id); return row ? { baseVersion: row.base_version, revision: row.revision, data: JSON.parse(row.data), updatedAt: row.updated_at } : null; };
  const view = (d, user) => d && { ...d, data: filterSettings(d.data, user.role) };
  function save(user, patch, revision) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail(422,'INVALID_SETTINGS','A settings object is required.');
    const live = current(), old = draft(user);
    if (old ? revision !== old.revision : revision !== 0) fail(409,'DRAFT_CONFLICT','The draft changed. Reload before saving.');
    const next = structuredClone(old ? old.data : live.data);
    for (const [section, values] of Object.entries(patch)) {
      if (!sectionsFor(user.role).includes(section)) fail(403,'FORBIDDEN','Your role cannot change this settings section.');
      if (!values || typeof values !== 'object' || Array.isArray(values)) fail(422,'INVALID_SETTINGS','Invalid settings section.');
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(next[section], key)) fail(422,'UNKNOWN_SETTING','Unsupported settings field.');
        next[section][key] = value;
      }
    }
    const errors = validateSettings(next);
    if (errors.length) fail(422,'INVALID_SETTINGS',errors.join(' '),{ errors });
    db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at').run(user.id, old ? old.baseVersion : live.version, (old?.revision || 0) + 1, JSON.stringify(next), now());
    audit(user,'SANDBOX_DRAFT_SAVED',{ sections: Object.keys(patch) });
    return view(draft(user), user);
  }
  function apply(user, input) {
    const d = draft(user), live = current();
    if (!d || d.revision !== input.revision || d.baseVersion !== live.version) fail(409,'CONFIG_CONFLICT','Live settings or the draft changed. Discard and recreate the draft.');
    if (input.confirm !== 'APPLY' || typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 200) fail(422,'CONFIRM_REQUIRED','Enter APPLY and a reason of 5–200 characters.');
    const next = structuredClone(live.data);
    for (const section of sectionsFor(user.role)) next[section] = d.data[section];
    const errors = validateSettings(next);
    if (errors.length) fail(422,'INVALID_SETTINGS',errors.join(' '));
    const changes = diffSettings(live.data, next);
    if (!changes.length) fail(422,'NO_CHANGES','The draft has no changes to apply.');
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE settings SET version=version+1,data=? WHERE id=1').run(JSON.stringify(next));
      db.prepare('INSERT INTO config_history VALUES (?,?,?,?,?,0,NULL)').run(id,user.id,JSON.stringify(changes),input.reason.trim(),now());
      db.prepare('DELETE FROM drafts WHERE actor_id=?').run(user.id);
      audit(user,'CONFIG_APPLIED',{ historyId: id, changes, reason: input.reason.trim() });
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
    return { version: live.version + 1, historyId: id, changes };
  }
  function rollback(user, id, input) {
    const record = db.prepare('SELECT * FROM config_history WHERE id=?').get(id);
    if (!record) fail(404,'NOT_FOUND','Configuration change not found.');
    const changes = JSON.parse(record.changes);
    if (changes.some(c=>!sectionsFor(user.role).includes(c.section))) fail(403,'FORBIDDEN','Your role cannot roll back this configuration.');
    if (record.rolled_back || record.rollback_of) fail(409,'ALREADY_ROLLED_BACK','This entry cannot be rolled back.');
    if (input.confirm !== 'ROLLBACK' || typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 200) fail(422,'CONFIRM_REQUIRED','Enter ROLLBACK and a reason of 5–200 characters.');
    const live = current();
    if (input.version !== live.version || changes.some(c=>live.data[c.section][c.key] !== c.after)) fail(409,'CONFIG_CONFLICT','A later change overlaps this entry. Reload and review current settings.');
    const next = structuredClone(live.data);
    for (const c of changes) next[c.section][c.key] = c.before;
    const errors = validateSettings(next);
    if (errors.length) fail(422,'INVALID_SETTINGS',errors.join(' '));
    const inverse = diffSettings(live.data, next), rollbackId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE settings SET version=version+1,data=? WHERE id=1').run(JSON.stringify(next));
      db.prepare('UPDATE config_history SET rolled_back=1 WHERE id=?').run(id);
      db.prepare('INSERT INTO config_history VALUES (?,?,?,?,?,0,?)').run(rollbackId,user.id,JSON.stringify(inverse),input.reason.trim(),now(),id);
      audit(user,'CONFIG_ROLLED_BACK',{ historyId: id, changes: inverse, reason: input.reason.trim() });
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
    return { version: live.version + 1, changes: inverse };
  }
  function history(user) {
    return db.prepare('SELECT h.*,u.name AS actor_name FROM config_history h JOIN users u ON u.id=h.actor_id ORDER BY h.created_at DESC LIMIT 100').all().map(r=>({...r,changes:JSON.parse(r.changes)})).filter(r=>r.changes.every(c=>sectionsFor(user.role).includes(c.section)));
  }
  return { current, draft, view, save, apply, rollback, history };
}
module.exports = { PERMISSIONS, sectionsFor, filterSettings, validateSettings, diffSettings, settingsService };
