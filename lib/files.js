#!/usr/bin/env node
'use strict';

// File helper for the browser file panel. The server runs it as the mapped Linux user (through setpriv in the
// multi-user install), so Unix permissions decide what each person can list, read and write. It never runs as
// root. Results go to stdout; failures exit 1 with the errno code on stderr.
//
//   files.js list <dir>          JSON: { path, entries: [{ name, type, size, mtime }] }
//   files.js stat <path>         JSON: { name, type, size, mtime }
//   files.js read <file>         the file's bytes
//   files.js write <file> <size> [--overwrite]   stdin to the file; exactly <size> bytes or nothing is kept;
//                                                refuses to replace an existing file unless --overwrite

const fs = require('fs');
const path = require('path');

const [op, target, ...rest] = process.argv.slice(2);
if (!op || !target || !path.isAbsolute(target) || target.includes('\0')) die('EINVAL');

function die(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

function kind(st) {
  if (st.isDirectory()) return 'dir';
  if (st.isFile()) return 'file';
  return 'other';
}

async function entry(dir, dirent) {
  const full = path.join(dir, dirent.name);
  try {
    // Follow symlinks so a link to a directory opens like one.
    const st = await fs.promises.stat(full);
    return { name: dirent.name, type: kind(st), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) };
  } catch {
    return { name: dirent.name, type: dirent.isDirectory() ? 'dir' : 'other', size: 0, mtime: 0 };
  }
}

async function main() {
  if (op === 'list') {
    const dir = await fs.promises.realpath(target);
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(dirents.map((d) => entry(dir, d)));
    process.stdout.write(JSON.stringify({ path: dir, entries }));
    return;
  }
  if (op === 'stat') {
    const st = await fs.promises.stat(target);
    process.stdout.write(JSON.stringify({ name: path.basename(target), type: kind(st), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) }));
    return;
  }
  if (op === 'read') {
    const st = await fs.promises.stat(target);
    if (!st.isFile()) die('EISDIR');
    await new Promise((resolve, reject) => {
      fs.createReadStream(target).on('error', reject).pipe(process.stdout).on('finish', resolve).on('error', reject);
    });
    return;
  }
  if (op === 'write') {
    const size = Number(rest[0]);
    const overwrite = rest[1] === '--overwrite';
    if (!(size >= 0 && Number.isInteger(size))) die('EINVAL');
    // Fail fast before the upload is received, then atomically at the end (link never replaces a file).
    if (!overwrite && fs.existsSync(target)) die('EEXIST');
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.part${process.pid}`);
    let written = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp, { flags: 'wx', mode: 0o644 });
        out.on('error', reject).on('finish', resolve);
        process.stdin.on('error', reject).on('data', (d) => { written += d.length; }).pipe(out);
      });
      if (written !== size) throw Object.assign(new Error('short upload'), { code: 'EIO' });
      if (overwrite) await fs.promises.rename(tmp, target);
      else { await fs.promises.link(tmp, target); await fs.promises.unlink(tmp); }
    } catch (err) {
      await fs.promises.unlink(tmp).catch(() => {});
      throw err;
    }
    process.stdout.write(JSON.stringify({ size: written }));
    return;
  }
  die('EINVAL');
}

main().catch((err) => die(err.code || 'EIO'));
