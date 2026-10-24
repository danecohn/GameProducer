#!/usr/bin/env node
'use strict';
// Collects the installers from release/ into artifacts/ with a .sha256 beside each (the form `shasum -c` reads).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'release'), out = path.join(root, 'artifacts');
fs.mkdirSync(out, { recursive: true });
const want = /^AltStackGameProducer-(mac|win|linux)-(arm64|x64)\.(dmg|exe|AppImage)$/;
const files = fs.readdirSync(src).filter((f) => want.test(f));
if (!files.length) { console.error('no installers found in release/'); process.exit(1); }
for (const f of files) {
  const dest = path.join(out, f);
  fs.copyFileSync(path.join(src, f), dest);
  const sum = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  fs.writeFileSync(dest + '.sha256', sum + '  ' + f + '\n');
  console.log(sum + '  ' + f + '  ' + (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB');
}
