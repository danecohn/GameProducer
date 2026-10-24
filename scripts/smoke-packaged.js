#!/usr/bin/env node
'use strict';
// Starts the PACKAGED app (not the source tree) for this platform and checks that it boots, serves its API and renders the UI.
// usage: node scripts/smoke-packaged.js [releaseDir]   -> exits non-zero on failure, writes release/smoke-<os>-<arch>.png
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release'));
const shot = path.join(dir, 'smoke-' + process.platform + '-' + process.arch + '.png');

function find(re, root, depth) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const f = path.join(root, e.name);
    if (re.test(f)) return f;
    if (e.isDirectory() && depth > 0 && !/\.app$/.test(e.name)) { const hit = find(re, f, depth - 1); if (hit) return hit; }
  }
  return null;
}

let bin;
if (process.platform === 'darwin') bin = find(/AltStack Game Producer\.app$/, dir, 2) && path.join(find(/AltStack Game Producer\.app$/, dir, 2), 'Contents', 'MacOS', 'AltStack Game Producer');
else if (process.platform === 'win32') bin = find(/win[^\\/]*unpacked[\\/]AltStack Game Producer\.exe$/, dir, 3);
else bin = find(/linux[^/]*unpacked\/altstack-game-producer$/, dir, 3);
if (!bin || !fs.existsSync(bin)) { console.error('no packaged app found under ' + dir); process.exit(2); }

fs.rmSync(shot, { force: true });
const args = ['--smoke-test', shot];
let cmd = bin;
if (process.platform === 'linux') { args.unshift('--no-sandbox', '--disable-gpu'); if (!process.env.DISPLAY) { args.unshift('-a', bin); cmd = 'xvfb-run'; } }
console.log('running ' + [cmd, ...args].join(' '));
const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, GP_HOME: fs.mkdtempSync(path.join(require('os').tmpdir(), 'gp-smoke-')) } });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
if (r.status !== 0) { console.error('packaged app exited with ' + r.status + (r.signal ? ' (' + r.signal + ')' : '')); process.exit(1); }
if (!fs.existsSync(shot) || fs.statSync(shot).size < 2000) { console.error('no screenshot was written'); process.exit(1); }
console.log('PACKAGED SMOKE OK ' + shot + ' (' + fs.statSync(shot).size + ' bytes)');
