'use strict';
// Per-project event log: every message, tool call, contract and decision is an event. Persisted as JSONL and streamed over SSE.
const fs = require('fs');
const path = require('path');

class EventLog {
  constructor(file, memory) {
    this.file = file;
    this.memory = memory || 1500;
    this.events = [];
    this.seq = 0;
    this.subs = new Set();
    this._load();
  }

  _load() {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      for (const l of lines.slice(-this.memory)) { try { this.events.push(JSON.parse(l)); } catch (e) { /* torn last line */ } }
      this.seq = this.events.length ? this.events[this.events.length - 1].seq : 0;
    } catch (e) { /* new project */ }
  }

  emit(evt) {
    const e = { seq: ++this.seq, ts: Date.now(), ...evt };
    this.events.push(e);
    if (this.events.length > this.memory * 1.2) this.events.splice(0, this.events.length - this.memory);
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); } catch (err) { /* disk full etc.: keep running */ }
    for (const fn of this.subs) { try { fn(e); } catch (err) { this.subs.delete(fn); } }
    return e;
  }

  since(seq) { return this.events.filter((e) => e.seq > (seq || 0)); }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
}

module.exports = { EventLog };
