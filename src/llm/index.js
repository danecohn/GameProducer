'use strict';
// Provider factory + credential storage. ONE key powers the whole team: Director, every specialist and the summariser use it.
const fs = require('fs');
const config = require('../config');
const { LLMError } = require('./errors');

const PROVIDERS = ['anthropic', 'openai'];

function envCredentials() {
  if (process.env.GP_PROVIDER === 'mock') return { provider: 'mock', key: 'demo', source: 'env' };
  const p = process.env.GP_PROVIDER;
  const key = process.env.GP_API_KEY || (p === 'openai' ? process.env.OPENAI_API_KEY : p === 'anthropic' ? process.env.ANTHROPIC_API_KEY : '')
    || (!p && process.env.ANTHROPIC_API_KEY) || (!p && process.env.OPENAI_API_KEY) || '';
  if (!key) return null;
  const provider = p || (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY ? 'openai' : (key.startsWith('sk-ant-') ? 'anthropic' : 'openai'));
  return PROVIDERS.includes(provider) ? { provider, key, source: 'env' } : null;
}

function readCredentials() {
  const env = envCredentials();
  if (env) return env;
  const c = config.readJson(config.paths.credentials, null);
  return c && (PROVIDERS.includes(c.provider) || c.provider === 'mock') && typeof c.key === 'string' && c.key ? { provider: c.provider, key: c.key, source: 'file' } : null;
}

function saveCredentials(provider, key) {
  if (provider === 'mock') { config.ensureDir(config.paths.home, 0o700); config.writeJson(config.paths.credentials, { provider: 'mock', key: 'demo', saved: new Date().toISOString() }, 0o600); return; }
  if (!PROVIDERS.includes(provider)) throw new LLMError('invalid_request', 'provider must be anthropic or openai');
  key = String(key || '').trim();
  if (key.length < 20 || /\s/.test(key)) throw new LLMError('invalid_request', 'that does not look like an API key');
  config.ensureDir(config.paths.home, 0o700);
  config.writeJson(config.paths.credentials, { provider, key, saved: new Date().toISOString() }, 0o600);
  try { fs.chmodSync(config.paths.credentials, 0o600); } catch (e) { /* non-POSIX */ }
}

function clearCredentials() { try { fs.unlinkSync(config.paths.credentials); } catch (e) { /* none */ } }

/** What the browser may know about the key. Never the key itself. */
function describe() {
  const c = readCredentials();
  if (!c) return { configured: false };
  return { configured: true, provider: c.provider, source: c.source, hint: c.provider === 'mock' ? 'demo' : '…' + c.key.slice(-4) };
}

function createProvider(creds, opts) {
  creds = creds || readCredentials();
  if (!creds) throw new LLMError('no_key', 'no API key is set');
  opts = opts || {};
  if (creds.provider === 'anthropic') return require('./anthropic').create({ key: creds.key, fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl });
  if (creds.provider === 'openai') return require('./openai').create({ key: creds.key, fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl });
  if (creds.provider === 'mock') return require('./mock').create();
  throw new LLMError('invalid_request', 'unknown provider ' + creds.provider);
}

module.exports = { PROVIDERS, readCredentials, saveCredentials, clearCredentials, describe, createProvider };
