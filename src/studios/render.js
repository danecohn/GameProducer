'use strict';
// Vigil Render, headless. Molder drives the real Render add-on tools inside a background Blender process.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ToolError, safeName, abortError } = require('../util');
const toolchain = require('./toolchain');

const ROOT = path.join(__dirname, '..', '..');
const ADDON_PARENT = path.join(ROOT, 'vendor', 'render', 'src');
const WORKER = path.join(ROOT, 'studio', 'render_worker.py');
const SPECS = require('./generated/render-tools.json');
const MARK = '@@GP@@ ';
const IDLE_MS = 10 * 60 * 1000;

/** The Render prompt is Python; read its SYSTEM string from the vendored file so it can never drift. */
function systemManual() {
  try {
    const src = fs.readFileSync(path.join(ADDON_PARENT, 'amerika_render', 'prompt.py'), 'utf8');
    const m = /SYSTEM = """([\s\S]*?)"""/.exec(src);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

class RenderStudio {
  constructor(project, opts) {
    this.project = project;
    this.root = project.paths.assets;           // Render's own prompt exports to models/<name>.glb relative to its project folder
    this.dir = project.paths.models;
    this.workspace = path.join(this.dir, 'workspace.blend');
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buf = '';
    this.ready = null;
    this.idleTimer = null;
    this.queue = Promise.resolve();
    this.spawnImpl = (opts && opts.spawn) || null;   // tests inject a fake worker
  }

  systemManual() { return systemManual(); }

  definitions() {
    return SPECS.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  isCritical(name) { return SPECS.review_always.includes(name); }

  async _start() {
    if (this.child && this.ready) return this.ready;
    let bin, args;
    if (this.spawnImpl) ({ bin, args } = this.spawnImpl());
    else {
      const b = await toolchain.status('blender');
      if (!b.found) throw new ToolError('Blender is not installed on this machine, so Molder cannot work yet. ' + b.hint + ' Tell the Director that 3D models are blocked; Forge can use placeholder shapes meanwhile.', 'blender_missing');
      bin = b.path;
      args = ['-b', '--factory-startup', '-noaudio', '--python', WORKER, '--', '--addon', ADDON_PARENT, '--project', this.root, '--workspace', this.workspace];
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BLENDER_USER_RESOURCES: path.join(this.project.paths.producer, 'blender') } });
    this.child = child; this.buf = ''; this.stderrTail = '';
    child.stdout.on('data', (c) => this._onData(String(c)));
    child.stderr.on('data', (c) => { this.stderrTail = (this.stderrTail + String(c)).slice(-3000); });
    child.on('close', (code) => this._onClose(child, code));
    child.on('error', (e) => { this.stderrTail += String(e.message); this._onClose(child, -1); });
    this.ready = new Promise((resolve, reject) => { this._readyResolve = resolve; this._readyReject = reject; });
    const t = setTimeout(() => this._readyReject(new ToolError('Blender did not start within 90 seconds', 'blender_start')), 90000);
    this.ready.finally(() => clearTimeout(t)).catch(() => {});
    return this.ready;
  }

  _onData(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (!line.startsWith(MARK)) continue;
      let msg; try { msg = JSON.parse(line.slice(MARK.length)); } catch (e) { continue; }
      if (msg.ready !== undefined) { if (msg.ready) this._readyResolve(msg); else this._readyReject(new ToolError(msg.error || 'worker failed to start', 'blender_start')); continue; }
      const p = this.pending.get(msg.id);
      if (p) { this.pending.delete(msg.id); p.resolve(msg); }
    }
  }

  _onClose(child, code) {
    if (this.child !== child) return;
    this.child = null; this.ready = null;
    const err = new ToolError('Blender stopped unexpectedly (exit ' + code + '). ' + (this.stderrTail || '').split('\n').slice(-4).join(' ').slice(0, 300), 'blender_died');
    if (this._readyReject) this._readyReject(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  _call(name, input, signal, timeoutMs) {
    const job = async () => {
      if (signal && signal.aborted) throw abortError();
      await this._start();
      clearTimeout(this.idleTimer);
      const id = this.nextId++;
      const reply = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
      this.child.stdin.write(JSON.stringify({ id, name, input }) + '\n');
      let timer, onAbort;
      const guard = new Promise((_, reject) => {
        timer = setTimeout(() => { this.kill(); reject(new ToolError(name + ' took longer than ' + Math.round(timeoutMs / 1000) + ' s; Blender was restarted (the last saved scene is reloaded).', 'timeout')); }, timeoutMs);
        if (signal) { onAbort = () => { this.kill(); reject(abortError()); }; signal.addEventListener('abort', onAbort, { once: true }); }
      });
      try { return await Promise.race([reply, guard]); }
      finally { clearTimeout(timer); if (signal && onAbort) signal.removeEventListener('abort', onAbort); this.idleTimer = setTimeout(() => this.kill(), IDLE_MS); if (this.idleTimer.unref) this.idleTimer.unref(); }
    };
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }

  async run(name, input, ctx) {
    ctx = ctx || {};
    if (!SPECS.tools.some((t) => t.name === name)) throw new ToolError('unknown tool ' + name, 'unknown_tool');
    if (this.isCritical(name) && ctx.reviewCode && ctx.approve) {
      const ok = await ctx.approve({ kind: 'code', title: 'Molder wants to run Python inside Blender', language: 'python', code: String((input && input.code) || ''), why: String((input && input.description) || '') });
      if (!ok) throw new ToolError('The Producer declined to run this code. Use the structured tools instead, or explain what you need and ask the Director.', 'declined');
    }
    const msg = await this._call(name, input || {}, ctx.signal, name === 'render_preview' ? 900000 : 300000);
    if (!msg.ok) throw new ToolError(msg.error || 'Blender tool failed', 'render_error');
    const result = msg.result && typeof msg.result === 'object' ? { ...msg.result } : { value: msg.result };
    const images = (msg.images || []).map((b) => ({ mime: 'image/png', base64: b }));
    if (images.length && name === 'render_preview') {
      const dir = path.join(this.dir, 'previews');
      fs.mkdirSync(dir, { recursive: true });
      const f = safeName('preview_' + new Date().toISOString().replace(/[:.]/g, '-'), 'preview') + '.png';
      fs.writeFileSync(path.join(dir, f), Buffer.from(images[0].base64, 'base64'));
      result.saved_preview = 'assets/models/previews/' + f;
    }
    if (images.length) result.__images = images;
    return result;
  }

  kill() {
    clearTimeout(this.idleTimer);
    const c = this.child;
    if (!c) return;
    try { c.stdin.end(); } catch (e) { /* closed */ }
    try { c.kill('SIGKILL'); } catch (e) { /* gone */ }
  }

  dispose() { this.kill(); }
}

module.exports = { RenderStudio, systemManual };
