// Capability for one isolated local presentation server; never enabled by .env or an API.
const fs = require('node:fs');
const path = require('node:path');
const MARKER = 'salesync-local-catalog-fixtures-v1';
const ACTION = 'LOCAL_CATALOG_FIXTURE_CREATED';
function fixtureAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^(techhub|stylehub|customer|management|maintenance)@catalog\.salesync\.invalid$/.test(email) ? { email, key: email } : null;
}
function validateFixtureMode(config) {
  const directory = path.dirname(config.dbPath), data = path.join(config.root, 'data');
  let marker;
  try { marker = JSON.parse(fs.readFileSync(path.join(directory, 'local-fixtures.json'), 'utf8')); } catch {}
  if (config.production || config.env.NODE_ENV !== 'development' || !config.catalogDemo || config.host !== '127.0.0.1' || ![`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`].includes(config.origin) || String(config.env.API_ALLOWED_ORIGINS || '').trim() || !['local-test', 'disabled'].includes(config.paymentMode) || config.env.POS_ENABLED === 'true' || config.env.GMAIL_USER || config.env.GMAIL_APP_PASSWORD || [data, path.join(data, 'demo'), path.join(data, 'presentation')].includes(directory) || marker?.kind !== MARKER || marker?.database !== config.dbPath || fs.realpathSync(directory) !== directory || fs.lstatSync(config.dbPath).isSymbolicLink()) throw Error('Local fixtures require a marked isolated development database, loopback origin, local payments and no external credentials.');
  return true;
}
function localRequest(req, config) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && req.headers.host?.toLowerCase() === new URL(config.origin).host && !Object.keys(req.headers).some(key => key === 'forwarded' || key === 'via' || key.startsWith('x-forwarded-') || key === 'x-original-host');
}
module.exports = { MARKER, ACTION, fixtureAddress, validateFixtureMode, localRequest };
