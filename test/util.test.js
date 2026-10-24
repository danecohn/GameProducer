'use strict';
const { isolate } = require('./helpers');
isolate('util');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { confine, safeName, slugify, clip, ToolError } = require('../src/util');
const { writeZip, crc32 } = require('../src/projects/zip');
const { execFileSync } = require('child_process');

test('confine keeps everything inside the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-confine-'));
  fs.mkdirSync(path.join(root, 'a'));
  assert.equal(confine(root, 'a/b.txt'), path.join(fs.realpathSync(root), 'a', 'b.txt'));
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', 'a\0b', '']) assert.throws(() => confine(root, bad), ToolError, bad);
  // a symlink that points out of the root must not be followed
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-outside-'));
  fs.symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => confine(root, 'link/secret.txt'), /outside the project/);
  assert.throws(() => confine(root, 'nope', { mustExist: true }), /does not exist/);
});

test('names, slugs and clipping', () => {
  assert.equal(safeName('../../Hero Sprite!!'), 'Hero_Sprite');
  assert.equal(safeName('', 'x'), 'x');
  assert.equal(slugify('Coin Dash: Reloaded!'), 'coin-dash-reloaded');
  assert.equal(slugify('???'), 'game');
  const long = 'a'.repeat(5000) + 'END';
  const c = clip(long, 1000);
  assert.ok(c.length < 1100 && c.endsWith('END') && c.includes('omitted'));
});

test('zip writer produces archives the system unzip accepts', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gp-zip-')), 't.zip');
  writeZip(f, [{ name: 'a/readme.txt', data: Buffer.from('hello '.repeat(200)) }, { name: 'b.bin', data: Buffer.from([1, 2, 3]) }]);
  let ok = true;
  try { execFileSync('unzip', ['-tq', f], { stdio: 'pipe' }); } catch (e) { ok = e.code === 'ENOENT'; }   // no unzip installed: skip the external check
  assert.ok(ok, 'unzip rejected the archive');
});
