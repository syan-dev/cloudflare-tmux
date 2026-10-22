'use strict';

// TOTP (RFC 6238: SHA-1, 6 digits, 30 s) and the enrollment store shared by server.js and scripts/totp.js.
// Store: JSON { key: <hex cookie-signing key>, users: { <email>: { secret: <base32>, added: <iso> } } }, mode 600.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/[\s=]/g, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Returns the matching time counter (±1 step for clock drift), or -1.
function verify(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return -1;
  const t = Math.floor(now / 1000 / STEP);
  for (const c of [t, t - 1, t + 1]) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, c)), Buffer.from(code))) return c;
  }
  return -1;
}

const newSecret = () => base32Encode(crypto.randomBytes(20));

function otpauthUri(email, secret) {
  const label = encodeURIComponent(`cloudflare-tmux:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=cloudflare-tmux&algorithm=SHA1&digits=6&period=${STEP}`;
}

function defaultFile() {
  if (process.env.TOTP_FILE) return process.env.TOTP_FILE;
  return process.getuid() === 0 ? '/etc/cloudflare-tmux/totp.json' : path.join(os.homedir(), '.config', 'cloudflare-tmux', 'totp.json');
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { key: data.key || null, users: data.users || {} };
  } catch (err) {
    if (err.code === 'ENOENT') return { key: null, users: {} };
    throw err;
  }
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Loads the store, creating the signing key on first use.
function loadWithKey(file) {
  const data = load(file);
  if (!data.key) { data.key = crypto.randomBytes(32).toString('hex'); save(file, data); }
  return data;
}

module.exports = { base32Encode, base32Decode, hotp, verify, newSecret, otpauthUri, defaultFile, load, save, loadWithKey };
