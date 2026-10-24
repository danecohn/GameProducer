'use strict';
// The whole studio over real HTTP, speaking each provider's wire format to a local fake of that API.
// The fake's "brain" is the scripted demo crew; what is under test is everything between the loop and the network.
const { isolate, waitFor } = require('./helpers');
isolate('wire');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Project } = require('../src/projects/project');
const { Crew } = require('../src/crew');
const llm = require('../src/llm');
const mock = require('../src/llm/mock');

const brain = mock.create();
const seen = { requests: 0, systems: new Set(), models: new Set(), cacheMarks: 0, maxMessages: 0, imageBlocks: 0 };

function fakeApi(kind) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const send = (status, obj) => { const d = JSON.stringify(obj); res.writeHead(status, { 'content-type': 'application/json' }); res.end(d); };
      if (req.method === 'GET') return send(200, { data: [{ id: 'm1' }] });
      seen.requests++; seen.models.add(body.model);
      if (kind === 'anthropic') {
        if (req.url !== '/v1/messages' || req.headers['x-api-key'] !== 'sk-ant-test-FAKE-' + 'w'.repeat(30) || req.headers['anthropic-version'] !== '2023-06-01') return send(401, { error: { type: 'authentication_error', message: 'bad key' } });
        const system = body.system.map((b) => b.text).join('\n');
        seen.cacheMarks += JSON.stringify(body).split('cache_control').length - 1;
        seen.maxMessages = Math.max(seen.maxMessages, body.messages.length);
        seen.imageBlocks += (JSON.stringify(body.messages).match(/"type":"image"/g) || []).length;
        for (const t of body.tools) assert.ok(t.name && t.input_schema.type === 'object');
        const out = await brain.chat({ system, messages: body.messages });
        return send(200, { content: out.content, stop_reason: out.stopReason === 'tool_use' ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 } });
      }
      if (req.url !== '/v1/chat/completions' || req.headers.authorization !== 'Bearer sk-test-FAKE-' + 'w'.repeat(30)) return send(401, { error: { code: 'invalid_api_key', message: 'bad key' } });
      for (const t of body.tools) { assert.equal(t.type, 'function'); assert.ok(/^[a-zA-Z0-9_-]{1,64}$/.test(t.function.name)); }
      // OpenAI wire -> internal blocks (the inverse of the adapter), so the brain can read the conversation
      const messages = []; let system = '';
      for (const m of body.messages) {
        if (m.role === 'system') system = m.content;
        else if (m.role === 'user') { const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content.map((p) => p.type === 'text' ? p : { type: 'image', source: {} }); seen.imageBlocks += parts.filter((p) => p.type === 'image').length; messages.push({ role: 'user', content: parts }); }
        else if (m.role === 'assistant') messages.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...(m.tool_calls || []).map((c) => ({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments) }))] });
        else if (m.role === 'tool') { const b = { type: 'tool_result', tool_use_id: m.tool_call_id, is_error: /^ERROR: /.test(m.content), content: [{ type: 'text', text: m.content }] }; const prev = messages[messages.length - 1]; if (prev && prev.role === 'user' && prev.content.every((x) => x.type === 'tool_result')) prev.content.push(b); else messages.push({ role: 'user', content: [b] }); }
      }
      const out = await brain.chat({ system, messages });
      const text = out.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = out.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      return send(200, { choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port })));
}

for (const [kind, key] of [['anthropic', 'sk-ant-test-FAKE-' + 'w'.repeat(30)], ['openai', 'sk-test-FAKE-' + 'w'.repeat(30)]]) {
  test(kind + ': a full production over the real wire format', async () => {
    const api = await fakeApi(kind);
    try {
      const provider = llm.createProvider({ provider: kind, key }, { baseUrl: kind === 'openai' ? api.url + '/v1' : api.url });
      assert.ok((await provider.listModels()).length >= 0);
      const p = Project.create({ name: 'Wire ' + kind, pitch: 'a platformer' });
      const crew = new Crew(p, { provider });
      p.events.subscribe((e) => { if (e.type === 'decision') setTimeout(() => crew.answer(e.decision.id, { option: 0 }), 5); });
      const done = new Promise((resolve) => p.events.subscribe((e) => { if (e.type === 'run' && e.state !== 'started') resolve(e); }));
      await crew.chat('director', 'make a tiny platformer');
      const end = await done;
      assert.equal(end.state, 'finished');
      assert.ok(p.state.contracts.length >= 5 && p.state.contracts.filter((c) => c.status === 'delivered').length >= 4, JSON.stringify(p.state.contracts.map((c) => c.agent + ':' + c.status)));
      assert.ok(seen.requests > 30);
      assert.ok(p.state.usage.input > 3000 && p.state.usage.cached > 0, 'usage from the provider is recorded');
      assert.ok(seen.imageBlocks > 0, 'images from tools reach the model');
      if (kind === 'anthropic') assert.ok(seen.cacheMarks > 30, 'prompt-cache breakpoints are sent');
      crew.dispose();
    } finally { api.server.close(); }
  });
}
