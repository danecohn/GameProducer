'use strict';
// A game project on disk: bible, assets from each studio, the Godot project, and the Producer's working state.
//
//   <projects>/<id>/
//     project.json         name, pitch, timestamps
//     bible/               Sking's documents (BIBLE.md, STORY.md, ...)
//     assets/sprites|models|audio   Palette, Molder, Noteie output
//     game/                the Godot project Forge builds
//     .producer/           state.json, chat-*.json, events.jsonl, media/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { Bible } = require('./bible');
const { EventLog } = require('./events');
const { slugify, confine, ToolError } = require('../util');

const CHANNELS = ['director', 'sking'];

function freshState() {
  return { contracts: [], milestones: [], decisions: [], usage: { input: 0, output: 0, cached: 0, calls: 0, byAgent: {} }, budgetApproved: 0 };
}

class Project {
  constructor(dir) {
    this.dir = fs.realpathSync(dir);   // resolved once, so every derived path compares equal to what confine() returns
    dir = this.dir;
    this.id = path.basename(dir);
    this.meta = config.readJson(path.join(dir, 'project.json'), { id: this.id, name: this.id });
    this.paths = {
      bible: path.join(dir, 'bible'),
      assets: path.join(dir, 'assets'),
      sprites: path.join(dir, 'assets', 'sprites'),
      models: path.join(dir, 'assets', 'models'),
      audio: path.join(dir, 'assets', 'audio'),
      game: path.join(dir, 'game'),
      producer: path.join(dir, '.producer'),
      media: path.join(dir, '.producer', 'media'),
    };
    for (const p of Object.values(this.paths)) fs.mkdirSync(p, { recursive: true });
    this.bible = new Bible(this.paths.bible);
    this.events = new EventLog(path.join(this.paths.producer, 'events.jsonl'));
    this.state = { ...freshState(), ...config.readJson(path.join(this.paths.producer, 'state.json'), {}) };
    this._recover();
    this._saveTimer = null;
  }

  static idFor(name) { return slugify(name); }

  static list() {
    config.ensureDir(config.paths.projects);
    return fs.readdirSync(config.paths.projects, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(config.paths.projects, d.name, 'project.json')))
      .map((d) => config.readJson(path.join(config.paths.projects, d.name, 'project.json'), null)).filter(Boolean)
      .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  }

  static create({ name, pitch }) {
    name = String(name || '').trim().slice(0, 80);
    if (!name) throw new ToolError('a game needs a name', 'bad_input');
    config.ensureDir(config.paths.projects);
    let id = Project.idFor(name), n = 2;
    while (fs.existsSync(path.join(config.paths.projects, id))) id = Project.idFor(name) + '-' + n++;
    const dir = path.join(config.paths.projects, id);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    config.writeJson(path.join(dir, 'project.json'), { id, name, pitch: String(pitch || '').slice(0, 4000), created: now, updated: now });
    const p = new Project(dir);
    p.bible.init(name, pitch);
    return p;
  }

  static open(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id))) throw new ToolError('bad project id', 'bad_input');
    const dir = path.join(config.paths.projects, id);
    if (!fs.existsSync(path.join(dir, 'project.json'))) throw new ToolError('no such project: ' + id, 'not_found');
    return new Project(dir);
  }

  // ------------------------------------------------------------ state
  _recover() {
    let touched = false;
    for (const c of this.state.contracts) if (c.status === 'running' || c.status === 'queued') { c.status = 'interrupted'; c.finished = Date.now(); touched = true; }
    for (const d of this.state.decisions) if (d.status === 'pending') { d.status = 'expired'; touched = true; }
    if (touched) this.saveNow();
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.saveNow(); }, 150);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  saveNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    config.writeJson(path.join(this.paths.producer, 'state.json'), this.state);
    this.meta.updated = new Date().toISOString();
    config.writeJson(path.join(this.dir, 'project.json'), this.meta);
  }

  addUsage(agent, model, u) {
    const t = this.state.usage;
    t.input += u.input || 0; t.output += u.output || 0; t.cached += u.cached || 0; t.calls += 1;
    const a = t.byAgent[agent] || (t.byAgent[agent] = { input: 0, output: 0, cached: 0, calls: 0, model });
    a.input += u.input || 0; a.output += u.output || 0; a.cached += u.cached || 0; a.calls += 1; a.model = model;
    this.save();
  }

  tokensUsed() { return this.state.usage.input + this.state.usage.output; }

  // ------------------------------------------------------------ conversations (raw model messages)
  _chatFile(channel) {
    if (!CHANNELS.includes(channel)) throw new ToolError('unknown channel ' + channel, 'bad_input');
    return path.join(this.paths.producer, 'chat-' + channel + '.json');
  }
  loadChat(channel) { return repairMessages(config.readJson(this._chatFile(channel), [])); }
  saveChat(channel, messages) { config.writeJson(this._chatFile(channel), messages); }
  resetChat(channel) { try { fs.unlinkSync(this._chatFile(channel)); } catch (e) { /* none */ } }

  // ------------------------------------------------------------ media (images produced by tools, shown in the UI)
  saveMedia(base64, mime) {
    const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/gif' ? '.gif' : '.png';
    const hash = crypto.createHash('sha1').update(base64).digest('hex').slice(0, 14);
    const name = hash + ext;
    const f = path.join(this.paths.media, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(base64, 'base64'));
    return { name, url: '/api/projects/' + this.id + '/media/' + name };
  }

  /** Resolve a project-relative path for the file API (assets, bible, media, game sources; never .producer internals). */
  resolvePublic(rel) {
    const clean = String(rel || '').replace(/\\/g, '/');
    if (clean.split('/').some((seg) => seg === '..' || seg === '.')) throw new ToolError('path must not contain . or .. segments', 'bad_path');
    if (!/^(assets|bible|game|exports)\//.test(clean) && !/^\.producer\/media\//.test(clean)) throw new ToolError('only assets/, bible/, game/ and exports/ are readable', 'bad_path');
    return confine(this.dir, clean, { mustExist: true });
  }

  summary() {
    return { id: this.id, name: this.meta.name, pitch: this.meta.pitch, created: this.meta.created, updated: this.meta.updated };
  }
}

/** A crash or Stop can leave an assistant tool_use without its tool_result, which providers reject. Close any such gap. */
function repairMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    out.push(m);
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const uses = m.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) continue;
    const next = messages[i + 1];
    const answered = new Set(next && next.role === 'user' && Array.isArray(next.content) ? next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : []);
    const missing = uses.filter((u) => !answered.has(u.id));
    if (!missing.length) continue;
    const fill = missing.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Interrupted before this tool finished.' }));
    if (next && next.role === 'user' && Array.isArray(next.content)) { next.content = [...next.content.filter((b) => b.type === 'tool_result'), ...fill, ...next.content.filter((b) => b.type !== 'tool_result')]; }
    else out.push({ role: 'user', content: fill });
  }
  return out;
}

module.exports = { Project, repairMessages, CHANNELS };
