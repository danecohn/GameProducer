'use strict';
const { isolate } = require('./helpers');
isolate('tools');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../src/projects/project');
const { Crew } = require('../src/crew');
const { toolsFor } = require('../src/agents/tools');
const { ROSTER } = require('../src/agents/roster');
const { systemPrompt } = require('../src/agents/prompts');
const { fixSchema } = require('../src/llm/openai');
const mock = require('../src/llm/mock');

function arraysWithoutItems(node, trail, out) {
  if (Array.isArray(node)) { node.forEach((n, i) => arraysWithoutItems(n, trail + '[' + i + ']', out)); return out; }
  if (node && typeof node === 'object') {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes('array') && node.items === undefined) out.push(trail);
    for (const [k, v] of Object.entries(node)) arraysWithoutItems(v, trail + '.' + k, out);
  }
  return out;
}

test('every agent\'s tools are valid for Anthropic and OpenAI function calling', () => {
  const p = Project.create({ name: 'Tool Schemas' });
  const crew = new Crew(p, { provider: mock.create() });
  for (const a of ROSTER) {
    for (const mode of ['chat', 'contract']) {
      const tools = toolsFor(crew, a.id, mode);
      const names = tools.map((t) => t.name);
      assert.equal(new Set(names).size, names.length, a.id + ' has duplicate tool names');
      for (const t of tools) {
        assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/, a.id + '.' + t.name);
        assert.ok(t.description && t.description.length > 15, t.name + ' needs a description');
        assert.equal(t.input_schema.type, 'object', t.name);
        for (const r of t.input_schema.required || []) assert.ok(t.input_schema.properties && t.input_schema.properties[r], t.name + ' requires unknown property ' + r);
        assert.equal(typeof t.run, 'function');
        assert.equal(arraysWithoutItems(fixSchema(t.input_schema), t.name, []).length, 0, t.name + ' still has an array without items after the OpenAI fix');
        assert.ok(JSON.stringify(t.input_schema).length < 30000, t.name + ' schema is huge');
      }
    }
  }
  const sizeOf = (id) => JSON.stringify(toolsFor(crew, id, 'chat').map((t) => ({ n: t.name, d: t.description, s: t.input_schema }))).length;
  for (const a of ROSTER) assert.ok(sizeOf(a.id) < 160000, a.id + ' tool definitions are too large to send every turn');
  crew.dispose();
});

test('role boundaries: only Director contracts and asks, only specialists deliver, Sking alone writes the bible', () => {
  const p = Project.create({ name: 'Roles' });
  const crew = new Crew(p, { provider: mock.create() });
  const has = (id, mode, name) => toolsFor(crew, id, mode).some((t) => t.name === name);
  assert.ok(has('director', 'chat', 'contract_agent') && has('director', 'chat', 'ask_producer'));
  for (const id of ['forge', 'molder', 'palette', 'noteie', 'sking']) { assert.ok(!has(id, 'contract', 'contract_agent'), id); assert.ok(!has(id, 'contract', 'ask_producer'), id); assert.ok(has(id, 'contract', 'submit_deliverable'), id); }
  assert.ok(!has('sking', 'chat', 'submit_deliverable'), 'Sking talking to the Producer has no contract to submit');
  assert.ok(has('sking', 'chat', 'write_bible_doc') && !has('director', 'chat', 'write_bible_doc') && !has('forge', 'contract', 'write_bible_doc'));
  assert.ok(has('forge', 'contract', 'playtest') && has('molder', 'contract', 'export_file') && has('palette', 'contract', 'draw_pixels') && has('noteie', 'contract', 'export_music'));
  assert.ok(!has('palette', 'contract', 'playtest') && !has('director', 'chat', 'draw_pixels'));
  crew.dispose();
});

test('persona prompts carry the studio manuals, the roster and the contract rules', () => {
  for (const a of ROSTER) {
    const t = systemPrompt(a.id);
    assert.ok(t.startsWith('[[agent:' + a.id + ']]'));
    for (const other of ROSTER) assert.ok(t.includes(other.name), a.id + ' prompt should know ' + other.name);
    assert.ok(t.includes('bible/'));
  }
  assert.match(systemPrompt('forge'), /platformer_controller \[2d, mover\]/);       // live component catalogue
  assert.match(systemPrompt('forge'), /GDScript 4 style/);                          // from the Engine's own manual
  assert.match(systemPrompt('palette'), /PIXEL-ART RULES/);                         // from Sprite's own manual
  assert.match(systemPrompt('noteie'), /BeepBox/);                                  // from Box's own manual
  assert.match(systemPrompt('molder'), /Game-ready conventions/);                   // from Render's own manual
  assert.match(systemPrompt('director'), /ask_producer/); assert.match(systemPrompt('director'), /IN PARALLEL/);
  assert.match(systemPrompt('palette'), /hframes/);
});
