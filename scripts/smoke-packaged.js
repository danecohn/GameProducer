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

function locatePackagedApp(root, platform = process.platform, product = require('../package.json').build.productName) {
  const escaped = product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (platform === 'darwin') { const bundle = find(new RegExp(escaped + '\\.app$'), root, 2); return bundle && path.join(bundle, 'Contents', 'MacOS', product); }
  if (platform === 'win32') return find(new RegExp('[\\\\/]' + escaped + '\\.exe$'), root, 3);
  return find(/(?:linux[^/]*unpacked|opt\/[^/]+)\/altstack-game-producer$/, root, 4);
}
module.exports = { locatePackagedApp };
if (require.main === module) {
const bin = locatePackagedApp(dir);
if (!bin || !fs.existsSync(bin)) { console.error('no packaged app found under ' + dir); process.exit(2); }

fs.rmSync(shot, { force: true });
const args = ['--smoke-test', shot];
let cmd = bin;
if (process.platform === 'linux') { args.unshift('--no-sandbox', '--disable-gpu'); if (!process.env.DISPLAY) { args.unshift('-a', bin); cmd = 'xvfb-run'; } }
console.log('running ' + [cmd, ...args].join(' '));
const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, GP_HOME: fs.mkdtempSync(path.join(require('os').tmpdir(), 'gp-smoke-')) } });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
const tail = (t) => String(t || '').trim().split('\n').slice(-3).join(' | ').replace(/[\r%]/g, ' ').slice(0, 400);
if (r.error) { console.log('::error title=Packaged app did not start::' + r.error.message); process.exit(1); }
if (r.status !== 0) { console.error('packaged app exited with ' + r.status + (r.signal ? ' (' + r.signal + ')' : '')); console.log('::error title=Packaged app failed its launch test::exit ' + r.status + (r.signal ? ' signal ' + r.signal : '') + ' :: ' + tail(r.stderr || r.stdout)); process.exit(1); }
if (!fs.existsSync(shot) || fs.statSync(shot).size < 2000) { console.error('no screenshot was written'); console.log('::error title=Packaged app wrote no screenshot::' + tail(r.stderr || r.stdout)); process.exit(1); }
console.log('PACKAGED SMOKE OK ' + shot + ' (' + fs.statSync(shot).size + ' bytes)');

}
