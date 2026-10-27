const webBase=document.querySelector('meta[name="vigil-base"]')?.content||'';
// Renders the six desktop downloads from /api/downloads. A build with no published installer (and checksum) is shown as "not published yet", never as a dead link.
(async () => {
  const OS = [
    ['mac', 'macOS', [['arm64', 'Apple silicon', 'M1 and newer'], ['x64', 'Intel', 'Intel-based Macs']], 'dmg'],
    ['win', 'Windows', [['x64', 'Intel / AMD (x64)', 'Most Windows PCs'], ['arm64', 'Arm', 'Surface Pro X, Snapdragon PCs']], 'exe'],
    ['linux', 'Linux', [['x64', 'Intel / AMD (x64)', 'AppImage'], ['arm64', 'Arm', 'AppImage, Raspberry Pi 4/5 and Arm servers']], 'AppImage'],
  ];
  const ua = navigator.userAgent || '';
  const mine = /Mac/i.test(ua) ? 'mac' : /Win/i.test(ua) ? 'win' : /Linux|X11/i.test(ua) ? 'linux' : '';
  let info = { published: false, assets: {} };
  try { info = await (await fetch(webBase+'/api/downloads')).json(); } catch (e) { /* offline */ }
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else n.setAttribute(k, v); } for (const c of kids) n.append(c); return n; };
  const grid = document.getElementById('grid');
  for (const [os, label, arches] of OS) {
    grid.append(el('div', { class: 'os-title' }, label));
    const row = el('div', { class: 'dl-grid' });
    for (const [arch, name, note] of arches) {
      const a = info.assets[os + '-' + arch];
      const card = el('div', { class: 'card dl' + (os === mine ? ' rec' : '') }, el('h3', {}, label + ' · ' + name), el('div', { class: 'meta' }, note + (a ? ' · ' + (a.bytes / 1048576).toFixed(0) + ' MB' : '')));
      if (a) {
        card.append(el('a', { class: 'btn primary', href: a.url, rel: 'noopener' }, 'Download ' + (info.version ? 'v' + info.version : '')));
        card.append(el('a', { class: 'muted', href: a.sha256_url, rel: 'noopener', style: 'font-size:12px' }, 'SHA-256 checksum'));
      } else card.append(el('span', { class: 'btn', 'aria-disabled': 'true', style: 'opacity:.55;cursor:not-allowed' }, 'Not published yet'));
      row.append(card);
    }
    grid.append(row);
  }
  const s = document.getElementById('status');
  if (!info.published) { s.hidden = false; s.textContent = 'No verified release is published yet. Builds appear here once every platform has passed its launch test.'; }
})();
