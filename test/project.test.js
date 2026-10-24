'use strict';
const { isolate } = require('./helpers');
isolate('project');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Project, repairMessages } = require('../src/projects/project');
const { inventory } = require('../src/projects/inventory');

test('create, reopen and list projects; ids never collide', () => {
  const a = Project.create({ name: 'Coin Dash', pitch: 'run and jump' });
  const b = Project.create({ name: 'Coin Dash' });
  assert.equal(a.id, 'coin-dash'); assert.equal(b.id, 'coin-dash-2');
  assert.throws(() => Project.create({ name: '  ' }), /needs a name/);
  assert.throws(() => Project.open('../etc'), /bad project id/);
  assert.equal(Project.open('coin-dash').meta.pitch, 'run and jump');
  assert.equal(Project.list().length, 2);
  assert.ok(fs.existsSync(path.join(a.paths.bible, 'BIBLE.md')));
});

test('bible: confined names, replace and append, changelog, digest', () => {
  const p = Project.create({ name: 'Bible Test', pitch: 'a pitch' });
  const b = p.bible;
  for (const bad of ['../x.md', 'x.txt', 'a/b.md', '.hidden.md']) assert.throws(() => b.write(bad, 'x'), /bible document names/, bad);
  b.write('STORY.md', '# Story\n\nOnce.');
  b.write('STORY.md', 'Twice.', 'append');
  assert.match(b.read('STORY.md'), /Once\.\n\nTwice\./);
  b.changelog('Sking', 'wrote the story');
  assert.match(b.digest(), /STORY\.md/);
  assert.match(b.digest(), /Sking: wrote the story/);
  assert.throws(() => b.read('NOPE.md'), /no bible document/);
  assert.throws(() => b.write('BIG.md', 'x'.repeat(300 * 1024)), /larger than/);
});

test('state persists, interrupted work is marked on restart, pending decisions expire', () => {
  const p = Project.create({ name: 'Recover' });
  p.state.contracts.push({ id: 'c1', agent: 'forge', status: 'running' }, { id: 'c2', agent: 'palette', status: 'delivered' });
  p.state.decisions.push({ id: 'd1', status: 'pending' });
  p.addUsage('director', 'm', { input: 100, output: 20, cached: 0 });
  p.saveNow();
  const again = Project.open(p.id);
  assert.equal(again.state.contracts[0].status, 'interrupted');
  assert.equal(again.state.contracts[1].status, 'delivered');
  assert.equal(again.state.decisions[0].status, 'expired');
  assert.equal(again.tokensUsed(), 120);
});

test('repairMessages closes tool_use blocks that never got a result', () => {
  const fixed = repairMessages([
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'x', input: {} }, { type: 'tool_use', id: 'b', name: 'y', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }, { type: 'text', text: 'note' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'z', input: {} }] },
  ]);
  const ids = (m) => m.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
  assert.deepEqual(ids(fixed[2]), ['a', 'b']);
  assert.equal(fixed[2].content[2].type, 'text');
  assert.deepEqual(ids(fixed[4]), ['c']);
});

test('media is content-addressed and the public file resolver refuses internals', () => {
  const p = Project.create({ name: 'Media' });
  const m = p.saveMedia(Buffer.from('png-bytes').toString('base64'), 'image/png');
  assert.match(m.url, /^\/api\/projects\/media\/media\/[0-9a-f]{14}\.png$/);
  assert.equal(p.saveMedia(Buffer.from('png-bytes').toString('base64'), 'image/png').name, m.name);
  assert.ok(p.resolvePublic('.producer/media/' + m.name));
  for (const bad of ['.producer/state.json', 'project.json', '../x', 'assets/../.producer/state.json', '/etc/passwd']) assert.throws(() => p.resolvePublic(bad), undefined, bad);
  assert.deepEqual(inventory(p).sprites.images, []);
});
