'use strict';
const { isolate, waitFor } = require('./helpers');
const home = isolate('server');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('../src/config');
const llm = require('../src/llm');
const { createApp, listen } = require('../src/server');
const mock = require('../src/llm/mock');

/** Raw HTTP so tests can set Host and Origin headers (fetch forbids that). */
function request(app, method, url, { headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: app.port, method, path: url, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString()); } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, raw, json, text: raw.toString() }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function session(app) {
  const page = await request(app, 'GET', '/', { headers: { host: 'localhost:' + app.port } });
  const cookie = String(page.headers['set-cookie'] || '').split(';')[0];
  const h = { host: 'localhost:' + app.port, cookie };
  const api = (method, url, body, extra) => request(app, method, url, { headers: { ...h, ...(extra || {}) }, body });
  return { page, cookie, h, api };
}

let app;
test.before(async () => { app = await listen({ mode: { host: '127.0.0.1', port: 0, hosted: false }, provider: mock.create() }); });
test.after(async () => { await app.close(); });

test('local mode: the UI is served with a hardened header set and hands out a session cookie', async () => {
  const s = await session(app);
  assert.equal(s.page.status, 200);
  assert.match(s.page.text, /<title>Cohnsoft Game Producer/);
  assert.match(String(s.page.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  assert.match(s.page.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(s.page.headers['x-frame-options'], 'DENY');
  assert.equal((await request(app, 'GET', '/assets/logo.png', { headers: s.h })).headers['content-type'], 'image/png');
  assert.equal((await request(app, 'GET', '/../package.json', { headers: s.h })).status, 404);
  assert.equal((await request(app, 'GET', '/%2e%2e/package.json', { headers: s.h })).status, 404);
});

test('local mode: no cookie, a foreign Host or a foreign Origin is refused', async () => {
  const s = await session(app);
  assert.equal((await request(app, 'GET', '/api/status', { headers: { host: 'localhost:' + app.port } })).status, 401);
  assert.equal((await s.api('GET', '/api/status')).status, 200);
  assert.equal((await request(app, 'GET', '/api/status', { headers: { ...s.h, host: 'evil.example:' + app.port } })).status, 403, 'DNS rebinding');
  const post = await s.api('POST', '/api/projects', { name: 'x' }, { origin: 'http://evil.example' });
  assert.equal(post.status, 403, 'cross-site request');
  assert.equal((await s.api('POST', '/api/projects', { name: 'Same Origin Ok' }, { origin: 'http://localhost:' + app.port })).status, 201);
  assert.equal((await s.api('POST', '/api/projects', '{not json')).status, 400);
  assert.equal((await s.api('GET', '/api/nope')).status, 404);
});

test('the key: validated against the provider, stored privately, never echoed', async () => {
  const s = await session(app);
  assert.equal(llm.describe().configured, false);
  const good = 'sk-ant-test-FAKE-' + 'a'.repeat(30);
  const calls = [];
  const inner = createApp({ mode: { host: '127.0.0.1', port: 0, hosted: false }, provider: mock.create(), fetchImpl: async (url, init) => { calls.push({ url, key: init.headers['x-api-key'] || init.headers.authorization }); const ok = (init.headers['x-api-key'] || '').endsWith('a'.repeat(30)); return { ok, status: ok ? 200 : 401, headers: { get: () => null }, text: async () => JSON.stringify(ok ? { data: [{ id: 'claude-sonnet-5-5' }] } : { error: { type: 'authentication_error', message: 'invalid x-api-key' } }) }; } });
  await new Promise((r) => inner.server.listen(0, '127.0.0.1', r)); inner.port = inner.server.address().port; inner.auth.port = inner.port;
  const s2 = await session(inner);
  const bad = await s2.api('POST', '/api/credentials', { provider: 'anthropic', key: 'sk-ant-test-FAKE-' + 'b'.repeat(30) });
  assert.equal(bad.status, 400); assert.ok(!bad.text.includes('b'.repeat(30)));
  assert.equal(llm.describe().configured, false);
  const ok = await s2.api('POST', '/api/credentials', { provider: 'anthropic', key: good });
  assert.equal(ok.status, 200); assert.deepEqual(ok.json, { configured: true, provider: 'anthropic', source: 'file', hint: '…' + good.slice(-4) });
  assert.ok(!(await s2.api('GET', '/api/status')).text.includes(good), 'the key must never appear in an API response');
  assert.ok(calls.every((c) => c.url.startsWith('https://api.anthropic.com/')), 'the key goes to the provider and nowhere else');
  if (process.platform !== 'win32') assert.equal(fs.statSync(config.paths.credentials).mode & 0o777, 0o600);
  assert.equal((await s2.api('POST', '/api/credentials', { provider: 'openai', key: 'short' })).status, 400);
  assert.equal((await s2.api('DELETE', '/api/credentials')).json.configured, false);
  await inner.close();
});

test('settings are clamped and model names sanitised', async () => {
  const s = await session(app);
  try {
    const r = await s.api('PUT', '/api/settings', { budgetTokens: -5, maxTurns: { director: 99999, worker: 1 }, models: { forge: 'claude-sonnet-5-5; rm', bogus: 'x' }, reviewCode: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.budgetTokens, 0); assert.equal(r.json.maxTurns.director, 300); assert.equal(r.json.maxTurns.worker, 4);
    assert.ok(!/[; ]/.test(r.json.models.forge)); assert.ok(!('bogus' in r.json.models));
    assert.equal(r.json.reviewCode, false);
  } finally {
    await s.api('PUT', '/api/settings', { budgetTokens: 8000000, maxTurns: { director: 80, worker: 45 }, models: { forge: null }, reviewCode: true });
  }
});

test('a whole production over HTTP: create, live event stream, answer a question, read assets safely', async () => {
  const s = await session(app);
  const created = await s.api('POST', '/api/projects', { name: 'HTTP Quest', pitch: 'A tiny platformer', start: true });
  assert.equal(created.status, 201); assert.equal(created.json.started, true);
  const id = created.json.project.id;
  // live stream
  const seen = [];
  const sse = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: app.port, path: '/api/projects/' + id + '/events?since=0', headers: s.h }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frag = buf.slice(0, i); buf = buf.slice(i + 2); const d = frag.split('\n').find((l) => l.startsWith('data: ')); if (d) seen.push(JSON.parse(d.slice(6))); } });
      resolve({ req, res });
    });
    req.end();
  });
  assert.equal(sse.res.headers['content-type'].split(';')[0], 'text/event-stream');
  const d = await waitFor(() => seen.find((e) => e.type === 'decision'), 15000, 'the Director\'s question');
  assert.equal((await s.api('POST', '/api/projects/' + id + '/decisions/' + d.decision.id, { option: 0 })).status, 200);
  assert.equal((await s.api('POST', '/api/projects/' + id + '/decisions/' + d.decision.id, { option: 0 })).status, 404, 'answering twice');
  await waitFor(() => seen.find((e) => e.type === 'run' && e.state === 'finished'), 30000, 'the run to finish');
  sse.req.destroy();
  const boot = (await s.api('GET', '/api/projects/' + id)).json;
  assert.equal(boot.state.contracts.length >= 4, true);
  assert.ok(boot.inventory.sprites.images.includes('assets/sprites/hero.png'), JSON.stringify(boot.inventory) + ' / ' + JSON.stringify(boot.state.contracts.map((c) => c.agent + ':' + c.status + ':' + (c.summary || '').slice(0, 80))));
  assert.ok(boot.events.length > 30 && boot.lastSeq >= boot.events.length);
  // files: images inline, traversal and internals refused, svg never inline, ranges work
  const png = await s.api('GET', '/api/projects/' + id + '/file?path=' + encodeURIComponent('assets/sprites/hero.png'));
  assert.equal(png.status, 200); assert.equal(png.headers['content-type'], 'image/png'); assert.equal(png.headers['content-security-policy'], 'sandbox');
  for (const bad of ['../../credentials.json', '.producer/state.json', 'project.json', 'assets/../project.json', '/etc/passwd']) assert.notEqual((await s.api('GET', '/api/projects/' + id + '/file?path=' + encodeURIComponent(bad))).status, 200, bad);
  const wav = await s.api('GET', '/api/projects/' + id + '/file?path=' + encodeURIComponent('assets/audio/sfx/jump.wav'), undefined, { range: 'bytes=0-11' });
  assert.equal(wav.status, 206); assert.equal(wav.raw.length, 12); assert.equal(wav.raw.slice(0, 4).toString(), 'RIFF');
  fs.mkdirSync(path.join(config.paths.projects, id, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(config.paths.projects, id, 'assets', 'x.svg'), '<svg onload="alert(1)"/>');
  const svg = await s.api('GET', '/api/projects/' + id + '/file?path=assets/x.svg');
  assert.match(svg.headers['content-disposition'], /^attachment/);
  // bible editing, rename, export
  assert.equal((await s.api('PUT', '/api/projects/' + id + '/bible/NOTES.md', { content: '# Mine' })).status, 200);
  assert.equal((await s.api('GET', '/api/projects/' + id + '/bible/NOTES.md')).json.content.trim(), '# Mine');
  assert.equal((await s.api('PUT', '/api/projects/' + id + '/bible/..%2Fx.md', { content: 'x' })).status, 404);
  assert.equal((await s.api('PATCH', '/api/projects/' + id, { name: 'Renamed Quest' })).json.project.name, 'Renamed Quest');
  const game = await s.api('GET', '/api/projects/' + id + '/game');
  assert.equal(game.status, 200); assert.equal(game.json.canPlay, true);
  // projects list and a second chat while idle works; missing project is a 404
  assert.ok((await s.api('GET', '/api/projects')).json.projects.some((p) => p.id === id));
  assert.equal((await s.api('GET', '/api/projects/nope-nope')).status, 404);
});

test('hosted mode refuses to start without an access token, then requires login', async () => {
  assert.throws(() => createApp({ mode: { host: '0.0.0.0', port: 0, hosted: true }, accessToken: '' }), /GP_ACCESS_TOKEN/);
  const hosted = await listen({ mode: { host: '127.0.0.1', port: 0, hosted: true }, accessToken: 'correct horse battery staple', provider: mock.create() });
  try {
    const h = { host: 'game.example.com' };
    const home = await request(hosted, 'GET', '/', { headers: h });
    assert.equal(home.status, 302); assert.equal(home.headers.location, '/login.html');
    assert.equal((await request(hosted, 'GET', '/api/status', { headers: h })).status, 401);
    assert.equal((await request(hosted, 'POST', '/api/login', { headers: h, body: { token: 'wrong' } })).status, 401);
    const ok = await request(hosted, 'POST', '/api/login', { headers: { ...h, 'x-forwarded-proto': 'https' }, body: { token: 'correct horse battery staple' } });
    assert.equal(ok.status, 200); assert.match(String(ok.headers['set-cookie']), /Secure/);
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    assert.equal((await request(hosted, 'GET', '/api/status', { headers: { ...h, cookie } })).status, 200);
    assert.equal((await request(hosted, 'POST', '/api/install', { headers: { ...h, cookie }, body: { tool: 'godot' } })).status, 403, 'no installing on a hosted server');
    for (let i = 0; i < 8; i++) await request(hosted, 'POST', '/api/login', { headers: h, body: { token: 'nope' + i } });
    assert.equal((await request(hosted, 'POST', '/api/login', { headers: h, body: { token: 'correct horse battery staple' } })).status, 429, 'brute force is rate limited');
  } finally { await hosted.close(); }
});

test('a key set by the server environment cannot be changed from the browser', async () => {
  process.env.GP_PROVIDER = 'anthropic'; process.env.GP_API_KEY = 'sk-ant-env-FAKE-' + 'c'.repeat(30);
  try {
    const s = await session(app);
    assert.equal((await s.api('POST', '/api/credentials', { provider: 'openai', key: 'sk-' + 'd'.repeat(40) })).status, 409);
    assert.equal((await s.api('DELETE', '/api/credentials')).status, 409);
    assert.equal((await s.api('GET', '/api/status')).json.key.source, 'env');
  } finally { delete process.env.GP_PROVIDER; delete process.env.GP_API_KEY; }
});

test('downloads: only installers that have a checksum are offered, and the page is public even when hosted', async () => {
  const rel = { tag_name: 'v0.1.0', published_at: '2026-10-24T00:00:00Z', html_url: 'https://github.com/x/y/releases/tag/v0.1.0', assets: [
    { name: 'AltStackGameProducer-mac-arm64.dmg', size: 130000000, browser_download_url: 'https://dl/mac-arm64.dmg' }, { name: 'AltStackGameProducer-mac-arm64.dmg.sha256', size: 90, browser_download_url: 'https://dl/mac-arm64.dmg.sha256' },
    { name: 'AltStackGameProducer-win-x64.exe', size: 90000000, browser_download_url: 'https://dl/win-x64.exe' },   // no checksum: must not be offered
    { name: 'latest-mac.yml', size: 5, browser_download_url: 'https://dl/yml' } ] };
  const a = createApp({ mode: { host: '127.0.0.1', port: 0, hosted: true }, accessToken: 'tok-' + 'x'.repeat(20), provider: mock.create(), fetchImpl: async () => ({ ok: true, status: 200, json: async () => rel }) });
  await new Promise((r) => a.server.listen(0, '127.0.0.1', r)); a.port = a.server.address().port;
  try {
    const none = await request(a, 'GET', '/api/status', { headers: { host: 'x.example' } });
    assert.equal(none.status, 401);
    const r = await request(a, 'GET', '/api/downloads', { headers: { host: 'x.example' } });
    assert.equal(r.status, 200); assert.equal(r.json.published, true); assert.equal(r.json.version, '0.1.0');
    assert.deepEqual(Object.keys(r.json.assets), ['mac-arm64']);
    assert.equal(r.json.assets['mac-arm64'].sha256_url, 'https://dl/mac-arm64.dmg.sha256');
    const page = await request(a, 'GET', '/downloads.html', { headers: { host: 'x.example' } });
    assert.equal(page.status, 200); assert.match(page.text, /Get Cohnsoft Game Producer/); assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.equal((await request(a, 'GET', '/index.html', { headers: { host: 'x.example' } })).status, 302);
  } finally { await a.close(); }
  const offline = createApp({ mode: { host: '127.0.0.1', port: 0, hosted: false }, provider: mock.create(), fetchImpl: async () => { throw new Error('offline'); } });
  await new Promise((r) => offline.server.listen(0, '127.0.0.1', r)); offline.port = offline.server.address().port;
  try { assert.deepEqual((await request(offline, 'GET', '/api/downloads', { headers: { host: 'localhost:' + offline.port } })).json, { published: false, assets: {} }); } finally { await offline.close(); }
});
