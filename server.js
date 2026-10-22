'use strict';

// cloudflare-tmux: persistent tmux sessions in the browser.
// tmux keeps sessions alive; closing a tab only detaches.
// Login is Cloudflare Access (Google); the Access JWT is verified here too, and each allowed
// email is mapped to exactly one Linux account (IDENTITIES). Run as root to serve several
// accounts; each user's tmux runs with their own uid/gid.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile, execFileSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { createRemoteJWKSet, jwtVerify } = require('jose');

loadEnvFile(path.join(__dirname, '.env'));

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

if (IS_ROOT && AUTH_DISABLED) fail('AUTH_DISABLED is for local dev and refused when running as root.');
if (!AUTH_DISABLED && (!TEAM_DOMAIN || !ACCESS_AUD || IDENTITIES.size === 0)) {
  fail('Set CF_TEAM_DOMAIN, CF_ACCESS_AUD and IDENTITIES (or AUTH_DISABLED=1 for local testing).');
}

const jwks = AUTH_DISABLED ? null : createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));

// tmux >= 3.2 can send copies to the browser clipboard (OSC 52) via `-T clipboard`.
const TMUX_CLIPBOARD = (() => {
  try {
    const m = execFileSync('tmux', ['-V'], { timeout: 5000 }).toString().match(/(\d+)\.(\d+)/);
    return !!m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 2));
  } catch { return false; }
})();
if (!TMUX_CLIPBOARD) console.warn('tmux < 3.2: copying from tmux to the browser clipboard is disabled');

function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
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
  if (!user) throw new Error(`email not mapped: ${email}`);
  const account = await lookupUser(user);
  if (!account) throw new Error(`${email}: Linux user ${user} does not exist`);
  if (account.uid === 0) throw new Error(`${email}: refusing uid 0`);
  if (/(nologin|false)$/.test(account.shell)) throw new Error(`${email}: ${user} has no login shell`);
  if (!IS_ROOT && account.uid !== process.getuid()) {
    throw new Error(`${email}: mapped to ${user}, but the server runs as ${os.userInfo().username} (install as root for other users)`);
  }
  return { email, account };
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
    res.status(401).send('Unauthorized');
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
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Bad origin' });
  }
  next();
});

app.get('/api/me', (req, res) => res.json({ email: req.email, user: req.account.name, local: AUTH_DISABLED }));

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
  const origin = req.headers.origin;
  if (!origin || new URL(origin).host !== req.headers.host) return reject(403, 'Forbidden');

  let identity;
  try { identity = await authenticate(req); } catch (err) {
    console.warn(`ws auth rejected: ${err.message}`);
    return reject(401, 'Unauthorized');
  }
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
    (AUTH_DISABLED ? ' (ACCESS CHECK DISABLED, acting as current user)' : `; identities: ${ids}`));
});
