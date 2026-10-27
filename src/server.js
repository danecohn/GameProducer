'use strict';
// HTTP server: static UI, JSON API, one SSE stream per project. No framework, no dependencies.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const llm = require('./llm');
const { LLMError, explain } = require('./llm/errors');
const { TIERS, modelFor } = require('./llm/models');
const { Project } = require('./projects/project');
const { inventory } = require('./projects/inventory');
const { Crew } = require('./crew');
const { Auth, COOKIE } = require('./http/auth');
const { ROSTER } = require('./agents/roster');
const toolchain = require('./studios/toolchain');
const install = require('./install');
const { ToolError, confine, mimeOf } = require('./util');

const MAX_BODY = 1024 * 1024;
const INLINE_OK = /^(image\/(png|jpeg|gif|webp)|audio\/|application\/json|text\/|model\/|application\/zip)/;
const NEVER_INLINE = /svg|html|javascript|xml/i;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
};
const PAGE_CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function createApp(opts) {
  opts = opts || {};
  const mode = opts.mode || config.serverMode();
  const hosted = !!mode.hosted;
  const base = hosted ? String(opts.basePath || process.env.PUBLIC_BASE_PATH || '').replace(/\/$/, '') : '';
  if (base && !/^\/[a-z][a-z0-9-]*$/.test(base)) throw new Error('Invalid PUBLIC_BASE_PATH');
  const accessToken = opts.accessToken !== undefined ? opts.accessToken : process.env.GP_ACCESS_TOKEN;
  if (hosted && !accessToken) throw new Error('Refusing to listen on a public interface without GP_ACCESS_TOKEN. Set it to a long random string.');
  const auth = new Auth({ hosted, accessToken, port: mode.port });
  const crews = new Map();
  const installs = new Map();
  let modelCache = null;

  function crewFor(id) {
    let c = crews.get(id);
    if (!c) { c = new Crew(Project.open(id), { hosted, provider: opts.provider }); crews.set(id, c); }
    return c;
  }

  // ------------------------------------------------------------ helpers
  function send(res, status, body, headers) {
    const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store', ...SECURITY_HEADERS, ...(headers || {}) });
    res.end(data);
  }
  const fail = (res, status, message, code) => send(res, status, { error: message, code: code || undefined });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new ToolError('request body too large', 'too_large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!n) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new ToolError('body is not valid JSON', 'bad_json')); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath).replace(/^\/+/, '');
    let file;
    try { file = confine(config.paths.web, rel, { mustExist: true }); } catch (e) { return fail(res, 404, 'not found'); }
    if (fs.statSync(file).isDirectory()) return fail(res, 404, 'not found');
    const mime = mimeOf(file);
    const headers = { 'content-type': mime, 'cache-control': rel === 'index.html' ? 'no-store' : 'no-cache', ...SECURITY_HEADERS };
    if (/^(index|login|downloads)\.html$/.test(rel)) headers['content-security-policy'] = PAGE_CSP;
    if (rel === 'index.html' && !hosted) headers['set-cookie'] = auth.issueLocal(req);
    res.writeHead(200, headers);
    if(base && /\.html$/.test(rel)){let html=fs.readFileSync(file,'utf8').replace(/(href|src|action)="\/(?!\/)/g,'$1="'+base+'/').replace('<head>','<head><meta name="vigil-base" content="'+base+'">');res.end(html);return;}
    fs.createReadStream(file).pipe(res);
  }

  function serveFile(req, res, project, rel, download) {
    const file = project.resolvePublic(rel);
    const st = fs.statSync(file);
    if (!st.isFile()) throw new ToolError('not a file', 'bad_path');
    let mime = mimeOf(file);
    const inline = INLINE_OK.test(mime) && !NEVER_INLINE.test(mime) && !download;
    const headers = { 'content-type': mime, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-cache', 'accept-ranges': 'bytes',
      'content-disposition': (inline ? 'inline' : 'attachment') + '; filename="' + path.basename(file).replace(/[^\w.\- ]/g, '_') + '"' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, { ...headers, 'content-range': 'bytes ' + start + '-' + end + '/' + st.size, 'content-length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  }

  function sse(req, res, project) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', ...SECURITY_HEADERS });
    res.write('retry: 2000\n\n');
    const since = Number(new URL(req.url, 'http://x').searchParams.get('since') || req.headers['last-event-id'] || 0);
    const write = (e) => res.write('id: ' + e.seq + '\ndata: ' + JSON.stringify(e) + '\n\n');
    for (const e of project.events.since(since)) write(e);
    const unsub = project.events.subscribe(write);
    const hb = setInterval(() => res.write(': hb\n\n'), 20000);
    req.on('close', () => { clearInterval(hb); unsub(); });
  }

  function bootPayload(project, crew) {
    const s = project.state;
    return {
      project: project.summary(),
      state: { contracts: s.contracts, milestones: s.milestones, decisions: s.decisions.filter((d) => d.status === 'pending'), usage: s.usage, limit: crew.settings.budgetTokens + (s.budgetApproved || 0) },
      statuses: crew.agentStatus,
      busy: crew.busy(),
      runs: Object.keys(crew.runs),
      inventory: inventory(project),
      bible: project.bible.list(),
      events: project.events.events.slice(-900),
      lastSeq: project.events.seq,
    };
  }

  function publicSettings() {
    const s = config.loadSettings();
    return { models: s.models, reviewCode: s.reviewCode, maxTurns: s.maxTurns, budgetTokens: s.budgetTokens, parallelContracts: s.parallelContracts };
  }

  async function modelList() {
    const creds = llm.readCredentials();
    if (!creds) return [];
    if (modelCache && modelCache.sig === creds.provider + creds.key.slice(-6) && Date.now() - modelCache.at < 300000) return modelCache.list;
    const list = await llm.createProvider(creds, { fetchImpl: opts.fetchImpl }).listModels();
    modelCache = { sig: creds.provider + creds.key.slice(-6), at: Date.now(), list };
    return list;
  }

  // ------------------------------------------------------------ public release metadata (no secrets: it mirrors GitHub's public API)
  let releaseCache = null;
  const ASSET = /^AltStackGameProducer-(mac|win|linux)-(arm64|x64)\.(dmg|exe|AppImage)$/;
  async function latestRelease() {
    if (releaseCache && Date.now() - releaseCache.at < 600000) return releaseCache.value;
    const url = process.env.GP_RELEASES_URL || 'https://api.github.com/repos/' + (process.env.GP_RELEASES_REPO || 'danecohn/GameProducer') + '/releases/latest';
    let value = { published: false, assets: {} };
    try {
      const res = await (opts.fetchImpl || fetch)(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'altstack-game-producer' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const rel = await res.json();
        const byName = new Map((rel.assets || []).map((a) => [a.name, a]));
        const assets = {};
        for (const a of rel.assets || []) {
          const m = ASSET.exec(a.name);
          if (!m || !byName.has(a.name + '.sha256')) continue;   // an installer counts as published only together with its checksum
          assets[m[1] + '-' + m[2]] = { name: a.name, url: a.browser_download_url, bytes: a.size, sha256_url: byName.get(a.name + '.sha256').browser_download_url };
        }
        value = { published: Object.keys(assets).length > 0, version: String(rel.tag_name || '').replace(/^v/, ''), tag: rel.tag_name, released: rel.published_at, notes_url: rel.html_url, assets };
      }
    } catch (e) { /* offline or rate limited: report nothing published rather than failing */ }
    releaseCache = { at: Date.now(), value };
    return value;
  }

  // ------------------------------------------------------------ routes
  const routes = [];
  const route = (method, re, handler, o) => routes.push({ method, re, handler, public: !!(o && o.public) });

  route('GET', /^\/api\/downloads$/, async (req, res) => send(res, 200, await latestRelease()), { public: true });

  route('GET', /^\/api\/status$/, async (req, res) => {
    const keyInfo = llm.describe();
    const prov = keyInfo.configured ? keyInfo.provider : 'anthropic';
    send(res, 200, { version: config.VERSION, hosted, key: keyInfo, providers: ['anthropic', 'openai'], defaults: TIERS, defaultModels: Object.fromEntries(ROSTER.map((a) => [a.id, modelFor(prov, a.id, {})])), tools: await toolchain.all(), roster: ROSTER, settings: publicSettings(), installs: Object.fromEntries([...installs].map(([k, v]) => [k, { state: v.state, log: v.log.slice(-12) }])) });
  });

  route('POST', /^\/api\/credentials$/, async (req, res) => {
    if (process.env.GP_API_KEY || process.env.GP_PROVIDER) return fail(res, 409, 'The API key is set by the server environment (GP_API_KEY / GP_PROVIDER) and cannot be changed here.', 'env_key');
    const b = await readBody(req);
    if (b.provider === 'mock') { llm.saveCredentials('mock'); return send(res, 200, llm.describe()); }
    if (!llm.PROVIDERS.includes(b.provider)) return fail(res, 400, 'Choose OpenAI or Anthropic.');
    const key = String(b.key || '').trim();
    if (key.length < 20 || /\s/.test(key)) return fail(res, 400, 'That does not look like an API key.');
    try { await llm.createProvider({ provider: b.provider, key }, { fetchImpl: opts.fetchImpl }).listModels(); }
    catch (e) {
      if (e instanceof LLMError) return fail(res, e.kind === 'auth' ? 400 : 502, e.kind === 'auth' ? 'The provider rejected that key. Check that you copied all of it and that it is a ' + (b.provider === 'openai' ? 'OpenAI' : 'Anthropic') + ' key.' : explain(e), e.kind);
      throw e;
    }
    llm.saveCredentials(b.provider, key);
    modelCache = null;
    send(res, 200, llm.describe());
  });

  route('DELETE', /^\/api\/credentials$/, async (req, res) => {
    if (process.env.GP_API_KEY || process.env.GP_PROVIDER) return fail(res, 409, 'The API key is set by the server environment.', 'env_key');
    llm.clearCredentials(); modelCache = null;
    send(res, 200, llm.describe());
  });

  route('GET', /^\/api\/models$/, async (req, res) => { try { send(res, 200, { models: await modelList() }); } catch (e) { if (e instanceof LLMError) return fail(res, 502, explain(e), e.kind); throw e; } });

  route('GET', /^\/api\/settings$/, async (req, res) => send(res, 200, publicSettings()));
  route('PUT', /^\/api\/settings$/, async (req, res) => {
    const b = await readBody(req);
    const patch = {};
    if (b.models && typeof b.models === 'object') {
      patch.models = {};
      for (const k of Object.keys(config.DEFAULT_SETTINGS.models)) if (k in b.models) { const v = b.models[k]; patch.models[k] = v ? String(v).slice(0, 80).replace(/[^\w.:\/-]/g, '') : null; }
    }
    for (const k of ['reviewCode', 'parallelContracts']) if (k in b) patch[k] = !!b[k];
    if (b.budgetTokens !== undefined) patch.budgetTokens = Number(b.budgetTokens);
    if (b.maxTurns && typeof b.maxTurns === 'object') patch.maxTurns = { director: Number(b.maxTurns.director) || undefined, worker: Number(b.maxTurns.worker) || undefined };
    if (patch.maxTurns) for (const k of Object.keys(patch.maxTurns)) if (patch.maxTurns[k] === undefined) delete patch.maxTurns[k];
    config.saveSettings(patch);
    send(res, 200, publicSettings());
  });

  route('POST', /^\/api\/install$/, async (req, res) => {
    if (hosted) return fail(res, 403, 'Installing tools is disabled on a hosted server; the image already includes them.');
    const b = await readBody(req);
    if (!['godot', 'blender'].includes(b.tool)) return fail(res, 400, 'tool must be godot or blender');
    const cur = installs.get(b.tool);
    if (cur && cur.state === 'running') return send(res, 200, { state: 'running' });
    const rec = { state: 'running', log: [] };
    installs.set(b.tool, rec);
    (b.tool === 'godot' ? install.installGodot : install.installBlender)((l) => rec.log.push(l)).then(() => { rec.state = 'done'; toolchain.clearCache(); }, (e) => { rec.state = 'failed'; rec.log.push('Failed: ' + e.message); });
    send(res, 202, { state: 'running' });
  });

  route('GET', /^\/api\/projects$/, async (req, res) => send(res, 200, { projects: Project.list() }));

  route('POST', /^\/api\/projects$/, async (req, res) => {
    const b = await readBody(req);
    const project = Project.create({ name: b.name, pitch: b.pitch });
    const out = { project: project.summary() };
    if (b.start && String(b.pitch || '').trim()) {
      try { await crewFor(project.id).chat('director', 'Here is the game I want to make:\n\n' + String(b.pitch).trim()); out.started = true; }
      catch (e) { out.started = false; out.warning = e instanceof LLMError ? explain(e) : e.message; }
    }
    send(res, 201, out);
  });

  const P = /^\/api\/projects\/([a-z0-9][a-z0-9-]*)/;
  route('GET', new RegExp(P.source + '$'), async (req, res, m) => { const c = crewFor(m[1]); send(res, 200, bootPayload(c.project, c)); });
  route('PATCH', new RegExp(P.source + '$'), async (req, res, m) => {
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) return fail(res, 400, 'a game needs a name');
    const project = crewFor(m[1]).project;
    project.meta.name = name;
    project.saveNow();
    project.events.emit({ type: 'renamed', name });
    send(res, 200, { project: project.summary() });
  });
  route('GET', new RegExp(P.source + '/events$'), async (req, res, m) => sse(req, res, crewFor(m[1]).project));

  route('POST', new RegExp(P.source + '/chat$'), async (req, res, m) => {
    const b = await readBody(req);
    send(res, 202, await crewFor(m[1]).chat(b.channel || 'director', b.text));
  });
  route('POST', new RegExp(P.source + '/reset$'), async (req, res, m) => { const b = await readBody(req); crewFor(m[1]).resetChat(b.channel || 'director'); send(res, 200, { ok: true }); });
  route('POST', new RegExp(P.source + '/stop$'), async (req, res, m) => { crewFor(m[1]).stop(); send(res, 200, { ok: true }); });
  route('POST', new RegExp(P.source + '/decisions/([a-z0-9_]+)$'), async (req, res, m) => { const b = await readBody(req); crewFor(m[1]).answer(m[2], { answer: b.answer, option: Number.isInteger(b.option) ? b.option : undefined }); send(res, 200, { ok: true }); });

  route('GET', new RegExp(P.source + '/assets$'), async (req, res, m) => send(res, 200, inventory(crewFor(m[1]).project)));
  route('GET', new RegExp(P.source + '/bible$'), async (req, res, m) => send(res, 200, { documents: crewFor(m[1]).project.bible.list() }));
  route('GET', new RegExp(P.source + '/bible/([A-Za-z0-9_-]+\\.md)$'), async (req, res, m) => send(res, 200, { name: m[2], content: crewFor(m[1]).project.bible.read(m[2]) }));
  route('PUT', new RegExp(P.source + '/bible/([A-Za-z0-9_-]+\\.md)$'), async (req, res, m) => {
    const b = await readBody(req);
    const crew = crewFor(m[1]);
    crew.project.bible.write(m[2], b.content);
    crew.project.bible.changelog('Producer', 'edited ' + m[2]);
    crew.emitBible(m[2]);
    send(res, 200, { ok: true });
  });
  route('GET', new RegExp(P.source + '/(?:file|media/([^/]+))$'), async (req, res, m) => {
    const project = crewFor(m[1]).project;
    const u = new URL(req.url, 'http://x');
    const rel = m[2] ? '.producer/media/' + m[2] : u.searchParams.get('path');
    serveFile(req, res, project, rel, u.searchParams.get('download') === '1');
  });

  route('GET', new RegExp(P.source + '/game$'), async (req, res, m) => {
    const crew = crewFor(m[1]);
    const info = await crew.studio('engine').info();
    delete info.assets_ready_to_import;
    const exportsDir = path.join(crew.project.dir, 'exports');
    const exportsList = fs.existsSync(exportsDir) ? require('./util').walk(exportsDir).map((f) => ({ path: 'exports/' + f.path, bytes: f.size, modified: f.mtime })) : [];
    send(res, 200, { info, exports: exportsList, canPlay: !hosted });
  });

  route('POST', new RegExp(P.source + '/export$'), async (req, res, m) => {
    const crew = crewFor(m[1]);
    const out = await crew.studio('engine').run('export_game', { kind: 'source_zip' }, {});
    crew.emit({ type: 'assets' });
    send(res, 200, out);
  });

  route('POST', new RegExp(P.source + '/play$'), async (req, res, m) => {
    if (hosted) return fail(res, 403, 'Playing is only available when VigilTech Game Producer runs on your own computer. Download the Godot project instead.');
    const crew = crewFor(m[1]);
    const g = await toolchain.status('godot');
    if (!g.found) return fail(res, 400, g.hint, 'godot_missing');
    if (!fs.existsSync(path.join(crew.project.paths.game, 'amerika_game.json'))) return fail(res, 400, 'The game has not been assembled yet. Ask the Director to build it first.', 'not_assembled');
    const child = spawn(g.path, ['--path', crew.project.paths.game], { detached: true, stdio: 'ignore' });
    child.unref();
    send(res, 200, { ok: true, pid: child.pid });
  });

  // ------------------------------------------------------------ dispatch
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = base && (url.pathname===base||url.pathname.startsWith(base+'/')) ? url.pathname.slice(base.length)||'/' : url.pathname;
    if (!auth.hostOk(req)) return fail(res, 403, 'unexpected Host header');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !auth.originOk(req)) return fail(res, 403, 'cross-origin request refused');

    if (hosted && p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const r = auth.login(req, b.token);
      return r.ok ? send(res, 200, { ok: true }, { 'set-cookie': r.cookie }) : fail(res, r.status, r.error);
    }
    if (hosted && p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'set-cookie': auth.cookie(req, '', 0) });
    if (p === '/api/downloads' && req.method === 'GET') return routes.find((r) => r.re.test(p)).handler(req, res);
    if (hosted && !auth.authed(req)) {
      if (p === '/login.html' || p === '/login.js' || p === '/downloads.html' || p === '/downloads.js' || p === '/style.css' || p.startsWith('/assets/')) return serveStatic(req, res, p);
      if (p.startsWith('/api/')) return fail(res, 401, 'login required', 'login');
      res.writeHead(302, { location: base+'/login.html', ...SECURITY_HEADERS });
      return res.end();
    }
    if (p.startsWith('/api/')) {
      if (!hosted && !auth.authed(req)) return fail(res, 401, 'Open VigilTech Game Producer from its own page (reload the tab).', 'session');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p);
        if (m) return r.handler(req, res, m);
      }
      return fail(res, 404, 'no such endpoint');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed');
    return serveStatic(req, res, p);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (res.headersSent) { try { res.end(); } catch (x) { /* closed */ } return; }
      if (e instanceof ToolError) return fail(res, e.code === 'not_found' || e.code === 'gone' ? 404 : e.code === 'busy' ? 409 : 400, e.message, e.code);
      if (e instanceof LLMError) return fail(res, e.kind === 'no_key' ? 400 : e.kind === 'auth' ? 400 : 502, explain(e), e.kind);
      if (process.env.GP_DEBUG) console.error(e);
      fail(res, 500, 'internal error');
    });
  });
  server.requestTimeout = 0;      // SSE streams stay open

  function close() {
    for (const c of crews.values()) { c.stop(); c.dispose(); }
    return new Promise((resolve) => { server.close(() => resolve()); if (server.closeAllConnections) server.closeAllConnections(); });
  }

  return { server, auth, crews, close, crewFor, mode };
}

async function listen(opts) {
  const app = createApp(opts);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(app.mode.port, app.mode.host, resolve); });
  const addr = app.server.address();
  app.port = addr.port;
  app.auth.port = addr.port;
  return app;
}

module.exports = { createApp, listen };
