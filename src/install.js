'use strict';
// "game-producer install godot": downloads the OFFICIAL Godot build for this machine from godotengine/godot-builds,
// verifies its SHA-512 against the release's SHA512-SUMS.txt, and unpacks it under GP_HOME/tools/godot.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('./config');

const GODOT_VERSION = process.env.GP_GODOT_VERSION || '4.7.2-stable';
const BASE = 'https://github.com/godotengine/godot-builds/releases/download/' + GODOT_VERSION + '/';

function assetName() {
  const v = 'Godot_v' + GODOT_VERSION + '_';
  if (process.platform === 'darwin') return v + 'macos.universal.zip';
  if (process.platform === 'win32') return v + 'win64.exe.zip';
  if (process.platform === 'linux') return v + (process.arch === 'arm64' ? 'linux.arm64.zip' : 'linux.x86_64.zip');
  throw new Error('no official Godot build for ' + process.platform + '/' + process.arch);
}

async function download(url, file, log) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('download failed: HTTP ' + res.status + ' for ' + url);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0, lastPct = -1;
  const src = Readable.fromWeb(res.body);
  src.on('data', (c) => { got += c.length; if (total) { const pct = Math.floor(got * 10 / total) * 10; if (pct !== lastPct) { lastPct = pct; log('  ' + pct + '%'); } } });
  await pipeline(src, fs.createWriteStream(file));
}

function sha512(file) {
  const h = crypto.createHash('sha512');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tries = process.platform === 'win32' ? [['tar', ['-xf', zip, '-C', dest]]] : [['unzip', ['-q', '-o', zip, '-d', dest]], ['tar', ['-xf', zip, '-C', dest]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: 'pipe' });
    if (r.status === 0) return;
  }
  throw new Error('could not unpack ' + path.basename(zip) + ' (install "unzip")');
}

async function installGodot(log) {
  log = log || console.log;
  const name = assetName();
  const dest = path.join(config.paths.tools, 'godot', GODOT_VERSION);
  const work = path.join(config.paths.tools, '.download-' + process.pid);
  fs.mkdirSync(work, { recursive: true });
  try {
    log('Godot ' + GODOT_VERSION + ': ' + name);
    const sums = await (await fetch(BASE + 'SHA512-SUMS.txt', { redirect: 'follow' })).text();
    const line = sums.split('\n').find((l) => l.trim().endsWith(' ' + name) || l.trim().endsWith('*' + name));
    if (!line) throw new Error('no checksum for ' + name + ' in SHA512-SUMS.txt');
    const expected = line.trim().split(/\s+/)[0].toLowerCase();
    const zip = path.join(work, name);
    log('Downloading ' + BASE + name);
    await download(BASE + name, zip, log);
    log('Verifying SHA-512');
    if (sha512(zip) !== expected) throw new Error('checksum mismatch: the download was corrupted or tampered with; nothing was installed');
    fs.rmSync(dest, { recursive: true, force: true });
    log('Unpacking');
    unzip(zip, dest);
    if (process.platform !== 'win32') {
      // zip drops the executable bit on some platforms
      const bins = [];
      (function rec(d, depth) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory() && depth < 6) rec(f, depth + 1); else if (e.isFile() && /^godot/i.test(e.name)) bins.push(f); } })(dest, 0);
      for (const b of bins) { try { fs.chmodSync(b, 0o755); } catch (e) { /* ignore */ } }
    }
    require('./studios/toolchain').clearCache();
    const bin = require('./studios/toolchain').locate('godot');
    if (!bin) throw new Error('unpacked, but could not find the Godot executable under ' + dest);
    log('Installed: ' + bin);
    return bin;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const BLENDER_VERSION = process.env.GP_BLENDER_VERSION || '5.0.1';
const BLENDER_BASE = 'https://download.blender.org/release/Blender' + BLENDER_VERSION.split('.').slice(0, 2).join('.') + '/';

function blenderAsset() {
  const v = 'blender-' + BLENDER_VERSION + '-';
  if (process.platform === 'darwin' && process.arch === 'arm64') return v + 'macos-arm64.dmg';
  if (process.platform === 'win32' && process.arch === 'x64') return v + 'windows-x64.zip';
  if (process.platform === 'win32' && process.arch === 'arm64') return v + 'windows-arm64.zip';
  if (process.platform === 'linux' && process.arch === 'x64') return v + 'linux-x64.tar.xz';
  throw new Error('no official Blender ' + BLENDER_VERSION + ' build for ' + process.platform + '/' + process.arch + '; install Blender yourself and set GP_BLENDER');
}

async function installBlender(log) {
  log = log || console.log;
  const name = blenderAsset();
  const dest = path.join(config.paths.tools, 'blender', BLENDER_VERSION);
  const work = path.join(config.paths.tools, '.download-' + process.pid);
  fs.mkdirSync(work, { recursive: true });
  try {
    log('Blender ' + BLENDER_VERSION + ': ' + name);
    const sums = await (await fetch(BLENDER_BASE + 'blender-' + BLENDER_VERSION + '.sha256', { redirect: 'follow' })).text();
    const line = sums.split('\n').find((l) => l.trim().endsWith(' ' + name) || l.trim().endsWith('*' + name));
    if (!line) throw new Error('no checksum for ' + name + ' in the release checksum file');
    const expected = line.trim().split(/\s+/)[0].toLowerCase();
    const file = path.join(work, name);
    log('Downloading ' + BLENDER_BASE + name + ' (large, a few hundred MB)');
    await download(BLENDER_BASE + name, file, log);
    log('Verifying SHA-256');
    if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== expected) throw new Error('checksum mismatch: nothing was installed');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    log('Unpacking');
    if (name.endsWith('.dmg')) {
      const mnt = path.join(work, 'mnt');
      fs.mkdirSync(mnt);
      execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-mountpoint', mnt, file], { stdio: 'pipe' });
      try { execFileSync('cp', ['-R', path.join(mnt, 'Blender.app'), dest], { stdio: 'pipe' }); }
      finally { try { execFileSync('hdiutil', ['detach', '-force', mnt], { stdio: 'pipe' }); } catch (e) { /* already gone */ } }
    } else if (name.endsWith('.tar.xz')) {
      execFileSync('tar', ['-xJf', file, '-C', dest], { stdio: 'pipe' });
    } else unzip(file, dest);
    require('./studios/toolchain').clearCache();
    const bin = require('./studios/toolchain').locate('blender');
    if (!bin) throw new Error('unpacked, but could not find the Blender executable under ' + dest);
    log('Installed: ' + bin);
    return bin;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { installGodot, installBlender, GODOT_VERSION, BLENDER_VERSION, assetName, blenderAsset };
