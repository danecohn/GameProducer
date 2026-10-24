'use strict';
const { isolate } = require('./helpers');
isolate('loop');
const test = require('node:test');
const assert = require('node:assert/strict');
const loop = require('../src/agents/loop');
const { ToolError } = require('../src/util');

function stubCrew(script) {
  const events = [];
  return {
    events,
    modelFor: () => 'm',
    provider: () => ({ chat: async (req) => { const r = script.shift(); if (!r) throw new Error('script exhausted'); return typeof r === 'function' ? r(req) : r; } }),
    status() {}, say: (a, t) => events.push(['say', t]), note() {}, log() {},
    toolStart: (a, u) => events.push(['start', u.name]), toolDone: (a, u, c, r) => events.push(['done', u.name, r.ok, r.error]),
    recordUsage: (a, m, u) => events.push(['usage', u.input]), guardBudget: async () => {},
  };
}
const reply = (content, stop) => ({ content, stopReason: stop || (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'), usage: { input: 5, output: 2, cached: 0 } });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input: input || {} });
const tool = (name, run) => ({ name, description: name, input_schema: { type: 'object', properties: {} }, run });

test('runs tools, feeds results back, ends on a plain answer', async () => {
  const crew = stubCrew([reply([{ type: 'text', text: 'working' }, use('a', 'add', { n: 2 })]), reply([{ type: 'text', text: 'done: 4' }])]);
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'go' }] }];
  const res = await loop.run({ crew, agent: 'forge', system: 's', tools: [tool('add', async ({ n }) => ({ sum: n + 2 }))], messages, maxTurns: 5 });
  assert.equal(res.status, 'done'); assert.equal(res.text, 'done: 4'); assert.equal(res.turns, 2);
  const result = messages[2].content[0];
  assert.equal(result.type, 'tool_result'); assert.equal(result.tool_use_id, 'a'); assert.equal(result.content[0].text, '{"sum":4}');
});

test('tool errors reach the model as is_error results, unknown tools list the real ones', async () => {
  const crew = stubCrew([reply([use('1', 'boom'), use('2', 'nope')]), reply([{ type: 'text', text: 'ok' }])]);
  const messages = [{ role: 'user', content: 'x' }];
  await loop.run({ crew, agent: 'forge', system: 's', tools: [tool('boom', async () => { throw new ToolError('bad input: x'); })], messages, maxTurns: 5 });
  const [r1, r2] = messages[2].content;
  assert.equal(r1.is_error, true); assert.match(r1.content[0].text, /bad input: x/);
  assert.equal(r2.is_error, true); assert.match(r2.content[0].text, /unknown tool "nope".*boom/);
});

test('parallel tool calls really run at the same time', async () => {
  const crew = stubCrew([reply([use('1', 'slow'), use('2', 'slow'), use('3', 'slow')]), reply([{ type: 'text', text: 'ok' }])]);
  let live = 0, peak = 0;
  const slow = tool('slow', async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 40)); live--; return 'x'; });
  await loop.run({ crew, agent: 'director', system: 's', tools: [slow], messages: [{ role: 'user', content: 'x' }], maxTurns: 5 });
  assert.equal(peak, 3);
});

test('terminal tool ends the run with its input; producer notes join the next user turn', async () => {
  const crew = stubCrew([reply([use('1', 'work')]), reply([use('2', 'submit_deliverable', { status: 'delivered', summary: 's' })])]);
  const inbox = ['[note] use red'];
  const messages = [{ role: 'user', content: 'x' }];
  const res = await loop.run({ crew, agent: 'palette', system: 's', tools: [tool('work', async () => 'ok'), tool('submit_deliverable', async () => ({ ok: true }))], messages, maxTurns: 5, terminal: 'submit_deliverable', inbox });
  assert.equal(res.status, 'terminal'); assert.deepEqual(res.terminalInput, { status: 'delivered', summary: 's' });
  assert.equal(messages[2].content[1].text, '[note] use red');
  assert.equal(inbox.length, 0);
});

test('step limit, cut-off replies and abort are handled', async () => {
  const forever = () => reply([use('x', 'noop')]);
  const crew = stubCrew([forever(), forever(), forever()]);
  const res = await loop.run({ crew, agent: 'forge', system: 's', tools: [tool('noop', async () => 'ok')], messages: [{ role: 'user', content: 'x' }], maxTurns: 2 });
  assert.equal(res.status, 'max_turns');
  const crew2 = stubCrew([reply([{ type: 'text', text: 'half' }], 'max_tokens'), reply([{ type: 'text', text: 'whole' }])]);
  const msgs = [{ role: 'user', content: 'x' }];
  const r2 = await loop.run({ crew: crew2, agent: 'forge', system: 's', tools: [], messages: msgs, maxTurns: 4 });
  assert.equal(r2.text, 'whole'); assert.match(msgs[2].content[0].text, /cut off/);
  const ctl = new AbortController();
  const crew3 = stubCrew([reply([use('1', 'wait')])]);
  const t = tool('wait', async (i, ctx) => { ctl.abort(); return 'late'; });
  await assert.rejects(loop.run({ crew: crew3, agent: 'forge', system: 's', tools: [t], messages: [{ role: 'user', content: 'x' }], maxTurns: 4, signal: ctl.signal }), (e) => e.name === 'AbortError');
});

test('history trimming keeps the newest images and shrinks old bulky output', () => {
  const img = (n) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x'.repeat(n) } });
  const messages = [];
  for (let i = 0; i < 30; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? [{ type: 'text', text: 'a' }] : [{ type: 'tool_result', tool_use_id: 't' + i, content: [{ type: 'text', text: 'y'.repeat(5000) }, img(10)] }] });
  loop.trimHistory(messages, { keepImages: 2, recent: 6 });
  const imgs = JSON.stringify(messages).match(/"type":"image"/g) || [];
  assert.equal(imgs.length, 2);
  assert.ok(messages[0].content[0].content[0].text.length < 2000, 'old tool output is clipped');
  assert.equal(messages[28].content[0].content[0].text.length, 5000, 'recent output is untouched');
});
