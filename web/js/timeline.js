// Turns the server's event stream into what the Producer reads: one transcript per channel (Director, Sking),
// with each contract shown as a card that carries its own live work log. Pure functions: no DOM, testable in Node.

export function createTimeline() {
  return { director: [], sking: [], contracts: new Map(), decisions: new Map(), tools: new Map(), pending: new Set() };
}

const channelOf = (agent) => (agent === 'sking' ? 'sking' : 'director');

export function apply(tl, e) {
  switch (e.type) {
    case 'message': {
      if (e.role === 'producer') { tl[e.channel === 'sking' ? 'sking' : 'director'].push({ kind: 'producer', text: e.text, ts: e.ts, seq: e.seq }); break; }
      const c = e.contract && tl.contracts.get(e.contract);
      if (c) c.log.push({ kind: 'agent', text: e.text, ts: e.ts });
      else tl[channelOf(e.agent)].push({ kind: 'agent', agent: e.agent, text: e.text, ts: e.ts, seq: e.seq });
      break;
    }
    case 'tool': {
      const entry = { kind: 'tool', agent: e.agent, id: e.id, name: e.name, summary: e.summary, status: 'running', ts: e.ts, images: [] };
      tl.tools.set(e.id, entry);
      const c = e.contract && tl.contracts.get(e.contract);
      if (c) c.log.push(entry); else tl[channelOf(e.agent)].push(entry);
      break;
    }
    case 'tool_result': {
      const entry = tl.tools.get(e.id);
      if (!entry) break;
      entry.status = e.ok ? 'ok' : 'error'; entry.ms = e.ms; entry.error = e.error; entry.result = e.summary; entry.images = e.images || [];
      const c = e.contract && tl.contracts.get(e.contract);
      if (c && entry.images.length) c.images.push(...entry.images.map((im) => ({ ...im, tool: e.name })));
      break;
    }
    case 'contract': {
      const incoming = e.contract;
      let c = tl.contracts.get(incoming.id);
      if (!c) { c = { ...incoming, log: [], images: [] }; tl.contracts.set(c.id, c); tl.director.push({ kind: 'contract', id: c.id, ts: e.ts, seq: e.seq }); }
      else Object.assign(c, incoming);
      break;
    }
    case 'decision': {
      const d = e.decision;
      if (!tl.decisions.has(d.id)) { tl.decisions.set(d.id, { ...d }); tl[channelOf(d.agent)].push({ kind: 'decision', id: d.id, ts: e.ts, seq: e.seq }); }
      if (d.status === 'pending') tl.pending.add(d.id);
      break;
    }
    case 'decision_resolved': {
      const d = tl.decisions.get(e.id);
      if (d) { d.status = e.status; if (e.answer !== undefined) d.answer = e.answer; }
      tl.pending.delete(e.id);
      break;
    }
    case 'note': {
      const c = e.contract && tl.contracts.get(e.contract);
      if (c) c.log.push({ kind: 'note', text: e.text, ts: e.ts });
      else tl[channelOf(e.agent)].push({ kind: 'note', text: e.text, ts: e.ts, seq: e.seq });
      break;
    }
    case 'error': tl[channelOf(e.agent)].push({ kind: 'error', text: e.message, errorKind: e.kind, ts: e.ts, seq: e.seq }); break;
    case 'run':
      if (e.state === 'stopped') tl[e.channel === 'sking' ? 'sking' : 'director'].push({ kind: 'note', text: 'Stopped.', ts: e.ts, seq: e.seq });
      break;
    case 'chat_reset': tl[e.channel === 'sking' ? 'sking' : 'director'].length = 0; break;
    default: break;
  }
}

export function build(events) {
  const tl = createTimeline();
  for (const e of events) apply(tl, e);
  // anything still "running" in a replayed history belongs to a run that is over
  return tl;
}

export const durationLabel = (ms) => {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
};
