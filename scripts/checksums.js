#!/usr/bin/env node
'use strict';
// Collects the installers from release/ into artifacts/ with a .sha256 beside each (the form `shasum -c` reads).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'release'), out = path.join(root, 'artifacts');
fs.mkdirSync(out, { recursive: true });
// electron-builder's ${arch} is x86_64 for Linux AppImages and aarch64 on some hosts; the published names are always x64 and arm64.
const want = /^AltStackGameProducer-(mac|win|linux)-(arm64|aarch64|x64|x86_64|amd64)\.(dmg|exe|AppImage|deb)$/;
const canon = (f) => { const m = want.exec(f); return 'AltStackGameProducer-' + m[1] + '-' + (/arm64|aarch64/.test(m[2]) ? 'arm64' : 'x64') + '.' + m[3]; };
const files = fs.readdirSync(src).filter((f) => want.test(f));
if (!files.length) { console.error('no installers found in release/'); process.exit(1); }
for (const f of files) {
  const name = canon(f), dest = path.join(out, name);
  fs.copyFileSync(path.join(src, f), dest);
  const sum = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  fs.writeFileSync(dest + '.sha256', sum + '  ' + name + '\n');
  console.log(sum + '  ' + name + '  ' + (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB');
}
