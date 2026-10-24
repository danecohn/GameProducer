'use strict';
const { isolate, tools: haveTools, waitFor } = require('./helpers');
isolate('crew');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { Project } = require('../src/projects/project');
const { Crew } = require('../src/crew');
const { RenderStudio } = require('../src/studios/render');
const mock = require('../src/llm/mock');
const { LLMError } = require('../src/llm/errors');

const mk = (name) => Project.create({ name: name + ' ' + Math.random().toString(36).slice(2, 6), pitch: 'a game' });
const finished = (project, channel) => new Promise((resolve) => { const off = project.events.subscribe((e) => { if (e.type === 'run' && e.channel === channel && e.state !== 'started') { off(); resolve(e.state); } }); });
const autoAnswer = (crew, pick) => crew.project.events.subscribe((e) => { if (e.type === 'decision') setTimeout(() => crew.answer(e.decision.id, typeof pick === 'function' ? pick(e.decision) : { option: pick || 0 }), 5); });

test('the scripted demo crew builds a game through every studio, in parallel, with Producer decisions', async () => {
  const have = await haveTools();
  const p = mk('Coin Quest'); const crew = new Crew(p, { provider: mock.create() });
  autoAnswer(crew, 0);
  const done = finished(p, 'director');
  await crew.chat('director', 'Make me a tiny platformer');
  assert.equal(await done, 'finished');
  const byAgent = Object.fromEntries(p.state.contracts.map((c, i) => [c.agent + (i > 0 && p.state.contracts.filter((x) => x.agent === c.agent).indexOf(c) > 0 ? '2' : ''), c.status]));
  assert.equal(byAgent.sking, 'delivered'); assert.equal(byAgent.palette, 'delivered'); assert.equal(byAgent.noteie, 'delivered');
  if (have.godot) { assert.equal(byAgent.forge, 'delivered'); assert.equal(byAgent.forge2, 'delivered'); }
  else { assert.match(byAgent.forge, /blocked|partial/, 'without Godot, Forge must say it is blocked, not pretend'); }
  // assets really exist
  assert.ok(fs.existsSync(path.join(p.dir, 'assets/sprites/hero.png')));
  assert.ok(fs.existsSync(path.join(p.dir, 'assets/audio/music/level_1/level_1.wav')));
  assert.ok(fs.existsSync(path.join(p.dir, 'assets/audio/sfx/jump.wav')));
  assert.match(p.bible.read('BIBLE.md'), /Coin Quest/);
  // the contracts of palette, noteie and forge overlapped in time
  const c = p.state.contracts.filter((x) => ['palette', 'noteie', 'forge'].includes(x.agent)).slice(0, 3);
  const overlap = Math.min(...c.map((x) => x.finished)) > Math.max(...c.map((x) => x.started));
  assert.ok(overlap, 'palette, noteie and forge should have worked at the same time');
  // decisions are recorded, milestones published, usage counted per agent
  assert.equal(p.state.decisions.filter((d) => d.status === 'answered').length, 1);
  assert.equal(p.state.milestones.length >= 5 && p.state.milestones.every((m) => m.status === 'done'), true);
  for (const a of ['director', 'sking', 'palette', 'noteie', 'forge']) assert.ok(p.state.usage.byAgent[a].calls > 0, a);
  if (have.godot) {
    const info = await crew.studio('engine').info();
    assert.equal(info.assembled, true);
    assert.equal(info.last_playtest.ok, true, 'the integration playtest must be clean');
    assert.ok(fs.existsSync(path.join(p.dir, 'game/sprites/hero.png')));
  }
  assert.equal(crew.busy(), false);
  assert.ok(Object.values(crew.agentStatus).every((s) => s.status === 'idle'));
  crew.dispose();
});

test('conversation survives a restart, continues, and can be reset', async () => {
  const p = mk('Persist'); const crew = new Crew(p, { provider: mock.create() });
  autoAnswer(crew, 0);
  let done = finished(p, 'director');
  await crew.chat('director', 'make a platformer'); await done;
  const saved = p.loadChat('director');
  assert.ok(saved.length > 10);
  assert.ok(!JSON.stringify(saved).includes('mock_undefined'));
  const again = new Crew(Project.open(p.id), { provider: mock.create() });
  done = finished(again.project, 'director');
  await again.chat('director', 'what now?'); await done;
  assert.ok(again.project.loadChat('director').length > saved.length);
  again.resetChat('director');
  assert.equal(again.project.loadChat('director').length, 0);
  crew.dispose(); again.dispose();
});

test('stop cancels running contracts and waiting questions', async () => {
  process.env.GP_MOCK_DELAY_MS = '60';
  const p = mk('Stop'); const crew = new Crew(p, { provider: mock.create() });
  const done = finished(p, 'director');
  await crew.chat('director', 'go');
  await waitFor(() => p.state.decisions.some((d) => d.status === 'pending'), 8000, 'the Producer question');
  crew.stop();
  assert.equal(await done, 'stopped');
  assert.ok(p.state.decisions.every((d) => d.status !== 'pending'));
  assert.equal(crew.busy(), false);
  process.env.GP_MOCK_DELAY_MS = '1';
  crew.dispose();
});

test('Producer notes sent mid-run reach the Director on its next step', async () => {
  const seen = [];
  let turn = 0;
  const provider = { name: 'fake', chat: async (req) => {
    seen.push(JSON.stringify(req.messages[req.messages.length - 1]));
    await new Promise((r) => setTimeout(r, 30));
    turn++;
    return turn < 3 ? { content: [{ type: 'tool_use', id: 't' + turn, name: 'get_project_state', input: {} }], stopReason: 'tool_use', usage: { input: 1, output: 1, cached: 0 } } : { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { input: 1, output: 1, cached: 0 } };
  } };
  const p = mk('Notes'); const crew = new Crew(p, { provider });
  const done = finished(p, 'director');
  await crew.chat('director', 'start');
  assert.deepEqual(await crew.chat('director', 'actually make it blue'), { queued: true });
  await done;
  assert.ok(seen.some((m) => m.includes('actually make it blue')), 'the note was delivered inside the running conversation');
  crew.dispose();
});

test('budget: the team stops and asks before spending past the limit', async () => {
  config.saveSettings({ budgetTokens: 3000 });
  const p = mk('Budget'); const crew = new Crew(p, { provider: mock.create() });
  crew._settings = null;
  const asked = new Promise((resolve) => p.events.subscribe((e) => { if (e.type === 'decision' && e.decision.kind === 'budget') resolve(e.decision); }));
  autoAnswer(crew, (d) => (d.kind === 'budget' ? { option: d.options.length - 1 } : { option: 0 }));   // "Stop here"
  const done = finished(p, 'director');
  await crew.chat('director', 'go');
  const d = await asked;
  assert.match(d.question, /budget/);
  assert.equal(await done, 'stopped');
  config.saveSettings({ budgetTokens: 8000000 });
  crew.dispose();
});

test('a rejected key surfaces as a clear error, not a hang', async () => {
  const provider = { name: 'fake', chat: async () => { throw new LLMError('auth', 'bad key'); } };
  const p = mk('Auth'); const crew = new Crew(p, { provider });
  const errored = new Promise((resolve) => p.events.subscribe((e) => { if (e.type === 'error') resolve(e); }));
  const done = finished(p, 'director');
  await crew.chat('director', 'hi');
  const e = await errored;
  assert.equal(e.kind, 'auth'); assert.match(e.message, /rejected the API key/);
  assert.equal(await done, 'error');
  await assert.rejects(new Crew(mk('NoKey')).chat('director', 'hi'), (x) => x.kind === 'no_key');
  crew.dispose();
});

test('Molder asks the Producer before running Blender Python, and a decline is respected', async () => {
  let n = 0;
  const provider = { name: 'fake', chat: async (req) => {
    const agent = /^\[\[agent:(\w+)\]\]/.exec(req.system)[1];
    n++;
    const last = req.messages[req.messages.length - 1];
    const results = last.role === 'user' && Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
    const u = { input: 1, output: 1, cached: 0 };
    if (agent === 'director') {
      if (!results.length) return { content: [{ type: 'tool_use', id: 'c1', name: 'contract_agent', input: { agent: 'molder', title: 'Scatter rocks', brief: 'Scatter 20 rocks with python.' } }], stopReason: 'tool_use', usage: u };
      return { content: [{ type: 'text', text: 'Molder said: ' + results[0].content[0].text.slice(0, 120) }], stopReason: 'end_turn', usage: u };
    }
    if (!results.length) return { content: [{ type: 'tool_use', id: 'p1', name: 'run_python', input: { code: 'import bpy\nprint("rocks")', description: 'scatter' } }], stopReason: 'tool_use', usage: u };
    const declined = results[0].is_error;
    return { content: [{ type: 'tool_use', id: 's1', name: 'submit_deliverable', input: { status: declined ? 'blocked' : 'delivered', summary: declined ? 'declined' : 'ran', files: [], notes: '' } }], stopReason: 'tool_use', usage: u };
  } };
  const p = mk('Approve'); const crew = new Crew(p, { provider });
  const fake = path.join(__dirname, 'fixtures', 'fake_blender.js');
  crew.studios.render = new RenderStudio(p, { spawn: () => ({ bin: process.execPath, args: [fake] }) });
  let shown = null;
  autoAnswer(crew, (d) => { shown = d; return { option: 1 }; });   // Decline
  const done = finished(p, 'director');
  await crew.chat('director', 'rocks please');
  assert.equal(await done, 'finished');
  assert.equal(shown.kind, 'approval'); assert.match(shown.code, /print\("rocks"\)/);
  assert.equal(p.state.contracts[0].status, 'blocked');
  crew.dispose();
});
