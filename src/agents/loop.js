'use strict';
// The tool-use loop every agent runs on: call the model, run the tools it asks for (in parallel), feed results back.
const { LLMError, explain } = require('../llm/errors');
const { ToolError, clip, isAbort, abortError } = require('../util');
const { split } = require('../studios/media');

const MAX_TOOL_TEXT = 14000;

function short(input, max) {
  max = max || 180;
  let s;
  try { s = JSON.stringify(input); } catch (e) { s = String(input); }
  s = (s || '').replace(/\\n/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Keep the conversation affordable: old images and old bulky tool output are shrunk, newest stay intact. */
function trimHistory(messages, opts) {
  opts = opts || {};
  const keepImages = opts.keepImages || 3;
  const recent = opts.recent || 14;
  let images = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!Array.isArray(m.content)) continue;
    const old = i < messages.length - recent;
    let changed = false;
    const content = m.content.map((b) => {
      if (b.type === 'image') { if (++images > keepImages) { changed = true; return { type: 'text', text: '[earlier image omitted]' }; } return b; }
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        const inner = b.content.map((c) => {
          if (c.type === 'image') { if (++images > keepImages) { changed = true; return { type: 'text', text: '[earlier image omitted]' }; } return c; }
          if (old && c.type === 'text' && c.text.length > 1800) { changed = true; return { type: 'text', text: clip(c.text, 1800) }; }
          return c;
        });
        return inner.some((c, k) => c !== b.content[k]) ? { ...b, content: inner } : b;
      }
      if (b.type === 'tool_result' && typeof b.content === 'string' && old && b.content.length > 1800) { changed = true; return { ...b, content: clip(b.content, 1800) }; }
      return b;
    });
    if (changed || content.some((c, k) => c !== m.content[k])) messages[i] = { ...m, content };
  }
}

function sizeOf(messages) {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') { n += m.content.length; continue; }
    for (const b of m.content) {
      if (b.type === 'text') n += b.text.length;
      else if (b.type === 'tool_use') n += JSON.stringify(b.input).length + 40;
      else if (b.type === 'tool_result') n += typeof b.content === 'string' ? b.content.length : b.content.reduce((a, c) => a + (c.type === 'text' ? c.text.length : 1500), 0);
      else if (b.type === 'image') n += 1500;
    }
  }
  return n;
}

/**
 * run({crew, agent, system, tools, messages, maxTurns, signal, inbox, terminal, contractId})
 * `tools`: [{name, description, input_schema, run(input, ctx) -> value}]. `terminal`: tool name that ends the run when it succeeds.
 * Returns {status: 'done'|'terminal'|'max_turns', text, turns, terminalInput}. Throws on LLM errors and on abort.
 */
async function run(o) {
  const { crew, agent, system, tools, messages, maxTurns, signal, terminal, contractId } = o;
  const inbox = o.inbox || [];
  const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const model = crew.modelFor(agent);
  let turns = 0, lastText = '', cutOffs = 0;

  for (;;) {
    if (signal && signal.aborted) throw abortError();
    if (turns >= maxTurns) return { status: 'max_turns', text: lastText, turns };
    await crew.guardBudget(agent, signal);
    trimHistory(messages);
    let res;
    try {
      res = await crew.provider().chat({
        model, system, messages, tools: defs, maxTokens: 8192, signal,
        onRetry: (e, n, wait) => crew.note(agent, 'The provider is busy (' + e.kind + '); retrying in ' + Math.round(wait / 1000) + ' s', contractId),
      });
    } catch (e) {
      if (e instanceof LLMError && e.kind === 'aborted') throw abortError();
      throw e;
    }
    turns++;
    crew.recordUsage(agent, model, res.usage);

    const content = res.content.length ? res.content : [{ type: 'text', text: '(no output)' }];
    messages.push({ role: 'assistant', content });
    const texts = content.filter((b) => b.type === 'text' && b.text.trim() && b.text !== '(no output)');
    if (texts.length) { lastText = texts.map((b) => b.text).join('\n\n'); crew.say(agent, lastText, contractId); }
    const uses = content.filter((b) => b.type === 'tool_use');

    if (!uses.length) {
      if (res.stopReason === 'max_tokens' && cutOffs++ < 3) { messages.push({ role: 'user', content: [{ type: 'text', text: 'Your reply was cut off. Continue, in smaller steps.' }] }); continue; }
      if (res.stopReason === 'refusal') throw new LLMError('invalid_request', 'The model declined this request.');
      return { status: 'done', text: lastText, turns };
    }

    let terminalInput = null;
    const results = await Promise.all(uses.map(async (u) => {
      const t = byName.get(u.name);
      const t0 = Date.now();
      crew.toolStart(agent, u, contractId);
      let block, ok = true, images = [];
      try {
        if (!t) throw new ToolError('unknown tool "' + u.name + '". Your tools: ' + [...byName.keys()].join(', '), 'unknown_tool');
        if (u.input && u.input.__parse_error) throw new ToolError(u.input.__parse_error, 'bad_input');
        if (signal && signal.aborted) throw abortError();
        const value = await t.run(u.input || {}, { signal, agent, contractId, toolUseId: u.id });
        const { text, images: imgs } = split(value);
        images = imgs;
        block = { type: 'tool_result', tool_use_id: u.id, content: [{ type: 'text', text: clip(text, MAX_TOOL_TEXT) }, ...imgs.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } }))] };
        if (u.name === terminal) terminalInput = u.input || {};
        crew.toolDone(agent, u, contractId, { ok: true, ms: Date.now() - t0, images, text });
      } catch (e) {
        ok = false;
        const aborted = isAbort(e) || (signal && signal.aborted);
        const msg = aborted ? 'Stopped by the producer.' : (e instanceof ToolError || e.toolError ? e.message : 'Internal error in ' + u.name + ': ' + (e && e.message ? e.message : e));
        if (!aborted && !(e instanceof ToolError) && !e.toolError) crew.log('tool bug', agent, u.name, e && e.stack);
        block = { type: 'tool_result', tool_use_id: u.id, is_error: true, content: [{ type: 'text', text: clip(msg, 4000) }] };
        crew.toolDone(agent, u, contractId, { ok: false, ms: Date.now() - t0, error: msg });
      }
      return block;
    }));

    const extra = inbox.splice(0).map((text) => ({ type: 'text', text }));
    messages.push({ role: 'user', content: [...results, ...extra] });
    if (o.onTurn) o.onTurn();
    if (terminalInput) return { status: 'terminal', text: lastText, turns, terminalInput };
  }
}

module.exports = { run, trimHistory, sizeOf, short, explain };
