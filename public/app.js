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
  const u = document.createElement('b');
  u.textContent = me.user;
  el.append(u, ` · ${me.email}`);
  $('term-logout').title = `Log out ${me.user} · ${me.email}`;
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

// A dot beside the session name. Only trouble gets words: "connected" is the normal state.
function setStatus(text, cls) {
  $('status').textContent = cls === 'ok' ? '' : text;
  $('status').title = text;
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
    // VS Code's Dark Modern terminal colors.
    theme: {
      background: '#1f1f1f', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78',
      black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
      brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
    },
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
  files.dir = null; // the panel opens where this session's terminal is working
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

// An explorer like VS Code's: a tree of the person's files, uploads and downloads. Everything goes through
// /api/files, which the server runs as the same Linux user as the terminal. A drop or a pasted image on the
// terminal uploads the file and types its path; a drop on the explorer only uploads, into the folder under the
// pointer. Rows rename inline, move by drag, and have a context menu.

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const files = { dir: null, home: null, hidden: store.get('files-hidden') === '1', open: new Set(), kids: new Map(), sel: null };
const isWide = () => window.matchMedia('(min-width: 721px)').matches;
const FILENAME_RE = /^[^/\0]{1,255}$/;
const SVG = 'http://www.w3.org/2000/svg';

// An <svg><use> of one of the icons defined in index.html.
function icon(id, size = 16) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', `#i-${id}`);
  s.append(u);
  return s;
}

function iconButton(id, title, fn) {
  const b = document.createElement('button');
  b.className = 'icon';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(icon(id));
  b.onclick = (ev) => { ev.stopPropagation(); fn(b); };
  return b;
}

function filesVisible() { return !$('files').hidden; }

function showFiles(on, remember = true) {
  $('files').hidden = !on;
  $('files-btn').classList.toggle('active', on);
  $('files-btn').setAttribute('aria-pressed', String(on));
  $('sash').hidden = !on;
  if (on && isWide()) setSideWidth(Number(store.get('files-width')) || SIDE_DEFAULT);
  if (remember) store.set('files-open', on ? '1' : '0');
  if (fit && currentSession) fit.fit();
  if (on && !files.dir) loadTerminalDir();
}

function filesError(msg) {
  $('files-error').textContent = msg || '';
  $('files-error').hidden = !msg;
}

const join = (dir, name) => dir.replace(/\/$/, '') + '/' + name;
const parentOf = (p) => p.replace(/\/[^/]+\/?$/, '') || '/';

// Lists one folder. Resolves its entries, or null after showing the error.
async function listDir(dir) {
  try { return (await api('GET', `/api/files?path=${encodeURIComponent(dir)}`)).entries; }
  catch (err) { filesError(err.message); return null; }
}

// Makes `dir` the root of the tree, or home when null. Resolves true when it loaded.
async function loadFiles(dir) {
  filesError('');
  let data;
  try { data = await api('GET', '/api/files' + (dir ? `?path=${encodeURIComponent(dir)}` : '')); }
  catch (err) { filesError(err.message); return false; }
  files.dir = data.path;
  files.home = data.home;
  files.open = new Set();
  files.kids = new Map([[data.path, data.entries]]);
  files.sel = null;
  renderFiles();
  return true;
}

// Re-reads the root and every open folder, keeping the tree as it is.
async function refreshFiles() {
  if (!files.dir) return;
  filesError('');
  await Promise.all([files.dir, ...files.open].map(async (d) => {
    const entries = await listDir(d);
    if (entries) files.kids.set(d, entries);
    else { files.open.delete(d); files.kids.delete(d); }
  }));
  renderFiles();
}

// Expands or collapses a folder in the tree, listing it the first time.
async function toggleDir(dir, open = !files.open.has(dir)) {
  if (!open) { files.open.delete(dir); renderFiles(); return; }
  files.open.add(dir);
  if (!files.kids.has(dir)) {
    renderFiles();
    const entries = await listDir(dir);
    if (entries) files.kids.set(dir, entries);
    else files.open.delete(dir);
  }
  renderFiles();
}

// Opens the folder the terminal is working in, like VS Code's explorer. Falls back to home.
async function loadTerminalDir() {
  let dir = null;
  if (currentSession) {
    try { dir = (await api('GET', `/api/sessions/${encodeURIComponent(currentSession)}/cwd`)).path; } catch { /* home */ }
  }
  if (!dir || !(await loadFiles(dir))) await loadFiles(null);
}

// Where a drop or paste on the terminal goes: the tree's root, loading it first if the panel was never opened.
async function uploadDir() {
  if (!files.dir) await loadTerminalDir();
  return files.dir;
}

// Where a panel action works: the selected folder, the selected file's folder, or the root. As in VS Code.
function contextDir() {
  if (!files.sel) return files.dir;
  return files.sel.type === 'dir' ? files.sel.path : parentOf(files.sel.path);
}

// "~/sub/dir" for paths under home.
function prettyPath(p) {
  const home = (files.home || '').replace(/\/$/, '');
  return home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p;
}

// A typed path: absolute, ~-relative, or relative to the tree's root.
function expandPath(typed) {
  const t = typed.trim();
  if (!t) return null;
  const p = t.startsWith('/') ? t : t === '~' || t.startsWith('~/') ? files.home.replace(/\/$/, '') + t.slice(1) : join(files.dir, t);
  return p.replace(/\/+$/, '') || '/';
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} M`;
  return `${(n / 1024 ** 3).toFixed(1)} G`;
}

// The root's path as crumbs, each clickable and a drop target; the last one bold, as VS Code names its root.
function renderPath() {
  const el = $('files-path');
  el.replaceChildren();
  const home = files.home.replace(/\/$/, '');
  const inHome = files.dir === home || files.dir.startsWith(home + '/');
  const rest = inHome ? files.dir.slice(home.length) : files.dir;
  const segs = rest.split('/').filter(Boolean);
  const crumb = (text, dir) => {
    const span = document.createElement('span');
    span.textContent = text;
    span.dataset.dir = dir;
    span.onclick = () => loadFiles(dir);
    return span;
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '/'; return s; };
  el.append(crumb(inHome ? '~' : '/', inHome ? home : '/'));
  let acc = inHome ? home : '';
  segs.forEach((seg, i) => {
    acc += '/' + seg;
    if (inHome || i > 0) el.append(sep());
    el.append(crumb(seg, acc));
  });
  el.lastChild.classList.add('last');
  el.title = files.dir;
  const up = $('files-up');
  if (files.dir === '/') delete up.dataset.dir;
  else up.dataset.dir = parentOf(files.dir);
}

// Icon and color class for an entry, in the spirit of VS Code's file icons.
function iconFor(e) {
  if (e.type === 'dir') return ['folder', 'dir'];
  if (e.type !== 'file') return ['symlink', 'other'];
  const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : '';
  if (/^(png|jpe?g|gif|webp|svg|bmp|ico|heic|avif)$/.test(ext)) return ['image', 'img'];
  if (/^(m?js|cjs|ts|jsx|tsx|json)$/.test(ext)) return ['file', ext === 'json' ? 'json' : 'js'];
  if (/^(md|txt|rst|csv)$/.test(ext)) return ['file', 'md'];
  if (/^(sh|bash|zsh|py|rb|go|rs|c|h|cpp)$/.test(ext)) return ['file', 'sh'];
  return ['file', ''];
}

function select(e, full) {
  files.sel = e ? { type: e.type, path: full, name: e.name } : null;
  for (const li of $('files-list').children) li.classList.toggle('sel', !!e && li.dataset.path === full);
}

function download(full, name) {
  const a = document.createElement('a');
  a.href = `/api/files/download?path=${encodeURIComponent(full)}`;
  a.download = name;
  a.click();
}

// Draws the tree: the root's entries, with every open folder's entries indented under it.
function renderFiles() {
  renderPath();
  const list = $('files-list');
  list.replaceChildren();
  const note = (text, depth, cls) => {
    const li = document.createElement('li');
    li.className = cls;
    li.style.paddingLeft = `${26 + depth * 12}px`;
    li.textContent = text;
    list.append(li);
  };
  const add = (dir, depth) => {
    const entries = files.kids.get(dir);
    if (!entries) return note('Loading…', depth, 'loading');
    const shown = entries.filter((e) => files.hidden || !e.name.startsWith('.'));
    shown.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1);
    if (!shown.length) return note('Empty folder', depth, 'empty');
    for (const e of shown) {
      const full = join(dir, e.name);
      const open = e.type === 'dir' && files.open.has(full);
      const li = document.createElement('li');
      li.style.paddingLeft = `${4 + depth * 12}px`;
      // Indent guides: a faint line per level, tying nested rows to their folder, as in VS Code.
      for (let d = 0; d < depth; d++) {
        const g = document.createElement('span');
        g.className = 'guide';
        g.style.left = `${12 + d * 12}px`;
        li.append(g);
      }
      li.dataset.path = full;
      li.entry = e;
      if (e.type === 'dir') li.dataset.dir = full;
      if (files.sel?.path === full) li.classList.add('sel');
      const twist = document.createElement('span');
      twist.className = 'twist';
      if (e.type === 'dir') twist.append(icon(open ? 'chev-down' : 'chev-right'));
      const [ic, cls] = iconFor(e);
      const fi = document.createElement('span');
      fi.className = `ficon ${cls}`;
      fi.append(icon(open ? 'folder-open' : ic));
      const name = document.createElement('span');
      name.className = `fname ${e.type}`;
      name.textContent = e.name;
      name.title = full;
      const size = document.createElement('span');
      size.className = 'fsize';
      size.textContent = e.type === 'file' ? fmtSize(e.size) : '';
      const acts = document.createElement('span');
      acts.className = 'acts';
      acts.append(
        iconButton('terminal', 'Type this path into the terminal', () => insertPath(full)),
        iconButton('more', 'Rename, move, delete…', (b) => { select(e, full); const r = b.getBoundingClientRect(); showMenu(r.right, r.bottom + 2, rowMenu(li, e, full), { right: true, title: e.name }); }),
      );
      li.append(twist, fi, name, size, acts);
      li.onclick = () => { select(e, full); if (e.type === 'dir') toggleDir(full); };
      li.ondblclick = () => { if (e.type === 'file') download(full, e.name); };
      li.oncontextmenu = (ev) => { ev.preventDefault(); select(e, full); showMenu(ev.clientX, ev.clientY, rowMenu(li, e, full), { title: e.name }); };
      // Dragging a row onto the terminal types its path; onto a folder in the panel moves it, as in VS Code.
      li.draggable = true;
      li.ondragstart = (ev) => {
        ev.dataTransfer.setData('text/plain', shellQuote(full) + ' ');
        ev.dataTransfer.setData(MOVE_TYPE, JSON.stringify({ path: full, name: e.name }));
        ev.dataTransfer.effectAllowed = 'copyMove';
      };
      list.append(li);
      if (open) add(full, depth + 1);
    }
  };
  add(files.dir, 0);
}

// Keyboard in the tree, as in VS Code: arrows move and fold, Enter opens, F2 renames, Delete deletes.
$('files-list').addEventListener('keydown', (ev) => {
  const rows = [...$('files-list').querySelectorAll('li[data-path]')];
  if (!rows.length) return;
  const i = rows.findIndex((li) => li.dataset.path === files.sel?.path);
  const li = rows[i];
  const e = li?.entry;
  const full = li?.dataset.path;
  const go = (n) => { const r = rows[Math.max(0, Math.min(rows.length - 1, n))]; select(r.entry, r.dataset.path); r.scrollIntoView({ block: 'nearest' }); };
  const keys = {
    ArrowDown: () => go(i + 1),
    ArrowUp: () => go(i < 0 ? 0 : i - 1),
    Home: () => go(0),
    End: () => go(rows.length - 1),
    ArrowRight: () => { if (e?.type === 'dir') { if (files.open.has(full)) go(i + 1); else toggleDir(full, true); } },
    ArrowLeft: () => {
      if (e?.type === 'dir' && files.open.has(full)) return toggleDir(full, false);
      const p = full && parentOf(full);
      const up = rows.findIndex((r) => r.dataset.path === p);
      if (up >= 0) go(up);
    },
    Enter: () => { if (e?.type === 'dir') toggleDir(full); else if (e?.type === 'file') download(full, e.name); },
    F2: () => { if (li) startRename(li, e, full); },
    Delete: () => { if (li) deleteEntry(e, full); },
    Escape: () => select(null),
  };
  const fn = keys[ev.key];
  if (!fn) return;
  ev.preventDefault();
  fn();
});

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

// ---- rename, move, delete ----

const MOVE_TYPE = 'application/x-cloudflare-tmux-path';

function renamePath(from, to) {
  return api('POST', `/api/files/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

// The row's name becomes an input, as in VS Code. Enter saves, Escape or an empty name cancels.
function startRename(li, e, full) {
  const nameEl = li.querySelector('.fname');
  const input = document.createElement('input');
  input.className = 'frename';
  input.value = e.name;
  nameEl.replaceWith(input);
  input.focus();
  const dot = e.type === 'file' ? e.name.lastIndexOf('.') : -1;
  input.setSelectionRange(0, dot > 0 ? dot : e.name.length);
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    input.replaceWith(nameEl);
    if (!commit || !name || name === e.name) return;
    if (!FILENAME_RE.test(name) || name === '.' || name === '..') return filesError('A name can\'t contain /');
    try { await renamePath(full, join(parentOf(full), name)); refreshFiles(); }
    catch (err) { filesError(err.message); }
  };
  input.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

// Moves `full` into `destDir`, with Undo in the corner instead of a confirmation.
async function movePath(full, name, destDir) {
  const to = join(destDir, name);
  if (to === full || destDir === full || destDir.startsWith(full + '/')) return;
  try { await renamePath(full, to); } catch (err) { return showToast(`${name}: ${err.message}`, { bad: true, ttl: 8000 }); }
  if (files.sel?.path === full) files.sel = null;
  refreshFiles();
  showToast(`Moved ${name} to ${prettyPath(destDir)}`, { ttl: 10000, actions: [['Undo', async () => {
    try { await renamePath(to, full); refreshFiles(); } catch (err) { showToast(`${name}: ${err.message}`, { bad: true, ttl: 8000 }); }
  }]] });
}

// "Move to…" for phones and for far-away folders: a path, absolute, ~-relative or relative to the panel's folder.
function moveTo(full, name) {
  const dest = expandPath(prompt(`Move ${name} to folder`, prettyPath(files.dir)) || '');
  if (dest) movePath(full, name, dest);
}

async function deleteEntry(e, full) {
  const ok = await confirmDialog({
    title: e.type === 'dir' ? `Delete the folder '${e.name}' and everything in it?` : `Delete '${e.name}'?`,
    detail: `${prettyPath(full)}\nThis can't be undone. There is no trash on the server.`,
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try { await api('DELETE', `/api/files?path=${encodeURIComponent(full)}`); if (files.sel?.path === full) files.sel = null; refreshFiles(); }
  catch (err) { filesError(err.message); }
}

function rowMenu(li, e, full) {
  const items = [];
  if (e.type === 'dir') items.push(['Open as root', () => loadFiles(full)], ['New folder inside…', () => newFolder(full)]);
  else if (e.type === 'file') items.push(['Download', () => download(full, e.name), '', 'Enter']);
  items.push(['Insert path into terminal', () => insertPath(full)]);
  items.push(['Copy path', () => navigator.clipboard?.writeText(full).catch(() => showToast('Clipboard access was refused.', { bad: true, ttl: 6000 }))]);
  items.push(null);
  items.push(['Rename…', () => startRename(li, e, full), '', 'F2']);
  items.push(['Move to…', () => moveTo(full, e.name)]);
  items.push(['Delete', () => deleteEntry(e, full), 'danger', 'Delete']);
  return items;
}

async function newFolder(dir) {
  const name = (prompt('New folder name') || '').trim();
  if (!name) return;
  if (!FILENAME_RE.test(name) || name === '.' || name === '..') return filesError('A folder name can\'t contain /');
  try { await api('POST', `/api/files/mkdir?path=${encodeURIComponent(join(dir, name))}`); }
  catch (err) { return filesError(err.message); }
  if (dir !== files.dir) files.open.add(dir);
  refreshFiles();
}

function headerMenu() {
  return [
    ['Show hidden files', () => { files.hidden = !files.hidden; store.set('files-hidden', files.hidden ? '1' : '0'); renderFiles(); }, files.hidden ? 'checked' : ''],
    ['Collapse folders', () => { files.open.clear(); renderFiles(); }],
    null,
    ['Home folder', () => loadFiles(null)],
    ['The terminal\'s folder', () => loadTerminalDir()],
    ['Open folder…', () => { const p = expandPath(prompt('Folder path', prettyPath(files.dir)) || ''); if (p) loadFiles(p); }],
  ];
}

// A small menu at a point, or a bottom sheet on a phone, where 26 px rows are too small to tap.
// Items are [label, fn, class, shortcut] or null for a separator; `title` heads the sheet.
let menu = null;
const isTouch = () => window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
function closeMenu() { if (menu) { menu.backdrop?.remove(); menu.remove(); menu = null; } }
function showMenu(x, y, items, { right = false, title = '' } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  if (isTouch()) {
    el.classList.add('sheet');
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    document.body.append(backdrop);
    el.backdrop = backdrop;
    const grip = document.createElement('div');
    grip.className = 'grip';
    el.append(grip);
    if (title) { const h = document.createElement('div'); h.className = 'sheet-title'; h.textContent = title; el.append(h); }
    items = items.map((it) => it && [it[0].replace(/…$/, ''), it[1], it[2]]); // no shortcuts on a phone
  }
  for (const it of items) {
    if (!it) { el.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.textContent = it[0];
    if (it[2]) b.className = it[2];
    if (it[3]) { const k = document.createElement('span'); k.className = 'kbd'; k.textContent = it[3]; b.append(k); }
    b.onclick = () => { closeMenu(); it[1](); };
    el.append(b);
  }
  document.body.append(el);
  menu = el;
  if (el.classList.contains('sheet')) return;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(right ? x - r.width : x, innerWidth - r.width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  menu = el;
}
document.addEventListener('pointerdown', (ev) => { if (menu && !menu.contains(ev.target)) closeMenu(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); }, true);

// One upload request. Resolves { status, data }, or null when aborted or when the page has to re-authenticate.
function sendFile(file, dir, name, overwrite, onProgress, handle) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const q = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}${overwrite ? '&overwrite=1' : ''}`;
    xhr.open('POST', `/api/files/upload?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status === 401) { location.reload(); return resolve(null); }
      if (data.twofa) { me.twofa = 'needed'; route(); return resolve(null); }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ status: 0, data: { error: 'Network error' } });
    xhr.onabort = () => resolve(null);
    handle.abort = () => xhr.abort();
    xhr.send(file);
  });
}

// "name (2).ext", as file managers name a second copy.
function numbered(name, n) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

// Uploads a batch of { file, rel } into `dir` (the panel's folder when not given). `rel` is the name, or a
// path inside a dropped folder; { dir: rel } makes an empty folder. One toast shows progress and the result.
// `insert` types each saved path into the terminal, as VS Code does for a drop on its terminal.
async function uploadAll(items, { dir, insert = false } = {}) {
  if (!items.length) return;
  dir = dir || await uploadDir();
  if (!dir) return;
  if (isWide() && !filesVisible()) showFiles(true);
  const total = items.reduce((n, it) => n + (it.file?.size || 0), 0) || 1;
  const many = items.length > 1;
  const handle = {};
  let cancelled = false;
  let done = 0;
  let policy = null; // what to do with duplicates for the rest of this batch
  const saved = [];
  const failed = [];
  const made = new Set();
  const toast = showToast('Uploading…', { progress: true, actions: [['Cancel', () => { cancelled = true; handle.abort?.(); }]] });
  const mkdir = async (d) => {
    if (made.has(d)) return true;
    try { await api('POST', `/api/files/mkdir?path=${encodeURIComponent(d)}`); made.add(d); return true; }
    catch (err) { failed.push(`${prettyPath(d)}: ${err.message}`); return false; }
  };
  for (const [i, it] of items.entries()) {
    if (cancelled) break;
    const parts = it.rel.split('/').filter(Boolean);
    const name = parts.pop();
    const target = parts.length ? join(dir, parts.join('/')) : dir;
    if (it.dir) { await mkdir(join(dir, it.rel)); continue; }
    toast.update(`Uploading ${many ? `${i + 1} of ${items.length}: ` : ''}${name}`, { thumb: it.file });
    if (parts.length && !(await mkdir(target))) continue;
    const onProgress = (frac) => toast.progress((done + frac * it.file.size) / total);
    let r = await sendFile(it.file, target, name, false, onProgress, handle);
    if (r && r.status === 409) {
      const choice = policy || await ask(`${name} already exists in ${prettyPath(target)}.${many ? ' Your choice applies to the rest of this upload.' : ''}`,
        ['Replace', 'Keep both', 'Skip']) || 'Skip';
      if (many) policy = choice;
      if (choice === 'Replace') r = await sendFile(it.file, target, name, true, onProgress, handle);
      else if (choice === 'Keep both') {
        for (let n = 2; r && r.status === 409 && n < 100; n++) r = await sendFile(it.file, target, numbered(name, n), false, onProgress, handle);
      } else r = { skipped: true };
    }
    if (!r) { if (cancelled) break; toast.remove(); return; }
    done += it.file.size;
    if (r.skipped) continue;
    if (r.status === 201) saved.push(r.data.path);
    else failed.push(`${name}: ${r.data.error || `upload failed (${r.status})`}`);
  }
  refreshFiles();
  if (insert) saved.forEach(insertPath);
  const n = saved.length;
  const count = `${n} file${n === 1 ? '' : 's'}`;
  if (failed.length) toast.update(`${n ? `${count} saved, ` : ''}${failed.length} failed: ${failed.join('; ')}`, { done: true, bad: true, ttl: 15000 });
  else if (cancelled) toast.update(`Upload cancelled${n ? ` after ${count}` : ''}`, { done: true, ttl: 6000 });
  else if (!n && made.size) toast.update(`Created ${made.size} folder${made.size === 1 ? '' : 's'} in ${prettyPath(dir)}`, { done: true, ttl: 6000 });
  else if (!n) toast.remove();
  else if (n === 1) toast.update(`Saved ${prettyPath(saved[0])}`, { done: true, ttl: 10000, actions: insert ? [] : [['Insert path', () => insertPath(saved[0])]] });
  else toast.update(`Saved ${count} to ${prettyPath(dir)}`, { done: true, ttl: 10000, thumb: null, actions: insert || !n ? [] : [['Insert paths', () => saved.forEach(insertPath)]] });
}

// Pasted screenshots arrive as "image.png"; name them by time so they never collide.
function pastedName(file) {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[file.type]
    || (file.name ? file.name.split('.').pop() : 'bin');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `pasted-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

const asItems = (fileList) => [...fileList].map((file) => ({ file, rel: file.name }));

// The Paste button reads the clipboard itself: for phones, and for when the terminal doesn't have focus.
async function pasteClipboard() {
  if (!navigator.clipboard?.read) return showToast('This browser can\'t read the clipboard here. Paste into the terminal instead.', { bad: true, ttl: 8000 });
  let entries;
  try { entries = await navigator.clipboard.read(); } catch { return showToast('Clipboard access was refused.', { bad: true, ttl: 6000 }); }
  const list = [];
  for (const it of entries) {
    const type = it.types.find((t) => t.startsWith('image/'));
    if (type) list.push(new File([await it.getType(type)], '', { type }));
  }
  if (!list.length) return showToast('No image in the clipboard.', { ttl: 5000 });
  uploadAll(list.map((file) => ({ file, rel: pastedName(file) })), { dir: contextDir() });
}

$('files-btn').onclick = () => showFiles(!filesVisible());
$('files-close').onclick = () => showFiles(false);
$('files-refresh').onclick = () => refreshFiles();
$('files-up').onclick = () => { if (files.dir && files.dir !== '/') loadFiles(parentOf(files.dir)); };
$('files-more').onclick = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); showMenu(r.right, r.bottom + 2, headerMenu(), { right: true }); };
$('files-upload').onclick = () => $('files-input').click();
$('files-input').onchange = () => { uploadAll(asItems($('files-input').files), { dir: contextDir() }); $('files-input').value = ''; };
$('files-paste').onclick = pasteClipboard;
$('files-mkdir').onclick = () => { if (files.dir) newFolder(contextDir()); };

// ---- the splitter between the file panel and the terminal ----
// Drag it, or focus it and use the arrow keys. Double-click puts the default width back. The width is
// remembered per browser and kept so the terminal never gets narrower than MIN_TERM.
const SIDE_DEFAULT = 280;
const SIDE_MIN = 180;
const MIN_TERM = 320;

function sideWidth(w) {
  const avail = $('workbench').clientWidth; // 0 while the terminal view is hidden
  const max = avail ? Math.max(SIDE_MIN, avail - MIN_TERM) : Infinity;
  return Math.round(Math.min(Math.max(w, SIDE_MIN), max));
}

let fitFrame = 0;
function refit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => { if (fit && currentSession) fit.fit(); });
}

function setSideWidth(w, remember = false) {
  const width = sideWidth(w);
  $('workbench').style.setProperty('--side-w', `${width}px`);
  $('sash').setAttribute('aria-valuenow', String(width));
  if (remember) store.set('files-width', String(width));
  refit();
}

setSideWidth(Number(store.get('files-width')) || SIDE_DEFAULT);
window.addEventListener('resize', () => { if (filesVisible() && isWide()) setSideWidth($('files').getBoundingClientRect().width); });

$('sash').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const sash = $('sash');
  const left = $('files').getBoundingClientRect().left;
  sash.setPointerCapture(ev.pointerId);
  document.body.classList.add('resizing');
  const move = (e) => setSideWidth(e.clientX - left);
  const up = (e) => {
    sash.removeEventListener('pointermove', move);
    sash.removeEventListener('pointerup', up);
    sash.removeEventListener('pointercancel', up);
    document.body.classList.remove('resizing');
    setSideWidth(e.clientX - left, true);
  };
  sash.addEventListener('pointermove', move);
  sash.addEventListener('pointerup', up);
  sash.addEventListener('pointercancel', up);
});
$('sash').addEventListener('dblclick', () => setSideWidth(SIDE_DEFAULT, true));
$('sash').addEventListener('keydown', (ev) => {
  const step = ev.shiftKey ? 64 : 16;
  const now = $('files').getBoundingClientRect().width;
  if (ev.key === 'ArrowLeft') setSideWidth(now - step, true);
  else if (ev.key === 'ArrowRight') setSideWidth(now + step, true);
  else if (ev.key === 'Home') setSideWidth(SIDE_MIN, true);
  else if (ev.key === 'End') setSideWidth(Infinity, true);
  else if (ev.key === 'Enter') setSideWidth(SIDE_DEFAULT, true);
  else return;
  ev.preventDefault();
});

// Everything in a drop as { file, rel }, walking into dropped folders. Empty folders come back as { dir: rel }.
async function droppedItems(dt) {
  // Entries must be taken before the first await, or the browser forgets the drop.
  const entries = [...(dt.items || [])].filter((it) => it.kind === 'file').map((it) => it.webkitGetAsEntry?.() || it.getAsFile());
  if (!entries.length) return asItems([...dt.files].filter((f) => f.size > 0 || f.type)); // a folder shows up as an empty, typeless file
  const out = [];
  const walk = async (entry, rel) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (file) out.push({ file, rel });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let any = false;
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
        if (!batch.length) break;
        any = true;
        for (const e of batch) await walk(e, `${rel}/${e.name}`);
      }
      if (!any) out.push({ dir: true, rel });
    }
  };
  for (const e of entries) {
    if (e instanceof File) out.push({ file: e, rel: e.name });
    else if (e) await walk(e, e.name);
  }
  return out;
}

// Drag and drop. Over the terminal: upload and type the paths, like VS Code's terminal. Over the panel: upload
// into the folder under the pointer, like VS Code's explorer. A panel row dragged onto the terminal types its
// path; dragged onto a folder, the breadcrumb or ↑ it moves there.
{
  const view = $('terminal-view');
  let depth = 0;
  let over = null; // the folder row under the pointer
  const types = (ev) => [...(ev.dataTransfer?.types || [])];
  const hasFiles = (ev) => types(ev).includes('Files');
  const hasText = (ev) => types(ev).includes('text/plain');
  const hasMove = (ev) => types(ev).includes(MOVE_TYPE);
  const zone = (ev) => (ev.target.closest?.('#files') ? 'panel' : 'term');
  const mark = (ev) => {
    const z = hasFiles(ev) || hasMove(ev) ? zone(ev) : null;
    $('drop').hidden = !(hasFiles(ev) && z === 'term');
    $('files').classList.toggle('drop-here', hasFiles(ev) && z === 'panel');
    const row = z === 'panel' ? ev.target.closest('[data-dir]') : null;
    if (row !== over) { over?.classList.remove('drop-here'); row?.classList.add('drop-here'); over = row; }
  };
  const clear = () => { depth = 0; mark({ target: view }); $('files').classList.remove('drop-here'); };
  view.addEventListener('dragenter', (ev) => {
    if (!hasFiles(ev) && !hasText(ev)) return;
    ev.preventDefault();
    if (depth++ === 0 && hasFiles(ev)) uploadDir().then((d) => { $('drop-dir').textContent = d ? prettyPath(d) : '~'; });
    mark(ev);
  });
  view.addEventListener('dragover', (ev) => {
    if (!hasFiles(ev) && !hasText(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = hasMove(ev) && zone(ev) === 'panel' ? 'move' : 'copy';
    mark(ev);
  });
  view.addEventListener('dragleave', () => { if (--depth <= 0) clear(); });
  view.addEventListener('drop', async (ev) => {
    if (!hasFiles(ev) && !hasText(ev)) return;
    ev.preventDefault();
    const z = zone(ev);
    const target = over?.dataset.dir || null;
    clear();
    if (!hasFiles(ev)) {
      const moving = ev.dataTransfer.getData(MOVE_TYPE);
      if (moving && z === 'panel') { if (target) { const m = JSON.parse(moving); movePath(m.path, m.name, target); } }
      else if (z === 'term' && term) { sendInput(ev.dataTransfer.getData('text/plain')); term.focus(); }
      return;
    }
    uploadAll(await droppedItems(ev.dataTransfer), { dir: target, insert: z === 'term' });
  });
}

// A pasted image or file anywhere in the terminal view is uploaded and its path typed, as if dropped on the
// terminal. Text pasted while nothing editable has focus goes to the terminal; text pasted into it is xterm's.
document.addEventListener('paste', (ev) => {
  if ($('terminal-view').hidden) return;
  const dt = ev.clipboardData;
  if (!dt) return;
  let list = [...(dt.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
  if (!list.length) list = [...(dt.files || [])];
  if (list.length) {
    ev.preventDefault();
    ev.stopPropagation();
    uploadAll(list.map((file) => ({ file, rel: pastedName(file) })), { insert: true });
    return;
  }
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  const text = dt.getData('text/plain');
  if (text && term) { ev.preventDefault(); term.paste(text); term.focus(); }
}, true);

// ---------- toasts ----------

// A message in the corner. Returns { update(msg, opts), progress(frac), remove() }. Options: bad, ttl, progress
// (show a bar), thumb (a File to show a thumbnail of, null removes it), actions ([label, fn] pairs; fn runs and
// the toast closes), done (drop the bar and the actions), onClose.
function showToast(text, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  const row = document.createElement('div');
  row.className = 't-row';
  const img = document.createElement('img');
  img.className = 't-thumb';
  img.alt = '';
  img.hidden = true;
  img.onerror = () => { img.hidden = true; };
  const span = document.createElement('span');
  span.className = 't-text';
  const acts = document.createElement('div');
  acts.className = 't-actions';
  acts.hidden = true;
  const close = document.createElement('button');
  close.className = 'icon';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.append(icon('close'));
  row.append(img, span, close);
  el.append(row, acts);
  let bar = null;
  let timer = null;
  let url = null;
  const t = {
    remove() { clearTimeout(timer); if (url) URL.revokeObjectURL(url); el.remove(); },
    progress(frac) { if (bar) bar.value = frac; },
    update(msg, o = {}) {
      span.textContent = msg;
      el.classList.toggle('bad', !!o.bad);
      if (o.thumb !== undefined) {
        if (url) { URL.revokeObjectURL(url); url = null; }
        const show = !!o.thumb && /^image\//.test(o.thumb.type);
        if (show) { url = URL.createObjectURL(o.thumb); img.src = url; }
        img.hidden = !show;
      }
      if (o.done && bar) { bar.remove(); bar = null; }
      if (o.actions || o.done) {
        acts.replaceChildren(...(o.actions || []).map(([label, fn]) => {
          const b = document.createElement('button');
          b.className = 't-action';
          b.textContent = label;
          b.onclick = () => { t.remove(); fn(); };
          return b;
        }));
        acts.hidden = !acts.childElementCount;
      }
      clearTimeout(timer);
      if (o.ttl) timer = setTimeout(t.remove, o.ttl);
    },
  };
  close.onclick = () => { t.remove(); opts.onClose?.(); };
  if (opts.progress) { bar = document.createElement('progress'); bar.max = 1; bar.value = 0; el.append(bar); }
  t.update(text, opts);
  $('toasts').append(el);
  return t;
}

// A question in the corner. Resolves with the chosen label, or null when dismissed.
// A modal question, as VS Code asks before deleting. Resolves true only for the confirm button. Cancel has
// focus, so Enter or Escape right after opening never destroys anything.
function confirmDialog({ title, detail = '', confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    closeMenu();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const head = document.createElement('div');
    head.className = 'modal-head';
    const ic = document.createElement('span');
    ic.className = 'modal-icon' + (danger ? ' danger' : '');
    ic.textContent = '!';
    const text = document.createElement('div');
    const h = document.createElement('div');
    h.className = 'modal-title';
    h.id = 'modal-title';
    h.textContent = title;
    const d = document.createElement('div');
    d.className = 'modal-detail';
    d.textContent = detail;
    text.append(h, d);
    head.append(ic, text);
    box.setAttribute('aria-labelledby', 'modal-title');
    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    const yes = document.createElement('button');
    yes.className = danger ? 'danger-fill' : 'primary';
    yes.textContent = confirm;
    const no = document.createElement('button');
    no.textContent = 'Cancel';
    acts.append(yes, no);
    box.append(head, acts);
    back.append(box);
    document.body.append(back);
    const prev = document.activeElement;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); prev?.focus?.(); resolve(v); };
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false); }
      else if (ev.key === 'Tab') { ev.preventDefault(); (document.activeElement === no ? yes : no).focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    back.onclick = (ev) => { if (ev.target === back) done(false); };
    no.focus();
  });
}

function ask(text, labels) {
  return new Promise((resolve) => {
    showToast(text, { actions: labels.map((l) => [l, () => resolve(l)]), onClose: () => resolve(null) });
  });
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
  $('term-logout').hidden = !!me.local;
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
