'use strict';
// The project bible: markdown docs under <project>/bible/, maintained by Sking (and editable by the Producer).
const fs = require('fs');
const path = require('path');
const { ToolError, clip } = require('../util');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}\.md$/;
const MAX_DOC = 200 * 1024;

const SKELETON = (name, pitch) => `# ${name}: Project Bible

> The single source of truth for the whole team. Sking keeps it current; every agent reads it before working.

## Pitch
${pitch || '_Not written yet._'}

## Pillars
_Three to five things this game must always be._

## Genre and platform
_Genre, camera, dimension (2D or 3D), target platform._

## Scope
_What is in the first playable and what is deliberately out._

## Art direction
_Palette, resolution, reference points, what Palette (2D) and Molder (3D) should match._

## Audio direction
_Mood, instruments, loop behaviour, which sound effects the game needs (Noteie)._

## Technical constraints
_Controls, performance budget, engine notes (Forge)._

## Status
_What exists, what is next._

## Decisions
_Dated decisions the Producer made. Newest last._
`;

class Bible {
  constructor(dir) { this.dir = dir; }

  init(name, pitch) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, 'BIBLE.md'))) fs.writeFileSync(path.join(this.dir, 'BIBLE.md'), SKELETON(name, pitch));
    if (!fs.existsSync(path.join(this.dir, 'CHANGELOG.md'))) fs.writeFileSync(path.join(this.dir, 'CHANGELOG.md'), '# Bible changelog\n\n');
  }

  file(name) {
    if (!NAME_RE.test(String(name || ''))) throw new ToolError('bible document names look like "STORY.md" (letters, digits, - and _, ending in .md); got "' + name + '"', 'bad_name');
    return path.join(this.dir, name);
  }

  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => NAME_RE.test(n)).sort((a, b) => (a === 'BIBLE.md' ? -1 : b === 'BIBLE.md' ? 1 : a.localeCompare(b))); } catch (e) { /* none */ }
    return names.map((n) => {
      const st = fs.statSync(path.join(this.dir, n));
      const first = (fs.readFileSync(path.join(this.dir, n), 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('>')) || '').trim().slice(0, 120);
      return { name: n, size: st.size, updated: st.mtime.toISOString(), summary: first };
    });
  }

  read(name) {
    const f = this.file(name);
    if (!fs.existsSync(f)) throw new ToolError('no bible document "' + name + '". Existing: ' + (this.list().map((d) => d.name).join(', ') || 'none'), 'not_found');
    return fs.readFileSync(f, 'utf8');
  }

  write(name, content, mode) {
    const f = this.file(name);
    content = String(content == null ? '' : content);
    if (mode === 'append') content = (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\s*$/, '\n\n') : '') + content;
    if (Buffer.byteLength(content) > MAX_DOC) throw new ToolError('document is larger than ' + MAX_DOC / 1024 + ' KB; split it into several documents', 'too_large');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, content.endsWith('\n') ? content : content + '\n');
    fs.renameSync(tmp, f);
    return { name, bytes: Buffer.byteLength(content) };
  }

  changelog(author, summary) {
    const f = path.join(this.dir, 'CHANGELOG.md');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    fs.appendFileSync(f, '- ' + stamp + ' UTC, ' + author + ': ' + String(summary).replace(/\s+/g, ' ').slice(0, 400) + '\n');
  }

  recentChanges(n) {
    try {
      return fs.readFileSync(path.join(this.dir, 'CHANGELOG.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).slice(-(n || 6));
    } catch (e) { return []; }
  }

  /** What every agent gets in its system prompt: the main bible (clipped), the other documents, recent changes. */
  digest() {
    const out = [];
    try { out.push(clip(this.read('BIBLE.md'), 9000)); } catch (e) { out.push('(no BIBLE.md yet)'); }
    const others = this.list().filter((d) => d.name !== 'BIBLE.md' && d.name !== 'CHANGELOG.md');
    if (others.length) out.push('Other bible documents (read with read_bible): ' + others.map((d) => d.name + (d.summary ? ' (' + d.summary + ')' : '')).join('; '));
    const rc = this.recentChanges(6);
    if (rc.length) out.push('Recent bible changes:\n' + rc.join('\n'));
    return out.join('\n\n');
  }
}

module.exports = { Bible, SKELETON };
