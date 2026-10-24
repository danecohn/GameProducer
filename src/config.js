'use strict';
// Paths, environment and persisted settings. One root (GP_HOME) holds everything the app writes.
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = require('../package.json').version;
const ROOT = path.resolve(__dirname, '..');
const HOME = path.resolve(process.env.GP_HOME || path.join(os.homedir(), 'AltStack', 'GameProducer'));

const paths = {
  root: ROOT,
  home: HOME,
  projects: path.join(HOME, 'projects'),
  tools: path.join(HOME, 'tools'),
  settings: path.join(HOME, 'settings.json'),
  credentials: path.join(HOME, 'credentials.json'),
  web: path.join(ROOT, 'web'),
  vendor: path.join(ROOT, 'vendor'),
};

const DEFAULT_SETTINGS = {
  // null = use the provider default for that tier (see llm/models.js)
  models: { director: null, sking: null, forge: null, molder: null, palette: null, noteie: null },
  reviewCode: true,            // Producer approves model-written Python before Molder runs it
  maxTurns: { director: 80, worker: 45 },
  budgetTokens: 8000000,       // per project; the Producer is asked before the team goes past it
  parallelContracts: true,
};

function ensureDir(dir, mode) {
  fs.mkdirSync(dir, { recursive: true, mode: mode || 0o755 });
  return dir;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

/** Atomic JSON write: temp file in the same directory, then rename. */
function writeJson(file, value, mode) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: mode || 0o644 });
  fs.renameSync(tmp, file);
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = (typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) && typeof extra[k] === 'object' && extra[k] !== null)
      ? deepMerge(base[k], extra[k]) : extra[k];
  }
  return out;
}

function loadSettings() { return deepMerge(DEFAULT_SETTINGS, readJson(paths.settings, {})); }

function saveSettings(patch) {
  const next = deepMerge(loadSettings(), patch || {});
  // keep what the UI may change to sane bounds
  next.budgetTokens = Math.max(0, Math.min(1e10, Number(next.budgetTokens) || 0));
  next.maxTurns.director = Math.max(4, Math.min(300, Number(next.maxTurns.director) || 80));
  next.maxTurns.worker = Math.max(4, Math.min(200, Number(next.maxTurns.worker) || 45));
  next.reviewCode = !!next.reviewCode;
  next.parallelContracts = !!next.parallelContracts;
  writeJson(paths.settings, next);
  return next;
}

/** local = loopback only, no login. hosted = behind a platform proxy, GP_ACCESS_TOKEN required. */
function serverMode() {
  const host = process.env.GP_HOST || (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  return { host, port: Number(process.env.GP_PORT || process.env.PORT || 7878), hosted: !loopback };
}

module.exports = { VERSION, ROOT, HOME, paths, DEFAULT_SETTINGS, ensureDir, readJson, writeJson, deepMerge, loadSettings, saveSettings, serverMode };
