// One shared state object and a tiny pub/sub, so views can redraw only the parts that changed.
import { createTimeline } from './timeline.js';

export const S = {
  status: null,           // /api/status
  projectId: null,
  project: null,
  tl: createTimeline(),
  statuses: {},
  milestones: [],
  usage: null,
  limit: 0,
  inv: null,
  bible: [],
  channel: 'director',
  tab: 'assets',
  pane: 'chat',
  open: new Set(),        // expanded contract cards
  running: { director: false, sking: false },
  live: 'live',
  game: null,
};

const subs = new Map();
export function on(topic, fn) { (subs.get(topic) || subs.set(topic, new Set()).get(topic)).add(fn); return () => subs.get(topic).delete(fn); }
let queued = new Set(), scheduled = false;
export function schedule(...topics) {
  topics.forEach((t) => queued.add(t));
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const run = [...queued]; queued = new Set();
    for (const t of run) for (const fn of subs.get(t) || []) { try { fn(); } catch (e) { console.error('render ' + t, e); } }
  });
}
export function resetSubs() { subs.clear(); queued = new Set(); }
