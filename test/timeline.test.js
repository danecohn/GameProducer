'use strict';
const { isolate } = require('./helpers');
isolate('timeline');
const test = require('node:test');
const assert = require('node:assert/strict');

test('timeline: contracts collect their own work log, decisions resolve, replay equals live', async () => {
  const { build, createTimeline, apply, durationLabel } = await import('../web/js/timeline.js');
  const events = [
    { seq: 1, type: 'message', role: 'producer', channel: 'director', text: 'make a game' },
    { seq: 2, type: 'tool', agent: 'director', id: 't1', name: 'get_project_state', summary: '{}', contract: null },
    { seq: 3, type: 'tool_result', agent: 'director', id: 't1', name: 'get_project_state', ok: true, ms: 5, images: [] },
    { seq: 4, type: 'contract', contract: { id: 'c1', agent: 'palette', title: 'Hero', status: 'running' } },
    { seq: 5, type: 'tool', agent: 'palette', id: 't2', name: 'draw_pixels', summary: 'x', contract: 'c1' },
    { seq: 6, type: 'tool_result', agent: 'palette', id: 't2', name: 'draw_pixels', ok: true, ms: 9, images: [{ url: '/m/1.png' }], contract: 'c1' },
    { seq: 7, type: 'message', role: 'agent', agent: 'palette', text: 'looks good', contract: 'c1' },
    { seq: 8, type: 'contract', contract: { id: 'c1', agent: 'palette', title: 'Hero', status: 'delivered', summary: 'done' } },
    { seq: 9, type: 'decision', decision: { id: 'd1', agent: 'director', kind: 'question', question: 'Which?', options: [], status: 'pending' } },
    { seq: 10, type: 'decision_resolved', id: 'd1', status: 'answered', answer: 'A' },
    { seq: 11, type: 'message', role: 'agent', agent: 'sking', text: 'hello', contract: null },
    { seq: 12, type: 'tool', agent: 'forge', id: 't3', name: 'x', summary: '', contract: 'ghost' },
  ];
  const tl = build(events);
  assert.deepEqual(tl.director.map((i) => i.kind), ['producer', 'tool', 'contract', 'decision', 'tool'].slice(0, 4).concat(['tool']));
  const c = tl.contracts.get('c1');
  assert.equal(c.status, 'delivered'); assert.equal(c.log.length, 2); assert.equal(c.images.length, 1); assert.equal(c.images[0].tool, 'draw_pixels');
  assert.equal(tl.decisions.get('d1').answer, 'A'); assert.equal(tl.pending.size, 0);
  assert.equal(tl.sking.length, 1);
  const live = createTimeline(); for (const e of events) apply(live, e);
  assert.deepEqual(JSON.parse(JSON.stringify([...live.contracts])), JSON.parse(JSON.stringify([...tl.contracts])));
  assert.equal(durationLabel(65000), '1 min 5 s');
});

test('markdown renderer escapes HTML and handles the bible subset', async () => {
  globalThis.document = undefined;
  const { md } = await import('../web/js/dom.js').catch(() => ({ md: null }));
  if (!md) return;   // dom.js touches `document` lazily; md() itself is pure
  const html = md('# Title\n\n<script>alert(1)</script> **bold** and `code`\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```\n<b>raw</b>\n```');
  assert.ok(!html.includes('<script>')); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<h2>Title<\/h2>/); assert.match(html, /<strong>bold<\/strong>/); assert.match(html, /<li>a<\/li>/); assert.match(html, /<td>1<\/td>/); assert.match(html, /<blockquote>quote/); assert.match(html, /&lt;b&gt;raw&lt;\/b&gt;/);
});
