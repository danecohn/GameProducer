'use strict';
// OpenAI Chat Completions with function tools. The app speaks Anthropic-style content blocks internally; this file converts.
const { requestJson, withRetry } = require('./http');

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
const dataUrl = (b) => 'data:' + b.source.media_type + ';base64,' + b.source.data;

/** Anthropic-style messages -> OpenAI chat messages. Tool-result images (not allowed in tool messages) follow as a user message. */
function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'assistant') {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const results = blocks.filter((b) => b.type === 'tool_result');
    const images = [];
    for (const r of results) {
      const parts = typeof r.content === 'string' ? [{ type: 'text', text: r.content }] : (r.content || []);
      for (const p of parts) if (p.type === 'image') images.push(p);
      out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: (r.is_error ? 'ERROR: ' : '') + (textOf(parts) || (images.length ? '(image attached below)' : '(empty)')) });
    }
    const rest = blocks.filter((b) => b.type !== 'tool_result');
    const parts = [];
    if (images.length) parts.push({ type: 'text', text: 'Images returned by the tool call(s) above:' }, ...images.map((im) => ({ type: 'image_url', image_url: { url: dataUrl(im) } })));
    for (const b of rest) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push({ type: 'image_url', image_url: { url: dataUrl(b) } });
    }
    if (parts.length) out.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
  }
  return out;
}

/** OpenAI rejects a function whose schema has an array without "items". Fill any gap with "anything". Returns a copy. */
function fixSchema(node) {
  if (Array.isArray(node)) return node.map(fixSchema);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = (k === 'properties' || k === '$defs' || k === 'definitions') && v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, fixSchema(pv)])) : fixSchema(v);
  const types = Array.isArray(out.type) ? out.type : [out.type];
  if (types.includes('array') && out.items === undefined) out.items = {};
  return out;
}

function create({ key, fetchImpl, baseUrl }) {
  const base = (baseUrl || process.env.GP_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const fx = fetchImpl || globalThis.fetch;
  const headers = () => ({ authorization: 'Bearer ' + key });
  const errorParser = (j) => j && j.error ? { message: j.error.message, code: j.error.code || j.error.type } : null;

  async function chat(req) {
    const body = { model: req.model, messages: toOpenAIMessages(req.system, req.messages), max_completion_tokens: req.maxTokens || 8192 };
    if (req.tools && req.tools.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: fixSchema(t.input_schema) } }));
    const json = await withRetry(() => requestJson(fx, base + '/chat/completions', { headers: headers(), body, signal: req.signal, errorParser }), { signal: req.signal, onRetry: req.onRetry });
    const choice = (json.choices || [])[0];
    if (!choice) throw new (require('./errors').LLMError)('server', 'the provider returned no choices');
    const msg = choice.message || {};
    const content = [];
    if (msg.content) content.push({ type: 'text', text: String(msg.content) });
    for (const c of msg.tool_calls || []) {
      let input = {};
      try { input = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch (e) { input = { __parse_error: 'tool arguments were not valid JSON: ' + String(c.function.arguments).slice(0, 200) }; }
      content.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
    }
    const u = json.usage || {};
    return {
      content,
      stopReason: (msg.tool_calls && msg.tool_calls.length) ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason === 'content_filter' ? 'refusal' : 'end_turn',
      usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0 },
    };
  }

  async function listModels(signal) {
    const json = await requestJson(fx, base + '/models', { method: 'GET', headers: headers(), signal, timeoutMs: 20000, errorParser });
    return (json.data || []).map((m) => ({ id: m.id, name: m.id })).filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !/(embedding|tts|whisper|dall|image|audio|realtime|transcribe|moderation|search)/.test(m.id)).sort((a, b) => a.id.localeCompare(b.id));
  }

  return { name: 'openai', chat, listModels };
}

module.exports = { create, toOpenAIMessages, fixSchema };
