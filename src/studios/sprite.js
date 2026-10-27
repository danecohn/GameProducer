'use strict';
// Cohnsoft Sprite, headless. Palette drives the real Sprite tool set (vendor/sprite) against an in-memory document.
const fs = require('fs');
const path = require('path');
const { ToolError, safeName, confine, walk } = require('../util');

const J = (n) => require(path.join(__dirname, '..', '..', 'vendor', 'sprite', 'src', 'app', 'js', n + '.js'));

class SpriteStudio {
  constructor(project) {
    this.project = project;
    this.M = J('model'); this.Tools = J('tools'); this.AI = J('ai'); this.PNG = J('png');
    const { Session } = J('session');
    this.Session = Session;
    this.S = null;
    this.name = null;
    this.dir = project.paths.sprites;
  }

  systemManual() { return this.AI.SYSTEM_PROMPT; }

  /** Sprite's own tools plus the project-level ones (new/open/save/list) that the desktop app handles through menus. */
  definitions() {
    const own = this.Tools.definitions().map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema }));
    const nameProp = { type: 'string', description: 'Asset name, letters digits . _ - and spaces. Saved as assets/sprites/<name>.asprite.json.' };
    return [
      { name: 'new_sprite', description: 'Start a NEW sprite (a fresh document) and make it the current one. Save the previous one first with save_sprite if you want to keep it. Always call this before drawing a new asset.',
        input_schema: { type: 'object', properties: { name: nameProp, width: { type: 'integer', minimum: 1, maximum: 512 }, height: { type: 'integer', minimum: 1, maximum: 512 }, mode: { type: 'string', enum: ['indexed', 'rgba'] }, palette: { type: 'string', description: 'Preset id (pico8, sweetie16, endesga32, db16, gameboy, c64, gray8, fire, amerika) or omit.' } }, required: ['name', 'width', 'height'] } },
      { name: 'open_sprite', description: 'Open an existing sprite from assets/sprites/ to edit it.', input_schema: { type: 'object', properties: { name: nameProp }, required: ['name'] } },
      { name: 'save_sprite', description: 'Save the current sprite as an editable project file (assets/sprites/<name>.asprite.json). Do this whenever a sprite is finished or before starting another one. Use export for PNG/GIF/sheets.', input_schema: { type: 'object', properties: {} } },
      { name: 'list_sprites', description: 'List the sprite projects and exported files in assets/sprites/.', input_schema: { type: 'object', properties: {} } },
      ...own,
    ];
  }

  _ensure() {
    if (!this.S) throw new ToolError('no sprite is open. Call new_sprite (or open_sprite) first.', 'no_sprite');
  }

  _file(name) { return path.join(this.dir, safeName(name, 'sprite') + '.asprite.json'); }

  save() {
    this._ensure();
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this._file(this.name);
    fs.writeFileSync(file, JSON.stringify(this.S.doc.toJSON()));
    this.S.doc.savedRev = this.S.doc.rev;
    return { ok: true, path: 'assets/sprites/' + path.basename(file) };
  }

  async run(name, input) {
    input = input || {};
    if (name === 'new_sprite') {
      if (this.S && this.S.doc.rev !== this.S.doc.savedRev && this.name) this.save();   // never lose work silently
      const doc = new this.M.Doc({ w: input.width, h: input.height, mode: input.mode || 'indexed', name: safeName(input.name, 'sprite') });
      this.S = new this.Session(doc); this.name = doc.name;
      if (input.palette) await this.Tools.run(this.S, 'set_palette', { preset: input.palette });
      return { ok: true, name: this.name, ...this.Tools.info(this.S) };
    }
    if (name === 'open_sprite') {
      const f = this._file(input.name);
      if (!fs.existsSync(f)) throw new ToolError('no sprite "' + input.name + '". Existing: ' + this._list().projects.join(', '), 'not_found');
      const doc = this.M.Doc.fromJSON(fs.readFileSync(f, 'utf8'));
      this.S = new this.Session(doc); this.name = safeName(input.name);
      return { ok: true, name: this.name, ...this.Tools.info(this.S) };
    }
    if (name === 'save_sprite') return this.save();
    if (name === 'list_sprites') return this._list();
    this._ensure();
    const io = {
      write: async (rel, data) => {
        const target = confine(this.dir, String(rel));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, typeof data === 'string' ? data : Buffer.from(data));
        return { path: 'assets/sprites/' + path.relative(this.dir, target).split(path.sep).join('/') };
      },
    };
    try {
      return await this.Tools.run(this.S, name, input, io);
    } catch (e) {
      if (e && e.toolError) throw new ToolError(e.message, 'sprite_error');
      throw e;
    }
  }

  _list() {
    const all = walk(this.dir);
    return { projects: all.filter((f) => f.path.endsWith('.asprite.json')).map((f) => f.path.replace(/\.asprite\.json$/, '')), files: all.filter((f) => !f.path.endsWith('.asprite.json')).map((f) => 'assets/sprites/' + f.path), current: this.name };
  }

  dispose() { this.S = null; }
}

module.exports = { SpriteStudio };
