// Tiny DOM helpers: h() builds elements, md() renders the small subset of Markdown the bible uses (safely).

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;                       // only ever used with markup produced by this file
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (Array.isArray(k)) add(el, k);
    else if (k === null || k === undefined || k === false) continue;
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export const $ = (sel, root) => (root || document).querySelector(sel);
/** Replace an element's children, skipping null/false the way h() does (native append() would print "null"). */
export function fill(el, ...kids) { while (el.firstChild) el.removeChild(el.firstChild); add(el, kids); return el; }
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

/** Markdown subset -> safe HTML string: headings, paragraphs, lists, quotes, fenced code, tables, rules. No raw HTML, no links. */
export function md(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); continue; }
    const hm = /^(#{1,4})\s+(.*)$/.exec(l);
    if (hm) { out.push('<h' + (hm[1].length + 1) + '>' + inline(hm[2]) + '</h' + (hm[1].length + 1) + '>'); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(l)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>'); continue; }
    if (/^\s*[-*]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^\s*[-*]\s+/, '')) + '</li>'); out.push('<ul>' + items.join('') + '</ul>'); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'); out.push('<ol>' + items.join('') + '</ol>'); continue; }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const p = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+|\|)/.test(lines[i])) p.push(lines[i++]);
    out.push('<p>' + inline(p.join(' ')) + '</p>');
  }
  return out.join('\n');
}

export const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));
export const timeLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const baseName = (p) => { const parts = String(p).replace(/\/+$/, '').split('/'); return parts.pop() || String(p); };
export const prettyTool = (n) => String(n).replace(/_/g, ' ');

const ICONS = {
  gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.4 4.3-.1-1.6 1.7-1.3-1.7-3-2 .8a7.6 7.6 0 0 0-1.4-.8l-.3-2.1h-3.4l-.3 2.1c-.5.2-1 .5-1.4.8l-2-.8-1.7 3 1.7 1.3-.1 1.6.1 1.6L4.8 15.7l1.7 3 2-.8c.4.3.9.6 1.4.8l.3 2.1h3.4l.3-2.1c.5-.2 1-.5 1.4-.8l2 .8 1.7-3-1.7-1.3c.1-.5.1-1.1.1-1.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  send: '<path d="M4 12 20 4l-5 16-3.5-6.5L4 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  chevron: '<path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5Zm7 0v4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  wrench: '<path d="M14.5 6.2a4 4 0 0 0-5 5L4 16.7 7.3 20l5.5-5.5a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};
export function icon(name, size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 16); s.setAttribute('height', size || 16); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'icon');
  s.innerHTML = ICONS[name] || '';
  return s;
}
