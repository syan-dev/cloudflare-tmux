'use strict';

// Hash routes: "#/" = session dashboard, "#/s/<name>" = terminal attached to that tmux session.

const $ = (id) => document.getElementById(id);
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

let term = null;
let fit = null;
let ws = null;
let currentSession = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let ctrlArmed = false;
let me = { email: '', user: '' };

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/api/2fa') { location.reload(); throw new Error('Session expired, re-authenticating'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.twofa) { me.twofa = 'needed'; route(); }
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

function showError(msg) {
  $('error').textContent = msg || '';
  $('error').hidden = !msg;
}

function timeAgo(epochSec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- identity ----------

function renderMe() {
  const el = $('me');
  el.replaceChildren();
  const u = document.createElement('span');
  u.className = 'me-user';
  u.textContent = me.user;
  el.append(u, ` · ${me.email}`);
}

// ---------- dashboard ----------

async function renderDashboard() {
  showError('');
  let sessions;
  try { sessions = await api('GET', '/api/sessions'); } catch (err) { return showError(err.message); }
  sessions.sort((a, b) => b.activity - a.activity);
  const list = $('sessions');
  list.replaceChildren();
  $('empty').hidden = sessions.length > 0;
  for (const s of sessions) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    const dot = document.createElement('span');
    dot.className = 'dot' + (s.attached ? ' on' : '');
    dot.title = s.attached ? `${s.attached} client(s) attached` : 'detached';
    name.append(dot, s.name);
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `${s.windows} window${s.windows === 1 ? '' : 's'} · active ${timeAgo(s.activity)}`;
    info.append(name, meta);

    const open = document.createElement('a');
    open.className = 'btn primary';
    open.href = `#/s/${encodeURIComponent(s.name)}`;
    open.textContent = 'Open';

    const rename = document.createElement('button');
    rename.textContent = 'Rename';
    rename.onclick = async () => {
      const newName = prompt('New name', s.name);
      if (!newName || newName === s.name) return;
      if (!NAME_RE.test(newName)) return showError('Name must be 1-32 chars: letters, digits, _ or -');
      try { await api('POST', `/api/sessions/${encodeURIComponent(s.name)}/rename`, { name: newName }); renderDashboard(); }
      catch (err) { showError(err.message); }
    };

    const kill = document.createElement('button');
    kill.className = 'danger';
    kill.textContent = 'Kill';
    kill.onclick = async () => {
      if (!confirm(`Kill session "${s.name}"? Running programs in it will be terminated.`)) return;
      try { await api('DELETE', `/api/sessions/${encodeURIComponent(s.name)}`); renderDashboard(); }
      catch (err) { showError(err.message); }
    };

    li.append(info, open, rename, kill);
    list.append(li);
  }
}

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('new-name').value.trim();
  if (!NAME_RE.test(name)) return showError('Name must be 1-32 chars: letters, digits, _ or -');
  try {
    await api('POST', '/api/sessions', { name });
    $('new-name').value = '';
    location.hash = `#/s/${encodeURIComponent(name)}`;
  } catch (err) { showError(err.message); }
});

// ---------- terminal ----------

function setStatus(text, cls) {
  $('status').textContent = text;
  $('status').className = 'status ' + (cls || '');
}

function sendControl(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send('\x00' + JSON.stringify(obj));
}

function sendInput(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
}

// Ctrl+Shift+C / Cmd+C copy the selection; Ctrl+Shift+V pastes. Plain Ctrl+C stays ^C.
function clipboardKeys(e) {
  if (e.type !== 'keydown') return true;
  const key = e.key.toLowerCase();
  const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
  if ((ctrlShift || (e.metaKey && !e.ctrlKey)) && key === 'c') {
    if (term.hasSelection()) {
      navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
    }
    // Keep Ctrl+Shift+C from opening DevTools.
    if (ctrlShift) e.preventDefault();
    return false;
  }
  // Let the browser fire a paste event, which xterm handles.
  if (ctrlShift && key === 'v') return false;
  return true;
}

function ensureTerminal() {
  if (term) return;
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: window.matchMedia('(pointer: coarse)').matches ? 13 : 14,
    scrollback: 5000,
    theme: { background: '#000000' },
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  // OSC 52: tmux (and vim, etc.) can write to the browser clipboard, but never read it.
  // Any selection counts: tmux < 3.3 sends an empty one, which the default provider ignores.
  term.loadAddon(new ClipboardAddon.ClipboardAddon(undefined, {
    readText: () => '',
    writeText: (_sel, text) => navigator.clipboard?.writeText(text).catch(() => {}),
  }));
  term.attachCustomKeyEventHandler(clipboardKeys);
  term.open($('terminal'));
  term.onData((data) => {
    if (ctrlArmed && data.length === 1) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
      setCtrl(false);
    }
    sendInput(data);
  });
  term.onResize(({ cols, rows }) => sendControl({ type: 'resize', cols, rows }));
  window.addEventListener('resize', () => { if (currentSession) fit.fit(); });
}

function connect(name) {
  clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); }
  fit.fit();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?session=${encodeURIComponent(name)}&cols=${term.cols}&rows=${term.rows}`;
  setStatus('connecting…');
  ws = new WebSocket(url);
  ws.onopen = () => {
    reconnectDelay = 1000;
    setStatus('connected', 'ok');
    term.focus();
  };
  ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
  ws.onclose = (ev) => {
    if (currentSession !== name) return;
    if (ev.reason === 'session ended') {
      setStatus('session ended', 'bad');
      term.write('\r\n\x1b[90m[session ended — returning to sessions]\x1b[0m\r\n');
      setTimeout(() => { if (currentSession === name) location.hash = '#/'; }, 1500);
      return;
    }
    setStatus(`disconnected, retrying in ${Math.round(reconnectDelay / 1000)}s`, 'bad');
    reconnectTimer = setTimeout(async () => {
      // A 401 on the upgrade means the Access session expired: reload to log in again.
      // An expired two-step session also refuses the upgrade: ask for a code again.
      try { me = await api('GET', '/api/me'); } catch { return; }
      if (me.twofa === 'needed' || me.twofa === 'not-enrolled') return route();
      if (currentSession === name) connect(name);
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };
}

function openSession(name) {
  currentSession = name;
  document.title = `${name} · cloudflare-tmux`;
  $('term-name').textContent = name;
  ensureTerminal();
  term.reset();
  showFiles(isWide() && store.get('files-open') === '1', false);
  connect(name);
}

function closeSession() {
  currentSession = null;
  clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  document.title = 'cloudflare-tmux';
}

// ---------- mobile extra keys ----------

const KEYS = {
  esc: '\x1b', tab: '\t', prefix: '\x02',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
};

function setCtrl(on) {
  ctrlArmed = on;
  $('ctrl-btn').classList.toggle('active', on);
}

$('keys').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  e.preventDefault();
  if (btn.dataset.mod === 'ctrl') setCtrl(!ctrlArmed);
  else if (btn.dataset.key) sendInput(KEYS[btn.dataset.key] ?? btn.dataset.key);
  term && term.focus();
});

// ---------- files panel ----------

// Browses the person's files, uploads by drop, paste or button, and downloads. Everything goes through
// /api/files, which the server runs as the same Linux user as the terminal.

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const files = { dir: null, home: null, hidden: store.get('files-hidden') === '1' };
const isWide = () => window.matchMedia('(min-width: 721px)').matches;

function filesVisible() { return !$('files').hidden; }

function showFiles(on, remember = true) {
  $('files').hidden = !on;
  $('files-btn').classList.toggle('active', on);
  if (remember) store.set('files-open', on ? '1' : '0');
  if (fit && currentSession) fit.fit();
  if (on && !files.dir) loadFiles();
}

function filesError(msg) {
  $('files-error').textContent = msg || '';
  $('files-error').hidden = !msg;
}

async function loadFiles(dir) {
  filesError('');
  let data;
  try { data = await api('GET', '/api/files' + (dir ? `?path=${encodeURIComponent(dir)}` : '')); }
  catch (err) { return filesError(err.message); }
  files.dir = data.path;
  files.home = data.home;
  renderFiles(data.entries);
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} M`;
  return `${(n / 1024 ** 3).toFixed(1)} G`;
}

// Shows "~/sub/dir" with each segment clickable.
function renderPath() {
  const el = $('files-path');
  el.replaceChildren();
  const home = files.home.replace(/\/$/, '');
  const inHome = files.dir === home || files.dir.startsWith(home + '/');
  const base = inHome ? home : '';
  const rest = inHome ? files.dir.slice(home.length) : files.dir;
  const root = document.createElement('span');
  root.textContent = inHome ? '~' : '/';
  root.onclick = () => loadFiles(inHome ? home : '/');
  el.append(root);
  let acc = base;
  rest.split('/').filter(Boolean).forEach((seg, i) => {
    acc += '/' + seg;
    const target = acc;
    const span = document.createElement('span');
    span.textContent = seg;
    span.onclick = () => loadFiles(target);
    if (inHome || i > 0) el.append('/');
    el.append(span);
  });
  el.title = files.dir;
}

function renderFiles(entries) {
  renderPath();
  $('files-hidden').classList.toggle('active', files.hidden);
  const list = $('files-list');
  list.replaceChildren();
  const shown = entries.filter((e) => files.hidden || !e.name.startsWith('.'));
  shown.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1);
  for (const e of shown) {
    const full = files.dir.replace(/\/$/, '') + '/' + e.name;
    const li = document.createElement('li');
    let name;
    if (e.type === 'dir') {
      name = document.createElement('a');
      name.href = '#';
      name.textContent = e.name + '/';
      name.onclick = (ev) => { ev.preventDefault(); loadFiles(full); };
    } else if (e.type === 'file') {
      name = document.createElement('a');
      name.href = `/api/files/download?path=${encodeURIComponent(full)}`;
      name.download = e.name;
      name.title = `Download ${e.name}`;
      name.textContent = e.name;
    } else {
      name = document.createElement('span');
      name.textContent = e.name;
    }
    name.className = `fname ${e.type}`;
    const size = document.createElement('span');
    size.className = 'fsize';
    size.textContent = e.type === 'file' ? fmtSize(e.size) : '';
    const insert = document.createElement('button');
    insert.className = 'fact';
    insert.textContent = 'path';
    insert.title = 'Type this path into the terminal';
    insert.onclick = () => insertPath(full);
    li.append(name, size, insert);
    list.append(li);
  }
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Empty folder';
    list.append(li);
  }
}

// Quotes a path for the shell, as VS Code does when a file is dropped on its terminal.
function shellQuote(p) {
  return /^[A-Za-z0-9_/.,:@%+=-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`;
}

function insertPath(p) {
  if (!currentSession) return;
  sendInput(shellQuote(p) + ' ');
  if (!isWide()) showFiles(false);
  term.focus();
}

// Uploads one File into `dir`. Asks before replacing. Resolves with the saved path or null.
function uploadFile(file, dir, name) {
  const toast = showToast(`Uploading ${name}…`, { progress: true });
  const attempt = (overwrite) => new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const q = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}${overwrite ? '&overwrite=1' : ''}`;
    xhr.open('POST', `/api/files/upload?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) toast.progress(ev.loaded / ev.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status === 401) { location.reload(); return resolve(null); }
      if (data.twofa) { me.twofa = 'needed'; route(); return resolve(null); }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ status: 0, data: { error: 'Network error' } });
    xhr.send(file);
  });
  return (async () => {
    let r = await attempt(false);
    if (r && r.status === 409 && confirm(`${name} already exists in ${dir}. Replace it?`)) r = await attempt(true);
    if (!r) { toast.remove(); return null; }
    if (r.status !== 201) {
      toast.update(`${name}: ${r.data.error || `upload failed (${r.status})`}`, { bad: true, ttl: 8000 });
      return null;
    }
    toast.update(`Saved ${r.data.path}`, { ttl: 10000, action: ['Insert path', () => insertPath(r.data.path)] });
    if (files.dir === dir) loadFiles(dir);
    return r.data.path;
  })();
}

async function uploadAll(fileList) {
  const list = [...fileList].filter((f) => f.size > 0 || f.type);
  if (!list.length) return;
  if (!files.dir) await loadFiles();
  if (!files.dir) return;
  const dir = files.dir;
  if (isWide() && !filesVisible()) showFiles(true);
  for (const f of list) await uploadFile(f, dir, f.name);
}

function pastedName(type) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[type] || 'bin';
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `pasted-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

$('files-btn').onclick = () => showFiles(!filesVisible());
$('files-close').onclick = () => showFiles(false);
$('files-refresh').onclick = () => loadFiles(files.dir);
$('files-home').onclick = () => loadFiles();
$('files-up').onclick = () => { if (files.dir && files.dir !== '/') loadFiles(files.dir.replace(/\/[^/]+\/?$/, '') || '/'); };
$('files-hidden').onclick = () => {
  files.hidden = !files.hidden;
  store.set('files-hidden', files.hidden ? '1' : '0');
  loadFiles(files.dir);
};
$('files-upload').onclick = () => $('files-input').click();
$('files-input').onchange = () => { uploadAll($('files-input').files); $('files-input').value = ''; };

// Drag and drop anywhere on the terminal view. Folders can't be read by the browser and are skipped.
{
  const view = $('terminal-view');
  let depth = 0;
  const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  view.addEventListener('dragenter', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    if (depth++ === 0) {
      if (!files.dir) loadFiles();
      $('drop-dir').textContent = files.dir ? files.dir.replace(files.home, '~') : '~';
      $('drop').hidden = false;
    }
  });
  view.addEventListener('dragover', (ev) => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  view.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
  view.addEventListener('drop', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth = 0;
    $('drop').hidden = true;
    const items = [...(ev.dataTransfer.items || [])];
    const dropped = items.length ? items.filter((it) => it.kind === 'file' && !(it.webkitGetAsEntry?.()?.isDirectory)).map((it) => it.getAsFile()).filter(Boolean)
      : [...ev.dataTransfer.files];
    if (items.some((it) => it.webkitGetAsEntry?.()?.isDirectory)) showToast('Folders can\'t be uploaded. Drop files instead.', { bad: true, ttl: 6000 });
    uploadAll(dropped);
  });
}

// A pasted image (or file) in the terminal is uploaded; pasted text still goes to xterm.
$('terminal').addEventListener('paste', (ev) => {
  const items = [...(ev.clipboardData?.items || [])].filter((it) => it.kind === 'file');
  if (!items.length) return;
  ev.preventDefault();
  ev.stopPropagation();
  const list = items.map((it) => it.getAsFile()).filter(Boolean);
  (async () => {
    if (!files.dir) await loadFiles();
    if (!files.dir) return;
    const dir = files.dir;
    if (isWide() && !filesVisible()) showFiles(true);
    for (const f of list) await uploadFile(f, dir, f.name && f.name !== 'image.png' ? f.name : pastedName(f.type));
  })();
}, true);

// ---------- toasts ----------

function showToast(text, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (opts.bad ? ' bad' : '');
  const row = document.createElement('div');
  row.className = 't-row';
  const span = document.createElement('span');
  span.className = 't-text';
  span.textContent = text;
  const close = document.createElement('button');
  close.textContent = '✕';
  close.title = 'Dismiss';
  row.append(span, close);
  el.append(row);
  let bar = null;
  let timer = null;
  const t = {
    remove() { clearTimeout(timer); el.remove(); },
    progress(frac) { if (bar) bar.value = frac; },
    update(msg, o = {}) {
      span.textContent = msg;
      el.classList.toggle('bad', !!o.bad);
      if (bar) { bar.remove(); bar = null; }
      row.querySelectorAll('.t-action').forEach((b) => b.remove());
      if (o.action) {
        const b = document.createElement('button');
        b.className = 't-action';
        b.textContent = o.action[0];
        b.onclick = () => { o.action[1](); t.remove(); };
        row.insertBefore(b, close);
      }
      clearTimeout(timer);
      if (o.ttl) timer = setTimeout(t.remove, o.ttl);
    },
  };
  close.onclick = t.remove;
  if (opts.progress) { bar = document.createElement('progress'); bar.max = 1; bar.value = 0; el.append(bar); }
  if (opts.ttl) timer = setTimeout(t.remove, opts.ttl);
  $('toasts').append(el);
  return t;
}

// ---------- second step ----------

function showTwofa() {
  closeSession();
  showView('twofa');
  $('twofa-me').textContent = me.email;
  const enrolled = me.twofa !== 'not-enrolled';
  $('twofa-form').hidden = !enrolled;
  $('twofa-error').hidden = enrolled;
  if (!enrolled) $('twofa-error').textContent = `No authenticator is set up for ${me.email}. Ask the admin to run: scripts/totp.js add ${me.email}`;
  else $('twofa-code').focus();
}

$('twofa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('twofa-error').hidden = true;
  try {
    await api('POST', '/api/2fa', { code: $('twofa-code').value });
    $('twofa-code').value = '';
    me.twofa = 'ok';
    route();
  } catch (err) {
    $('twofa-error').textContent = err.message;
    $('twofa-error').hidden = false;
    $('twofa-code').select();
  }
});

// ---------- routing ----------

function showView(id) {
  for (const v of ['dashboard', 'terminal-view', 'twofa']) $(v).hidden = v !== id;
}

function route() {
  if (me.twofa === 'needed' || me.twofa === 'not-enrolled') return showTwofa();
  renderMe();
  $('logout-btn').hidden = !!me.local;
  const m = location.hash.match(/^#\/s\/(.+)$/);
  const name = m ? decodeURIComponent(m[1]) : null;
  if (name && NAME_RE.test(name)) {
    showView('terminal-view');
    if (currentSession !== name) openSession(name);
  } else {
    closeSession();
    showView('dashboard');
    renderDashboard();
  }
}

window.addEventListener('hashchange', route);
api('GET', '/api/me').then((r) => { me = r; route(); }).catch((err) => { showView('dashboard'); showError(err.message); });
