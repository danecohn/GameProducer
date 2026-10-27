// Boot, routing and the live event stream.
import { api, stream } from './api.js';
import { S, schedule, resetSubs } from './state.js';
import { build, apply } from './timeline.js';
import { setRoster } from './ui.js';
import { renderSetup } from './view-setup.js';
import { renderHome } from './view-home.js';
import { renderStudio } from './view-studio.js';
import { openSettings as showSettings } from './view-settings.js';
import { h, clear } from './dom.js';

const root = document.getElementById('app');
let closeStream = null;

async function loadStatus() { S.status = await api('GET', '/api/status'); setRoster(S.status.roster); }

async function route() {
  if (closeStream) { closeStream(); closeStream = null; }
  resetSubs();
  S.projectId = null;
  const m = /^#\/g\/([a-z0-9-]+)$/.exec(location.hash);
  try { await loadStatus(); } catch (e) { clear(root).append(h('div', { class: 'page' }, h('div', { class: 'err' }, 'Could not reach VigilTech Game Producer: ' + e.message))); return; }
  if (!S.status.key.configured) return renderSetup(root, async () => { await route(); });
  if (!m) { document.title = 'VigilTech Game Producer · VigilTech'; return renderHome(root, { openProject: (id) => { location.hash = '#/g/' + id; }, openSettings: () => showSettings({ onKeyChange: route }) }); }
  await openProject(m[1]);
}

async function openProject(id) {
  let boot;
  try { boot = await api('GET', '/api/projects/' + id); } catch (e) { location.hash = ''; return; }
  S.projectId = id; S.project = boot.project;
  S.tl = build(boot.events);
  S.statuses = boot.statuses; S.milestones = boot.state.milestones; S.usage = boot.state.usage; S.limit = boot.state.limit;
  S.inv = boot.inventory; S.bible = boot.bible; S.running = { director: boot.runs.includes('director'), sking: boot.runs.includes('sking') };
  S.channel = 'director'; S.tab = 'assets'; S.pane = 'chat'; S.live = 'live'; S.open = new Set(); S.bibleDoc = null;
  for (const c of S.tl.contracts.values()) if (c.status === 'running' || c.status === 'queued') S.open.add(c.id);
  document.title = S.project.name + ' · VigilTech Game Producer';
  renderStudio(root, { goHome: () => { location.hash = ''; }, openSettings: () => showSettings({ onKeyChange: route }) });
  closeStream = stream(id, boot.lastSeq, handle, (s) => { if (S.live !== s) { S.live = s; schedule('menubar'); } });
}

function handle(e) {
  apply(S.tl, e);
  switch (e.type) {
    case 'agent_status': S.statuses[e.agent] = { status: e.status, detail: e.detail }; schedule('rail', 'menubar'); break;
    case 'milestones': S.milestones = e.milestones; schedule('rail'); break;
    case 'usage': S.usage = e.usage; S.limit = e.limit; schedule('menubar'); if (S.tab === 'usage') schedule('inspector'); break;
    case 'run': S.running[e.channel] = e.state === 'started'; schedule('composer', 'channel', 'menubar', 'rail'); if (e.state !== 'started') { schedule('game'); refreshInventory(); } break;
    case 'assets': refreshInventory(); break;
    case 'bible': api('GET', '/api/projects/' + S.projectId + '/bible').then((r) => { S.bible = r.documents; schedule('bible'); }).catch(() => {}); break;
    case 'chat_reset': schedule('channel', 'transcript'); break;
    case 'decision': case 'decision_resolved': schedule('menubar', 'channel', 'rail'); break;
    default: break;
  }
  if (['message', 'tool', 'tool_result', 'contract', 'decision', 'decision_resolved', 'note', 'error', 'run', 'chat_reset'].includes(e.type)) schedule('transcript');
}

let invTimer = null;
function refreshInventory() {
  clearTimeout(invTimer);
  invTimer = setTimeout(() => api('GET', '/api/projects/' + S.projectId + '/assets').then((inv) => { S.inv = inv; schedule('assets'); if (S.tab === 'game') schedule('game'); }).catch(() => {}), 250);
}

window.addEventListener('hashchange', route);
route();
