'use strict';
// Finds the external programs the studios may use: Godot (Forge), Blender (Molder), ffmpeg (Noteie's Ogg export).
// Sprite and Box need nothing: they run inside this process.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');

const HINTS = {
  godot: 'Forge needs Godot 4. Run "game-producer install godot" (downloads the official build into ' + '~/AltStack/GameProducer/tools), or install Godot 4.4+ and set GP_GODOT=/path/to/godot.',
  blender: 'Molder needs Blender 4.2+ (5.x recommended). Install Blender and set GP_BLENDER=/path/to/blender, or put "blender" on your PATH.',
  ffmpeg: 'Optional: ffmpeg lets Noteie also export Ogg Vorbis. WAV export works without it.',
};

const cache = new Map();

function onPath(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const n of names) for (const d of dirs) for (const e of exts) {
    const f = path.join(d, n + e);
    try { if (fs.statSync(f).isFile()) { fs.accessSync(f, fs.constants.X_OK); return f; } } catch (err) { /* next */ }
  }
  return null;
}

function firstExisting(list) {
  for (const f of list) { try { if (f && fs.statSync(f).isFile()) return f; } catch (e) { /* next */ } }
  return null;
}

function installed(tool) {
  const dir = path.join(config.paths.tools, tool);
  const found = [];
  (function rec(d, depth) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && depth < 5) rec(f, depth + 1);
      else if (e.isFile() && ((tool === 'godot' && /^godot.*(\.exe|\.x86_64|\.arm64|\.universal|_console\.exe)?$/i.test(e.name) && !/\.(pck|zip|txt|md|import)$/.test(e.name)) || (tool === 'blender' && /^blender(\.exe)?$/i.test(e.name))) && depth >= (tool === 'godot' ? 0 : 0)) {
        try { fs.accessSync(f, fs.constants.X_OK); found.push(f); } catch (x) { /* not executable */ }
      }
    }
  })(dir, 0);
  // prefer binaries inside .app bundles' MacOS directory or plain files
  return found.sort((a, b) => a.length - b.length)[0] || null;
}

function locate(tool) {
  const env = { godot: [process.env.GP_GODOT, process.env.AMERIKA_GODOT, process.env.GODOT_BIN], blender: [process.env.GP_BLENDER, process.env.BLENDER_BIN], ffmpeg: [process.env.GP_FFMPEG] }[tool];
  const fromEnv = firstExisting(env);
  if (fromEnv) return fromEnv;
  const own = tool === 'ffmpeg' ? null : installed(tool);
  if (own) return own;
  const pathHit = onPath({ godot: ['godot4', 'godot'], blender: ['blender'], ffmpeg: ['ffmpeg'] }[tool]);
  if (pathHit) return pathHit;
  const mac = { godot: ['/Applications/Godot.app/Contents/MacOS/Godot'], blender: ['/Applications/Blender.app/Contents/MacOS/Blender'], ffmpeg: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'] }[tool];
  const win = { godot: [], blender: ['C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe', 'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe'], ffmpeg: [] }[tool];
  return firstExisting([...(mac || []), ...(win || [])]);
}

function version(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 20000 }, (err, stdout, stderr) => {
      const out = String(stdout || stderr || '').trim().split('\n')[0] || '';
      resolve(err && !out ? null : out);
    });
  });
}

/** {found, path, version, hint}. Cached for a minute; pass refresh to re-scan. */
async function status(tool, refresh) {
  const hit = cache.get(tool);
  if (hit && !refresh && Date.now() - hit.at < 60000) return hit.value;
  const bin = locate(tool);
  let value;
  if (!bin) value = { tool, found: false, hint: HINTS[tool] };
  else {
    const v = await version(bin, tool === 'ffmpeg' ? ['-version'] : ['--version']);
    value = { tool, found: true, path: bin, version: v, hint: null };
  }
  cache.set(tool, { at: Date.now(), value });
  return value;
}

async function all(refresh) {
  const [godot, blender, ffmpeg] = await Promise.all([status('godot', refresh), status('blender', refresh), status('ffmpeg', refresh)]);
  return { godot, blender, ffmpeg };
}

function clearCache() { cache.clear(); }

module.exports = { locate, status, all, clearCache, HINTS };
