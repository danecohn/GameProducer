// The studio: team rail, conversation with Director or Sking, and the inspector (assets, bible, game, usage).
import { h, clear, fill, icon, md, fmtTokens, timeLabel, baseName, prettyTool } from './dom.js';
import { api, fileUrl } from './api.js';
import { S, on, schedule } from './state.js';
import { AGENTS, avatar, agentName, statusChip, toast, modal, lightbox, reconcile } from './ui.js';
import { durationLabel } from './timeline.js';

const HIDE_TOOLS = new Set(['contract_agent', 'ask_producer', 'set_milestones']);   // each has its own card or panel
const CHANNELS = { director: { name: 'Director', sub: 'Your game director. Tell it what to make; it contracts the team.', ph: 'Tell Director what to make or change…' }, sking: { name: 'Sking', sub: 'Your writer. Story, script, dialogue and the project bible.', ph: 'Ask Sking to write or revise something…' } };

export function renderStudio(root, { goHome, openSettings }) {
  const pid = S.projectId;
  const menubar = h('div', { class: 'menubar' });
  const rail = h('aside', { class: 'rail', 'aria-label': 'Team' });
  const main = h('section', { class: 'main' });
  const inspector = h('aside', { class: 'inspector', 'aria-label': 'Project' });
  const studio = h('div', { class: 'studio', 'data-pane': S.pane }, rail, main, inspector);
  const mobileNav = h('nav', { class: 'mobile-nav', 'aria-label': 'Sections' });
  fill(root, menubar, studio, mobileNav);

  // ---------------------------------------------------------------- menubar
  function drawMenubar() {
    const u = S.usage || { input: 0, output: 0 };
    const used = (u.input || 0) + (u.output || 0), limit = S.limit || 0;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const waiting = S.tl.pending.size;
    const busy = S.running.director || S.running.sking || Object.values(S.statuses).some((s) => s && s.status === 'working');
    fill(menubar, 
      h('button', { class: 'brand', onclick: goHome, 'aria-label': 'All games' }, h('img', { src: '/assets/logo.png', alt: '' }), h('span', null, 'GameProducer', h('small', {class:'maker'}, 'COHNSOFT'))),
      h('span', { class: 'faint' }, '/'),
      h('button', { class: 'project-name btn ghost small', title: 'Rename this game', onclick: renameProject }, S.project.name),
      h('span', { class: 'grow' }),
      S.status.key.provider === 'mock' ? h('span', { class: 'demo-badge', title: 'A scripted stand-in for the AI. No key, no spend.' }, 'Demo crew') : null,
      S.live !== 'live' ? h('span', { class: 'chip warn' }, 'reconnecting…') : null,
      waiting ? h('button', { class: 'btn small primary', onclick: jumpToDecision }, waiting + ' waiting for you') : null,
      busy ? h('button', { class: 'btn small danger', onclick: stopAll }, icon('stop', 13), 'Stop') : null,
      h('div', { class: 'usage', title: used.toLocaleString() + ' tokens used' + (limit ? ' of ' + limit.toLocaleString() : '') }, h('span', { class: 'lbl' }, fmtTokens(used) + (limit ? ' / ' + fmtTokens(limit) : '') + ' tokens'), limit ? h('div', { class: 'meter' + (pct > 85 ? ' hot' : ''), role: 'progressbar', 'aria-valuenow': String(pct) }, h('i', { style: { width: pct + '%' } })) : null),
      h('button', { class: 'btn ghost small', onclick: openSettings, 'aria-label': 'Settings' }, icon('gear', 18)));
  }
  async function renameProject() {
    const name = prompt('Rename this game', S.project.name);
    if (!name || !name.trim() || name.trim() === S.project.name) return;
    try { const out = await api('PATCH', '/api/projects/' + pid, { name: name.trim() }); S.project = out.project; document.title = S.project.name + ' · Cohnsoft Game Producer'; schedule('menubar'); } catch (e) { toast(e.message, true); }
  }
  async function stopAll() { try { await api('POST', '/api/projects/' + pid + '/stop'); } catch (e) { toast(e.message, true); } }
  function jumpToDecision() {
    const id = [...S.tl.pending][0], d = S.tl.decisions.get(id);
    if (d) { S.channel = d.agent === 'sking' ? 'sking' : 'director'; S.pane = 'chat'; studio.dataset.pane = 'chat'; schedule('channel', 'transcript', 'composer', 'rail'); }
  }

  // ---------------------------------------------------------------- rail
  function drawRail() {
    const list = Object.values(AGENTS).map((a) => {
      const st = S.statuses[a.id] || { status: 'idle', detail: '' };
      const isChannel = a.id === 'director' || a.id === 'sking';
      const current = isChannel && S.channel === a.id;
      return h('button', { class: 'agent', 'aria-current': current ? 'true' : null, title: a.blurb, onclick: () => focusAgent(a.id) },
        avatar(a.id), h('span', { class: 'meta' }, h('span', { class: 'nm' }, a.name, h('span', { class: 'dot ' + st.status, title: st.status })), h('span', { class: 'ti' }, a.title + (a.studio ? ' · ' + a.studio : '')),
          h('span', { class: 'st ' + (st.status === 'working' ? 'live' : st.status === 'waiting' ? 'wait' : '') }, st.status === 'idle' ? 'idle' : st.detail || st.status)));
    });
    const ms = S.milestones;
    const t = S.status.tools;
    fill(rail, 
      h('h3', null, 'The team'), ...list,
      h('div', { class: 'board' }, h('h3', null, 'Production board'),
        ms.length ? ms.map((m) => h('div', { class: 'ms ' + m.status },
          h('span', { class: 'box' }, m.status === 'done' ? icon('check', 11) : null),
          h('span', null, h('span', { class: 'tt' }, m.title), m.owner ? h('span', { class: 'own' }, '  ' + agentName(m.owner)) : null, m.note ? h('div', { class: 'own' }, m.note) : null)))
          : h('div', { class: 'empty-note' }, 'Director will post the plan here.')),
      h('div', { class: 'board' }, h('h3', null, 'Studios'),
        h('div', { class: 'tools-row', style: { padding: '0 6px' } },
          h('span', { class: 'chip ' + (t.godot.found ? 'ok' : 'warn'), title: t.godot.found ? t.godot.version : t.godot.hint }, 'Godot'),
          h('span', { class: 'chip ' + (t.blender.found ? 'ok' : 'warn'), title: t.blender.found ? t.blender.version : t.blender.hint }, 'Blender'),
          h('span', { class: 'chip ok' }, 'Sprite'), h('span', { class: 'chip ok' }, 'Box')),
        (!t.godot.found || !t.blender.found) ? h('button', { class: 'btn small', style: { margin: '8px 6px 0' }, onclick: openSettings }, icon('wrench', 13), 'Set up tools') : null));
  }
  function focusAgent(id) {
    if (id === 'director' || id === 'sking') { S.channel = id; S.pane = 'chat'; studio.dataset.pane = 'chat'; schedule('channel', 'transcript', 'composer', 'rail'); return; }
    const mine = [...S.tl.contracts.values()].filter((c) => c.agent === id);
    if (!mine.length) { toast(agentName(id) + ' has no work yet. Director will contract them when the game needs it.'); return; }
    const c = mine[mine.length - 1];
    S.channel = 'director'; S.open.add(c.id); S.pane = 'chat'; studio.dataset.pane = 'chat';
    schedule('channel', 'transcript', 'composer', 'rail');
    setTimeout(() => { const el = [...transcript.children].find((x) => x.__key === 'contract:' + c.id); if (el) el.scrollIntoView({ block: 'center' }); }, 80);
  }

  // ---------------------------------------------------------------- conversation
  const channelBar = h('div', { class: 'channel-bar' });
  const banner = h('div', { class: 'needs-you', hidden: true });
  const transcript = h('div', { class: 'transcript', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'field', rows: '1', 'aria-label': 'Message', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }, oninput: autosize });
  const sendBtn = h('button', { class: 'btn primary', onclick: send }, icon('send', 15), h('span', null, 'Send'));
  const stopBtn = h('button', { class: 'btn danger', onclick: stopAll, hidden: true }, icon('stop', 13), 'Stop');
  const hintEl = h('div', { class: 'hint' });
  const composer = h('div', { class: 'composer' }, h('div', { class: 'inner' }, input, stopBtn, sendBtn), hintEl);
  main.append(channelBar, banner, transcript, composer);

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(190, input.scrollHeight + 2) + 'px'; }
  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try { await api('POST', '/api/projects/' + pid + '/chat', { channel: S.channel, text }); input.value = ''; autosize(); }
    catch (e) { toast(e.message, true); }
    finally { sendBtn.disabled = false; input.focus(); }
  }

  function drawChannel() {
    const c = CHANNELS[S.channel];
    fill(channelBar, 
      h('div', { class: 'seg', role: 'tablist' }, ['director', 'sking'].map((id) => h('button', { role: 'tab', 'aria-pressed': String(S.channel === id), onclick: () => { S.channel = id; schedule('channel', 'transcript', 'composer', 'rail'); } }, AGENTS[id].name, S.running[id] ? h('span', { class: 'dot working', style: { marginLeft: '6px' } }) : null))),
      h('div', { class: 'who' }, h('span', { class: 'muted', style: { fontSize: '12.5px', marginLeft: '6px' } }, c.sub)),
      h('button', { class: 'btn ghost small', title: 'Start this conversation fresh. The bible, assets and game stay.', onclick: async () => { if (!confirm('Start a fresh conversation with ' + c.name + '? Your bible, assets and game are kept.')) return; try { await api('POST', '/api/projects/' + pid + '/reset', { channel: S.channel }); } catch (e) { toast(e.message, true); } } }, icon('plus', 13), 'New session'));
    const other = S.channel === 'director' ? 'sking' : 'director';
    const waitingOther = [...S.tl.pending].map((id) => S.tl.decisions.get(id)).find((d) => d && (d.agent === 'sking' ? 'sking' : 'director') === other);
    banner.hidden = !waitingOther;
    if (waitingOther) { fill(banner, icon('chevron', 14), h('span', null, agentName(waitingOther.agent) + ' is waiting for your answer in the ' + AGENTS[other].name + ' tab.'), h('button', { class: 'btn small', onclick: jumpToDecision }, 'Go there')); }
  }

  function drawComposer() {
    const c = CHANNELS[S.channel];
    const running = S.running[S.channel];
    input.placeholder = running ? 'Add a note for ' + c.name + '. They read it on their next step…' : c.ph;
    sendBtn.querySelector('span').textContent = running ? 'Add note' : 'Send';
    stopBtn.hidden = !running;
    hintEl.replaceChildren(h('span', null, 'Enter to send · Shift+Enter for a new line'), h('span', null, running ? c.name + ' is working' : ''));
  }

  function keyOf(item) { return item.kind + ':' + (item.id || item.seq); }
  function sigOf(item) {
    switch (item.kind) {
      case 'tool': return item.status + item.ms + item.images.length;
      case 'contract': { const c = S.tl.contracts.get(item.id); return [c.status, c.log.length, c.images.length, S.open.has(c.id), (c.summary || '').length, c.finished || 0].join('|'); }
      case 'decision': { const d = S.tl.decisions.get(item.id); return d.status + (d.answer || ''); }
      default: return 's';
    }
  }

  let stick = true;   // follow new messages unless the Producer scrolled up to read
  transcript.addEventListener('scroll', () => { stick = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 160; }, { passive: true });
  function drawTranscript() {
    const items = S.tl[S.channel];
    const first = transcript.querySelector('.welcome');
    if (!items.length) {
      if (!first) fill(transcript, welcome());
      return;
    }
    if (first) first.remove();
    reconcile(transcript, items, keyOf, sigOf, renderItem);
    if (stick) transcript.scrollTop = transcript.scrollHeight;
  }
  function welcome() {
    const c = CHANNELS[S.channel];
    return h('div', { class: 'welcome' }, S.channel === 'director' ? h('img', { src: '/assets/logo.png', alt: '' }) : null, h('h3', null, 'This is your line to ' + c.name), h('p', null, c.sub));
  }

  function renderItem(item) {
    switch (item.kind) {
      case 'producer': return h('div', { class: 'msg me' }, h('div', { class: 'bubble' }, item.text));
      case 'agent': return h('div', { class: 'msg' }, avatar(item.agent), h('div', null, h('div', { class: 'who', style: { '--c': AGENTS[item.agent].color } }, agentName(item.agent)), h('div', { class: 'bubble' }, item.text)));
      case 'note': return h('div', { class: 'note' }, item.text);
      case 'error': return h('div', { class: 'err' }, item.text, item.errorKind === 'no_key' || item.errorKind === 'auth' ? h('button', { class: 'btn small', style: { marginLeft: '10px' }, onclick: openSettings }, 'Open Settings') : null);
      case 'tool': return HIDE_TOOLS.has(item.name) ? null : toolLine(item);
      case 'contract': return contractCard(item.id);
      case 'decision': return decisionCard(item.id);
      default: return null;
    }
  }

  function toolLine(t) {
    const mark = t.status === 'running' ? h('span', { class: 'spin' }) : t.status === 'ok' ? icon('check', 13) : icon('x', 13);
    return h('div', { class: 'toolline' + (t.status === 'error' ? ' bad' : '') }, mark, h('span', { class: 'nm' }, t.name), h('span', { class: 'sm' }, t.status === 'error' ? t.error : t.summary),
      t.images && t.images.length ? t.images.slice(0, 2).map((im) => h('img', { src: im.url, alt: '', style: { height: '34px', borderRadius: '5px', cursor: 'zoom-in', imageRendering: 'pixelated' }, onclick: () => lightbox(im.url) })) : null);
  }

  function contractCard(id) {
    const c = S.tl.contracts.get(id), a = AGENTS[c.agent] || { name: c.agent, color: '#888' };
    const open = S.open.has(id), active = c.status === 'running' || c.status === 'queued';
    const toggle = () => { if (open) S.open.delete(id); else S.open.add(id); schedule('transcript'); };
    const tools = c.log.filter((x) => x.kind === 'tool');
    const running = [...tools].reverse().find((x) => x.status === 'running') || tools[tools.length - 1];
    const el = h('article', { class: 'contract', style: { '--c': a.color } });
    el.append(h('header', { onclick: toggle, role: 'button', tabindex: '0', 'aria-expanded': String(open), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
      avatar(c.agent), h('span', { class: 'tt' }, c.title, h('span', { class: 'sub' }, '  ' + a.name + (c.started ? ' · ' + durationLabel((c.finished || Date.now()) - c.started) : ''))), statusChip(c.status), icon('chevron', 14)));
    const body = h('div', { class: 'body' });
    if (active) body.append(h('div', { class: 'live' }, running ? [h('span', { class: 'spin' }), h('span', { class: 'nm' }, prettyTool(running.name)), h('span', { class: 'faint' }, running.summary ? running.summary.slice(0, 80) : '')] : h('span', { class: 'faint' }, c.status === 'queued' ? 'waiting for ' + a.name + ' to be free' : 'starting…'), h('span', { class: 'faint', style: { marginLeft: 'auto' } }, tools.length + ' steps')));
    if (c.images.length) body.append(h('div', { class: 'thumbs' }, c.images.slice(-6).map((im) => h('img', { src: im.url, alt: im.tool, title: prettyTool(im.tool), onclick: () => lightbox(im.url, a.name + ': ' + prettyTool(im.tool)) }))));
    if (!active && c.summary) {
      body.append(h('div', { class: 'summary' }, c.summary));
      if (c.files && c.files.length) body.append(h('div', { class: 'files' }, c.files.slice(0, 12).map((f) => h('button', { class: 'file-chip', title: 'Open in Assets', onclick: () => openAsset(f) }, baseName(f)))));
      if (c.notes) body.append(h('div', { class: 'notes-box' }, h('b', null, 'Notes for the team  '), c.notes));
      if (c.questions && c.questions.length) body.append(h('div', { class: 'questions' }, h('b', null, 'Open questions'), h('ul', { style: { margin: '4px 0 0', padding: 0 } }, c.questions.map((q) => h('li', null, q)))));
    }
    if (open) body.append(h('div', { class: 'details' }, c.log.length ? c.log.map((x) => x.kind === 'tool'
      ? h('div', { class: 'l' + (x.status === 'error' ? ' bad' : '') }, x.status === 'running' ? h('span', { class: 'spin' }) : x.status === 'ok' ? icon('check', 12) : icon('x', 12), h('span', { class: 'nm' }, x.name), h('span', { class: 'sm' }, x.status === 'error' ? x.error : x.summary))
      : h('div', { class: 'l ' + (x.kind === 'agent' ? 'say' : '') }, x.text)) : h('div', { class: 'faint' }, 'No steps yet.'),
      c.brief ? h('details', { style: { marginTop: '6px' } }, h('summary', { class: 'toggle' }, 'The brief Director sent'), h('div', { class: 'notes-box' }, c.brief)) : null));
    el.append(body);
    return el;
  }

  function decisionCard(id) {
    const d = S.tl.decisions.get(id);
    const who = agentName(d.agent);
    if (d.status !== 'pending') {
      return h('div', { class: 'decision done' }, h('div', { class: 'answered' }, h('b', null, who + (d.kind === 'approval' ? ' asked to run code: ' : ' asked: ')), d.kind === 'approval' ? d.question : d.question), h('div', { class: 'answered' }, d.status === 'answered' ? 'You answered: ' + (d.answer || '') : d.status === 'cancelled' ? 'Cancelled.' : 'No longer waiting.'));
    }
    const answer = async (payload) => { try { await api('POST', '/api/projects/' + pid + '/decisions/' + id, payload); } catch (e) { toast(e.message, true); } };
    const free = h('input', { class: 'field', placeholder: 'Or answer in your own words…', 'aria-label': 'Your answer', onkeydown: (e) => { if (e.key === 'Enter' && free.value.trim()) answer({ answer: free.value.trim() }); } });
    return h('div', { class: 'decision', role: 'group', 'aria-label': who + ' needs your decision' },
      h('div', { class: 'row', style: { gap: '8px' } }, avatar(d.agent), h('b', null, who + (d.kind === 'approval' ? ' needs your approval' : d.kind === 'budget' ? ' needs a budget decision' : ' needs your call'))),
      h('div', { class: 'q' }, d.question),
      d.code ? h('pre', null, d.code) : null,
      h('div', { class: 'opts' }, d.options.map((o, i) => h('button', { class: 'opt', onclick: () => answer({ option: i }) }, h('b', null, o.label), o.description ? h('span', null, o.description) : null))),
      d.kind === 'question' ? h('div', { class: 'own' }, free, h('button', { class: 'btn', onclick: () => free.value.trim() && answer({ answer: free.value.trim() }) }, 'Answer')) : null);
  }

  // ---------------------------------------------------------------- inspector
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const pane = h('div', { class: 'pane' });
  inspector.append(tabsEl, pane);
  const TABS = [['assets', 'Assets'], ['bible', 'Bible'], ['game', 'Game'], ['usage', 'Usage']];

  function drawInspector() {
    fill(tabsEl, ...TABS.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; schedule('inspector'); } }, label)));
    pane.__tab = S.tab;
    if (S.tab === 'assets') drawAssets();
    else if (S.tab === 'bible') drawBible();
    else if (S.tab === 'game') drawGame();
    else drawUsage();
  }

  function openAsset(path) {
    S.tab = 'assets'; S.pane = 'inspect'; studio.dataset.pane = 'inspect'; schedule('inspector');
    if (/\.(png|gif|jpg)$/i.test(path)) lightbox(fileUrl(pid, path), path);
    else if (/^bible\//.test(path)) { S.tab = 'bible'; S.bibleDoc = path.replace(/^bible\//, ''); schedule('inspector'); }
  }

  function drawAssets() {
    const inv = S.inv;
    const nothing = !inv || (!inv.sprites.images.length && !inv.models.files.length && !inv.audio.music.length && !inv.audio.sfx.length);
    if (nothing) { fill(pane, h('div', { class: 'empty-note', style: { padding: '24px 4px', textAlign: 'center' } }, h('b', null, 'No assets yet'), h('p', null, 'Sprites from Palette, models from Molder and music and sound effects from Noteie show up here as they are made.'))); return; }
    const parts = [];
    if (inv.sprites.images.length) parts.push(h('h3', null, 'Sprites · Palette'), h('div', { class: 'asset-grid' }, inv.sprites.images.map((p) => h('div', { class: 'asset', onclick: () => lightbox(fileUrl(pid, p, '&v=' + Date.now()), baseName(p)), title: p }, h('div', { class: 'pic' }, h('img', { src: fileUrl(pid, p), alt: baseName(p), loading: 'lazy' })), h('div', { class: 'nm' }, baseName(p))))));
    if (inv.models.files.length) {
      const previews = inv.models.previews;
      parts.push(h('h3', null, 'Models · Molder'), h('div', { class: 'asset-grid' }, inv.models.files.map((m) => {
        const stem = baseName(m.path).replace(/\.\w+$/, '');
        const pv = [...previews].reverse().find((p) => baseName(p).includes(stem)) || previews[previews.length - 1];
        return h('div', { class: 'asset', title: m.path, onclick: () => pv ? lightbox(fileUrl(pid, pv), baseName(m.path)) : window.open(fileUrl(pid, m.path, '&download=1')) }, h('div', { class: 'pic smooth' }, pv ? h('img', { src: fileUrl(pid, pv), alt: stem, loading: 'lazy' }) : h('span', { class: 'faint' }, '.glb')), h('div', { class: 'nm' }, baseName(m.path)), h('a', { href: fileUrl(pid, m.path, '&download=1'), onclick: (e) => e.stopPropagation(), style: { fontSize: '11px' } }, 'download'));
      })));
    }
    if (inv.audio.music.length) parts.push(h('h3', null, 'Music · Noteie'), inv.audio.music.map((t) => {
      const file = t.files.find((f) => f.endsWith('.ogg')) || t.files.find((f) => f.endsWith('.wav'));
      return h('div', { class: 'audio-row' }, h('div', { class: 't' }, h('span', null, t.name), h('span', { class: 'faint' }, 'loops')), file ? h('audio', { controls: true, preload: 'none', src: fileUrl(pid, t.dir + '/' + file) }) : null);
    }));
    if (inv.audio.sfx.length) parts.push(h('h3', null, 'Sound effects · Noteie'), inv.audio.sfx.map((p) => h('div', { class: 'audio-row' }, h('div', { class: 't' }, baseName(p).replace(/\.wav$/, '')), h('audio', { controls: true, preload: 'none', src: fileUrl(pid, p) }))));
    fill(pane, ...parts);
  }

  async function drawBible() {
    const docs = S.bible.length ? S.bible : (await api('GET', '/api/projects/' + pid + '/bible')).documents;
    S.bible = docs;
    if (pane.__tab !== 'bible') return;
    const name = S.bibleDoc && docs.some((d) => d.name === S.bibleDoc) ? S.bibleDoc : (docs[0] && docs[0].name);
    S.bibleDoc = name;
    const body = h('div', { class: 'prose' }, h('span', { class: 'faint' }, 'Loading…'));
    const bar = h('div', { class: 'row', style: { justifyContent: 'space-between' } });
    const layout = h('div', { class: 'bible-layout' }, h('div', { class: 'doc-list' }, docs.map((d) => h('button', { 'aria-pressed': String(d.name === name), onclick: () => { S.bibleDoc = d.name; drawBible(); } }, d.name.replace(/\.md$/, '')))), bar, body);
    fill(pane, layout);
    if (!name) { body.textContent = 'The bible is empty.'; return; }
    let text = '';
    try { text = (await api('GET', '/api/projects/' + pid + '/bible/' + name)).content; } catch (e) { body.textContent = e.message; return; }
    const view = () => { body.innerHTML = md(text); bar.replaceChildren(h('span', { class: 'faint', style: { fontSize: '12px' } }, 'Maintained by Sking. You can edit it too.'), h('button', { class: 'btn small', onclick: edit }, 'Edit')); };
    const edit = () => {
      const ta = h('textarea', { class: 'field bible-edit', 'aria-label': 'Edit ' + name }, text);
      body.replaceChildren(ta);
      bar.replaceChildren(h('button', { class: 'btn small', onclick: view }, 'Cancel'), h('button', { class: 'btn small primary', onclick: async () => { try { await api('PUT', '/api/projects/' + pid + '/bible/' + name, { content: ta.value }); text = ta.value; toast('Saved ' + name); view(); } catch (e) { toast(e.message, true); } } }, 'Save'));
      ta.focus();
    };
    view();
  }

  async function drawGame() {
    fill(pane, h('span', { class: 'faint' }, 'Loading…'));
    let g;
    try { g = await api('GET', '/api/projects/' + pid + '/game'); } catch (e) { pane.textContent = e.message; return; }
    if (pane.__tab !== 'game') return;
    S.game = g;
    const i = g.info, r = i.recipe;
    const pt = i.last_playtest;
    const exportBtn = h('button', { class: 'btn', disabled: !i.project_exists, onclick: async () => { exportBtn.disabled = true; try { await api('POST', '/api/projects/' + pid + '/export'); toast('Project zipped'); drawGame(); } catch (e) { toast(e.message, true); exportBtn.disabled = false; } } }, icon('download', 14), 'Zip the Godot project');
    const playBtn = h('button', { class: 'btn primary', disabled: !i.assembled || !g.canPlay || !i.godot.found, title: !g.canPlay ? 'Available when Cohnsoft Game Producer runs on your computer' : !i.godot.found ? 'Godot is not installed' : '', onclick: async () => { try { await api('POST', '/api/projects/' + pid + '/play'); toast('Launching the game…'); } catch (e) { toast(e.message, true); } } }, icon('play', 14), 'Play');
    fill(pane, 
      h('div', { class: 'status-card' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', null, r ? r.name : 'No game built yet'), r ? h('span', { class: 'chip ' + (i.assembled ? 'ok' : 'warn') }, i.assembled ? 'assembled' : 'not assembled') : null),
        r ? h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', null, 'Genre'), h('dd', null, r.genre), h('dt', null, 'Entities'), h('dd', null, r.entities.join(', ')), h('dt', null, 'Levels'), h('dd', null, r.levels.join(', ') || 'none'), h('dt', null, 'Recipe'), h('dd', null, r.valid ? 'valid' : 'has errors: ' + r.issues.join('; ')), h('dt', null, 'Last playtest'), h('dd', null, pt ? (pt.ok ? 'clean' : pt.errors + ' error(s)') + ' · ' + pt.state : 'not run yet'))
          : h('p', { class: 'muted', style: { margin: '8px 0 0' } }, 'Ask Director to start building. Forge will assemble a playable game here.')),
      h('div', { class: 'row', style: { margin: '14px 0' } }, playBtn, exportBtn),
      !i.godot.found ? h('div', { class: 'callout warn' }, 'Godot is not installed, so Forge cannot assemble or playtest yet. ', h('button', { class: 'toggle', onclick: openSettings }, 'Set it up')) : null,
      h('h3', null, 'Downloads'),
      g.exports.length ? g.exports.map((x) => h('div', { class: 'audio-row' }, h('div', { class: 't' }, h('a', { href: fileUrl(pid, x.path, '&download=1') }, baseName(x.path)), h('span', { class: 'faint' }, (x.bytes / 1024).toFixed(0) + ' KB')))) : h('div', { class: 'empty-note' }, 'Zip the project to download it. Open the folder in Godot 4 and press F5.'));
  }

  function drawUsage() {
    const u = S.usage || { input: 0, output: 0, cached: 0, calls: 0, byAgent: {} };
    const rows = Object.entries(u.byAgent || {}).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
    fill(pane, 
      h('h3', null, 'Tokens this game'),
      h('p', { class: 'muted', style: { margin: '0 0 10px' } }, 'Everything the team has asked the model to read and write. Your provider bills you directly for these; the budget in Settings stops the team from running away.'),
      h('table', { class: 'usage-table' }, h('thead', null, h('tr', null, h('th', null, 'Agent'), h('th', null, 'Calls'), h('th', null, 'In'), h('th', null, 'Out'))),
        h('tbody', null, rows.map(([id, a]) => h('tr', null, h('td', null, agentName(id)), h('td', null, a.calls), h('td', null, fmtTokens(a.input)), h('td', null, fmtTokens(a.output)))),
          h('tr', { style: { fontWeight: '700' } }, h('td', null, 'Total'), h('td', null, u.calls), h('td', null, fmtTokens(u.input)), h('td', null, fmtTokens(u.output))))),
      u.cached ? h('p', { class: 'faint', style: { fontSize: '12px' } }, fmtTokens(u.cached) + ' input tokens were served from the provider cache.') : null,
      h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn small', onclick: openSettings }, 'Change budget and models')));
  }

  // ---------------------------------------------------------------- wire up
  fill(mobileNav, ...[['team', 'Team'], ['chat', 'Chat'], ['inspect', 'Project']].map(([id, label]) => h('button', { 'aria-pressed': String(S.pane === id), onclick: () => { S.pane = id; studio.dataset.pane = id; [...mobileNav.children].forEach((b, k) => b.setAttribute('aria-pressed', String(['team', 'chat', 'inspect'][k] === id))); } }, label)));
  on('menubar', drawMenubar); on('rail', drawRail); on('channel', drawChannel); on('transcript', drawTranscript); on('composer', drawComposer); on('inspector', drawInspector);
  on('assets', () => { if (S.tab === 'assets') drawAssets(); });
  on('bible', () => { if (S.tab === 'bible' && !pane.querySelector('textarea')) drawBible(); });
  on('game', () => { if (S.tab === 'game') drawGame(); });
  schedule('menubar', 'rail', 'channel', 'transcript', 'composer', 'inspector');
  setInterval(() => { if (S.tl && [...S.tl.contracts.values()].some((c) => c.status === 'running')) schedule('transcript'); }, 5000);
}
