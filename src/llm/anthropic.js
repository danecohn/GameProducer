'use strict';
// Anthropic Messages API. Internal message format IS the Anthropic format, so this is a thin client.
const { requestJson, withRetry } = require('./http');
const { LLMError } = require('./errors');

const VERSION = '2023-06-01';

function create({ key, fetchImpl, baseUrl }) {
  const base = (baseUrl || process.env.GP_ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const fx = fetchImpl || globalThis.fetch;
  const headers = () => ({ 'x-api-key': key, 'anthropic-version': VERSION });
  const errorParser = (j) => j && j.error ? { message: j.error.message, code: j.error.type } : null;

  /** Mark the stable prefix (system, tools) and the newest message as cache breakpoints (max 4 allowed). */
  function withCache(req) {
    const system = req.system ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }] : undefined;
    const tools = req.tools && req.tools.length ? req.tools.map((t, i, a) => i === a.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t) : undefined;
    const messages = req.messages.map((m) => m);
    const last = messages[messages.length - 1];
    if (last && Array.isArray(last.content) && last.content.length) {
      const blocks = last.content.slice();
      const i = blocks.length - 1;
      blocks[i] = { ...blocks[i], cache_control: { type: 'ephemeral' } };
      messages[messages.length - 1] = { ...last, content: blocks };
    }
    return { system, tools, messages };
  }

  async function chat(req) {
    const c = withCache(req);
    const body = { model: req.model, max_tokens: req.maxTokens || 8192, messages: c.messages };
    if (c.system) body.system = c.system;
    if (c.tools) body.tools = c.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, ...(t.cache_control ? { cache_control: t.cache_control } : {}) }));
    const json = await withRetry(() => requestJson(fx, base + '/v1/messages', { headers: headers(), body, signal: req.signal, errorParser }), { signal: req.signal, onRetry: req.onRetry });
    const content = (json.content || []).filter((b) => b.type === 'text' || b.type === 'tool_use').map((b) => b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} });
    const u = json.usage || {};
    return {
      content,
      stopReason: json.stop_reason === 'tool_use' ? 'tool_use' : json.stop_reason === 'max_tokens' ? 'max_tokens' : json.stop_reason === 'refusal' ? 'refusal' : 'end_turn',
      usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 },
    };
  }

  async function listModels(signal) {
    const json = await requestJson(fx, base + '/v1/models?limit=100', { method: 'GET', headers: headers(), signal, timeoutMs: 20000, errorParser });
    return (json.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  }

  return { name: 'anthropic', chat, listModels };
}

module.exports = { create, LLMError };
