'use strict';
// Demo crew: a SCRIPTED stand-in for the model so the whole studio can be tried (and tested) without an API key and
// without spending anything. It makes real tool calls against the real studios; only the "thinking" is canned.
// It is clearly labelled in the UI and is selected with GP_PROVIDER=mock or "Try the demo crew".
let seq = 0;
const tid = () => 'mock_' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
const text = (t) => ({ type: 'text', text: t });
const use = (name, input) => ({ type: 'tool_use', id: tid(), name, input: input || {} });
const reply = (content, stop) => ({ content, stopReason: stop || (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'), usage: { input: 900, output: 160, cached: 0 } });

function agentOf(system) { const m = /^\[\[agent:(\w+)\]\]/.exec(system || ''); return m ? m[1] : 'director'; }
function blocksOf(m) { return typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content; }
function allText(messages) { return messages.map((m) => blocksOf(m).map((b) => b.type === 'text' ? b.text : '').join('\n')).join('\n'); }

/** How many assistant turns happened since the current "task start" message. */
function turnIndex(messages, isTaskStart) {
  let start = 0;
  messages.forEach((m, i) => { if (m.role === 'user' && blocksOf(m).some((b) => b.type === 'text' && isTaskStart(b.text))) start = i; });
  return messages.slice(start).filter((m) => m.role === 'assistant').length;
}

function lastResults(messages) {
  const last = messages[messages.length - 1];
  return last && last.role === 'user' ? blocksOf(last).filter((b) => b.type === 'tool_result') : [];
}
const resultText = (r) => (typeof r.content === 'string' ? r.content : (r.content || []).map((c) => c.text || '').join(' '));

const HERO = [
  '................', '....00000000....', '...0cccccccc0...', '..0cccccccccc0..', '..0cc77cc77cc0..', '..0cc70cc70cc0..', '..0cccccccccc0..', '...0cccccccc0...',
  '....00000000....', '...0888888880...', '..088888888880..', '..088888888880..', '..0f88888888f0..', '...0888008880...', '...0880..0880...', '...0000..0000...',
];
const COIN = ['..0000..', '.0aaaa0.', '0aa77aa0', '0a7aaaa0', '0a7aaaa0', '0aaaaaa0', '.0aaaa0.', '..0000..'];

function gameName(messages) { const m = /Game: (.+)/.exec(allText(messages)); return (m ? m[1] : 'Demo Game').trim(); }

// ---------------------------------------------------------------------------------------------- Director
function director(messages) {
  const everything = allText(messages);
  const snapshot = (everything.match(/Assets so far: (\d+) sprite image\(s\), (\d+) model\(s\), (\d+) music track\(s\)/g) || []).pop() || '';
  const nums = (/(\d+) sprite image\(s\), (\d+) model\(s\), (\d+) music/.exec(snapshot) || []).slice(1).map(Number);
  const hasAssets = nums.some((n) => n > 0);
  const t = turnIndex(messages, (s) => s.startsWith('Producer: '));
  const wants3d = /\b3d\b|model|blender|crate/i.test(everything.split('<project_snapshot>')[0] + (everything.match(/Producer: .*/g) || []).join(' '));
  const name = gameName(messages);
  const res = lastResults(messages);
  const prior = (nm) => { for (let i = messages.length - 1; i >= 0; i--) for (const b of (messages[i].role === 'assistant' ? blocksOf(messages[i]) : [])) if (b.type === 'tool_use' && b.name === nm) return b; return null; };

  if (t === 0 && hasAssets) return reply([text('[Demo crew] The scripted production already ran for this game. With a real API key I would plan your next change here; in demo mode I can only replay the same showcase. Start a new game to see it again.')]);
  if (t === 0) return reply([text('[Demo crew: scripted, no AI is running] Got it. Let me check where the project stands.'), use('get_project_state', {})]);
  if (t === 1) return reply([text('Plan: a small 2D platformer. First Sking locks the bible, then Palette, Noteie and Forge work in parallel.'),
    use('set_milestones', { milestones: [{ title: 'Bible and direction', status: 'doing', owner: 'sking' }, { title: 'Art: hero and coin', status: 'todo', owner: 'palette' }, { title: 'Music and sound effects', status: 'todo', owner: 'noteie' }, ...(wants3d ? [{ title: '3D prop: crate', status: 'todo', owner: 'molder' }] : []), { title: 'Playable build', status: 'todo', owner: 'forge' }, { title: 'Integration and playtest', status: 'todo', owner: 'forge' }] }),
    use('contract_agent', { agent: 'sking', title: 'Project bible', brief: 'Write the project bible for "' + name + '" from the Producer\'s pitch: pillars, scope of the first playable (one level), art direction (16x16 pixel art, PICO-8 palette), audio direction (chiptune), controls (arrows/WASD, space to jump). Update BIBLE.md and log the change.', deliverables: ['bible/BIBLE.md'] })]);
  if (t === 2) return reply([text('The bible is in. One creative call for you before art starts.'),
    use('ask_producer', { question: 'Which visual mood should Palette use? I recommend neon, it reads best at 16x16.', options: [{ label: 'Neon arcade', description: 'Bright PICO-8 colours on a dark sky (recommended)' }, { label: 'Soft pastel', description: 'Calmer and cosier' }, { label: 'Monochrome', description: 'Game Boy greens' }] })]);
  if (t === 3) {
    const ans = res.length ? resultText(res[0]) : '';
    const mood = (/"answer":"([^"]+)"/.exec(ans) || [])[1] || 'Neon arcade';
    return reply([text('Locked in: ' + mood + '. Starting art, audio' + (wants3d ? ', a 3D prop' : '') + ' and the engine skeleton at the same time.'),
      use('contract_agent', { agent: 'palette', title: 'Hero and coin sprites', brief: 'Make a 16x16 hero (2-frame idle bob) and an 8x8 coin in the ' + mood + ' style, PICO-8 palette. Export sheets hero.png and coin.png (horizontal layout, scale 1).', deliverables: ['assets/sprites/hero.png', 'assets/sprites/coin.png'] }),
      use('contract_agent', { agent: 'noteie', title: 'Level music and sound effects', brief: 'Compose an 8-bar looping chiptune level theme "level_1" (A minor, 140 bpm) and the effects "jump" and "pickup". Export them for the game.', deliverables: ['assets/audio/music/level_1', 'assets/audio/sfx/jump.wav', 'assets/audio/sfx/pickup.wav'] }),
      ...(wants3d ? [use('contract_agent', { agent: 'molder', title: 'Crate prop', brief: 'Model a low-poly wooden crate (1 m cube, brown), check it is game-ready and export crate.glb.', deliverables: ['assets/models/crate.glb'] })] : []),
      use('contract_agent', { agent: 'forge', title: 'Game skeleton', brief: 'Create the game from the closest template (platformer_2d), rename it, assemble and playtest it with placeholder shapes. Report the controls.', deliverables: ['game/ project that runs'] })]);
  }
  if (t === 4) return reply([text('All four delivered. Let me look at the art before integrating.'), use('view_asset', { path: 'assets/sprites/hero.png' })]);
  if (t === 5) return reply([text('The hero reads well. Forge, bring the art and audio in.'),
    use('contract_agent', { agent: 'forge', title: 'Integrate art and audio', brief: 'Import assets/sprites/hero.png (2 frames, hframes=2, idle 0-1) and assets/sprites/coin.png, the music bundle assets/audio/music/level_1 and the effects assets/audio/sfx/jump.wav and pickup.wav. Point the recipe at them, assemble, playtest, and package the project as a source zip.', deliverables: ['game/ updated', 'exports/*.zip'] })]);
  if (t === 6) return reply([use('set_milestones', { milestones: [{ title: 'Bible and direction', status: 'done', owner: 'sking' }, { title: 'Art: hero and coin', status: 'done', owner: 'palette' }, { title: 'Music and sound effects', status: 'done', owner: 'noteie' }, ...(wants3d ? [{ title: '3D prop: crate', status: 'done', owner: 'molder' }] : []), { title: 'Playable build', status: 'done', owner: 'forge' }, { title: 'Integration and playtest', status: 'done', owner: 'forge' }] })]);
  return reply([text('First playable is ready. In the Game tab you will find the build status and the zipped Godot project; open it in Godot 4 and press F5. Move with the arrow keys or A/D, jump with Space, collect the coins and reach the flag. Everything here was produced by a scripted demo crew; connect an API key to have the real team build your own idea. What should we change next?')]);
}

// ---------------------------------------------------------------------------------------------- workers
function sking(messages) {
  const t = turnIndex(messages, (s) => s.startsWith('# Contract'));
  const name = gameName(messages);
  if (t === 0) return reply([text('Reading the current bible.'), use('read_bible', { doc: 'BIBLE.md' })]);
  if (t === 1) return reply([use('write_bible_doc', { name: 'BIBLE.md', mode: 'replace', content: `# ${name}: Project Bible\n\n## Pitch\nA tiny, joyful platformer: run, jump, grab coins, reach the flag.\n\n## Pillars\n- Instant feel: responsive jump, readable hazards\n- One screen of clarity: tiny sprites, strong silhouettes\n- Short and finishable: one level, about two minutes\n\n## Genre and platform\n2D platformer (platformer_2d) for desktop. Keyboard: arrows or A/D, Space to jump.\n\n## Scope\nFirst playable: one level, coins, patrolling blobs, spikes, a goal flag.\n\n## Art direction\n16x16 characters, 8x8 items, PICO-8 palette, dark sky, bright characters.\n\n## Audio direction\nChiptune, A minor, 140 bpm, looping level theme; short effects for jump and pickup.\n\n## Technical constraints\nGodot 4 via AltStack Engine; keyboard only; no networking.\n\n## Status\nBible written. Art, audio and engine skeleton starting.\n\n## Decisions\n- Demo crew: scripted showcase.\n` }),
    use('write_bible_doc', { name: 'CHARACTERS.md', mode: 'replace', content: '# Characters\n\n## Hero\nA small blue-headed runner with a red suit. 16x16. Brave, silent.\n\n## Blob\nPatrolling red blob enemy. Stomp it.\n' })]);
  if (t === 2) return reply([use('log_change', { summary: 'wrote BIBLE.md and CHARACTERS.md for the first playable' })]);
  return reply([use('submit_deliverable', { status: 'delivered', summary: 'Bible and character notes written.', files: ['bible/BIBLE.md', 'bible/CHARACTERS.md'], notes: 'Genre platformer_2d, 16x16 hero, PICO-8 palette, chiptune A minor 140 bpm.', questions: [] })]);
}

function palette(messages) {
  const t = turnIndex(messages, (s) => s.startsWith('# Contract'));
  if (t === 0) return reply([text('Setting up the hero on a 16x16 canvas with the PICO-8 palette.'), use('new_sprite', { name: 'hero', width: 16, height: 16, mode: 'indexed', palette: 'pico8' })]);
  if (t === 1) return reply([use('draw_pixels', { x: 0, y: 0, rows: HERO })]);
  if (t === 2) return reply([use('copy_frame_with_transform', { dy: 1, dx: 0 })]);
  if (t === 3) return reply([use('set_tag', { name: 'idle', from: 0, to: 1, direction: 'forward' }), use('view_canvas', { all_frames: true })]);
  if (t === 4) return reply([use('export', { format: 'sheet', path: 'hero.png', layout: 'horizontal' }), use('save_sprite', {})]);
  if (t === 5) return reply([text('Hero done. Now the coin.'), use('new_sprite', { name: 'coin', width: 8, height: 8, mode: 'indexed', palette: 'pico8' })]);
  if (t === 6) return reply([use('draw_pixels', { x: 0, y: 0, rows: COIN })]);
  if (t === 7) return reply([use('export', { format: 'sheet', path: 'coin.png', layout: 'horizontal' }), use('save_sprite', {})]);
  return reply([use('submit_deliverable', { status: 'delivered', summary: 'Hero (2-frame idle) and coin delivered in the PICO-8 palette.', files: ['assets/sprites/hero.png', 'assets/sprites/hero.tres', 'assets/sprites/coin.png'], notes: 'hero.png: frame 16x16, hframes 2, vframes 1, animation idle = frames 0-1 (150 ms). coin.png: 8x8, 1 frame. Palette: PICO-8 (black outline index 0, skin f, blue c, red 8, yellow a).', questions: [] })]);
}

function noteie(messages) {
  const t = turnIndex(messages, (s) => s.startsWith('# Contract'));
  if (t === 0) return reply([text('Starting a minor-key level theme.'), use('new_song', { layout: 'empty', key: 'A', scale: 'minor', tempo: 140, bars: 8 })]);
  if (t === 1) return reply([use('add_channel', { type: 'pitch', instrument: 'triangle bass', octave: 2 })]);
  if (t === 2) return reply([use('write_track', { channel: 1, notes: 'A4@0+1 C5@1+1 E5@2+1 C5@3+1 A4@4+2 G4@6+2 F4@8+4 E4@12+4', bars: 4 }), use('generate_part', { channel: 2, kind: 'bass', progression: 'i VI III VII', bars: 8, style: 'arp' })]);
  if (t === 3) return reply([use('render_preview', {})]);
  if (t === 4) return reply([use('save_song', { name: 'level_1' }), use('export_music', { name: 'level_1' })]);
  if (t === 5) return reply([use('new_song', { layout: 'empty', tempo: 220, bars: 1 })]);
  if (t === 6) return reply([use('write_track', { channel: 1, notes: 'E5@0+0.5 A5@0.5+1', bars: 1 }), use('export_sfx', { name: 'jump' })]);
  if (t === 7) return reply([use('new_song', { layout: 'empty', tempo: 240, bars: 1 })]);
  if (t === 8) return reply([use('write_track', { channel: 1, notes: 'C6@0+0.25 G6@0.25+0.75', bars: 1 }), use('export_sfx', { name: 'pickup' })]);
  return reply([use('submit_deliverable', { status: 'delivered', summary: 'Looping level theme and two sound effects exported.', files: ['assets/audio/music/level_1/level_1.wav', 'assets/audio/sfx/jump.wav', 'assets/audio/sfx/pickup.wav'], notes: 'level_1: 8 bars A minor 140 bpm, loops seamlessly (see level_1.json for loop points). jump.wav and pickup.wav are one-shots named to be played automatically by the engine.', questions: [] })]);
}

function molder(messages) {
  const t = turnIndex(messages, (s) => s.startsWith('# Contract'));
  const res = lastResults(messages);
  if (t > 0 && res.some((r) => r.is_error && /Blender is not installed/.test(resultText(r)))) return reply([use('submit_deliverable', { status: 'blocked', summary: 'Blender is not installed on this machine, so no 3D model could be made.', files: [], notes: 'Install Blender 5 (game-producer install blender) and contract me again. Forge can use a placeholder shape meanwhile.', questions: ['Should I retry once Blender is installed?'] })]);
  if (t === 0) return reply([text('Blocking out the crate.'), use('create_primitive', { type: 'cube', name: 'Crate', size: 1, location: [0, 0, 0.5] })]);
  if (t === 1) return reply([use('set_material', { objects: ['Crate'], material: 'Wood', base_color: '#8b5a2b', roughness: 0.8 })]);
  if (t === 2) return reply([use('check_game_ready', {}), use('viewport_screenshot', { view: 'front' })]);
  if (t === 3) return reply([use('export_file', { path: 'models/crate.glb' })]);
  return reply([use('submit_deliverable', { status: 'delivered', summary: 'Low-poly crate exported.', files: ['assets/models/crate.glb'], notes: 'crate.glb: 1 m cube, 12 triangles, origin at the base, one brown material.', questions: [] })]);
}

function forge(messages) {
  const everything = allText(messages);
  const integrate = /Integrate art and audio/.test(everything);
  const t = turnIndex(messages, (s) => s.startsWith('# Contract'));
  if (!integrate) {
    if (t === 0) return reply([text('Checking the project, then starting from the platformer template.'), use('project_info', {})]);
    if (t === 1) return reply([use('start_from_template', { template: 'platformer_2d', name: gameName(messages), overwrite: true })]);
    if (t === 2) return reply([use('assemble_recipe', {})]);
    if (t === 3) return reply([use('playtest', { frames: 240, input: 'move_right@0.2-2.5,jump@0.8-0.95' })]);
    const last = lastResults(messages).map(resultText).join(' ');
    const blocked = /Godot is not installed/.test(last);
    return reply([use('submit_deliverable', blocked
      ? { status: 'blocked', summary: 'The recipe is ready but Godot is not installed on this machine, so it could not be assembled or played.', files: ['game/amerika_recipe.json'], notes: 'Install Godot 4 (game-producer install godot), then contract me again to assemble and playtest.', questions: [] }
      : { status: 'delivered', summary: 'Platformer skeleton assembled with placeholder shapes; a scripted run collected coins with no errors.', files: ['game/amerika_recipe.json', 'game/levels/level_1.tscn'], notes: 'Controls: arrows or A/D to move, Space to jump (double jump). Everything is a placeholder shape until art is imported.', questions: [] })]);
  }
  if (t === 0) return reply([text('Importing the art and audio.'), use('import_asset', { source: 'assets/sprites/hero.png' }), use('import_asset', { source: 'assets/sprites/coin.png' }), use('import_asset', { source: 'assets/audio/music/level_1' }), use('import_asset', { source: 'assets/audio/sfx/jump.wav' }), use('import_asset', { source: 'assets/audio/sfx/pickup.wav' })]);
  if (t === 1) return reply([use('patch_recipe', { ops: [
    { op: 'set', path: 'entities.player.sprite', value: { texture: 'res://sprites/hero.png', hframes: 2, vframes: 1 } },
    { op: 'append', path: 'entities.player.components', value: { type: 'sprite_anim', animations: { idle: [0, 1] }, fps: 6 } },
    { op: 'set', path: 'audio', value: { music: { level_1: 'res://audio/music/level_1/level_1.wav' }, sfx: { jump: 'res://audio/sfx/jump.wav', pickup: 'res://audio/sfx/pickup.wav' } } },
    { op: 'set', path: 'levels[0].music', value: 'level_1' },
  ] })]);
  if (t === 2) return reply([use('assemble_recipe', { overwrite: true })]);
  if (t === 3) return reply([use('playtest', { frames: 240, input: 'move_right@0.2-2.5,jump@0.8-0.95' })]);
  if (t === 4) return reply([use('export_game', { kind: 'source_zip' })]);
  const last = lastResults(messages).map(resultText).join(' ');
  return reply([use('submit_deliverable', /Godot is not installed/.test(last) || /Godot is not installed/.test(everything)
    ? { status: 'partial', summary: 'Assets imported where possible, but Godot is not installed, so the game could not be assembled or played.', files: [], notes: 'Install Godot 4 and contract me again.', questions: [] }
    : { status: 'delivered', summary: 'Art and audio are wired in; the scripted playtest ran clean and the project is zipped.', files: ['game/amerika_recipe.json', 'exports/'], notes: 'Hero uses sprite hero.png (2 frames, idle). Music level_1 loops; jump and pickup effects play automatically. Controls: arrows/A-D, Space.', questions: [] })]);
}

const SCRIPTS = { director, sking, palette, noteie, molder, forge };

function create() {
  return {
    name: 'mock',
    async chat(req) {
      await new Promise((r) => setTimeout(r, Number(process.env.GP_MOCK_DELAY_MS || 120)));
      if (req.signal && req.signal.aborted) { const { LLMError } = require('./errors'); throw new LLMError('aborted', 'stopped'); }
      const agent = agentOf(req.system);
      // Sking talking directly to the Producer (no contract): a single canned reply.
      if (agent === 'sking' && !messagesHaveContract(req.messages)) return reply([text('[Demo crew] I am Sking, the writer. In demo mode I only echo that I am here; with a real API key I would draft your story, characters and dialogue and keep the bible current.')]);
      return (SCRIPTS[agent] || director)(req.messages);
    },
    async listModels() { return [{ id: 'demo-crew', name: 'Demo crew (scripted)' }]; },
  };
}
function messagesHaveContract(messages) { return /# Contract/.test(allText(messages)); }

module.exports = { create };
