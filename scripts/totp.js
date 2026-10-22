#!/usr/bin/env node
'use strict';

// Manages authenticator-app codes for the second login step (TOTP=required).
// Enrollment happens here on the server, never in the browser, so passing Access alone can't enroll a device.
//
// Usage: scripts/totp.js add <email>      enroll (or re-enroll) an authenticator app
//        scripts/totp.js remove <email>   remove it; that person can no longer log in
//        scripts/totp.js list
// Store: TOTP_FILE, or ~/.config/cloudflare-tmux/totp.json (root: /etc/cloudflare-tmux/totp.json).
// Run it as the same user as the service (root for the multi-user install).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const totp = require('../lib/totp');

// Pick up TOTP_FILE from the app config (single-user) or /etc/cloudflare-tmux/env (multi-user).
const os = require('os');
for (const file of [path.join(os.homedir(), '.config', 'cloudflare-tmux', 'env'), path.join(__dirname, '..', '.env'),
  '/etc/cloudflare-tmux/env']) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const m = text.match(/^\s*TOTP_FILE\s*=\s*(.+?)\s*$/m);
  if (m && !process.env.TOTP_FILE) process.env.TOTP_FILE = m[1].replace(/^["']|["']$/g, '');
}

const FILE = totp.defaultFile();
const [cmd, rawEmail] = process.argv.slice(2);
const email = String(rawEmail || '').trim().toLowerCase();

function usage() {
  console.log('Usage: scripts/totp.js add <email> | remove <email> | list');
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function add() {
  if (!email.includes('@') && email !== 'local') usage();
  if (!process.stdin.isTTY) { console.error('Run this in a terminal: it asks for a code to confirm the setup.'); process.exit(1); }
  const secret = totp.newSecret();
  const uri = totp.otpauthUri(email, secret);
  console.log(`\nAdd this account to your authenticator app (Google Authenticator, 1Password, Authy, ...):\n`);
  try {
    process.stdout.write(execFileSync('qrencode', ['-t', 'ansiutf8', uri], { stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    console.log('  (install qrencode to show a QR code here: apt install qrencode)');
  }
  console.log(`  Secret key: ${secret.match(/.{1,4}/g).join(' ')}`);
  console.log(`  Or open:    ${uri}\n`);
  for (let tries = 0; tries < 3; tries++) {
    const code = (await ask('Enter the 6-digit code from the app to confirm: ')).replace(/\s/g, '');
    if (totp.verify(secret, code) >= 0) {
      const data = totp.loadWithKey(FILE);
      data.users[email] = { secret, added: new Date().toISOString() };
      totp.save(FILE, data);
      console.log(`Saved for ${email} in ${FILE}. Any earlier device for this email no longer works.`);
      return;
    }
    console.log('That code is wrong. Check the time on your phone and try again.');
  }
  console.error('Not saved.');
  process.exit(1);
}

function remove() {
  if (!email) usage();
  const data = totp.load(FILE);
  if (!data.users[email]) { console.log(`${email} is not enrolled.`); return; }
  delete data.users[email];
  totp.save(FILE, data);
  console.log(`Removed ${email}. With TOTP=required they can no longer log in until enrolled again.`);
}

function list() {
  const users = Object.entries(totp.load(FILE).users);
  if (!users.length) return console.log(`Nobody enrolled yet (${FILE}).`);
  for (const [e, u] of users) console.log(`${e}\tadded ${u.added}`);
}

if (cmd === 'add') add();
else if (cmd === 'remove') remove();
else if (cmd === 'list') list();
else usage();
