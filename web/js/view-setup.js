// First run: plug in ONE key. It powers Director and the whole team.
import { h, clear } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { AGENTS, toast } from './ui.js';

export function renderSetup(root, onDone) {
  let provider = 'anthropic', busy = false;
  const err = h('div', { class: 'err', hidden: true, role: 'alert' });
  const keyInput = h('input', { class: 'field mono', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', 'aria-label': 'API key' });
  const connect = h('button', { class: 'btn primary big', type: 'submit' }, 'Connect');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Provider' });
  const hint = h('p', { class: 'muted', style: { margin: '6px 0 0', fontSize: '12.5px' } });

  const drawSeg = () => {
    clear(seg);
    for (const [id, label] of [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI']]) seg.append(h('button', { type: 'button', 'aria-pressed': String(provider === id), onclick: () => { provider = id; drawSeg(); } }, label));
    keyInput.placeholder = provider === 'anthropic' ? 'sk-ant-…' : 'sk-…';
    hint.textContent = provider === 'anthropic' ? 'Create one at console.anthropic.com → API keys.' : 'Create one at platform.openai.com → API keys.';
  };
  drawSeg();

  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; connect.disabled = true; connect.textContent = 'Checking…'; err.hidden = true;
    try { await api('POST', '/api/credentials', { provider, key: keyInput.value }); keyInput.value = ''; await onDone(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { busy = false; connect.disabled = false; connect.textContent = 'Connect'; }
  } },
    h('div', null, h('label', { class: 'lbl' }, 'Your AI provider'), seg),
    h('div', null, h('label', { class: 'lbl', for: 'k' }, 'API key'), keyInput, hint),
    err,
    h('div', { class: 'row' }, connect, h('button', { type: 'button', class: 'btn big ghost', onclick: async () => { try { await api('POST', '/api/credentials', { provider: 'mock' }); await onDone(); } catch (ex) { toast(ex.message, true); } } }, 'Try the demo crew first')),
    h('p', { class: 'faint', style: { fontSize: '12px', margin: 0 } }, 'One key runs the whole studio: Director, Sking, Forge, Molder, Palette and Noteie. It is stored on this computer, readable only by you, and sent nowhere except directly to your provider. You pay your provider for what the team uses, and you set the budget.'));
  keyInput.id = 'k';

  clear(root).append(h('div', { class: 'page' },
    h('div', { class: 'hero' }, h('img', { class: 'mark', src: '/assets/logo.png', alt: 'AltStack' }), h('h1', null, 'Make a game with a whole studio'), h('p', null, 'You are the Producer. Tell Director what you want; a team of AI specialists builds it with AltStack Engine, Render, Sprite and Box, and checks in with you along the way.')),
    h('div', { class: 'card', style: { maxWidth: '560px', margin: '0 auto' } }, h('h2', null, 'Plug in your key'), h('p', { class: 'muted', style: { margin: '2px 0 16px' } }, 'Step one of one.'), form),
    h('div', { class: 'team-strip', 'aria-label': 'The team' }, Object.values(AGENTS).map((a) => h('span', { class: 'mini' }, h('span', { class: 'avatar', style: { '--c': a.color, width: '22px', height: '22px', fontSize: '11px' } }, a.name[0]), a.name)))));
}
