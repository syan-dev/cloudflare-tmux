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
  if (res.status === 401) { location.reload(); throw new Error('Session expired, re-authenticating'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
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
      try { await api('GET', '/api/me'); } catch { return; }
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

// ---------- routing ----------

function showView(id) {
  for (const v of ['dashboard', 'terminal-view']) $(v).hidden = v !== id;
}

function route() {
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
