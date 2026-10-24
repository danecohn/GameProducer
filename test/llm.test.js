'use strict';
const { isolate } = require('./helpers');
isolate('llm');
const test = require('node:test');
const assert = require('node:assert/strict');
const anthropic = require('../src/llm/anthropic');
const openai = require('../src/llm/openai');
const llm = require('../src/llm');
const { LLMError, explain } = require('../src/llm/errors');
const { modelFor } = require('../src/llm/models');

const json = (status, body, headers) => ({ ok: status < 400, status, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null }, text: async () => JSON.stringify(body) });
function fakeFetch(script) {
  const calls = [];
  const fx = async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); const r = script.shift(); if (!r) throw new Error('unexpected request ' + url); return typeof r === 'function' ? r(url, init) : r; };
  fx.calls = calls;
  return fx;
}
const tool = { name: 'draw', description: 'draw it', input_schema: { type: 'object', properties: { x: { type: 'integer' } } } };

test('anthropic: request shape, caching markers, tool_use parsing, usage', async () => {
  const fx = fakeFetch([json(200, { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu1', name: 'draw', input: { x: 1 } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 } })]);
  const p = anthropic.create({ key: 'sk-ant-test-FAKE-0123456789', fetchImpl: fx });
  const res = await p.chat({ model: 'claude-sonnet-5-5', system: 'sys', tools: [tool], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
  assert.equal(res.stopReason, 'tool_use');
  assert.deepEqual(res.content[1], { type: 'tool_use', id: 'tu1', name: 'draw', input: { x: 1 } });
  assert.deepEqual(res.usage, { input: 100, output: 5, cached: 90 });
  const c = fx.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.init.headers['x-api-key'], 'sk-ant-test-FAKE-0123456789');
  assert.equal(c.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.body.system[0].cache_control.type, 'ephemeral');
  assert.equal(c.body.tools[0].cache_control.type, 'ephemeral');
  assert.equal(c.body.messages[0].content[0].cache_control.type, 'ephemeral');
});

test('anthropic: retries rate limits, then surfaces typed errors without leaking the key', async () => {
  const key = 'sk-ant-test-FAKE-secretsecret';
  let slept = 0;
  const fx = fakeFetch([json(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, { 'retry-after': '0' }), json(200, { content: [{ type: 'text', text: 'fine' }], stop_reason: 'end_turn', usage: {} })]);
  const p = anthropic.create({ key, fetchImpl: fx });
  const t0 = Date.now();
  const ok = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(ok.content[0].text, 'fine');
  assert.equal(fx.calls.length, 2);
  assert.ok(Date.now() - t0 < 3000);
  const bad = anthropic.create({ key, fetchImpl: fakeFetch([json(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } })]) });
  await assert.rejects(bad.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }), (e) => { assert.ok(e instanceof LLMError); assert.equal(e.kind, 'auth'); assert.ok(!explain(e).includes(key)); assert.ok(!JSON.stringify(e).includes(key)); return true; });
  const quota = openai.create({ key, fetchImpl: fakeFetch([json(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } })]) });
  await assert.rejects(quota.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }), (e) => e.kind === 'quota');
});

test('openai: converts tool use, tool results and images to chat-completions format', async () => {
  const fx = fakeFetch([json(200, { choices: [{ finish_reason: 'tool_calls', message: { content: 'drawing', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'draw', arguments: '{"x":3}' } }] } }], usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 8 } } })]);
  const p = openai.create({ key: 'sk-test-FAKE-0123456789012345', fetchImpl: fx });
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'make a coin' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'call_0', name: 'draw', input: { x: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_0', content: [{ type: 'text', text: 'done' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }, { type: 'text', text: 'and again' }] },
  ];
  const res = await p.chat({ model: 'gpt-5', system: 'sys', tools: [tool], messages });
  const body = fx.calls[0].body;
  assert.equal(fx.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(fx.calls[0].init.headers.authorization, 'Bearer sk-test-FAKE-0123456789012345');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"x":1}');
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'call_0', content: 'done' });
  assert.equal(body.messages[4].role, 'user');
  assert.ok(body.messages[4].content.some((c) => c.type === 'image_url' && c.image_url.url === 'data:image/png;base64,AAAA'), 'tool-result images must be re-sent as a user message');
  assert.equal(body.tools[0].function.parameters.type, 'object');
  assert.equal(res.stopReason, 'tool_use');
  assert.deepEqual(res.content[1], { type: 'tool_use', id: 'call_1', name: 'draw', input: { x: 3 } });
  assert.deepEqual(res.usage, { input: 20, output: 4, cached: 8 });
});

test('openai: unparseable tool arguments become a recoverable error input', async () => {
  const fx = fakeFetch([json(200, { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'draw', arguments: '{"x": ' } }] } }], usage: {} })]);
  const res = await openai.create({ key: 'k'.repeat(30), fetchImpl: fx }).chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.match(res.content[0].input.__parse_error, /not valid JSON/);
});

test('credentials: one key, stored 0600, never returned to callers of describe()', () => {
  const fs = require('fs'); const config = require('../src/config');
  assert.equal(llm.describe().configured, false);
  assert.throws(() => llm.saveCredentials('anthropic', 'short'), /does not look like/);
  llm.saveCredentials('anthropic', 'sk-ant-test-FAKE-abcdefghijklmnop');
  const d = llm.describe();
  assert.deepEqual(d, { configured: true, provider: 'anthropic', source: 'file', hint: '…mnop' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(config.paths.credentials).mode & 0o777, 0o600);
  process.env.GP_PROVIDER = 'openai'; process.env.GP_API_KEY = 'sk-env-FAKE-0123456789012345';
  assert.equal(llm.describe().source, 'env');   // the server environment wins (hosted deployments)
  delete process.env.GP_PROVIDER; delete process.env.GP_API_KEY;
  llm.clearCredentials();
  assert.equal(llm.describe().configured, false);
});

test('models: Director gets the strongest tier, settings override per agent', () => {
  assert.equal(modelFor('anthropic', 'director', {}), 'claude-opus-5-5');
  assert.equal(modelFor('anthropic', 'forge', {}), 'claude-sonnet-5-5');
  assert.equal(modelFor('anthropic', 'forge', { models: { forge: 'claude-haiku-5-5' } }), 'claude-haiku-5-5');
  assert.equal(modelFor('openai', 'director', {}), 'gpt-5');
});
