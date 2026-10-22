'use strict';

// Starts the server twice (auth disabled, then enabled) and checks session persistence + auth.
// Usage: npm test

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');
const totp = require('../lib/totp');

const ROOT = path.join(__dirname, '..');
const SESSION = `cloudflare-tmux-test-${process.pid}`;
const ME = require('os').userInfo().username;

function startServer(port, env) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, ENV_FILE: '', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (/listening/.test(d)) resolve(proc); });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

function attach(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?session=${name}&cols=100&rows=30`,
    { headers: { Origin: `http://127.0.0.1:${port}` } });
  let buf = '';
  ws.on('message', (d) => { buf += d.toString(); });
  const waitFor = (re, ms = 5000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (re.test(buf)) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${re}; got: ${JSON.stringify(buf.slice(-300))}`)); }
    }, 50);
  });
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, waitFor, send: (s) => ws.send(s) }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`ws status ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

const tmuxHas = (name) => {
  try { execFileSync('tmux', ['has-session', '-t', `=${name}`], { stdio: 'ignore' }); return true; } catch { return false; }
};

async function main() {
  const port = 17681;
  const srv = await startServer(port, { AUTH_DISABLED: '1' });
  const base = `http://127.0.0.1:${port}`;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  try {
    const me = await (await fetch(`${base}/api/me`)).json();
    assert.strictEqual(me.user, ME, 'local mode acts as current user');
    let res = await fetch(`${base}/api/sessions`, json('POST', { name: SESSION }));
    assert.strictEqual(res.status, 201, 'create session');
    assert.ok(tmuxHas(SESSION), 'tmux session exists');

    res = await fetch(`${base}/api/sessions`, json('POST', { name: 'bad name;rm' }));
    assert.strictEqual(res.status, 400, 'invalid name rejected');

    res = await fetch(`${base}/api/sessions/${SESSION}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 403, 'state change without Origin refused');
    res = await fetch(`${base}/api/sessions/${SESSION}`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(res.status, 403, 'cross-origin state change refused');
    assert.ok(tmuxHas(SESSION), 'session not killed by refused requests');

    const list = await (await fetch(`${base}/api/sessions`)).json();
    assert.ok(list.some((s) => s.name === SESSION), 'session listed');

    // Attach, run a command, then drop the connection (like closing the tab).
    let c = await attach(port, SESSION);
    await c.waitFor(/[$#] /);
    c.send('echo MARK-$((40+2))\r');
    await c.waitFor(/MARK-42/);
    c.send('export KEEP=persisted\r');
    await new Promise((r) => setTimeout(r, 300));
    c.ws.terminate();
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(tmuxHas(SESSION), 'session survives disconnect');

    // Reattach: the screen is redrawn and shell state is preserved.
    c = await attach(port, SESSION);
    await c.waitFor(/MARK-42/);
    await new Promise((r) => setTimeout(r, 300));
    c.send('echo VAL=$KEEP\r');
    await c.waitFor(/VAL=persisted/);
    c.ws.close();

    // Cross-origin WebSocket is refused.
    await assert.rejects(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?session=${SESSION}`, { headers: { Origin: 'https://evil.example' } });
      ws.on('open', resolve);
      ws.on('unexpected-response', (_q, r) => reject(new Error(String(r.statusCode))));
      ws.on('error', reject);
    }), /403/, 'cross-origin ws refused');

    res = await fetch(`${base}/api/sessions/${SESSION}`, { method: 'DELETE', headers: { Origin: base } });
    assert.strictEqual(res.status, 204, 'kill session');
    assert.ok(!tmuxHas(SESSION), 'session gone after kill');
  } finally {
    srv.kill();
    if (tmuxHas(SESSION)) execFileSync('tmux', ['kill-session', '-t', `=${SESSION}`]);
  }

  // Bad identity mappings stop the server from starting.
  const startFails = (env) => new Promise((resolve) => {
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, ENV_FILE: '', PORT: '17699', ...env }, stdio: 'ignore' });
    const t = setTimeout(() => { proc.kill(); resolve(false); }, 3000);
    proc.on('exit', (code) => { clearTimeout(t); resolve(code !== 0); });
  });
  const cf = { AUTH_DISABLED: '', CF_TEAM_DOMAIN: 'example.cloudflareaccess.com', CF_ACCESS_AUD: 'test-aud' };
  assert.ok(await startFails({ ...cf, IDENTITIES: 'a@b.c:root' }), 'root mapping refused');
  assert.ok(await startFails({ ...cf, IDENTITIES: 'a@b.c' }), 'malformed mapping refused');
  assert.ok(await startFails({ ...cf, IDENTITIES: 'a@b.c:x,A@b.c:y' }), 'duplicate email refused');
  assert.ok(await startFails({ ...cf, IDENTITIES: '' }), 'missing mapping refused');

  // Auth enabled: requests without / with a forged Access JWT are rejected.
  const authPort = port + 1;
  const srv2 = await startServer(authPort, {
    AUTH_DISABLED: '', CF_TEAM_DOMAIN: 'example.cloudflareaccess.com', CF_ACCESS_AUD: 'test-aud', IDENTITIES: `a@b.c:${ME}`,
  });
  try {
    let res = await fetch(`http://127.0.0.1:${authPort}/api/sessions`);
    assert.strictEqual(res.status, 401, 'no token -> 401');
    const forged = [{ alg: 'RS256', kid: 'x' }, { email: 'a@b.c', aud: 'test-aud' }]
      .map((p) => Buffer.from(JSON.stringify(p)).toString('base64url')).join('.') + '.sig';
    res = await fetch(`http://127.0.0.1:${authPort}/`, { headers: { 'Cf-Access-Jwt-Assertion': forged } });
    assert.strictEqual(res.status, 401, 'forged token -> 401');
    await assert.rejects(attach(authPort, 'x'), /401/, 'ws without token -> 401');
  } finally {
    srv2.kill();
  }

  // Two-step codes (TOTP=required): nothing works until a valid, unused code is entered.
  assert.strictEqual(totp.hotp(totp.base32Encode(Buffer.from('12345678901234567890')), Math.floor(1111111109 / 30)), '081804',
    'RFC 6238 test vector');
  const totpFile = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-totp-')), 'totp.json');
  const secret = totp.newSecret();
  totp.save(totpFile, { key: null, users: { local: { secret, added: 'test' } } });
  const totpPort = port + 2;
  const tbase = `http://127.0.0.1:${totpPort}`;
  const srv3 = await startServer(totpPort, { AUTH_DISABLED: '1', TOTP: 'required', TOTP_FILE: totpFile });
  const post = (body, cookie) => fetch(`${tbase}/api/2fa`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: tbase, ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body),
  });
  try {
    assert.strictEqual((await (await fetch(`${tbase}/api/me`)).json()).twofa, 'needed', 'code needed');
    assert.strictEqual((await fetch(`${tbase}/api/sessions`)).status, 403, 'api blocked without code');
    await assert.rejects(attach(totpPort, 'x'), /403/, 'ws blocked without code');
    assert.strictEqual((await post({ code: '000000' })).status, 401, 'wrong code rejected');
    const code = totp.hotp(secret, Math.floor(Date.now() / 30000));
    const ok = await post({ code });
    assert.strictEqual(ok.status, 204, 'right code accepted');
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/, 'cookie flags');
    assert.strictEqual((await fetch(`${tbase}/api/sessions`, { headers: { Cookie: cookie } })).status, 200, 'api open with code');
    assert.strictEqual((await post({ code })).status, 401, 'reused code rejected');
    assert.strictEqual((await fetch(`${tbase}/api/sessions`, { headers: { Cookie: 'ct_2fa=9999999999.forged' } })).status, 403,
      'forged cookie rejected');
    for (let i = 0; i < 5; i++) await post({ code: '111111' });
    assert.strictEqual((await post({ code: '222222' })).status, 429, 'guessing is rate-limited');
    totp.save(totpFile, { ...totp.load(totpFile), users: {} });
    assert.strictEqual((await fetch(`${tbase}/api/sessions`, { headers: { Cookie: cookie } })).status, 403, 'removal revokes access');
  } finally {
    srv3.kill();
  }

  console.log('All smoke tests passed');
}

main().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
