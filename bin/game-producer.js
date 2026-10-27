#!/usr/bin/env node
'use strict';
// Cohnsoft Game Producer command line.
//   game-producer [start] [--port N] [--no-open]   run the studio and open it in your browser
//   game-producer demo                            same, with the scripted demo crew (no API key, no spend)
//   game-producer doctor                          check what is installed
//   game-producer install godot|blender           download the official build, checksum-verified
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

if (Number(process.versions.node.split('.')[0]) < 20) { console.error('Game Producer needs Node.js 20 or newer (you have ' + process.version + ').'); process.exit(1); }

function openBrowser(url) {
  const [bin, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { const c = spawn(bin, a, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch (e) { /* the URL is printed anyway */ }
}

async function main() {
  if (flag('--help') || flag('-h') || cmd === 'help') {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(2, 7).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  if (opt('--port')) process.env.GP_PORT = opt('--port');
  if (cmd === 'demo') process.env.GP_PROVIDER = 'mock';

  if (cmd === 'doctor') {
    const toolchain = require('../src/studios/toolchain');
    const config = require('../src/config');
    const llm = require('../src/llm');
    const t = await toolchain.all(true);
    const k = llm.describe();
    const line = (name, s, note) => console.log((s ? '  ok   ' : '  --   ') + name.padEnd(8) + (note || ''));
    console.log('Cohnsoft Game Producer ' + config.VERSION + '  (data: ' + config.HOME + ')');
    line('node', true, process.version);
    line('key', k.configured, k.configured ? k.provider + ' ' + k.hint + ' (' + k.source + ')' : 'not set: add it in Settings, or set GP_PROVIDER and GP_API_KEY');
    line('godot', t.godot.found, t.godot.found ? t.godot.version + '  ' + t.godot.path : 'Forge cannot build or playtest. Run: game-producer install godot');
    line('blender', t.blender.found, t.blender.found ? t.blender.version + '  ' + t.blender.path : 'Molder cannot model. Run: game-producer install blender');
    line('ffmpeg', t.ffmpeg.found, t.ffmpeg.found ? t.ffmpeg.path : 'optional: Noteie will export WAV only');
    console.log('  ok   sprite   built in (Palette)\n  ok   box      built in (Noteie)');
    return;
  }

  if (cmd === 'install') {
    const what = args[1];
    const inst = require('../src/install');
    if (what === 'godot') await inst.installGodot();
    else if (what === 'blender') await inst.installBlender();
    else { console.error('usage: game-producer install godot|blender'); process.exit(2); }
    return;
  }

  if (cmd !== 'start' && cmd !== 'demo') { console.error('unknown command "' + cmd + '". Try --help.'); process.exit(2); }

  const { listen } = require('../src/server');
  const config = require('../src/config');
  const app = await listen();
  const host = app.mode.host === '0.0.0.0' ? 'localhost' : app.mode.host === '::1' ? '[::1]' : app.mode.host;
  const url = 'http://' + (app.mode.hosted ? host : 'localhost') + ':' + app.port + '/';
  console.log('Cohnsoft Game Producer ' + config.VERSION);
  console.log(app.mode.hosted ? '  hosted mode, listening on ' + app.mode.host + ':' + app.port + ' (access token required)' : '  open ' + url);
  console.log('  projects: ' + config.paths.projects);
  if (cmd === 'demo') console.log('  demo crew: scripted, no AI and no API key');
  if (!app.mode.hosted && !flag('--no-open') && !process.env.CI) openBrowser(url);

  let closing = false;
  const stop = async () => { if (closing) return; closing = true; console.log('\nstopping...'); await app.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
