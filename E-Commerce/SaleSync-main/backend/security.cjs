const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const actual = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return safeEqual(actual.toString('hex'), hash);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const token = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const keyed = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
function gmailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:\.?[a-z0-9]+)*(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email) || email.length > 254) return null;
  // Gmail dots and plus tags identify the same mailbox: do not create duplicate accounts.
  const local = email.split('@')[0].split('+')[0].replaceAll('.', '');
  return { email, key: `${local}@gmail.com` };
}
function passwordValid(value) { return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 128; }
function publicUser(u) { const fixture=!!require('./local-fixtures.cjs').fixtureAddress(u?.email);return u ? { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, verified: !fixture&&!!u.verified_at, ...(fixture?{localFixture:true,activation:'local-development-only'}:{}) } : null; }
module.exports = { hashPassword, verifyPassword, safeEqual, token, digest, keyed, gmailAddress, passwordValid, publicUser };
