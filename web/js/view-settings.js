// Settings: the one key, model choices, review and budget controls, and tool setup.
import { h, icon, fmtTokens } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { AGENTS, modal, toast } from './ui.js';

export function openSettings({ onKeyChange }) {
  const st = S.status;
  const content = h('div');
  const m = modal('Settings', content);
  let settings = null, models = [];

  async function load() {
    try { [settings, S.status] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/status')]); } catch (e) { toast(e.message, true); return; }
    if (S.status.key.configured && S.status.key.provider !== 'mock') api('GET', '/api/models').then((r) => { models = r.models; draw(); }).catch(() => {});
    draw();
  }

  function draw() {
    const st = S.status, key = st.key;
    content.replaceChildren(
      section('API key', [
        key.configured
          ? h('div', { class: 'row' }, h('span', { class: 'chip ok' }, icon('check', 12), key.provider === 'mock' ? 'Demo crew (no key)' : (key.provider === 'openai' ? 'OpenAI' : 'Anthropic') + ' ' + key.hint), key.source === 'env' ? h('span', { class: 'muted' }, 'Set by the server environment.') : [
            h('button', { class: 'btn small', onclick: async () => { await api('DELETE', '/api/credentials'); await onKeyChange(); m.close(); } }, 'Disconnect'),
          ])
          : h('p', { class: 'muted' }, 'No key connected.'),
        h('p', { class: 'faint', style: { fontSize: '12px', margin: '8px 0 0' } }, 'One key powers the whole studio. It stays on this computer and goes only to your provider.'),
      ]),
      section('Which model each agent uses', [
        h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12.5px' } }, 'Leave blank for the default. Director plans and judges, so it defaults to the strongest model; specialists default to the middle tier.'),
        h('div', { class: 'model-grid' }, Object.values(AGENTS).map((a) => {
          const inp = h('input', { class: 'field', list: 'models', placeholder: st.defaultModels[a.id], value: settings.models[a.id] || '', 'aria-label': a.name + ' model', onchange: async () => { settings = await api('PUT', '/api/settings', { models: { [a.id]: inp.value.trim() || null } }); toast(a.name + ' will use ' + (inp.value.trim() || 'the default')); } });
          return h('div', null, h('label', { class: 'lbl' }, a.name + ' · ' + a.title), inp);
        })),
        h('datalist', { id: 'models' }, models.map((x) => h('option', { value: x.id }))),
      ]),
      section('Producer controls', [
        h('label', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } },
          h('input', { type: 'checkbox', checked: settings.reviewCode ? '' : null, onchange: async (e) => { settings = await api('PUT', '/api/settings', { reviewCode: e.target.checked }); } }),
          h('span', null, h('b', null, 'Review code before it runs'), h('br'), h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Molder shows you any Python it wants to run inside Blender and waits for your OK. Recommended.'))),
        h('div', { style: { marginTop: '14px' } }, h('label', { class: 'lbl' }, 'Token budget per game (0 = no limit)'),
          h('div', { class: 'row' }, h('input', { class: 'field', type: 'number', min: '0', step: '100000', value: String(settings.budgetTokens), style: { maxWidth: '200px' }, onchange: async (e) => { settings = await api('PUT', '/api/settings', { budgetTokens: Number(e.target.value) }); toast('Budget set to ' + fmtTokens(settings.budgetTokens) + ' tokens'); } }), h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'The team asks before going past it.'))),
      ]),
      section('Tools', toolRows(st)),
      section('About', [h('p', { class: 'muted', style: { margin: 0 } }, 'Cohnsoft Game Producer ' + st.version + '. A product of Cohnsoft. Cohnsoft was founded by Demetria Althea Cohn. Godot (MIT), Blender (GPL) and BeepBox (MIT) are used under their own licences; see NOTICE.md. Not affiliated with or endorsed by those projects.')]),
    );
  }

  function toolRows(st) {
    const rows = [];
    const row = (label, who, t, installKey) => {
      const log = st.installs[installKey];
      return h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' } },
        h('div', null, h('b', null, label), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, who + ' · ' + (t.found ? (t.version || 'installed') : 'not installed'))),
        t.found ? h('span', { class: 'chip ok' }, icon('check', 12), 'ready')
          : st.hosted ? h('span', { class: 'chip warn' }, 'not in this server image')
          : installKey ? h('button', { class: 'btn small primary', disabled: log && log.state === 'running', onclick: () => startInstall(installKey) }, log && log.state === 'running' ? 'Installing…' : 'Install ' + label) : h('span', { class: 'muted', style: { fontSize: '12px' } }, 'optional'));
    };
    rows.push(row('Godot', 'Forge builds games with it', st.tools.godot, 'godot'));
    rows.push(row('Blender', 'Molder models with it', st.tools.blender, 'blender'));
    rows.push(row('ffmpeg', 'Noteie exports Ogg with it', st.tools.ffmpeg, null));
    rows.push(h('p', { class: 'faint', style: { fontSize: '12px', margin: '8px 0 0' } }, 'Install downloads the official build from godotengine.org or blender.org and verifies its checksum. Palette (Sprite) and Noteie (Box) are built in and need nothing.'));
    const running = Object.entries(st.installs).filter(([, v]) => v.state === 'running' || v.state === 'failed');
    for (const [k, v] of running) rows.push(h('pre', { class: 'mono muted', style: { fontSize: '11.5px', whiteSpace: 'pre-wrap', margin: '8px 0 0' } }, k + ': ' + v.log.slice(-4).join('\n')));
    return rows;
  }

  async function startInstall(tool) {
    try { await api('POST', '/api/install', { tool }); } catch (e) { toast(e.message, true); return; }
    const t = setInterval(async () => {
      S.status = await api('GET', '/api/status');
      draw();
      const i = S.status.installs[tool];
      if (!i || i.state !== 'running') { clearInterval(t); if (i && i.state === 'done') toast(tool + ' installed'); }
    }, 1500);
  }

  function section(title, kids) { return h('div', { class: 'sect' }, h('h4', null, title), kids); }
  load();
}
