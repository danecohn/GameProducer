'use strict';
// Vigil Engine, headless. Forge builds the game as a Godot 4 project through the vendored "game recipe" assembler,
// the Engine plugin's debug agent (scripted headless playtests) and plain GDScript files.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const { ToolError, confine, walk, clip, slugify } = require('../util');
const toolchain = require('./toolchain');
const recipeLib = require('./recipe');
const { inventory } = require('../projects/inventory');
const { zipDir } = require('../projects/zip');

const VENDOR = path.join(__dirname, '..', '..', 'vendor', 'engine', 'src');
const ADDON_NAME = 'amerika_engine';
const TEXT_EXT = new Set(['gd', 'tscn', 'tres', 'json', 'cfg', 'md', 'txt', 'gdshader', 'csv', 'svg']);
const PROTECTED = [/^project\.godot$/, /^addons\/amerika_engine\//, /^\.godot\//, /^\.git\//, /^\.amerika\//, /^export_presets\.cfg$/, /^amerika_recipe\.json$/, /^amerika_game\.json$/];

// Generated GDScript runs inside the game. These calls reach outside the game, so they are refused (defence in depth;
// the Producer's machine is the sandbox of last resort, so playtests also run only the game's own project).
const UNSAFE_GD = [
  [/\bOS\s*\.\s*(execute|execute_with_pipe|create_process|create_instance|shell_open|shell_show_in_file_manager|kill|move_to_trash|set_environment|crash|read_string_from_stdin)\b/, 'OS process/shell access'],
  [/\b(HTTPRequest|HTTPClient|TCPServer|StreamPeerTCP|StreamPeerTLS|UDPServer|PacketPeerUDP|WebSocketPeer|WebRTCPeerConnection|ENetMultiplayerPeer|ENetConnection)\b/, 'network access'],
  [/\bDirAccess\s*\.\s*(remove_absolute|rename_absolute|copy_absolute)\b|\.remove\s*\(\s*"(?!user:\/\/)/, 'deleting or moving files'],
  [/\bFileAccess\s*\.\s*open(_compressed|_encrypted)?\s*\(\s*"(?!user:\/\/|res:\/\/)/, 'file access outside res:// and user://'],
  [/\b(GDExtension|GDExtensionManager|OS\s*\.\s*load_(?:dynamic|external))\b|\bJavaScriptBridge\b|\bEngine\s*\.\s*get_singleton\b/, 'native/extension access'],
];

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }

/** Run a program with a timeout and an AbortSignal; never leaves the child running. */
function run(bin, args, { cwd, timeoutMs = 120000, signal, env } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, timedOut = false;
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    const cap = (s, chunk) => (s.length < 2000000 ? s + chunk : s);
    child.stdout.on('data', (c) => { out = cap(out, c); });
    child.stderr.on('data', (c) => { err = cap(err, c); });
    const kill = () => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const onAbort = () => kill();
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const finish = (code) => {
      if (done) return; done = true; clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout: stripAnsi(out), stderr: stripAnsi(err), timedOut, aborted: !!(signal && signal.aborted) });
    };
    child.on('error', (e) => { err += String(e.message); finish(-1); });
    child.on('close', (code) => finish(code));
  });
}

/** Pull errors / warnings (with their "at:" lines) out of Godot's output. Mirrors the plugin's runner.gd. */
function parseProblems(text) {
  const lines = stripAnsi(text).split('\n').map((l) => l.replace(/\r$/, ''));
  const problems = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const m = /^(SCRIPT ERROR:|ERROR:|WARNING:|USER ERROR:|USER WARNING:|USER SCRIPT ERROR:)/.exec(t);
    if (!m) continue;
    const p = { kind: /WARNING/.test(m[1]) ? 'warning' : 'error', message: t, at: '' };
    let j = i + 1;
    while (j < lines.length && j < i + 6 && /^\s*(at:|GDScript backtrace|\[\d+\])/.test(lines[j])) {
      if (/^\s*at:/.test(lines[j])) p.at = lines[j].replace(/^\s*at:\s*/, '').trim(); else p.message += '\n' + lines[j].trim();
      j++;
    }
    problems.push(p); i = j - 1;
  }
  return problems;
}

/** Godot prints these when the process exits (leaked resources in headless runs). They say nothing about the game. */
const EXIT_NOISE = /resources? still in use at exit|ObjectDB instances? (were )?leaked|leaked at exit|cleanup \(core\/object|clear \(core\/io\/resource/i;
const withoutNoise = (problems) => problems.filter((p) => !EXIT_NOISE.test(p.message + ' ' + p.at));

function applyOps(recipe, ops) {
  const toKeys = (p) => String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter((k) => k !== '');
  const notes = [];
  for (const [n, op] of ops.entries()) {
    const keys = toKeys(op.path);
    if (!keys.length) throw new ToolError('op ' + n + ': empty path', 'bad_input');
    let node = recipe;
    for (const k of keys.slice(0, -1)) {
      if (node === null || typeof node !== 'object' || !(k in node)) throw new ToolError(`op ${n}: "${op.path}" does not exist (missing "${k}")`, 'bad_input');
      node = node[k];
    }
    const last = keys[keys.length - 1];
    if (op.op === 'set') { if (node === null || typeof node !== 'object') throw new ToolError(`op ${n}: cannot set inside a non-object`, 'bad_input'); node[last] = op.value; }
    else if (op.op === 'delete') { if (Array.isArray(node)) node.splice(Number(last), 1); else delete node[last]; }
    else if (op.op === 'append') {
      const arr = node[last];
      if (!Array.isArray(arr)) throw new ToolError(`op ${n}: "${op.path}" is not an array`, 'bad_input');
      arr.push(op.value);
    } else throw new ToolError(`op ${n}: unknown op "${op.op}" (set | delete | append)`, 'bad_input');
    notes.push(op.op + ' ' + op.path);
  }
  return notes;
}

class EngineStudio {
  constructor(project, opts) {
    this.project = project;
    this.game = project.paths.game;
    this.hosted = !!(opts && opts.hosted);
    this.needsImport = false;
    this.lastPlaytest = null;
  }

  _dir(rel) { return confine(this.game, rel); }
  recipePath() { return path.join(this.game, 'amerika_recipe.json'); }
  readRecipe() { try { return JSON.parse(fs.readFileSync(this.recipePath(), 'utf8')); } catch (e) { return null; } }

  async godot() {
    const s = await toolchain.status('godot');
    if (!s.found) throw new ToolError('Godot is not installed on this machine, so this step cannot run yet. ' + s.hint + ' You can still design the recipe and write files; tell the Director that playtests are blocked.', 'godot_missing');
    return s;
  }

  definitions() {
    const O = (properties, required) => ({ type: 'object', properties, required: required || [] });
    return [
      { name: 'project_info', description: 'Start here. Reports whether Godot is installed, whether the game project exists, the recipe summary (name, genre, entities, levels), whether it is assembled, which game files exist, and which assets from Palette, Molder and Noteie are waiting to be imported.', input_schema: O({}) },
      { name: 'list_templates', description: 'List the starter game templates (genre, title, description). Starting from the closest template and then changing the recipe is much faster than writing a recipe from nothing.', input_schema: O({}) },
      { name: 'start_from_template', description: 'Create the Godot project (if needed) and copy a template recipe into it, renamed to the game\'s name. Refuses to replace an existing recipe unless overwrite is true.', input_schema: O({ template: { type: 'string' }, name: { type: 'string', description: 'Game title' }, overwrite: { type: 'boolean' } }, ['template']) },
      { name: 'get_recipe', description: 'Return the current game recipe (the JSON that describes the whole game).', input_schema: O({}) },
      { name: 'set_recipe', description: 'Replace the whole recipe. It is validated first; if there are errors NOTHING is written and the errors are returned. Use patch_recipe for small changes.', input_schema: O({ recipe: { type: 'object', description: 'The complete recipe object (recipe_version 1).' } }, ['recipe']) },
      { name: 'patch_recipe', description: 'Apply small edits to the recipe: ops of {op:"set"|"delete"|"append", path:"entities.player.components[0].speed", value}. Validated before writing; all-or-nothing.', input_schema: O({ ops: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'object', properties: { op: { type: 'string', enum: ['set', 'delete', 'append'] }, path: { type: 'string' }, value: {} }, required: ['op', 'path'] } } }, ['ops']) },
      { name: 'validate_recipe', description: 'Validate the saved recipe: schema, entity references, legend characters, component parameters, audio keys, story nodes, missing model/sprite files. Returns issues with codes (E_... errors, W_... warnings).', input_schema: O({}) },
      { name: 'assemble_recipe', description: 'Run the Engine assembler in Godot: turns the recipe into scenes, the input map, autoloads, project settings and export presets. Safe to repeat; files you edited by hand are kept unless overwrite is true. Imports pending assets first.', input_schema: O({ overwrite: { type: 'boolean' } }) },
      { name: 'list_files', description: 'List files in the game project (res://). Optional dir.', input_schema: O({ dir: { type: 'string' } }) },
      { name: 'read_file', description: 'Read a text file from the game project (gd, tscn, tres, json, cfg, md, txt, gdshader, csv, svg).', input_schema: O({ path: { type: 'string', description: 'Relative to res://, e.g. scripts/boss.gd' } }, ['path']) },
      { name: 'write_file', description: 'Write a text file into the game project. GDScript is parse-checked by Godot first and refused if it fails, so a broken script never lands. Overwriting needs overwrite:true. Not writable here: project.godot, the recipe (use set_recipe), generated export presets and the Engine plugin. GDScript may not use OS execution, networking or files outside res:// and user://.', input_schema: O({ path: { type: 'string' }, content: { type: 'string' }, overwrite: { type: 'boolean' } }, ['path', 'content']) },
      { name: 'delete_file', description: 'Delete a file you created in the game project (not plugin or generated project files).', input_schema: O({ path: { type: 'string' } }, ['path']) },
      { name: 'import_asset', description: 'Copy a finished asset from the studio into the game project and queue it for Godot import. source is a project path from the asset inventory: assets/sprites/<n>.png (+ its .tres/.json), assets/models/<n>.glb, assets/audio/music/<name> (a whole folder), assets/audio/sfx/<n>.wav. Returns the res:// path to use in the recipe.', input_schema: O({ source: { type: 'string' }, dest: { type: 'string', description: 'Optional res:// subfolder override, e.g. sprites/hero' } }, ['source']) },
      { name: 'playtest', description: 'Play the game HEADLESS for N frames with scripted input and report what happened: script errors and warnings, plus a state report (score, health, player position, scene, state: playing/won/lost). Input spec: "action@start-end,..." in seconds, e.g. "move_right@0.2-2.0,jump@0.6-0.7". Fix every error before anything else.', input_schema: O({ frames: { type: 'integer', minimum: 30, maximum: 7200, description: 'Physics frames at 60/s (default 300).' }, input: { type: 'string' }, scene: { type: 'string', description: 'Optional res:// scene to start instead of the main scene.' } }) },
      { name: 'screenshot', description: 'Run the game in a real window for a few frames and return a screenshot you can look at. Only works where a display exists (a desktop session, not a headless server); otherwise rely on playtest.', input_schema: O({ frames: { type: 'integer', minimum: 10, maximum: 1800 }, input: { type: 'string' } }) },
      { name: 'export_game', description: 'Package the game for the Producer. kind "source_zip" (always works): a zip of the Godot project to open in Godot. kind "native": export with the recipe\'s export_presets (needs Godot export templates installed).', input_schema: O({ kind: { type: 'string', enum: ['source_zip', 'native'] }, preset: { type: 'string', description: 'native only: preset name, default the first' } }, ['kind']) },
    ];
  }

  async run(name, input, ctx) {
    input = input || {};
    const signal = ctx && ctx.signal;
    switch (name) {
      case 'project_info': return this.info();
      case 'list_templates': return this.templates();
      case 'start_from_template': return this.startFromTemplate(input);
      case 'get_recipe': { const r = this.readRecipe(); if (!r) throw new ToolError('no recipe yet. Use start_from_template or set_recipe.', 'no_recipe'); return r; }
      case 'set_recipe': return this.setRecipe(input.recipe);
      case 'patch_recipe': return this.patchRecipe(input.ops);
      case 'validate_recipe': return this.validateSaved();
      case 'assemble_recipe': return this.assemble(!!input.overwrite, signal);
      case 'list_files': return this.listFiles(input.dir);
      case 'read_file': return this.readFile(input.path);
      case 'write_file': return this.writeFile(input.path, input.content, !!input.overwrite, signal);
      case 'delete_file': return this.deleteFile(input.path);
      case 'import_asset': return this.importAsset(input.source, input.dest);
      case 'playtest': return this.playtest(input, signal);
      case 'screenshot': return this.screenshot(input, signal);
      case 'export_game': return this.exportGame(input, signal);
      default: throw new ToolError('unknown tool ' + name, 'unknown_tool');
    }
  }

  // ------------------------------------------------------------ project plumbing
  async ensureProject(name) {
    fs.mkdirSync(this.game, { recursive: true });
    const pg = path.join(this.game, 'project.godot');
    if (!fs.existsSync(pg)) {
      const st = await toolchain.status('godot');
      const m = st.found && /^(\d+\.\d+)/.exec(st.version || '');
      fs.writeFileSync(pg, `; Engine configuration file.\nconfig_version=5\n\n[application]\n\nconfig/name=${JSON.stringify(name || this.project.meta.name)}\nconfig/features=PackedStringArray("${m ? m[1] : '4.4'}")\nconfig/icon="res://icon.svg"\n`);
    }
    const dest = path.join(this.game, 'addons', ADDON_NAME);
    if (!fs.existsSync(path.join(dest, 'plugin.cfg'))) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(path.join(VENDOR, 'addons', ADDON_NAME), dest, { recursive: true, filter: (s) => !/\.uid$|__pycache__/.test(s) });
    }
    let text = fs.readFileSync(pg, 'utf8');
    if (!text.includes('amerika_engine/plugin.cfg')) {
      const line = 'enabled=PackedStringArray("res://addons/amerika_engine/plugin.cfg")';
      text = text.includes('[editor_plugins]') ? text.replace('[editor_plugins]\n', '[editor_plugins]\n\n' + line + '\n') : text.replace(/\s*$/, '\n') + '\n[editor_plugins]\n\n' + line + '\n';
      fs.writeFileSync(pg, text);
    }
    const icon = path.join(VENDOR, 'icons', 'amerika-engine-project.svg');
    if (fs.existsSync(icon) && !fs.existsSync(path.join(this.game, 'icon.svg'))) fs.copyFileSync(icon, path.join(this.game, 'icon.svg'));
    const gi = path.join(this.game, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '.godot/\n.amerika/\n');
  }

  templates() {
    const dir = path.join(VENDOR, 'templates');
    return { templates: fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'template.json'))).map((d) => JSON.parse(fs.readFileSync(path.join(dir, d, 'template.json'), 'utf8'))) };
  }

  async startFromTemplate({ template, name, overwrite }) {
    const src = path.join(VENDOR, 'templates', String(template || '').replace(/[^a-z0-9_]/gi, ''), 'amerika_recipe.json');
    if (!fs.existsSync(src)) throw new ToolError('unknown template "' + template + '". Known: ' + this.templates().templates.map((t) => t.id).join(', '), 'not_found');
    if (fs.existsSync(this.recipePath()) && !overwrite) throw new ToolError('a recipe already exists. Pass overwrite:true to replace it, or edit it with patch_recipe.', 'exists');
    await this.ensureProject(name);
    const r = JSON.parse(fs.readFileSync(src, 'utf8'));
    r.name = name || this.project.meta.name || r.name;
    fs.writeFileSync(this.recipePath(), JSON.stringify(r, null, 1) + '\n');
    const issues = recipeLib.validate(r, this.game);
    return { ok: true, genre: r.genre, entities: Object.keys(r.entities || {}), levels: (r.levels || []).length, issues: issues.map(recipeLib.format), next: 'Edit the recipe to match the bible, then assemble_recipe.' };
  }

  // ------------------------------------------------------------ recipe
  _writeRecipe(recipe) {
    const issues = recipeLib.validate(recipe, this.game);
    const errs = recipeLib.errors(issues);
    if (errs.length) return { ok: false, written: false, errors: errs.slice(0, 25).map(recipeLib.format), more: Math.max(0, errs.length - 25) };
    fs.mkdirSync(this.game, { recursive: true });
    fs.writeFileSync(this.recipePath(), JSON.stringify(recipe, null, 1) + '\n');
    return { ok: true, written: true, warnings: issues.filter((i) => i.severity === 'warning').map(recipeLib.format), next: 'assemble_recipe, then playtest.' };
  }

  async setRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') throw new ToolError('recipe must be an object', 'bad_input');
    await this.ensureProject(recipe.name);
    return this._writeRecipe(recipe);
  }

  async patchRecipe(ops) {
    const r = this.readRecipe();
    if (!r) throw new ToolError('no recipe yet. Use start_from_template or set_recipe first.', 'no_recipe');
    const notes = applyOps(r, ops || []);
    const res = this._writeRecipe(r);
    return { ...res, applied: res.ok ? notes : [] };
  }

  validateSaved() {
    const r = this.readRecipe();
    if (!r) throw new ToolError('no recipe yet.', 'no_recipe');
    const issues = recipeLib.validate(r, this.game);
    return { ok: !recipeLib.errors(issues).length, issues };
  }

  async importPending(signal) {
    if (!this.needsImport) return null;
    const g = await this.godot();
    const r = await run(g.path, ['--headless', '--path', this.game, '--import'], { timeoutMs: 180000, signal });
    this.needsImport = false;
    return { code: r.code, problems: withoutNoise(parseProblems(r.stdout + '\n' + r.stderr)).filter((p) => p.kind === 'error').slice(0, 5) };
  }

  async assemble(overwrite, signal) {
    const r = this.readRecipe();
    if (!r) throw new ToolError('no recipe yet. Use start_from_template or set_recipe first.', 'no_recipe');
    const errs = recipeLib.errors(recipeLib.validate(r, this.game));
    if (errs.length) return { ok: false, errors: errs.slice(0, 25).map(recipeLib.format), hint: 'fix these with patch_recipe, then assemble again' };
    const g = await this.godot();
    await this.ensureProject(r.name);
    await this.importPending(signal);
    const res = await run(g.path, ['--headless', '--path', this.game, '-s', 'res://addons/amerika_engine/cli.gd', '--', 'assemble', ...(overwrite ? ['--overwrite'] : [])], { timeoutMs: 180000, signal });
    const line = res.stdout.split('\n').find((l) => l.startsWith('AMERIKA_REPORT '));
    if (!line) return { ok: false, error: 'the assembler printed no report', output: clip(res.stdout + res.stderr, 3000) };
    const report = JSON.parse(line.slice('AMERIKA_REPORT '.length));
    // new scenes/scripts must be imported before the game can run
    this.needsImport = true;
    await this.importPending(signal);
    return report;
  }

  // ------------------------------------------------------------ files
  _rel(p) {
    const raw = String(p || '').replace(/^res:\/\//, '').replace(/\\/g, '/');
    if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new ToolError('absolute paths are not allowed: "' + p + '". Use a path relative to the game project, like scripts/boss.gd.', 'bad_path');
    confine(this.game, raw || '.');
    return raw;
  }

  listFiles(dir) {
    const rel = dir ? this._rel(dir) : '';
    const root = rel ? this._dir(rel) : this.game;
    if (!fs.existsSync(root)) throw new ToolError('no such directory: ' + (dir || '/'), 'not_found');
    const skip = (n) => n === '.godot' || n === '.git' || n === '.amerika' || n === 'amerika_engine' || n === 'node_modules';
    const files = walk(root, { skip, limit: 400 }).map((f) => ({ path: (rel ? rel + '/' : '') + f.path, bytes: f.size }));
    return { dir: rel || '.', count: files.length, files };
  }

  readFile(p) {
    const rel = this._rel(p);
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!TEXT_EXT.has(ext)) throw new ToolError('only text files can be read (' + [...TEXT_EXT].join(', ') + ')', 'bad_type');
    if (/^(\.godot|\.amerika)\//.test(rel)) throw new ToolError('internal Godot files are not readable', 'bad_path');
    const f = this._dir(rel);
    if (!fs.existsSync(f)) throw new ToolError('no such file: ' + rel, 'not_found');
    return { path: rel, content: clip(fs.readFileSync(f, 'utf8'), 60000) };
  }

  async writeFile(p, content, overwrite, signal) {
    const rel = this._rel(p);
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!TEXT_EXT.has(ext)) throw new ToolError('write_file only writes text files (' + [...TEXT_EXT].join(', ') + '). Binary assets come in through import_asset.', 'bad_type');
    for (const re of PROTECTED) if (re.test(rel)) throw new ToolError('"' + rel + '" is managed by the Engine and cannot be written directly' + (rel === 'amerika_recipe.json' ? ' (use set_recipe / patch_recipe)' : ''), 'protected');
    content = String(content == null ? '' : content);
    if (Buffer.byteLength(content) > 400 * 1024) throw new ToolError('file is larger than 400 KB', 'too_large');
    const target = this._dir(rel);
    if (fs.existsSync(target) && !overwrite) throw new ToolError('"' + rel + '" already exists. Pass overwrite:true to replace it.', 'exists');
    const warnings = [];
    if (ext === 'gd') {
      for (const [re, why] of UNSAFE_GD) if (re.test(content)) throw new ToolError('refused: this script uses ' + why + ', which generated game code may not do. If the Producer really wants it, they can add it by hand in Godot.', 'unsafe_code');
      const check = await this.checkScript(content, signal);
      if (check.errors.length) throw new ToolError('the script did not parse, so it was NOT written:\n' + check.errors.join('\n'), 'parse_error');
      if (check.skipped) warnings.push('not parse-checked: Godot is not installed');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content.endsWith('\n') ? content : content + '\n');
    if (ext === 'gd' || ext === 'tscn' || ext === 'tres') this.needsImport = true;
    return { ok: true, path: rel, bytes: Buffer.byteLength(content), warnings };
  }

  /** Parse-check GDScript with Godot's own compiler in a throwaway file. */
  async checkScript(content, signal) {
    const g = await toolchain.status('godot');
    if (!g.found) return { errors: [], skipped: true };
    await this.ensureProject();
    const tmpRel = '.amerika/check/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.gd';
    const tmp = path.join(this.game, tmpRel);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, content);
    try {
      const r = await run(g.path, ['--headless', '--path', this.game, '--check-only', '--script', 'res://' + tmpRel], { timeoutMs: 60000, signal });
      const errs = parseProblems(r.stdout + '\n' + r.stderr).filter((p) => p.kind === 'error' && /Parse Error|SCRIPT ERROR/.test(p.message));
      return { errors: errs.map((e) => e.message.replace(/^SCRIPT ERROR:\s*/, '') + (e.at ? ' (' + e.at.replace(/res:\/\/\.amerika\/check\/[^:]+/, 'your script') + ')' : '')).slice(0, 8), skipped: false };
    } finally { fs.rmSync(tmp, { force: true }); }
  }

  deleteFile(p) {
    const rel = this._rel(p);
    for (const re of PROTECTED) if (re.test(rel)) throw new ToolError('"' + rel + '" is managed by the Engine and cannot be deleted', 'protected');
    const f = this._dir(rel);
    if (!fs.existsSync(f)) throw new ToolError('no such file: ' + rel, 'not_found');
    if (fs.statSync(f).isDirectory()) throw new ToolError('delete_file removes single files, not folders', 'bad_input');
    fs.rmSync(f);
    return { ok: true, deleted: rel };
  }

  // ------------------------------------------------------------ assets in
  async importAsset(source, destOverride) {
    const src = String(source || '').replace(/\\/g, '/');
    const m = /^assets\/(sprites|models|audio)\/(.+)$/.exec(src);
    if (!m) throw new ToolError('source must be a project asset path like assets/sprites/hero.png (see the asset inventory)', 'bad_path');
    const from = confine(this.project.dir, src, { mustExist: true });
    await this.ensureProject();
    const kind = m[1], tail = m[2];
    const map = { sprites: 'sprites', models: 'models', audio: tail.startsWith('music/') ? 'audio/music' : tail.startsWith('sfx/') ? 'audio/sfx' : 'audio' };
    let destDir = destOverride ? this._rel(destOverride) : map[kind];
    const base = tail.startsWith('music/') ? tail.replace(/^music\//, '') : tail.startsWith('sfx/') ? tail.replace(/^sfx\//, '') : tail;
    const dest = confine(this.game, destDir + '/' + base);
    if (/\.asprite\.json$|\.beepbox\.json$/.test(base)) throw new ToolError('editable studio projects are not game assets; import the exported PNG/WAV instead', 'bad_input');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const st = fs.statSync(from);
    const copied = [];
    if (st.isDirectory()) {
      fs.cpSync(from, dest, { recursive: true, filter: (s) => !/\.song\.json$|README\.txt$/.test(s) });
      for (const f of walk(dest)) copied.push('res://' + path.relative(this.game, path.join(dest, f.path)).split(path.sep).join('/'));
    } else {
      fs.copyFileSync(from, dest);
      copied.push('res://' + path.relative(this.game, dest).split(path.sep).join('/'));
      // sprite sheets travel with their .tres/.json
      if (kind === 'sprites') for (const ext of ['.tres', '.json', '.atlas.gd']) { const side = from.replace(/\.png$/i, ext); if (side !== from && fs.existsSync(side)) { const d = dest.replace(/\.png$/i, ext); fs.copyFileSync(side, d); copied.push('res://' + path.relative(this.game, d).split(path.sep).join('/')); } }
    }
    this.needsImport = true;
    return { ok: true, imported: copied, note: 'Reference these res:// paths in the recipe (entities.<key>.model / sprite.texture, audio.music / audio.sfx). Godot imports them on the next assemble or playtest.' };
  }

  // ------------------------------------------------------------ play
  async info() {
    const g = await toolchain.status('godot');
    const r = this.readRecipe();
    const inv = inventory(this.project);
    const gameFiles = fs.existsSync(this.game) ? walk(this.game, { skip: (n) => ['.godot', '.git', '.amerika', 'amerika_engine'].includes(n), limit: 600 }) : [];
    const ext = {};
    for (const f of gameFiles) { const e = path.extname(f.path).slice(1) || 'other'; ext[e] = (ext[e] || 0) + 1; }
    const issues = r ? recipeLib.validate(r, this.game) : [];
    return {
      godot: g.found ? { found: true, version: g.version } : { found: false, hint: g.hint },
      project_exists: fs.existsSync(path.join(this.game, 'project.godot')),
      recipe: r ? { name: r.name, genre: r.genre, entities: Object.keys(r.entities || {}), levels: (r.levels || []).map((l) => l.name), valid: !recipeLib.errors(issues).length, issues: issues.slice(0, 10).map(recipeLib.format) } : null,
      assembled: fs.existsSync(path.join(this.game, 'amerika_game.json')),
      game_files_by_type: ext,
      last_playtest: this.lastPlaytest,
      assets_ready_to_import: inv,
      pending_godot_import: this.needsImport,
    };
  }

  async playtest(input, signal) {
    const g = await this.godot();
    if (!fs.existsSync(path.join(this.game, 'amerika_game.json'))) throw new ToolError('the game is not assembled yet. Run assemble_recipe first.', 'not_assembled');
    await this.importPending(signal);
    const frames = Math.max(30, Math.min(7200, Number(input.frames) || 300));
    const reportFile = path.join(this.game, '.amerika', 'report-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    const args = ['--headless', '--path', this.game, '--fixed-fps', '60'];
    if (input.scene) args.push(String(input.scene).replace(/[^A-Za-z0-9_./:-]/g, ''));
    args.push('--', '--amerika-agent', '--amerika-frames=' + frames, '--amerika-report=' + reportFile);
    if (input.input) args.push('--amerika-input=' + String(input.input).replace(/[^A-Za-z0-9_@.,-]/g, ''));
    const res = await run(g.path, args, { timeoutMs: Math.max(40000, (frames / 60) * 4000 + 20000), signal });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch (e) { /* no report */ }
    fs.rmSync(reportFile, { force: true });
    const problems = withoutNoise(parseProblems(res.stdout + '\n' + res.stderr));
    const errors = problems.filter((p) => p.kind === 'error');
    const out = {
      ok: !errors.length && !!report && !res.timedOut,
      frames_requested: frames,
      state: report ? report.state : 'no_report',
      report,
      errors: errors.slice(0, 12).map((p) => p.message + (p.at ? '  [' + p.at + ']' : '')),
      warnings: problems.filter((p) => p.kind === 'warning').length,
      timed_out: res.timedOut || undefined,
      output_tail: errors.length || !report ? clip(res.stdout + '\n' + res.stderr, 2500) : undefined,
    };
    this.lastPlaytest = { at: new Date().toISOString(), ok: out.ok, state: out.state, errors: errors.length };
    return out;
  }

  async screenshot(input, signal) {
    const g = await this.godot();
    const hasDisplay = !this.hosted && (process.platform === 'darwin' || process.platform === 'win32' || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY);
    if (!hasDisplay) throw new ToolError('there is no display on this machine, so screenshots are unavailable. Use playtest and its state report instead.', 'no_display');
    if (!fs.existsSync(path.join(this.game, 'amerika_game.json'))) throw new ToolError('the game is not assembled yet. Run assemble_recipe first.', 'not_assembled');
    await this.importPending(signal);
    const shot = path.join(this.game, '.amerika', 'shot-' + Date.now() + '.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    const frames = Math.max(10, Math.min(1800, Number(input.frames) || 120));
    const args = ['--path', this.game, '--', '--amerika-agent', '--amerika-frames=' + frames, '--amerika-shot=' + shot];
    if (input.input) args.push('--amerika-input=' + String(input.input).replace(/[^A-Za-z0-9_@.,-]/g, ''));
    const res = await run(g.path, args, { timeoutMs: 90000, signal });
    if (!fs.existsSync(shot)) throw new ToolError('no screenshot was produced. ' + clip(res.stdout + res.stderr, 800), 'no_shot');
    const data = fs.readFileSync(shot);
    fs.rmSync(shot, { force: true });
    return { ok: true, frames, __images: [{ mime: 'image/png', base64: data.toString('base64') }] };
  }

  async exportGame(input, signal) {
    const out = path.join(this.project.dir, 'exports');
    const slug = slugify(this.project.meta.name);
    if (input.kind === 'source_zip') {
      const f = path.join(out, slug + '-godot-project.zip');
      const r = zipDir(this.game, f, slug, (rel) => /^(\.godot|\.git|\.amerika)(\/|$)/.test(rel));
      return { ok: true, path: 'exports/' + path.basename(f), files: r.files, bytes: r.bytes, note: 'Unzip and open the folder in Godot 4 (Import > the project.godot file). Press F5 to play.' };
    }
    const g = await this.godot();
    const presetsFile = path.join(this.game, 'export_presets.cfg');
    if (!fs.existsSync(presetsFile)) throw new ToolError('no export presets yet. Add "export_presets" to the recipe and assemble_recipe.', 'no_presets');
    const names = [...fs.readFileSync(presetsFile, 'utf8').matchAll(/^name="([^"]+)"/gm)].map((m) => m[1]);
    const preset = input.preset || names[0];
    if (!names.includes(preset)) throw new ToolError('unknown preset "' + preset + '". Presets: ' + names.join(', '), 'bad_input');
    const dir = path.join(out, slugify(preset));
    fs.mkdirSync(dir, { recursive: true });
    const ext = /windows/i.test(preset) ? '.exe' : /web/i.test(preset) ? '.html' : /mac/i.test(preset) ? '.zip' : '';
    const target = path.join(dir, slug + ext);
    await this.importPending(signal);
    const res = await run(g.path, ['--headless', '--path', this.game, '--export-release', preset, target], { timeoutMs: 600000, signal });
    const ok = fs.existsSync(target);
    return { ok, path: ok ? path.relative(this.project.dir, target) : undefined, output: ok ? undefined : clip(res.stdout + res.stderr, 1500), hint: ok ? undefined : 'Export templates may be missing: in Godot choose Editor > Manage Export Templates, or use kind "source_zip".' };
  }

  dispose() {}
}

module.exports = { EngineStudio, parseProblems, withoutNoise, applyOps, run, UNSAFE_GD };
