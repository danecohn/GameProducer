'use strict';
// Cohnsoft Box, headless. Noteie drives BeepBox's real Song/Synth classes through the vendored composer tools.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');
const { ToolError, safeName, confine, walk } = require('../util');
const toolchain = require('./toolchain');

const APP = path.join(__dirname, '..', '..', 'vendor', 'box', 'src', 'app');
let beepboxCache = null;

/** BeepBox's synth bundle needs no DOM: run it in a vm context. Loaded once per process. */
function loadBeepBox() {
  if (beepboxCache) return beepboxCache;
  const ctx = { console, performance, Math, Date, setTimeout, Float32Array, Float64Array, Int32Array, Uint8Array, Array, JSON, Object, Error };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(APP, 'beepbox_synth.min.js'), 'utf8') + '\n;this.beepbox = beepbox;', ctx, { filename: 'beepbox_synth.min.js' });
  beepboxCache = ctx.beepbox;
  return beepboxCache;
}

const A = require(path.join(APP, 'amerika', 'audio.js'));
const X = require(path.join(APP, 'amerika', 'export.js'));
const Prompt = require(path.join(APP, 'amerika', 'prompt.js'));
const SongTools = require(path.join(APP, 'amerika', 'songtools.js'));

const HEADLESS_SKIP = new Set(['play', 'stop']);   // no audio device on the server; the Producer listens in the browser

class BoxStudio {
  constructor(project) {
    this.project = project;
    this.B = loadBeepBox();
    this.history = [];
    this.name = null;
    this.root = project.paths.audio;
    const self = this;
    this.host = {
      silent: true,
      song: new this.B.Song(),
      getSong() { return this.song; },
      commit(song, label) { self.history.push({ label, json: JSON.stringify(this.song.toJsonObject()) }); if (self.history.length > 60) self.history.shift(); this.song = song; },
      play() {}, stop() {},
      async undo(steps) {
        for (let i = 0; i < steps; i++) {
          const h = self.history.pop(); if (!h) break;
          const s = new self.B.Song(); s.fromJsonObject(JSON.parse(h.json)); this.song = s;
        }
      },
    };
    this.tools = SongTools.create(this.B, this.host);
  }

  systemManual() { return Prompt.SYSTEM; }

  definitions() {
    const nameProp = { type: 'string', description: 'Letters, digits . _ - and spaces.' };
    const own = this.tools.definitions.filter((d) => !HEADLESS_SKIP.has(d.name)).map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema }));
    return [
      ...own,
      { name: 'save_song', description: 'Save the current song as an editable project file (assets/audio/songs/<name>.beepbox.json). Do this before starting another song.', input_schema: { type: 'object', properties: { name: nameProp }, required: ['name'] } },
      { name: 'open_song', description: 'Open a saved song from assets/audio/songs/ to edit it.', input_schema: { type: 'object', properties: { name: nameProp }, required: ['name'] } },
      { name: 'list_audio', description: 'List saved songs and exported music/sound-effect files in assets/audio/.', input_schema: { type: 'object', properties: {} } },
      { name: 'export_music', description: 'Render the current song as GAME MUSIC: an intro plus one seamless loop with loop points, written to assets/audio/music/<name>/ as WAV (+ Ogg when ffmpeg is installed), loop metadata JSON, Godot .import presets and a README. Use this for soundtracks and menu/level themes. Run render_preview first and fix clipping.',
        input_schema: { type: 'object', properties: { name: nameProp, normalize_db: { type: 'number', description: 'Peak-normalise to this dBFS (default -1).' } }, required: ['name'] } },
      { name: 'export_sfx', description: 'Render the current song as a ONE-SHOT SOUND EFFECT (no loop) to assets/audio/sfx/<name>.wav. Build sound effects as very short songs: 1 bar, fast tempo, one or two channels; pitch slides via note bend, noise channels for hits and explosions. Name them by what they are (jump, coin, hit, explosion, menu_select).',
        input_schema: { type: 'object', properties: { name: nameProp, normalize_db: { type: 'number', description: 'Peak-normalise to this dBFS (default -1).' } }, required: ['name'] } },
    ];
  }

  _songFile(name) { return path.join(this.root, 'songs', safeName(name, 'song') + '.beepbox.json'); }

  _requestOgg() {
    const ffmpeg = toolchain.locate('ffmpeg');
    if (!ffmpeg) return undefined;
    const mapPath = (rel) => this._bundlePath(rel);
    return (job) => new Promise((resolve) => {
      const args = ['-y', '-v', 'error', '-i', mapPath(job.wav), '-c:a', 'libvorbis', '-q:a', String(job.quality == null ? 5 : job.quality),
        '-metadata', 'LOOPSTART=' + job.loop_start, '-metadata', 'LOOPLENGTH=' + job.loop_length, '-metadata', 'TITLE=' + job.title, mapPath(job.ogg)];
      execFile(ffmpeg, args, { timeout: 120000 }, (err, so, se) => resolve(err ? { ok: false, error: String(se || err.message).slice(0, 300) } : { ok: true }));
    });
  }

  /** The vendored exporter writes "exports/<name>/file"; game music lives in assets/audio/music/<name>/file. */
  _bundlePath(rel) {
    const m = /^exports\/(.+)$/.exec(rel);
    return confine(this.root, 'music/' + (m ? m[1] : rel));
  }

  async run(name, input) {
    input = input || {};
    if (name === 'save_song') {
      const f = this._songFile(input.name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(this.host.song.toJsonObject(), null, 1));
      this.name = safeName(input.name);
      return { ok: true, path: 'assets/audio/songs/' + path.basename(f) };
    }
    if (name === 'open_song') {
      const f = this._songFile(input.name);
      if (!fs.existsSync(f)) throw new ToolError('no song "' + input.name + '". Existing: ' + this._list().songs.join(', '), 'not_found');
      const song = new this.B.Song();
      song.fromJsonObject(JSON.parse(fs.readFileSync(f, 'utf8')));
      this.host.commit(song, 'open');
      this.name = safeName(input.name);
      return { ok: true, name: this.name, ...(await this.tools.run('song_info', {})) };
    }
    if (name === 'list_audio') return this._list();
    if (name === 'export_music') {
      const song = this.host.song;
      const res = await X.buildGameBundle(this.B, song, { name: input.name, normalizeDb: input.normalize_db == null ? -1 : input.normalize_db }, {
        write: async (rel, data) => {
          const f = this._bundlePath(rel);
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, typeof data === 'string' ? data : Buffer.from(data));
        },
        requestOgg: this._requestOgg(),
        progress() {},
      }).catch((e) => { throw new ToolError(e.message, 'export_failed'); });
      const dir = 'assets/audio/music/' + res.name;
      return { ok: true, dir, files: res.files.map((f) => dir + '/' + f), seconds: res.metadata.length_seconds, loop_start_seconds: res.metadata.loop_start_seconds, loop_end_seconds: res.metadata.loop_end_seconds, bpm: res.metadata.bpm, ogg: res.ogg, note: res.ogg === 'not requested' ? 'WAV only: install ffmpeg to also get Ogg.' : undefined };
    }
    if (name === 'export_sfx') {
      const r = await X.renderWav(this.B, this.host.song, { sampleRate: 44100, loops: 1, normalizeDb: input.normalize_db == null ? -1 : input.normalize_db });
      if (r.peakDbfs < -80) throw new ToolError('the sound renders as silence. Add notes first.', 'silent');
      const rel = 'sfx/' + safeName(input.name, 'sfx') + '.wav';
      const f = confine(this.root, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(r.wav));
      return { ok: true, path: 'assets/audio/' + rel, seconds: +r.seconds.toFixed(3), peak_dbfs: r.peakDbfs };
    }
    if (HEADLESS_SKIP.has(name)) throw new ToolError(name + ' is not available on the server', 'unavailable');
    try {
      return await this.tools.run(name, input);
    } catch (e) {
      if (e && e.userFacing) throw new ToolError(e.message, 'box_error');
      throw e;
    }
  }

  _list() {
    const all = walk(this.root);
    return {
      songs: all.filter((f) => f.path.startsWith('songs/')).map((f) => f.path.replace(/^songs\//, '').replace(/\.beepbox\.json$/, '')),
      music: [...new Set(all.filter((f) => f.path.startsWith('music/')).map((f) => f.path.split('/')[1]))],
      sfx: all.filter((f) => f.path.startsWith('sfx/')).map((f) => f.path.replace(/^sfx\//, '').replace(/\.wav$/, '')),
      current: this.name,
    };
  }

  dispose() {}
}

module.exports = { BoxStudio, loadBeepBox };
