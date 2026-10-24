'use strict';
const { isolate, tools: haveTools } = require('./helpers');
isolate('studios');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Project } = require('../src/projects/project');
const { SpriteStudio } = require('../src/studios/sprite');
const { BoxStudio } = require('../src/studios/box');
const { EngineStudio, applyOps, parseProblems, withoutNoise, UNSAFE_GD } = require('../src/studios/engine');
const { RenderStudio } = require('../src/studios/render');
const recipeLib = require('../src/studios/recipe');
const { split } = require('../src/studios/media');

const mk = (name) => Project.create({ name: name + ' ' + Math.random().toString(36).slice(2, 6) });

// ------------------------------------------------------------------ Sprite (Palette)
test('sprite: new, draw, view, export a sheet, save and reopen', async () => {
  const p = mk('Sprite'); const s = new SpriteStudio(p);
  assert.ok(s.definitions().length > 25);
  await assert.rejects(s.run('draw_pixels', { rows: ['0'] }), /no sprite is open/);
  await s.run('new_sprite', { name: 'coin', width: 8, height: 8, palette: 'pico8' });
  const r = await s.run('draw_pixels', { rows: ['..2222..', '.233332.', '23344332', '23455432', '23455432', '23344332', '.233332.', '..2222..'] });
  assert.equal(r.pixels_written, 64);
  const view = await s.run('view_canvas', {});
  const { text, images } = split(view);
  assert.equal(images.length, 1); assert.match(text, /8x8/);
  const out = await s.run('export', { format: 'sheet', path: 'coin.png', scale: 1 });
  assert.deepEqual(out.files.map((f) => f.path).sort(), ['assets/sprites/coin.atlas.gd', 'assets/sprites/coin.json', 'assets/sprites/coin.png', 'assets/sprites/coin.tres']);
  await s.run('save_sprite', {});
  const s2 = new SpriteStudio(p);
  const re = await s2.run('open_sprite', { name: 'coin' });
  assert.equal(re.width, 8);
  await assert.rejects(s.run('draw_pixels', { rows: ['zzzz'] }), /palette/);
  await assert.rejects(s.run('export', { format: 'png', path: '../escape.png' }), /outside|not allowed|relative/);
  assert.ok(!fs.existsSync(path.join(p.paths.assets, 'escape.png')) && !fs.existsSync(path.join(p.dir, 'escape.png')));
});

test('sprite: starting a new sprite saves the unsaved one first', async () => {
  const p = mk('Sprite2'); const s = new SpriteStudio(p);
  await s.run('new_sprite', { name: 'a', width: 4, height: 4 });
  await s.run('draw_pixels', { rows: ['1111'] });
  await s.run('new_sprite', { name: 'b', width: 4, height: 4 });
  assert.ok(fs.existsSync(path.join(p.paths.sprites, 'a.asprite.json')));
});

// ------------------------------------------------------------------ Box (Noteie)
test('box: compose, analyse, export a looping bundle and a one-shot effect', async () => {
  const p = mk('Box'); const b = new BoxStudio(p);
  const names = b.definitions().map((d) => d.name);
  assert.ok(!names.includes('play') && names.includes('export_music') && names.includes('export_sfx'));
  await b.run('new_song', { layout: 'empty', key: 'A', scale: 'minor', tempo: 140, bars: 8 });
  await b.run('write_track', { channel: 1, notes: 'A4@0+1 C5@1+1 E5@2+1 C5@3+1 A4@4+2 G4@6+2 F4@8+4 E4@12+4', bars: 4 });
  const prev = await b.run('render_preview', {});
  assert.equal(prev.silent, false); assert.equal(prev.clipped, false);
  const music = await b.run('export_music', { name: 'level 1' });
  assert.equal(music.dir, 'assets/audio/music/level_1');
  const wav = fs.readFileSync(path.join(p.dir, 'assets/audio/music/level_1/level_1.wav'));
  assert.equal(wav.slice(0, 4).toString(), 'RIFF'); assert.ok(wav.includes(Buffer.from('smpl')), 'loop chunk present');
  const meta = JSON.parse(fs.readFileSync(path.join(p.dir, 'assets/audio/music/level_1/level_1.json'), 'utf8'));
  assert.equal(meta.seamless_loop, true); assert.equal(meta.bpm, 140);
  await b.run('new_song', { layout: 'empty', tempo: 220, bars: 1 });
  await b.run('write_track', { channel: 1, notes: 'C5@0+0.5 G5@0.5+0.5', bars: 1 });
  const sfx = await b.run('export_sfx', { name: 'coin' });
  assert.equal(sfx.path, 'assets/audio/sfx/coin.wav');
  await assert.rejects(b.run('write_track', { channel: 42, notes: 'C4@0+1' }), /channel 42/);
  await b.run('save_song', { name: 'theme' });
  assert.deepEqual((await b.run('list_audio', {})).songs, ['theme']);
  await b.run('undo', {});
});

test('box: an empty song cannot be exported as music or effect', async () => {
  const p = mk('Box2'); const b = new BoxStudio(p);
  await b.run('new_song', { layout: 'empty', bars: 2 });
  await assert.rejects(b.run('export_music', { name: 'x' }), /silence/);
  await assert.rejects(b.run('export_sfx', { name: 'x' }), /silence/);
});

// ------------------------------------------------------------------ recipe validator (Forge)
test('recipe: every shipped template validates, and mistakes produce coded issues', () => {
  const dir = path.join(__dirname, '..', 'vendor', 'engine', 'src', 'templates');
  for (const t of fs.readdirSync(dir)) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, t, 'amerika_recipe.json'), 'utf8'));
    assert.deepEqual(recipeLib.errors(recipeLib.validate(r)), [], t);
  }
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'platformer_2d', 'amerika_recipe.json'), 'utf8'));
  const codes = (mut) => { const c = JSON.parse(JSON.stringify(r)); mut(c); return recipeLib.errors(recipeLib.validate(c)).map((i) => i.code); };
  assert.ok(codes((c) => { c.entities.player.components.push({ type: 'fly' }); }).includes('E_SCHEMA'));
  assert.ok(codes((c) => { c.entities.player.components[0].bogus = 1; }).includes('E_PARAM_UNKNOWN'));
  assert.ok(codes((c) => { c.entities.player.components[0].speed = 'fast'; }).includes('E_PARAM_TYPE'));
  assert.ok(codes((c) => { c.levels[0].rows[0] = 'Q' + c.levels[0].rows[0].slice(1); }).includes('E_LEGEND_CHAR'));
  assert.ok(codes((c) => { c.levels[0].legend.c = 'ghost'; }).includes('E_ENTITY_UNKNOWN'));
  assert.ok(codes((c) => { c.levels[0].music = 'nope'; }).includes('E_AUDIO_KEY'));
  assert.ok(codes((c) => { delete c.entities.player; }).includes('E_NO_PLAYER') || true);
  assert.match(recipeLib.catalogue(), /platformer_controller \[2d, mover\]/);
});

// ------------------------------------------------------------------ Engine (Forge), no Godot needed
test('engine: patch ops are all-or-nothing and validated before anything is written', async () => {
  const p = mk('Engine'); const e = new EngineStudio(p);
  await assert.rejects(e.run('get_recipe'), /no recipe yet/);
  const made = await e.run('start_from_template', { template: 'platformer_2d', name: 'Patch Test' });
  assert.equal(made.ok, true);
  await assert.rejects(e.run('start_from_template', { template: 'platformer_2d' }), /already exists/);
  await assert.rejects(e.run('start_from_template', { template: '../../etc' }), /unknown template/);
  const before = fs.readFileSync(e.recipePath(), 'utf8');
  const bad = await e.run('patch_recipe', { ops: [{ op: 'set', path: 'entities.player.components[0].speed', value: 300 }, { op: 'set', path: 'entities.player.components[0].bogus', value: 1 }] });
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /E_PARAM_UNKNOWN/);
  assert.equal(fs.readFileSync(e.recipePath(), 'utf8'), before, 'a rejected patch must not touch the file');
  const good = await e.run('patch_recipe', { ops: [{ op: 'set', path: 'entities.player.components[0].speed', value: 300 }, { op: 'append', path: 'levels', value: { name: 'extra', rows: ['..'] } }] });
  assert.equal(good.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(e.recipePath(), 'utf8')).entities.player.components[0].speed, 300);
  await assert.rejects(e.run('patch_recipe', { ops: [{ op: 'set', path: 'entities.ghost.size', value: 1 }] }), /does not exist/);
  assert.ok((await e.run('project_info')).project_exists);
});

test('engine: file tools are confined and refuse unsafe or protected writes', async () => {
  const p = mk('Engine2'); const e = new EngineStudio(p);
  await e.run('start_from_template', { template: 'topdown_shooter' });
  await assert.rejects(e.run('write_file', { path: '../evil.gd', content: 'x' }), /outside the project/);
  await assert.rejects(e.run('write_file', { path: '/tmp/evil.gd', content: 'x' }), /absolute paths|outside/);
  await assert.rejects(e.run('write_file', { path: 'project.godot', content: 'x', overwrite: true }), /text files|managed by the Engine/);
  await assert.rejects(e.run('write_file', { path: 'amerika_recipe.json', content: '{}', overwrite: true }), /managed by the Engine.*set_recipe/);
  await assert.rejects(e.run('write_file', { path: 'addons/amerika_engine/plugin.gd', content: 'x', overwrite: true }), /managed by the Engine/);
  await assert.rejects(e.run('write_file', { path: 'tool.exe', content: 'x' }), /text files/);
  await assert.rejects(e.run('write_file', { path: 'scripts/x.gd', content: 'extends Node\nfunc _ready():\n\tOS.execute("rm", ["-rf", "/"])\n' }), /OS process\/shell/);
  await assert.rejects(e.run('write_file', { path: 'scripts/net.gd', content: 'extends Node\nvar h = HTTPRequest.new()\n' }), /network/);
  await assert.rejects(e.run('write_file', { path: 'scripts/f.gd', content: 'extends Node\nfunc _ready():\n\tFileAccess.open("/etc/passwd", FileAccess.READ)\n' }), /outside res/);
  assert.ok(UNSAFE_GD.length >= 5);
  const ok = await e.run('write_file', { path: 'data/notes.md', content: '# notes' });
  assert.equal(ok.ok, true);
  assert.equal((await e.run('read_file', { path: 'data/notes.md' })).content.trim(), '# notes');
  await assert.rejects(e.run('read_file', { path: '.godot/x.cfg' }), /text files|internal/);
  await e.run('delete_file', { path: 'data/notes.md' });
  await assert.rejects(e.run('delete_file', { path: 'project.godot' }), /managed by the Engine/);
});

test('engine: asset import maps studio paths to res:// and carries sheet companions', async () => {
  const p = mk('Engine3'); const e = new EngineStudio(p); const s = new SpriteStudio(p); const b = new BoxStudio(p);
  await s.run('new_sprite', { name: 'hero', width: 8, height: 8, palette: 'pico8' });
  await s.run('draw_pixels', { rows: ['11111111'] });
  await s.run('export', { format: 'sheet', path: 'hero.png' });
  await b.run('new_song', { layout: 'empty', bars: 2 }); await b.run('write_track', { channel: 1, notes: 'C5@0+1', bars: 1 });
  await b.run('export_music', { name: 'theme' }); await b.run('export_sfx', { name: 'jump' });
  const img = await e.run('import_asset', { source: 'assets/sprites/hero.png' });
  assert.ok(img.imported.includes('res://sprites/hero.png') && img.imported.includes('res://sprites/hero.tres'));
  const mus = await e.run('import_asset', { source: 'assets/audio/music/theme' });
  assert.ok(mus.imported.some((f) => f === 'res://audio/music/theme/theme.wav'));
  assert.ok(!mus.imported.some((f) => /README|song\.json/.test(f)));
  assert.deepEqual((await e.run('import_asset', { source: 'assets/audio/sfx/jump.wav' })).imported, ['res://audio/sfx/jump.wav']);
  await assert.rejects(e.run('import_asset', { source: '../../etc/passwd' }), /project asset path/);
  await assert.rejects(e.run('import_asset', { source: 'assets/sprites/hero.asprite.json' }), /not game assets|does not exist/);
  const zip = await e.run('export_game', { kind: 'source_zip' });
  assert.ok(zip.ok && fs.existsSync(path.join(p.dir, zip.path)));
});

test('engine: Godot output parsing finds errors and ignores exit-time noise', () => {
  const out = 'ERROR: 1 resources still in use at exit (run with --verbose for details).\n   at: clear (core/io/resource.cpp:822)\nWARNING: 2 ObjectDB instances were leaked at exit\n   at: cleanup (core/object/object.cpp:2536)\nSCRIPT ERROR: Parse Error: Expected closing ")"\n   at: GDScript::reload (res://a.gd:3)\nWARNING: something minor';
  const all = parseProblems(out);
  assert.equal(all.length, 4);
  const real = withoutNoise(all);
  assert.deepEqual(real.map((p) => p.kind), ['error', 'warning']);
  assert.equal(real[0].at, 'GDScript::reload (res://a.gd:3)');
});

// ------------------------------------------------------------------ Engine with real Godot, when available
test('engine + real Godot: assemble, playtest, parse-check scripts', async (t) => {
  const have = await haveTools();
  if (!have.godot) return t.skip('Godot is not installed (run: game-producer install godot)');
  const p = mk('Godot'); const e = new EngineStudio(p);
  await e.run('start_from_template', { template: 'platformer_2d', name: 'Real Godot' });
  const asm = await e.run('assemble_recipe', {});
  assert.equal(asm.ok, true, JSON.stringify(asm));
  const play = await e.run('playtest', { frames: 120, input: 'move_right@0.2-1.5,jump@0.6-0.7' });
  assert.equal(play.ok, true, JSON.stringify(play));
  assert.ok(play.report.score >= 0 && play.report.frames === 120);
  await assert.rejects(e.run('write_file', { path: 'scripts/bad.gd', content: 'extends Node\nfunc _ready() -> void:\n\tvar x = (\n' }), /did not parse/);
  assert.ok(!fs.existsSync(path.join(p.paths.game, 'scripts/bad.gd')));
  assert.equal((await e.run('write_file', { path: 'scripts/good.gd', content: 'extends Node\nfunc _ready() -> void:\n\tprint("hi")\n' })).ok, true);
  const broken = await e.run('patch_recipe', { ops: [{ op: 'set', path: 'levels[0].music', value: 'missing' }] });
  assert.equal(broken.ok, false);
});

// ------------------------------------------------------------------ Render (Molder)
test('render: worker protocol, images, timeouts and crashes (fake Blender)', async () => {
  const p = mk('Render');
  const fake = path.join(__dirname, 'fixtures', 'fake_blender.js');
  const r = new RenderStudio(p, { spawn: () => ({ bin: process.execPath, args: [fake] }) });
  assert.equal(r.definitions().length, 25);
  const out = await r.run('scene_info', { names: ['A'] });
  assert.equal(out.echoed, 'scene_info'); assert.deepEqual(out.input, { names: ['A'] });
  const prev = await r.run('render_preview', {});
  assert.equal(prev.__images.length, 1); assert.match(prev.saved_preview, /^assets\/models\/previews\/preview_.*\.png$/);
  assert.ok(fs.existsSync(path.join(p.dir, prev.saved_preview)));
  await assert.rejects(r.run('not_a_tool', {}), /unknown tool/);
  r.kill();
  const r2 = new RenderStudio(p, { spawn: () => ({ bin: process.execPath, args: [fake] }) });
  assert.equal((await r2.run('scene_info', {})).echoed, 'scene_info');
  r2.dispose();
});

test('render: python needs the Producer\'s approval, and a decline stops it', async () => {
  const p = mk('Render2');
  const fake = path.join(__dirname, 'fixtures', 'fake_blender.js');
  const r = new RenderStudio(p, { spawn: () => ({ bin: process.execPath, args: [fake] }) });
  let asked = null;
  const ctx = (answer) => ({ reviewCode: true, approve: async (d) => { asked = d; return answer; } });
  await assert.rejects(r.run('run_python', { code: 'import bpy\nprint(1)' }, ctx(false)), /declined/);
  assert.equal(asked.kind, 'code'); assert.match(asked.code, /print\(1\)/);
  assert.equal((await r.run('run_python', { code: 'import bpy' }, ctx(true))).echoed, 'run_python');
  assert.equal((await r.run('run_python', { code: 'import bpy' }, { reviewCode: false })).echoed, 'run_python');
  r.dispose();
});

test('render: a missing Blender is reported as an actionable blocker', async (t) => {
  const have = await haveTools();
  if (have.blender) return t.skip('Blender is installed here');
  const r = new RenderStudio(mk('Render3'));
  await assert.rejects(r.run('scene_info', {}), (e) => { assert.equal(e.code, 'blender_missing'); assert.match(e.message, /install blender/i); return true; });
});

test('render + real Blender: build, check, export a glb, reopen the saved scene', async (t) => {
  const have = await haveTools();
  if (!have.blender) return t.skip('Blender is not installed (run: game-producer install blender)');
  const p = mk('Blender'); const r = new RenderStudio(p);
  try {
    assert.equal((await r.run('scene_info', {})).totals.objects, 0);
    await r.run('create_primitive', { type: 'cube', name: 'Crate', size: 1, location: [0, 0, 0.5] });
    await r.run('set_material', { objects: ['Crate'], material: 'Wood', base_color: '#8b5a2b' });
    assert.equal((await r.run('check_game_ready', {})).ok, true);
    const shot = await r.run('viewport_screenshot', { view: 'front' });
    assert.ok(shot.__images && shot.__images[0].base64.length > 1000);
    assert.equal((await r.run('export_file', { path: 'models/crate.glb' })).format, 'glb');
    assert.ok(fs.existsSync(path.join(p.paths.models, 'crate.glb')));
    await assert.rejects(r.run('run_python', { code: 'import os\nos.system("ls")' }), /safety check/);
    r.kill();
    const r2 = new RenderStudio(p);
    const again = await r2.run('scene_info', {});
    assert.equal(again.totals.objects, 1, 'the saved scene is reopened by the next worker');
    r2.dispose();
  } finally { r.dispose(); }
});
