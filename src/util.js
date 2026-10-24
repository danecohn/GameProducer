'use strict';
// Small shared helpers: confined file access, text trimming, ids, errors.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ToolError extends Error {
  constructor(message, code) { super(message); this.name = 'ToolError'; this.code = code || 'tool_error'; }
}

const id = (prefix) => (prefix ? prefix + '_' : '') + crypto.randomBytes(5).toString('hex');
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(abortError());
  const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(t); reject(abortError()); }
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
});

function abortError() { const e = new Error('stopped by the producer'); e.name = 'AbortError'; return e; }
const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');

/**
 * Resolve `rel` inside `root`. Absolute paths, "..", NUL bytes and symlinks that leave the root are refused.
 * Works for paths that do not exist yet (the deepest existing parent is resolved).
 */
function confine(root, rel, opts) {
  opts = opts || {};
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new ToolError('path must be a non-empty string', 'bad_path');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel)) throw new ToolError('absolute paths are not allowed: "' + rel + '" (use a path relative to the project)', 'bad_path');
  const rootReal = fs.realpathSync(root);
  const full = path.resolve(rootReal, rel);
  let probe = full;
  while (!fs.existsSync(probe) && probe !== rootReal && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const probeReal = fs.existsSync(probe) ? fs.realpathSync(probe) : rootReal;
  const resolved = path.join(probeReal, path.relative(probe, full));
  const inside = resolved === rootReal || resolved.startsWith(rootReal + path.sep);
  if (!inside) throw new ToolError('path "' + rel + '" is outside the project', 'bad_path');
  if (opts.mustExist && !fs.existsSync(resolved)) throw new ToolError('"' + rel + '" does not exist', 'not_found');
  return resolved;
}

function safeName(name, fallback) {
  const n = String(name == null ? '' : name).trim().replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '_').replace(/^[.-]+/, '').slice(0, 60);
  return n || fallback || 'untitled';
}

function slugify(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'game';
}

/** Keep head and tail of long text so the model sees both the start and the end. */
function clip(text, max) {
  text = String(text == null ? '' : text);
  max = max || 12000;
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7), tail = max - head;
  return text.slice(0, head) + '\n...[' + (text.length - max) + ' characters omitted]...\n' + text.slice(-tail);
}

function walk(dir, opts) {
  opts = opts || {};
  const out = [];
  const skip = opts.skip || ((name) => name === '.git' || name === '.godot' || name === 'node_modules');
  (function rec(d, rel) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (skip(e.name, rel)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (opts.dirs) out.push({ path: r, dir: true }); if (!opts.maxDepth || r.split('/').length < opts.maxDepth) rec(path.join(d, e.name), r); }
      else if (e.isFile()) { let st; try { st = fs.statSync(path.join(d, e.name)); } catch (x) { continue; } out.push({ path: r, size: st.size, mtime: st.mtimeMs }); }
      if (out.length >= (opts.limit || 5000)) return;
    }
  })(dir, '');
  return out;
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.zip': 'application/zip',
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.gd': 'text/plain; charset=utf-8',
    '.tscn': 'text/plain; charset=utf-8', '.tres': 'text/plain; charset=utf-8',
  })[ext] || 'application/octet-stream';
}

module.exports = { ToolError, id, sleep, abortError, isAbort, confine, safeName, slugify, clip, walk, mimeOf };
