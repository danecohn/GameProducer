// Home: start a new game or pick up an old one.
import { h, clear, icon } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { toast } from './ui.js';

const IDEAS = [
  'A cheerful 2D platformer about a little robot collecting batteries across floating islands.',
  'A top-down arena shooter in neon where waves of drones chase you and you pick power-ups.',
  'A cosy memory-match puzzle game with hand-drawn animal cards and a calm lo-fi soundtrack.',
  'A short first-person vault heist: find the red key, dodge the guard, open the vault.',
];

const STOP = new Set(['a', 'an', 'the', 'about', 'of', 'for', 'with', 'and', 'to', 'in', 'on', 'where', 'that', 'who', 'is', 'are', 'it', 'its', 'by', 'at', 'from', 'as', 'make', 'me', 'game', 'i', 'want']);
/** "A cheerful 2D platformer about a robot collecting coins" -> "Cheerful 2D Platformer" */
export function nameFromPitch(pitch) {
  const words = String(pitch || '').split(/[\s,.:;!?]+/).filter(Boolean);
  const out = [];
  for (const w of words) { if (!out.length && STOP.has(w.toLowerCase())) continue; if (out.length && STOP.has(w.toLowerCase()) && out.length >= 2) break; out.push(w); if (out.length === 4) break; }
  while (out.length && STOP.has(out[out.length - 1].toLowerCase())) out.pop();
  return out.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Untitled Game';
}

export function renderHome(root, { openProject, openSettings }) {
  const name = h('input', { class: 'field', placeholder: 'Name (optional)', maxlength: '60', 'aria-label': 'Game name' });
  const pitch = h('textarea', { class: 'field', rows: '5', placeholder: 'Describe the game you want to make. Genre, feel, anything you already know. Director will ask if something important is missing.', 'aria-label': 'Describe your game' });
  const go = h('button', { class: 'btn primary big', type: 'submit' }, 'Start producing');
  const list = h('div', { class: 'project-list' });

  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const p = pitch.value.trim();
    if (!p && !name.value.trim()) { pitch.focus(); return; }
    go.disabled = true; go.textContent = 'Setting up…';
    try {
      const title = name.value.trim() || nameFromPitch(p);
      const out = await api('POST', '/api/projects', { name: title, pitch: p, start: !!p });
      if (out.warning) toast(out.warning, true);
      openProject(out.project.id);
    } catch (ex) { toast(ex.message, true); go.disabled = false; go.textContent = 'Start producing'; }
  } },
    h('div', null, h('label', { class: 'lbl' }, 'New game'), pitch),
    h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: '180px' } }, name), go),
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'faint', style: { fontSize: '12px' } }, 'Need a spark?'), IDEAS.map((t) => h('button', { type: 'button', class: 'chip', style: { cursor: 'pointer' }, onclick: () => { pitch.value = t; pitch.focus(); } }, t.split(' ').slice(1, 5).join(' ') + '…'))));

  const tools = h('div', { class: 'tools-row' });
  const t = S.status.tools;
  const chip = (label, found, sub) => h('span', { class: 'chip ' + (found ? 'ok' : 'warn'), title: sub || '' }, found ? icon('check', 12) : null, label + (found ? '' : ' not installed'));
  tools.append(chip('Forge · Godot', t.godot.found, t.godot.version), chip('Molder · Blender', t.blender.found, t.blender.version), h('span', { class: 'chip ok' }, icon('check', 12), 'Palette · Sprite'), h('span', { class: 'chip ok' }, icon('check', 12), 'Noteie · Box'));
  if (!t.godot.found || !t.blender.found) tools.append(h('button', { class: 'btn small', onclick: openSettings }, icon('wrench', 13), 'Set up tools'));

  clear(root).append(h('div', { class: 'page' },
    h('div', { class: 'hero' }, h('img', { class: 'mark', src: '/assets/logo.png', alt: 'AltStack' }), h('h1', null, 'What are we making?'), h('p', null, 'Describe it. Director plans it, the team builds it, and you steer.')),
    h('div', { class: 'card' }, form, h('div', { style: { marginTop: '14px' } }, tools)),
    h('div', { class: 'card', id: 'recent' }, h('h2', null, 'Your games'), list)));

  api('GET', '/api/projects').then(({ projects }) => {
    clear(list);
    if (!projects.length) list.append(h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Nothing yet. Your first game will show up here.'));
    for (const p of projects) list.append(h('button', { class: 'project-item', onclick: () => openProject(p.id) },
      h('span', { class: 'avatar lg', style: { '--c': '#ff0058' } }, h('img', { src: '/assets/logo.png', alt: '' })),
      h('span', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, (p.pitch || 'No description').slice(0, 110))),
      h('span', { class: 'faint', style: { fontSize: '12px' } }, new Date(p.updated).toLocaleDateString())));
  }).catch((e) => toast(e.message, true));
}
