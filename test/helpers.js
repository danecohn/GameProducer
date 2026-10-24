'use strict';
// Every test file runs in its own process; this gives it a private GP_HOME before anything reads the config.
const fs = require('fs');
const os = require('os');
const path = require('path');

function isolate(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-test-' + (prefix || 'x') + '-'));
  process.env.GP_HOME = home;
  for (const k of ['GP_PROVIDER', 'GP_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GP_ACCESS_TOKEN', 'GP_HOST', 'RAILWAY_ENVIRONMENT']) delete process.env[k];
  process.env.GP_MOCK_DELAY_MS = '1';
  return home;
}

/** Real Godot / Blender are used when present (GP_GODOT / GP_BLENDER or on PATH or installed under the test home); otherwise those tests skip. */
async function tools() {
  const toolchain = require('../src/studios/toolchain');
  return { godot: (await toolchain.status('godot', true)).found, blender: (await toolchain.status('blender', true)).found };
}

function waitFor(cond, ms, what) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v; try { v = cond(); } catch (e) { return reject(e); }
      if (v) return resolve(v);
      if (Date.now() - t0 > (ms || 10000)) return reject(new Error('timed out waiting for ' + (what || 'condition')));
      setTimeout(tick, 15);
    };
    tick();
  });
}

module.exports = { isolate, tools, waitFor };
