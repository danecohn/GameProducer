// Shared building blocks.
import { h, icon, clear } from './dom.js';

export const AGENTS = {};                     // filled from /api/status roster
export function setRoster(list) { for (const a of list) AGENTS[a.id] = a; }
export const agentName = (id) => (AGENTS[id] ? AGENTS[id].name : id === 'producer' ? 'You' : id);

export function avatar(id, size) {
  const a = AGENTS[id] || { name: '?', color: '#888' };
  const el = h('span', { class: 'avatar' + (size === 'lg' ? ' lg' : ''), style: { '--c': a.color }, title: a.name + (a.title ? ', ' + a.title : '') });
  if (id === 'director') el.append(h('img', { src: '/assets/logo.png', alt: '' }));
  else if ({forge:'engine',molder:'render',palette:'sprite',noteie:'box',sking:'office'}[id]) el.append(h('img', {src:'/assets/studios/'+({forge:'engine',molder:'render',palette:'sprite',noteie:'box',sking:'office'}[id])+'.webp',alt:''}));
  else el.append(a.name.slice(0, 1));
  return el;
}

export function toast(text, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

export function modal(title, content, opts) {
  opts = opts || {};
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal ' + (opts.class || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    title ? h('header', null, h('h3', null, title), h('button', { class: 'btn ghost small', onclick: close, 'aria-label': 'Close' }, icon('x'))) : null,
    h('div', { class: 'content' }, content));
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, box);
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  return { close, el: box };
}

export function lightbox(src, caption) {
  const m = modal(null, [h('div', { class: 'lightbox', style: { textAlign: 'center' } }, h('img', { src, alt: caption || '' }), caption ? h('p', { class: 'muted' }, caption) : null)], { class: 'lightbox' });
  m.el.style.width = 'auto'; m.el.style.background = 'transparent'; m.el.style.border = '0'; m.el.style.boxShadow = 'none';
  return m;
}

export const statusChip = (status) => {
  const map = { queued: ['queued', ''], running: ['working', 'info'], delivered: ['delivered', 'ok'], partial: ['partial', 'warn'], blocked: ['blocked', 'bad'], failed: ['failed', 'bad'], cancelled: ['stopped', ''], interrupted: ['interrupted', 'warn'] };
  const [label, cls] = map[status] || [status, ''];
  return h('span', { class: 'chip ' + cls }, status === 'running' ? h('span', { class: 'spin' }) : null, label);
};

/**
 * Keyed reconciliation: keep existing DOM nodes whose signature did not change (so inputs keep focus and text),
 * replace the ones that did, append new ones, remove the gone ones, and keep the order.
 */
export function reconcile(container, items, keyOf, sigOf, render) {
  const old = new Map();
  for (const el of [...container.children]) if (el.__key !== undefined) old.set(el.__key, el);
  const seen = new Set();
  let cursor = null;
  const frag = [];
  for (const item of items) {
    const key = keyOf(item), sig = sigOf(item);
    seen.add(key);
    let el = old.get(key);
    if (!el || el.__sig !== sig) {
      const next = render(item);
      if (!next) { if (el) el.remove(); continue; }
      next.__key = key; next.__sig = sig;
      if (el) el.replaceWith(next);
      el = next;
    }
    frag.push(el);
  }
  for (const [k, el] of old) if (!seen.has(k)) el.remove();
  frag.forEach((el, i) => { const want = container.children[i]; if (want !== el) container.insertBefore(el, want || null); });
  return container;
}

export { clear };
