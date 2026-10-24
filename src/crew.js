'use strict';
// The crew for one project: runs the Director and Sking chats, runs worker contracts, asks the Producer for decisions,
// tracks status, usage and budget, and emits every event the UI shows.
const config = require('./config');
const llm = require('./llm');
const { LLMError, explain } = require('./llm/errors');
const { modelFor } = require('./llm/models');
const { ROSTER, BY_ID, WORKERS } = require('./agents/roster');
const { systemPrompt } = require('./agents/prompts');
const { toolsFor } = require('./agents/tools');
const loop = require('./agents/loop');
const toolchain = require('./studios/toolchain');
const { inventory, counts } = require('./projects/inventory');
const { id, clip, isAbort, abortError, ToolError } = require('./util');

const SNAPSHOT_OPEN = '<project_snapshot>';

class Crew {
  constructor(project, opts) {
    this.project = project;
    this.hosted = !!(opts && opts.hosted);
    this.studios = {};
    this.runs = {};                 // channel -> {ctl, inbox}
    this.active = new Set();        // AbortControllers of running contracts
    this.chains = new Map();        // agent -> promise (one contract at a time per agent)
    this.pending = new Map();       // decision id -> {resolve, reject, signalCleanup}
    this.agentStatus = Object.fromEntries(ROSTER.map((a) => [a.id, { status: 'idle', detail: '' }]));
    this._settings = null; this._settingsAt = 0;
    this._prov = null; this._provSig = '';
    this._budgetAsk = null;
    this._usageAt = 0;
    this._assetsTimer = null;
    this.providerOverride = opts && opts.provider || null;   // tests inject a provider
  }

  // ------------------------------------------------------------ plumbing
  get settings() {
    if (!this._settings || Date.now() - this._settingsAt > 1000) { this._settings = config.loadSettings(); this._settingsAt = Date.now(); }
    return this._settings;
  }
  emit(evt) { return this.project.events.emit(evt); }
  log(...a) { if (process.env.GP_DEBUG) console.error('[crew]', ...a); }

  provider() {
    if (this.providerOverride) return this.providerOverride;
    const creds = llm.readCredentials();
    if (!creds) throw new LLMError('no_key', 'no API key is set');
    const sig = creds.provider + ':' + creds.key.length + ':' + creds.key.slice(-6);
    if (!this._prov || sig !== this._provSig) { this._prov = llm.createProvider(creds); this._provSig = sig; this._providerName = creds.provider; }
    return this._prov;
  }
  providerName() { if (this.providerOverride) return this.providerOverride.name; const c = llm.readCredentials(); return c ? c.provider : 'anthropic'; }
  modelFor(agent) { return modelFor(this.providerName(), agent, this.settings); }

  studio(key) {
    if (this.studios[key]) return this.studios[key];
    const P = this.project;
    let s;
    if (key === 'sprite') s = new (require('./studios/sprite').SpriteStudio)(P);
    else if (key === 'box') s = new (require('./studios/box').BoxStudio)(P);
    else if (key === 'engine') s = new (require('./studios/engine').EngineStudio)(P, { hosted: this.hosted });
    else if (key === 'render') s = new (require('./studios/render').RenderStudio)(P);
    else throw new Error('unknown studio ' + key);
    return (this.studios[key] = s);
  }

  dispose() {
    for (const s of Object.values(this.studios)) { try { s.dispose(); } catch (e) { /* ignore */ } }
    this.studios = {};
  }

  // ------------------------------------------------------------ events
  status(agent, status, detail) {
    const cur = this.agentStatus[agent];
    if (!cur || (cur.status === status && cur.detail === (detail || ''))) return;
    this.agentStatus[agent] = { status, detail: detail || '' };
    this.emit({ type: 'agent_status', agent, status, detail: detail || '' });
  }
  say(agent, text, contractId) { this.emit({ type: 'message', role: 'agent', agent, text, contract: contractId || null }); }
  note(agent, text, contractId) { this.emit({ type: 'note', agent, text, contract: contractId || null }); }
  emitBible(name) { this.emit({ type: 'bible', name }); }
  assetsMaybeChanged() {
    clearTimeout(this._assetsTimer);
    this._assetsTimer = setTimeout(() => this.emit({ type: 'assets', counts: counts(inventory(this.project)) }), 350);
    if (this._assetsTimer.unref) this._assetsTimer.unref();
  }

  toolStart(agent, u, contractId) {
    this.emit({ type: 'tool', agent, id: u.id, name: u.name, summary: loop.short(u.input, 220), contract: contractId || null });
    if (agent === 'director' && u.name === 'contract_agent') this.status('director', 'waiting', 'waiting for ' + ((u.input && BY_ID[u.input.agent] && BY_ID[u.input.agent].name) || 'the team'));
    if (agent === 'director' && u.name === 'ask_producer') this.status('director', 'waiting', 'waiting for you');
  }
  toolDone(agent, u, contractId, r) {
    const images = (r.images || []).slice(0, 3).map((im) => this.project.saveMedia(im.base64, im.mime));
    this.emit({ type: 'tool_result', agent, id: u.id, name: u.name, ok: r.ok, ms: r.ms, error: r.error, summary: r.ok ? loop.short(r.text, 240) : undefined, images, contract: contractId || null });
    if (agent === 'director' && (u.name === 'contract_agent' || u.name === 'ask_producer')) this.status('director', 'working', '');
  }

  recordUsage(agent, model, usage) {
    this.project.addUsage(agent, model, usage);
    if (Date.now() - this._usageAt > 600) { this._usageAt = Date.now(); this.emitUsage(); }
  }
  emitUsage() { this.emit({ type: 'usage', usage: this.project.state.usage, limit: this.settings.budgetTokens + (this.project.state.budgetApproved || 0) }); }

  // ------------------------------------------------------------ decisions (Producer approvals)
  ask({ agent, kind, question, options, code, language, signal }) {
    const d = { id: id('d'), agent, kind: kind || 'question', question, options: (options || []).slice(0, 5), code, language, status: 'pending', created: Date.now() };
    this.project.state.decisions.push(d);
    this.project.state.decisions = this.project.state.decisions.slice(-60);
    this.project.save();
    this.emit({ type: 'decision', decision: d });
    this.status(agent, 'waiting', 'waiting for you');
    return new Promise((resolve, reject) => {
      const done = () => { if (signal) signal.removeEventListener('abort', onAbort); };
      const onAbort = () => { this.pending.delete(d.id); d.status = 'cancelled'; this.emit({ type: 'decision_resolved', id: d.id, status: 'cancelled' }); done(); reject(abortError()); };
      if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
      this.pending.set(d.id, { resolve: (a) => { done(); resolve(a); }, reject });
    });
  }

  answer(decisionId, { answer, option }) {
    const p = this.pending.get(decisionId);
    const d = this.project.state.decisions.find((x) => x.id === decisionId);
    if (!p || !d) throw new ToolError('that question is no longer waiting for an answer', 'gone');
    this.pending.delete(decisionId);
    const opt = Number.isInteger(option) ? d.options[option] : null;
    d.status = 'answered';
    d.answer = String(answer || (opt && opt.label) || '').slice(0, 4000);
    d.answeredAt = Date.now();
    this.project.save();
    this.emit({ type: 'decision_resolved', id: decisionId, status: 'answered', answer: d.answer, option: opt ? option : null });
    this.status(d.agent, 'working', '');
    p.resolve({ answer: d.answer, chosen_option: opt ? opt.label : null });
  }

  async approveCode(agent, details, signal) {
    const r = await this.ask({ agent, kind: 'approval', question: details.title, code: details.code, language: details.language, options: [{ label: 'Run it' }, { label: 'Decline' }], signal });
    return r.chosen_option === 'Run it';
  }

  async guardBudget(agent, signal) {
    const limit = this.settings.budgetTokens;
    if (!limit) return;
    const cap = limit + (this.project.state.budgetApproved || 0);
    if (this.project.tokensUsed() < cap) return;
    if (!this._budgetAsk) {
      const used = this.project.tokensUsed();
      const step = Math.max(500000, Math.round(limit * 0.5));
      this._budgetAsk = this.ask({
        agent: 'director', kind: 'budget',
        question: 'The team has used ' + used.toLocaleString() + ' tokens, the budget you set for this game (' + cap.toLocaleString() + '). Raise it so work can continue?',
        options: [{ label: 'Add ' + step.toLocaleString() + ' tokens', description: 'Keep going' }, { label: 'Add ' + (step * 3).toLocaleString() + ' tokens', description: 'A larger top-up' }, { label: 'Stop here', description: 'Pause all work' }],
      }).then((a) => {
        if (/^Add/.test(a.chosen_option || '')) { this.project.state.budgetApproved = (this.project.state.budgetApproved || 0) + (a.chosen_option === 'Add ' + step.toLocaleString() + ' tokens' ? step : step * 3); this.project.save(); this.emitUsage(); return true; }
        return false;
      }).finally(() => { this._budgetAsk = null; });
    }
    const ok = await this._budgetAsk;
    if (!ok) { this.stop(); throw abortError(); }
  }

  // ------------------------------------------------------------ project state for the Director
  async projectState() {
    const P = this.project, inv = inventory(P);
    const tools = await toolchain.all();
    let game = null;
    try { game = await this.studio('engine').info(); delete game.assets_ready_to_import; } catch (e) { game = { error: e.message }; }
    return {
      project: { name: P.meta.name, pitch: P.meta.pitch },
      installed: { godot: tools.godot.found ? tools.godot.version : false, blender: tools.blender.found ? tools.blender.version : false, ffmpeg: tools.ffmpeg.found },
      bible: { documents: P.bible.list().map((d) => d.name + (d.summary ? ' (' + d.summary + ')' : '')), recent_changes: P.bible.recentChanges(6) },
      milestones: P.state.milestones,
      contracts: P.state.contracts.slice(-14).map((c) => ({ id: c.id, agent: c.agent, title: c.title, status: c.status, summary: clip(c.summary || '', 500), files: c.files, notes: clip(c.notes || '', 500), questions: c.questions })),
      assets: inv,
      game,
      decisions: P.state.decisions.filter((d) => d.status === 'answered').slice(-6).map((d) => ({ question: d.question, answer: d.answer })),
      budget: { tokens_used: P.tokensUsed(), limit: this.settings.budgetTokens + (P.state.budgetApproved || 0) },
    };
  }

  setMilestones(list) {
    const ok = new Set(['todo', 'doing', 'done', 'blocked']);
    this.project.state.milestones = list.slice(0, 10).map((m, i) => ({ id: i + 1, title: String(m.title || '').slice(0, 120), status: ok.has(m.status) ? m.status : 'todo', owner: BY_ID[m.owner] ? m.owner : null, note: String(m.note || '').slice(0, 200) }));
    this.project.save();
    this.emit({ type: 'milestones', milestones: this.project.state.milestones });
  }

  snapshotText(agentId) {
    const P = this.project;
    const inv = inventory(P);
    const c = counts(inv);
    const parts = [
      SNAPSHOT_OPEN,
      'Game: ' + P.meta.name,
      'Assets so far: ' + c.sprites + ' sprite image(s), ' + c.models + ' model(s), ' + c.music + ' music track(s), ' + c.sfx + ' sound effect(s).',
      P.state.milestones.length ? 'Milestones:\n' + P.state.milestones.map((m) => '- [' + m.status + '] ' + m.title + (m.owner ? ' (' + m.owner + ')' : '')).join('\n') : '',
      '--- bible ---\n' + P.bible.digest(),
      '</project_snapshot>',
    ];
    return parts.filter(Boolean).join('\n');
  }

  // ------------------------------------------------------------ chat (Producer <-> Director / Sking)
  async chat(channel, text) {
    if (channel !== 'director' && channel !== 'sking') throw new ToolError('you can talk to the Director or to Sking', 'bad_input');
    text = String(text || '').trim();
    if (!text) throw new ToolError('say something first', 'bad_input');
    if (text.length > 20000) throw new ToolError('that message is too long (max 20,000 characters)', 'bad_input');
    this.provider();   // fail fast, with a clear error, when there is no key
    this.emit({ type: 'message', role: 'producer', channel, text });
    const run = this.runs[channel];
    if (run) { run.inbox.push('[The Producer added, while you were working]: ' + text); return { queued: true }; }
    const ctl = new AbortController();
    const state = { ctl, inbox: [] };
    this.runs[channel] = state;
    this._runChannel(channel, text, state).catch((e) => this.log('run crashed', e && e.stack)).finally(() => { if (this.runs[channel] === state) delete this.runs[channel]; });
    return { started: true };
  }

  async _runChannel(channel, text, state) {
    const agent = channel;
    const P = this.project;
    this.emit({ type: 'run', channel, state: 'started' });
    this.status(agent, 'working', '');
    const messages = P.loadChat(channel);
    stripOldSnapshots(messages);
    let outcome = 'finished', error = null;
    try {
      await this.maybeCompact(messages, state.ctl.signal);
      messages.push({ role: 'user', content: [{ type: 'text', text: this.snapshotText(agent) }, { type: 'text', text: 'Producer: ' + text }] });
      P.saveChat(channel, messages);
      const res = await loop.run({
        crew: this, agent, system: systemPrompt(agent), tools: toolsFor(this, agent, 'chat'), messages,
        maxTurns: this.settings.maxTurns.director, signal: state.ctl.signal, inbox: state.inbox, onTurn: () => P.saveChat(channel, messages),
      });
      if (res.status === 'max_turns') this.note(agent, 'Paused after a long run of steps. Say "continue" and I will pick up where I left off.');
    } catch (e) {
      if (isAbort(e) || state.ctl.signal.aborted) outcome = 'stopped';
      else { outcome = 'error'; error = e; }
    } finally {
      P.saveChat(channel, messages);
    }
    if (this.runs[channel] === state) delete this.runs[channel];   // before the event, so a listener that checks busy() sees the truth
    this.status(agent, 'idle', '');
    for (const a of ROSTER) if (this.agentStatus[a.id].status === 'waiting' && !this.pendingFor(a.id)) this.status(a.id, 'idle', '');
    if (outcome === 'error') this.emit({ type: 'error', agent, kind: error.kind || 'internal', message: explain(error) + (error.kind ? '' : ' (' + (error.message || error) + ')') });
    this.emit({ type: 'run', channel, state: outcome });
    this.emitUsage();
    P.saveNow();
  }

  pendingFor(agent) { return this.project.state.decisions.some((d) => d.status === 'pending' && d.agent === agent); }

  /** Summarise the oldest part of a very long conversation so it keeps fitting in the model's context. */
  async maybeCompact(messages, signal) {
    if (loop.sizeOf(messages) < 450000) return;
    const idx = [];
    messages.forEach((m, i) => { if (m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text' && b.text.startsWith('Producer: '))) idx.push(i); });
    if (idx.length < 3) return;
    const cut = idx[idx.length - 2];   // keep the last two Producer turns verbatim
    const old = messages.slice(0, cut);
    const transcript = old.map((m) => (m.role === 'user' ? 'USER' : 'ASSISTANT') + ': ' + (typeof m.content === 'string' ? m.content : m.content.map((b) => b.type === 'text' ? b.text : b.type === 'tool_use' ? '[tool ' + b.name + ' ' + loop.short(b.input, 300) + ']' : b.type === 'tool_result' ? '[result ' + clip(typeof b.content === 'string' ? b.content : b.content.map((c) => c.text || '').join(' '), 400) + ']' : '').join('\n'))).join('\n').slice(-180000);
    const res = await this.provider().chat({
      model: this.modelFor('summarizer'), maxTokens: 3000, signal,
      system: 'You compress the history of a game-production conversation between a Producer and their Director. Write a faithful memo: decisions made, what exists (assets, game state), what each contracted agent delivered, open questions, and the Producer\'s preferences. Plain text, under 900 words. No invention.',
      messages: [{ role: 'user', content: [{ type: 'text', text: transcript }] }], tools: [],
    });
    this.recordUsage('director', this.modelFor('summarizer'), res.usage);
    const memo = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const rest = messages.slice(cut);
    const first = rest[0];
    first.content = [{ type: 'text', text: '[Memory of the earlier conversation]\n' + memo + '\n[End of memory]' }, ...first.content];
    messages.splice(0, messages.length, ...rest);
    this.note('director', 'Condensed the earlier conversation to stay within the model\'s limits.');
  }

  resetChat(channel) {
    if (this.runs[channel]) throw new ToolError('wait for ' + channel + ' to finish or press Stop first', 'busy');
    this.project.resetChat(channel);
    this.emit({ type: 'chat_reset', channel });
  }

  stop() {
    for (const r of Object.values(this.runs)) r.ctl.abort();
    for (const c of this.active) c.abort();
    for (const [, p] of this.pending) { try { p.reject(abortError()); } catch (e) { /* ignore */ } }
    this.pending.clear();
    for (const d of this.project.state.decisions) if (d.status === 'pending') { d.status = 'cancelled'; this.emit({ type: 'decision_resolved', id: d.id, status: 'cancelled' }); }
    this.project.save();
  }

  busy() { return Object.keys(this.runs).length > 0 || this.active.size > 0; }

  // ------------------------------------------------------------ contracts
  contract(agentId, spec, parentSignal) {
    if (!WORKERS.includes(agentId)) return Promise.reject(new ToolError('unknown agent "' + agentId + '". You can contract: ' + WORKERS.join(', '), 'bad_input'));
    const c = { id: id('c'), agent: agentId, title: String(spec.title || 'Untitled').slice(0, 100), brief: String(spec.brief || ''), deliverables: Array.isArray(spec.deliverables) ? spec.deliverables.map(String).slice(0, 20) : [], status: 'queued', created: Date.now() };
    if (!c.brief.trim()) return Promise.reject(new ToolError('a contract needs a brief', 'bad_input'));
    this.project.state.contracts.push(c);
    this.project.save();
    this.emit({ type: 'contract', contract: c });
    const prev = this.chains.get(agentId) || Promise.resolve();
    const p = prev.catch(() => {}).then(() => this._runContract(c, parentSignal));
    this.chains.set(agentId, p.catch(() => {}));
    return p;
  }

  async _runContract(c, parentSignal) {
    const agent = c.agent, P = this.project;
    const ctl = new AbortController();
    const link = () => ctl.abort();
    if (parentSignal) { if (parentSignal.aborted) ctl.abort(); else parentSignal.addEventListener('abort', link, { once: true }); }
    this.active.add(ctl);
    const update = (patch) => { Object.assign(c, patch); P.save(); this.emit({ type: 'contract', contract: c }); };
    if (ctl.signal.aborted) { update({ status: 'cancelled', finished: Date.now() }); this.active.delete(ctl); throw abortError(); }
    update({ status: 'running', started: Date.now() });
    this.status(agent, 'working', c.title);
    const messages = [{ role: 'user', content: [
      { type: 'text', text: this.snapshotText(agent) },
      { type: 'text', text: '# Contract: ' + c.title + '\n\n' + c.brief + (c.deliverables.length ? '\n\nDeliverables:\n' + c.deliverables.map((d) => '- ' + d).join('\n') : '') + '\n\nWhen finished, call submit_deliverable.' },
    ] }];
    try {
      const res = await loop.run({
        crew: this, agent, system: systemPrompt(agent), tools: toolsFor(this, agent, 'contract'), messages, terminal: 'submit_deliverable',
        maxTurns: this.settings.maxTurns.worker, signal: ctl.signal, contractId: c.id,
      });
      let out;
      if (res.status === 'terminal') {
        const t = res.terminalInput;
        out = { status: ['delivered', 'partial', 'blocked'].includes(t.status) ? t.status : 'delivered', summary: String(t.summary || ''), files: Array.isArray(t.files) ? t.files.map(String).slice(0, 60) : [], notes: String(t.notes || ''), questions: Array.isArray(t.questions) ? t.questions.map(String).slice(0, 10) : [] };
      } else if (res.status === 'max_turns') {
        out = { status: 'partial', summary: (res.text || 'Ran out of steps before finishing.') + '\n(stopped at the step limit)', files: [], notes: '', questions: [] };
      } else {
        out = { status: 'delivered', summary: res.text || 'Finished without a written summary.', files: [], notes: '(no formal deliverable was submitted)', questions: [] };
      }
      update({ ...out, finished: Date.now(), turns: res.turns });
      this.assetsMaybeChanged();
      return { contract_id: c.id, agent, title: c.title, ...out, turns: res.turns };
    } catch (e) {
      if (isAbort(e) || ctl.signal.aborted) { update({ status: 'cancelled', finished: Date.now() }); throw abortError(); }
      if (e instanceof LLMError && ['auth', 'quota', 'no_key'].includes(e.kind)) { update({ status: 'failed', summary: explain(e), finished: Date.now() }); throw e; }
      update({ status: 'failed', summary: (e && e.message) || String(e), finished: Date.now() });
      return { contract_id: c.id, agent, title: c.title, status: 'failed', summary: 'The agent failed: ' + explain(e) + (e && e.kind ? '' : ' ' + (e && e.message || '')), files: [], notes: '', questions: [] };
    } finally {
      this.active.delete(ctl);
      if (parentSignal) parentSignal.removeEventListener('abort', link);
      if (!this.chainBusy(agent, c)) this.status(agent, 'idle', '');
    }
  }

  chainBusy(agent, except) { return this.project.state.contracts.some((x) => x.agent === agent && x !== except && (x.status === 'running' || x.status === 'queued')); }
}

function stripOldSnapshots(messages) {
  for (const m of messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    m.content = m.content.filter((b) => !(b.type === 'text' && b.text.startsWith(SNAPSHOT_OPEN)));
    if (!m.content.length) m.content = [{ type: 'text', text: '(continued)' }];
  }
}

module.exports = { Crew, stripOldSnapshots };
