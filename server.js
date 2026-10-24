'use strict';

// cloudflare-tmux: persistent tmux sessions in the browser.
// tmux keeps sessions alive; closing a tab only detaches.
// Login is Cloudflare Access (Cloudflare account); the Access JWT is verified here too, and each allowed
// email is mapped to exactly one Linux account (IDENTITIES). Run as root to serve several
// accounts; each user's tmux runs with their own uid/gid.

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const http = require('http');
const { execFile, execFileSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const totp = require('./lib/totp');

// Config lives outside the code (~/.config/cloudflare-tmux/env); a .env next to server.js still works.
// The multi-user service gets /etc/cloudflare-tmux/env from systemd instead. ENV_FILE overrides ('' = none).
loadEnvFile('ENV_FILE' in process.env ? process.env.ENV_FILE
  : [path.join(os.homedir(), '.config', 'cloudflare-tmux', 'env'), path.join(__dirname, '.env')].find((f) => fs.existsSync(f)));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 7681);
const AUTH_DISABLED = process.env.AUTH_DISABLED === '1'; // local dev: no Access check, act as the current user
const TEAM_DOMAIN = (process.env.CF_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const ACCESS_AUD = process.env.CF_ACCESS_AUD || '';
const IS_ROOT = process.getuid() === 0;
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

function fail(msg) { console.error(msg); process.exit(1); }

// IDENTITIES=email:linuxuser,email2:linuxuser2 — one Linux account per email.
const IDENTITIES = new Map();
for (const entry of (process.env.IDENTITIES || '').split(',').map((x) => x.trim()).filter(Boolean)) {
  const i = entry.lastIndexOf(':');
  const email = entry.slice(0, i).trim().toLowerCase();
  const user = entry.slice(i + 1).trim();
  if (i < 1 || !email.includes('@') || !USER_RE.test(user)) fail(`Bad IDENTITIES entry "${entry}" (expected email:linuxuser)`);
  if (user === 'root') fail('root may not be mapped in IDENTITIES.');
  if (IDENTITIES.has(email)) fail(`${email} is mapped twice in IDENTITIES.`);
  IDENTITIES.set(email, user);
}
// Without root the server can only act as itself. Refuse a config it could never serve instead of
// rejecting that person at login time, where the cause is much harder to see.
if (!IS_ROOT && !AUTH_DISABLED) {
  const me = os.userInfo().username;
  for (const [email, user] of IDENTITIES) {
    if (user !== me) fail(`IDENTITIES maps ${email} to Linux user '${user}', but this server runs as '${me}' and can only serve '${me}'.\n` +
      `Use the multi-user install: sudo NODE_BIN="$(command -v node)" scripts/install-system.sh (see docs/content/install/multi-user.md), or map ${email} to ${me}.`);
  }
}

if (IS_ROOT && AUTH_DISABLED) fail('AUTH_DISABLED is for local dev and refused when running as root.');
if (!AUTH_DISABLED && (!TEAM_DOMAIN || !ACCESS_AUD || IDENTITIES.size === 0)) {
  fail('Set CF_TEAM_DOMAIN, CF_ACCESS_AUD and IDENTITIES (or AUTH_DISABLED=1 for local testing).');
}

const jwks = AUTH_DISABLED ? null : createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));

// Optional second step after Access: an authenticator-app code checked here (TOTP=required).
const TOTP_REQUIRED = (process.env.TOTP || 'off') === 'required';
if (!['off', 'required'].includes(process.env.TOTP || 'off')) fail('TOTP must be "off" or "required".');
const TOTP_FILE = totp.defaultFile();
const TOTP_SESSION_HOURS = Number(process.env.TOTP_SESSION_HOURS || 12);
if (!(TOTP_SESSION_HOURS > 0 && TOTP_SESSION_HOURS <= 720)) fail('TOTP_SESSION_HOURS must be between 1 and 720.');
const TOTP_COOKIE = 'ct_2fa';
const TOTP_KEY = TOTP_REQUIRED ? Buffer.from(totp.loadWithKey(TOTP_FILE).key, 'hex') : null;

// tmux >= 3.2 can send copies to the browser clipboard (OSC 52) via `-T clipboard`.
const TMUX_CLIPBOARD = (() => {
  try {
    const m = execFileSync('tmux', ['-V'], { timeout: 5000 }).toString().match(/(\d+)\.(\d+)/);
    return !!m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 2));
  } catch { return false; }
})();
if (!TMUX_CLIPBOARD) console.warn('tmux < 3.2: copying from tmux to the browser clipboard is disabled');

function loadEnvFile(file) {
  if (!file) return;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// A missing or unparseable Origin (e.g. "null") is not same-origin.
function sameOrigin(req) {
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function lookupUser(name) {
  return new Promise((resolve) => {
    execFile('getent', ['passwd', name], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const [user, , uid, gid, , home, shell] = stdout.trim().split(':');
      resolve(user === name ? { name: user, uid: +uid, gid: +gid, home, shell } : null);
    });
  });
}

// Verifies the Access JWT and returns { email, account } for the mapped Linux account, or throws.
async function authenticate(req) {
  if (AUTH_DISABLED) {
    const u = os.userInfo();
    return { email: 'local', account: { name: u.username, uid: u.uid, gid: u.gid, home: u.homedir, shell: u.shell } };
  }
  const token = req.headers['cf-access-jwt-assertion'] || getCookie(req, 'CF_Authorization');
  if (!token) throw new Error('missing Access token');
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://${TEAM_DOMAIN}`,
    audience: ACCESS_AUD,
  });
  const email = String(payload.email || '').toLowerCase();
  const user = IDENTITIES.get(email);
  if (!user) throw mappingError(`email not mapped: ${email}`,
    `You signed in to Cloudflare as ${email}, but that account isn't on this server's list of people who may log in.`,
    `Ask the admin to run: cloudflare-tmux add ${email} <linux-user>`);
  const account = await lookupUser(user);
  if (!account) throw mappingError(`${email}: Linux user ${user} does not exist`,
    `${email} is mapped to the Linux user ${user}, which doesn't exist on this server.`, 'Ask the admin to create it or fix the mapping.');
  if (account.uid === 0) throw mappingError(`${email}: refusing uid 0`, `${email} is mapped to a root account, which is refused.`, 'Ask the admin to fix the mapping.');
  if (/(nologin|false)$/.test(account.shell)) throw mappingError(`${email}: ${user} has no login shell`,
    `${email} is mapped to the Linux user ${user}, which has no login shell.`, `Ask the admin to run: sudo chsh -s /bin/bash ${user}`);
  if (!IS_ROOT && account.uid !== process.getuid()) {
    throw mappingError(`${email}: mapped to ${user}, but the server runs as ${os.userInfo().username} (install as root for other users)`,
      `${email} is mapped to the Linux user ${user}, but this server can only serve ${os.userInfo().username}.`, 'Ask the admin to use the multi-user install.');
  }
  return { email, account };
}

// A login rejected because of the IDENTITIES mapping. The person sees `shown` and `hint`; the log gets `message`.
// Other failures (missing or invalid Access token) stay generic for the person.
function mappingError(message, shown, hint) {
  const err = new Error(message);
  err.shown = shown;
  err.hint = hint;
  return err;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function rejectionPage(err) {
  const shown = err.shown || 'Your Cloudflare login was not accepted by this server.';
  const hint = err.hint || 'Ask the admin to check the server log, which names the reason.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not signed in</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;display:grid;place-items:center;min-height:100vh}
main{max-width:34rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:.5rem 0}code{background:#1e293b;padding:.1rem .35rem;border-radius:.25rem}
a{color:#7dd3fc}</style></head><body><main><h1>Not signed in</h1><p>${esc(shown)}</p><p>${esc(hint)}</p>
<p><a href="/">Try again</a></p></main></body></html>`;
}

// ---------- second step: authenticator code ----------

// The store is re-read on every check, so `scripts/totp.js add/remove` applies without a restart.
function totpSecret(email) {
  return totp.load(TOTP_FILE).users[email]?.secret || null;
}

// Cookie value: <expiry>.<HMAC(email, expiry, secret)>. Re-enrolling or removing a user invalidates it.
function totpCookieSig(email, exp, secret) {
  return crypto.createHmac('sha256', TOTP_KEY).update(`${email}\n${exp}\n${secret}`).digest('base64url');
}

function totpPassed(req, email) {
  if (!TOTP_REQUIRED) return true;
  const secret = totpSecret(email);
  const [exp, sig] = (getCookie(req, TOTP_COOKIE) || '').split('.');
  if (!secret || !sig || !(+exp > Date.now() / 1000)) return false;
  const want = Buffer.from(totpCookieSig(email, exp, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Per email: reject reused codes and slow down guessing (5 failures per 5 minutes).
const totpLastCounter = new Map();
const totpFailures = new Map();
const TOTP_MAX_FAILURES = 5;
const TOTP_WINDOW_MS = 5 * 60 * 1000;

function totpCheck(email, code) {
  const now = Date.now();
  const recent = (totpFailures.get(email) || []).filter((t) => now - t < TOTP_WINDOW_MS);
  if (recent.length >= TOTP_MAX_FAILURES) return { status: 429, error: 'Too many attempts. Wait a few minutes.' };
  const secret = totpSecret(email);
  if (!secret) return { status: 403, error: `No authenticator set up for ${email}. Ask the admin to run: scripts/totp.js add ${email}` };
  const counter = totp.verify(secret, code);
  if (counter < 0 || counter <= (totpLastCounter.get(email) ?? -1)) {
    recent.push(now);
    totpFailures.set(email, recent);
    return { status: 401, error: 'Wrong or already used code' };
  }
  totpLastCounter.set(email, counter);
  totpFailures.delete(email);
  const exp = Math.floor(now / 1000) + TOTP_SESSION_HOURS * 3600;
  return { status: 200, cookie: `${exp}.${totpCookieSig(email, exp, secret)}` };
}

// ---------- running tmux as the mapped user ----------

// Builds the command that runs `tmux <args>` as `account`.
function tmuxCommand(account, args) {
  if (IS_ROOT) {
    return {
      file: '/usr/bin/setpriv',
      args: ['--reuid', String(account.uid), '--regid', String(account.gid), '--init-groups', '--reset-env', '--',
        '/usr/bin/env', `LANG=${process.env.LANG || 'C.UTF-8'}`, 'TERM=xterm-256color', 'COLORTERM=truecolor',
        '/usr/bin/tmux', ...args],
      cwd: account.home,
      env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
    };
  }
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.TMUX;
  for (const k of ['CF_ACCESS_AUD', 'CF_TEAM_DOMAIN', 'IDENTITIES', 'AUTH_DISABLED']) delete env[k];
  return { file: 'tmux', args, cwd: account.home, env };
}

function tmux(account, args) {
  const cmd = tmuxCommand(account, args);
  return new Promise((resolve, reject) => {
    execFile(cmd.file, cmd.args, { timeout: 5000, cwd: cmd.cwd, env: cmd.env }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}

async function listSessions(account) {
  try {
    const out = await tmux(account, ['list-sessions', '-F',
      '#{session_name}|#{session_windows}|#{session_attached}|#{session_activity}|#{session_created}']);
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [name, windows, attached, activity, created] = line.split('|');
      return { name, windows: +windows, attached: +attached, activity: +activity, created: +created };
    });
  } catch (err) {
    // No tmux server running means no sessions.
    if (/no server running|error connecting/i.test(err.stderr || '')) return [];
    throw err;
  }
}

// ---------- HTTP ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));

app.use(async (req, res, next) => {
  try {
    const { email, account } = await authenticate(req);
    req.email = email;
    req.account = account;
    next();
  } catch (err) {
    console.warn(`auth rejected ${req.method} ${req.path}: ${err.message}`);
    if (!req.path.startsWith('/api/') && req.accepts(['json', 'html']) === 'html') res.status(401).type('html').send(rejectionPage(err));
    else res.status(401).send('Unauthorized');
  }
});

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' wss: ws:; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
  });
  // State-changing requests must come from this site.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  }
  next();
});

app.get('/api/me', (req, res) => res.json({
  email: req.email, user: req.account.name, local: AUTH_DISABLED,
  twofa: !TOTP_REQUIRED ? 'off' : totpPassed(req, req.email) ? 'ok' : totpSecret(req.email) ? 'needed' : 'not-enrolled',
}));

app.post('/api/2fa', (req, res) => {
  const result = totpCheck(req.email, String(req.body?.code || '').replace(/\s/g, ''));
  if (result.status !== 200) {
    console.warn(`2fa rejected for ${req.email}: ${result.error}`);
    return res.status(result.status).json({ error: result.error });
  }
  console.log(`2fa ok for ${req.email}`);
  res.set('Set-Cookie', `${TOTP_COOKIE}=${result.cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TOTP_SESSION_HOURS * 3600}` +
    (AUTH_DISABLED ? '' : '; Secure'));
  res.status(204).end();
});

// Everything else under /api needs the second step (the page and its assets don't).
app.use('/api', (req, res, next) => {
  if (totpPassed(req, req.email)) return next();
  res.status(403).json({ error: 'Two-step code required', twofa: true });
});

app.get('/api/sessions', async (req, res) => {
  try { res.json(await listSessions(req.account)); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sessions', async (req, res) => {
  const { account } = req;
  const name = String(req.body?.name || '');
  if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Name must be 1-32 chars: letters, digits, _ or -' });
  if ((await listSessions(account)).some((s) => s.name === name)) return res.status(409).json({ error: 'Session already exists' });
  try {
    await tmux(account, ['new-session', '-d', '-s', name, '-c', account.home]);
    res.status(201).json({ name });
  } catch (err) { res.status(500).json({ error: err.stderr || err.message }); }
});

app.post('/api/sessions/:name/rename', async (req, res) => {
  const { name } = req.params;
  const newName = String(req.body?.name || '');
  if (!NAME_RE.test(name) || !NAME_RE.test(newName)) return res.status(400).json({ error: 'Invalid name' });
  try {
    await tmux(req.account, ['rename-session', '-t', `=${name}`, newName]);
    res.json({ name: newName });
  } catch (err) { res.status(500).json({ error: err.stderr || err.message }); }
});

app.delete('/api/sessions/:name', async (req, res) => {
  const { name } = req.params;
  if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Invalid name' });
  try {
    await tmux(req.account, ['kill-session', '-t', `=${name}`]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.stderr || err.message }); }
});

// Keep the no-store header set above, so a deploy is picked up on the next page load.
const staticOpts = { cacheControl: false, etag: false, lastModified: false };
const xtermDir = path.join(__dirname, 'node_modules', '@xterm');
app.use('/vendor/xterm', express.static(path.join(xtermDir, 'xterm'), staticOpts));
app.use('/vendor/addon-fit', express.static(path.join(xtermDir, 'addon-fit'), staticOpts));
app.use('/vendor/addon-web-links', express.static(path.join(xtermDir, 'addon-web-links'), staticOpts));
app.use('/vendor/addon-clipboard', express.static(path.join(xtermDir, 'addon-clipboard'), staticOpts));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));

// ---------- WebSocket terminal ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  const reject = (code, msg) => {
    socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return reject(404, 'Not Found');

  // Same-origin only: blocks cross-site WebSocket hijacking using the Access cookie.
  if (!sameOrigin(req)) return reject(403, 'Forbidden');

  let identity;
  try { identity = await authenticate(req); } catch (err) {
    console.warn(`ws auth rejected: ${err.message}`);
    return reject(401, 'Unauthorized');
  }
  if (!totpPassed(req, identity.email)) return reject(403, 'Forbidden');
  const name = url.searchParams.get('session') || '';
  if (!NAME_RE.test(name)) return reject(400, 'Bad Request');

  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, name, identity, url));
});

function attach(ws, name, { email, account }, url) {
  const cols = Math.min(Math.max(+url.searchParams.get('cols') || 80, 10), 500);
  const rows = Math.min(Math.max(+url.searchParams.get('rows') || 24, 5), 200);

  // -A attaches if the session exists, otherwise creates it.
  let args = ['new-session', '-A', '-s', name, '-c', account.home];
  // Mark this client as clipboard-capable so tmux copies reach the browser as OSC 52.
  if (TMUX_CLIPBOARD) args = ['-T', 'clipboard', ...args, ';', 'set', '-s', 'set-clipboard', 'on'];
  const cmd = tmuxCommand(account, args);
  const term = pty.spawn(cmd.file, cmd.args, { name: 'xterm-256color', cols, rows, cwd: cmd.cwd, env: cmd.env });
  console.log(`attach ${account.name}/${name} by ${email} (pid ${term.pid})`);

  term.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
  term.onExit(({ exitCode }) => {
    console.log(`client exit ${account.name}/${name} code=${exitCode}`);
    if (ws.readyState === ws.OPEN) ws.close(1000, 'session ended');
  });

  ws.on('message', (msg, isBinary) => {
    if (isBinary) return term.write(msg.toString());
    const text = msg.toString();
    // Control messages are JSON prefixed with \x00; everything else is keyboard input.
    if (text.startsWith('\x00')) {
      try {
        const ctl = JSON.parse(text.slice(1));
        if (ctl.type === 'resize') {
          term.resize(Math.min(Math.max(ctl.cols | 0, 10), 500), Math.min(Math.max(ctl.rows | 0, 5), 200));
        }
      } catch { /* ignore malformed control message */ }
      return;
    }
    term.write(text);
  });

  // Closing the tab kills only the attached client; the tmux session keeps running.
  ws.on('close', (code) => {
    console.log(`detach ${account.name}/${name} by ${email} (ws ${code})`);
    try { term.kill(); } catch { /* already gone */ }
  });

  const ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, 30000);
  ws.on('close', () => clearInterval(ping));
}

server.listen(PORT, HOST, () => {
  const ids = [...IDENTITIES].map(([e, u]) => `${e}→${u}`).join(', ');
  console.log(`cloudflare-tmux listening on http://${HOST}:${PORT} as ${IS_ROOT ? 'root (multi-user)' : os.userInfo().username}` +
    (AUTH_DISABLED ? ' (ACCESS CHECK DISABLED, acting as current user)' : `; identities: ${ids}`) +
    (TOTP_REQUIRED ? `; two-step codes required (${TOTP_FILE})` : ''));
});
