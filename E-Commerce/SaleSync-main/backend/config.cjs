const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
// Only messages created here may be shown by the startup entry point.
class ConfigurationError extends Error {}
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const dbPath = path.resolve(ROOT, env.DATABASE_PATH || 'data/salesync.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  let secret = env.APP_SECRET;
  if (!secret && !production) {
    const secretFile = path.join(path.dirname(dbPath), '.app-secret');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
    secret = fs.readFileSync(secretFile, 'utf8').trim();
  }
  if (!secret || secret.length < 32) throw new ConfigurationError('APP_SECRET must contain at least 32 characters.');
  if (production && env.COOKIE_SECURE !== 'true') throw new ConfigurationError('Production requires COOKIE_SECURE=true and HTTPS.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError('PORT must be an integer between 1 and 65535.');
  const origin = env.APP_ORIGIN || `http://127.0.0.1:${port}`;
  function validOrigin(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password; }
    catch { return false; }
  }
  if (!validOrigin(origin)) throw new ConfigurationError('APP_ORIGIN must be an HTTP(S) origin without credentials, a path or a trailing slash.');
  if (String(env.API_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean).some(x => !validOrigin(x))) throw new ConfigurationError('API_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins without paths or credentials.');
  const paymentMode=env.PAYMENT_MODE||(production?'disabled':'local-test');
  const courierMode=env.COURIER_MODE||(production?'manual':'local-test');
  if(!['manual','local-test','aftership'].includes(courierMode)||(production&&courierMode==='local-test'))throw new ConfigurationError('Use manual, aftership or development-only local-test COURIER_MODE.');
  if(!['disabled','local-test','paymongo-test'].includes(paymentMode)||(production&&paymentMode==='local-test'))throw new ConfigurationError('Use disabled, paymongo-test or development-only local-test PAYMENT_MODE.');
  if(paymentMode==='paymongo-test'&&!/^sk_test_[A-Za-z0-9]+$/.test(env.PAYMONGO_SECRET_KEY||''))throw new ConfigurationError('PAYMONGO_SECRET_KEY must be a complete sk_test_ key. Live keys are prohibited.');
  if(paymentMode==='paymongo-test'&&(!env.PAYMONGO_WEBHOOK_SECRET?.trim()||/^(?:pk|sk)_(?:test|live)_/.test(env.PAYMONGO_WEBHOOK_SECRET)))throw new ConfigurationError('PAYMONGO_WEBHOOK_SECRET requires the endpoint signing secret, not an API key.');
  if(paymentMode==='paymongo-test'&&(!env.PAYMONGO_PAYMENT_METHODS||!env.PAYMONGO_PAYMENT_METHODS.split(',').every(x=>/^[a-z_]+$/.test(x.trim()))))throw new ConfigurationError('PAYMONGO_PAYMENT_METHODS requires enabled test-account payment methods.');
  if (production && !origin.startsWith('https://')) throw new ConfigurationError('Production APP_ORIGIN must use HTTPS.');
  const num = (key, fallback, min, max) => {
    const n = Number(env[key] || fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw new ConfigurationError(`${key} must be an integer between ${min} and ${max}.`);
    return n;
  };
  if (production && env.CATALOG_DEMO === 'true') throw new ConfigurationError('CATALOG_DEMO is available only in an isolated development environment.');
  return { root: ROOT, dbPath, uploadDir:path.join(path.dirname(dbPath),'uploads'),secret, port, origin, host: env.HOST || '127.0.0.1', production, catalogDemo: !production && env.CATALOG_DEMO === 'true',
    secureCookie: env.COOKIE_SECURE === 'true', sessionSeconds: num('SESSION_TTL_SECONDS', 28800, 300, 86400),paymentMode,reservationSeconds:num('RESERVATION_TTL_SECONDS',900,60,3600),courierMode,courierStepSeconds:num('COURIER_TEST_STEP_SECONDS',60,10,3600),
    initialSettings: {
      store: { name: 'SaleSync Online', tagline: 'Make room for your next favorite find.', supportEmail: '', shippingPerSeller: 69 },
      email: { ttlSeconds: num('VERIFICATION_TTL_SECONDS', 300, 60, 900), maxAttempts: num('VERIFICATION_MAX_ATTEMPTS', 5, 1, 5), resendSeconds: num('VERIFICATION_RESEND_SECONDS', 60, 60, 600), maxSendsPerHour: num('VERIFICATION_MAX_SENDS_PER_HOUR', 5, 1, 5) },
      maintenance: { enabled: false, message: 'We are making a few improvements. Please check back shortly.' }
    }, env };
}
module.exports = { loadConfig, ConfigurationError };
