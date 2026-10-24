'use strict';
// Tool sets per agent. Studio tools are thin wrappers over the vendored studios; the rest is team plumbing.
const fs = require('fs');
const path = require('path');
const { ToolError, confine, clip, safeName } = require('../util');
const { inventory, counts } = require('../projects/inventory');
const toolchain = require('../studios/toolchain');
const { WORKERS, BY_ID } = require('./roster');

const O = (properties, required) => ({ type: 'object', properties, required: required || [] });
const vendorSprite = () => require('../../vendor/sprite/src/app/js/png.js');
const vendorAudio = () => require('../../vendor/box/src/app/amerika/audio.js');

// ---------------------------------------------------------------------------------------------- shared
function commonTools(crew) {
  const project = crew.project;
  return [
    {
      name: 'read_bible', description: 'Read the project bible. With no "doc" it lists the documents; with doc (for example BIBLE.md, STORY.md) it returns the full text. Read BIBLE.md before you start work.',
      input_schema: O({ doc: { type: 'string' } }),
      async run({ doc }) { return doc ? { doc, content: clip(project.bible.read(doc), 60000) } : { documents: project.bible.list(), recent_changes: project.bible.recentChanges(8) }; },
    },
    {
      name: 'list_assets', description: 'List every asset in the project: sprites (editable projects, PNG/GIF exports, sprite sheets), 3D models (.glb, previews), audio (music bundles, sound effects, editable songs).',
      input_schema: O({}),
      async run() { return inventory(project); },
    },
    {
      name: 'view_asset', description: 'Look at a project file. Images (PNG, JPG, GIF) are shown to you, small pixel art is enlarged so you can judge it. WAV files report duration, peak and loudness. Other files report size, text files show their start. Paths are project-relative: assets/..., game/..., bible/....',
      input_schema: O({ path: { type: 'string' }, scale: { type: 'integer', minimum: 1, maximum: 16, description: 'Integer upscale for small pixel art (default: automatic).' } }, ['path']),
      async run({ path: rel, scale }) { return viewAsset(project, rel, scale); },
    },
  ];
}

function viewAsset(project, rel, scale) {
  if (!/^(assets|game|bible|exports)\//.test(String(rel || '').replace(/\\/g, '/'))) throw new ToolError('only files under assets/, game/, bible/ and exports/ can be viewed', 'bad_path');
  const file = confine(project.dir, rel, { mustExist: true });
  const st = fs.statSync(file);
  if (st.isDirectory()) throw new ToolError('that is a folder; use list_assets', 'bad_input');
  const ext = path.extname(file).slice(1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    if (st.size > 6 * 1024 * 1024) throw new ToolError('image is larger than 6 MB', 'too_large');
    let buf = fs.readFileSync(file), mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext, note = '';
    if (ext === 'png') {
      try {
        const PNG = vendorSprite();
        const img = PNG.decode(buf);
        const small = Math.max(img.width, img.height);
        const k = scale || (small < 256 ? Math.min(16, Math.max(1, Math.floor(256 / small))) : 1);
        if (k > 1 && img.width * k <= 2048 && img.height * k <= 2048) {
          const W = img.width * k, H = img.height * k, out = new Uint8Array(W * H * 4), src = img.rgba;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((y / k | 0) * img.width + (x / k | 0)) * 4, d = (y * W + x) * 4; out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3]; }
          buf = Buffer.from(PNG.encode(W, H, out));
          note = ' Shown enlarged ' + k + 'x (nearest neighbour).';
        }
        return { path: rel, size: img.width + 'x' + img.height + ' px.' + note, __images: [{ mime: 'image/png', base64: buf.toString('base64') }] };
      } catch (e) { /* fall through to the raw image */ }
    }
    return { path: rel, bytes: st.size, __images: [{ mime, base64: buf.toString('base64') }] };
  }
  if (ext === 'wav') {
    const A = vendorAudio();
    try {
      const w = A.decodeWav(new Uint8Array(fs.readFileSync(file)));
      const peak = A.peakOf(w.L, w.R || w.L);
      return { path: rel, seconds: +(w.frames / w.sampleRate).toFixed(3), sample_rate: w.sampleRate, channels: w.channels, peak_dbfs: +(20 * Math.log10(Math.max(1e-9, peak))).toFixed(1), loop: w.loop || undefined, bytes: st.size };
    } catch (e) { return { path: rel, bytes: st.size, note: 'could not decode this WAV: ' + e.message }; }
  }
  if (['glb', 'gltf', 'ogg', 'mp3', 'zip', 'blend'].includes(ext)) return { path: rel, bytes: st.size, note: 'binary file; ' + (ext === 'glb' || ext === 'blend' ? 'look at the matching preview image under assets/models/previews/ instead' : 'size only') };
  if (st.size > 2 * 1024 * 1024) throw new ToolError('file is larger than 2 MB', 'too_large');
  return { path: rel, content: clip(fs.readFileSync(file, 'utf8'), 8000) };
}

// ---------------------------------------------------------------------------------------------- studios
function studioTools(crew, agentId) {
  const wrap = (studioKey, defs, extra) => defs.map((d) => ({
    ...d,
    async run(input, tctx) {
      const studio = crew.studio(studioKey);
      const res = await studio.run(d.name, input, { signal: tctx.signal, reviewCode: crew.settings.reviewCode, approve: (details) => crew.approveCode(agentId, details, tctx.signal), ...(extra || {}) });
      crew.assetsMaybeChanged();
      return res;
    },
  }));
  switch (agentId) {
    case 'palette': return wrap('sprite', crew.studio('sprite').definitions());
    case 'noteie': return wrap('box', crew.studio('box').definitions());
    case 'molder': return wrap('render', crew.studio('render').definitions());
    case 'forge': return wrap('engine', crew.studio('engine').definitions());
    default: return [];
  }
}

function deliverableTool() {
  return {
    name: 'submit_deliverable',
    description: 'Finish your contract. Call this once, last. The Director only sees this, not your tool calls.',
    input_schema: O({
      status: { type: 'string', enum: ['delivered', 'partial', 'blocked'] },
      summary: { type: 'string', description: 'What exists now and the choices you made, in a few sentences.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Project-relative paths of what you made.' },
      notes: { type: 'string', description: 'Exact details the next agent needs: names, sizes, frame counts, loop points, controls, placeholders.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Anything the Director must decide or arrange.' },
    }, ['status', 'summary']),
    async run(input) { return { ok: true, recorded: true }; },
  };
}

// ---------------------------------------------------------------------------------------------- Sking
function skingTools(crew) {
  const bible = crew.project.bible;
  const changed = (name, note) => { crew.emitBible(name); };
  return [
    {
      name: 'write_bible_doc',
      description: 'Create or update a bible document (BIBLE.md, STORY.md, CHARACTERS.md, WORLD.md, DIALOGUE.md, ART.md, AUDIO.md, PLAN.md ... names are UPPERCASE.md). mode "replace" writes the whole document (read it first when updating); "append" adds to the end. Then call log_change.',
      input_schema: O({ name: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] } }, ['name', 'content']),
      async run({ name, content, mode }) { const r = bible.write(name, content, mode === 'append' ? 'append' : 'replace'); changed(name); return { ok: true, ...r }; },
    },
    {
      name: 'log_change', description: 'Record one line in the bible changelog saying what you changed and why (the team reads it).',
      input_schema: O({ summary: { type: 'string' } }, ['summary']),
      async run({ summary }, tctx) { bible.changelog(BY_ID[tctx.agent].name, summary); changed('CHANGELOG.md'); return { ok: true }; },
    },
    logDecisionTool(crew),
  ];
}

function logDecisionTool(crew) {
  return {
    name: 'log_decision', description: 'Record a decision the Producer made in the "Decisions" section of BIBLE.md (dated), so it is never lost.',
    input_schema: O({ decision: { type: 'string' } }, ['decision']),
    async run({ decision }, tctx) {
      const bible = crew.project.bible;
      let text = '';
      try { text = bible.read('BIBLE.md'); } catch (e) { text = '# Bible\n\n## Decisions\n'; }
      const line = '- ' + new Date().toISOString().slice(0, 10) + ': ' + String(decision).replace(/\s+/g, ' ').trim();
      text = /^## Decisions\s*$/m.test(text) ? text.replace(/(^## Decisions[^\n]*\n)([\s\S]*?)(?=\n## |\s*$)/m, (m, h, body) => h + body.replace(/^_.*_\s*$/m, '').replace(/\s*$/, '\n') + line + '\n') : text.replace(/\s*$/, '\n\n## Decisions\n' + line + '\n');
      bible.write('BIBLE.md', text);
      bible.changelog(BY_ID[tctx.agent].name, 'decision: ' + decision);
      crew.emitBible('BIBLE.md');
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------- Director
function directorTools(crew) {
  return [
    {
      name: 'get_project_state', description: 'Everything about the project right now: the Producer\'s pitch, which tools are installed (Godot, Blender), bible documents, milestones, contracts and their results, assets, the game\'s build status, and budget. Call this at the start of every turn.',
      input_schema: O({}),
      async run() { return crew.projectState(); },
    },
    {
      name: 'contract_agent',
      description: 'Hire a team member for a piece of work and wait for their deliverable. Call it several times in ONE reply to run different agents at the same time. Each agent does one contract at a time (extra contracts to the same agent queue). The agent does NOT see this conversation, so the brief must be self-contained: what to make, exact file names, sizes, palette and mood, how it will be used, what "done" means, which bible documents to read. Returns the agent\'s deliverable: status, summary, files, notes, questions.',
      input_schema: O({
        agent: { type: 'string', enum: WORKERS, description: 'sking (writing, bible), forge (game engine), molder (3D), palette (2D), noteie (music and sound).' },
        title: { type: 'string', description: 'Short label, e.g. "Hero sprite sheet".' },
        brief: { type: 'string', description: 'The full self-contained instructions.' },
        deliverables: { type: 'array', items: { type: 'string' }, description: 'What must exist when it is done, with file names.' },
      }, ['agent', 'title', 'brief']),
      async run(input, tctx) { return crew.contract(input.agent, input, tctx.signal); },
    },
    {
      name: 'ask_producer',
      description: 'Ask the Producer a question and wait for their answer. Use it for creative forks, scope changes and spend, not for things you can decide. Give 2 to 4 options with a one-line description each, put your recommendation first and say so in the question. The Producer may also type their own answer.',
      input_schema: O({
        question: { type: 'string' },
        options: { type: 'array', maxItems: 5, items: O({ label: { type: 'string' }, description: { type: 'string' } }, ['label']) },
      }, ['question']),
      async run(input, tctx) { return crew.ask({ agent: 'director', kind: 'question', question: input.question, options: input.options || [], signal: tctx.signal }); },
    },
    {
      name: 'set_milestones',
      description: 'Publish the production plan the Producer sees on the board: 3 to 8 milestones. Replace the whole list each time. status: todo | doing | done | blocked. owner: an agent id.',
      input_schema: O({ milestones: { type: 'array', minItems: 1, maxItems: 10, items: O({ title: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] }, owner: { type: 'string' }, note: { type: 'string' } }, ['title', 'status']) } }, ['milestones']),
      async run({ milestones }) { crew.setMilestones(milestones); return { ok: true, count: milestones.length }; },
    },
    logDecisionTool(crew),
  ];
}

/** The tools an agent gets. mode: 'contract' (worker run) or 'chat' (talking to the Producer). */
function toolsFor(crew, agentId, mode) {
  const base = commonTools(crew);
  if (agentId === 'director') return [...base, ...directorTools(crew)];
  if (agentId === 'sking') return [...base, ...skingTools(crew), ...(mode === 'contract' ? [deliverableTool()] : [])];
  return [...base, ...studioTools(crew, agentId), deliverableTool()];
}

module.exports = { toolsFor, viewAsset, commonTools };
