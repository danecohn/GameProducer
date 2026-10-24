'use strict';
// Minimal ZIP writer (deflate) so projects can be handed to the Producer as one file. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** files: [{name: 'dir/file.txt', data: Buffer, mtime?: Date, mode?: 0o755}] -> writes outFile. */
function writeZip(outFile, files) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const fd = fs.openSync(outFile, 'w');
  const central = [];
  let offset = 0;
  const write = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
  try {
    for (const f of files) {
      const name = Buffer.from(f.name.replace(/\\/g, '/'));
      const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
      const comp = raw.length > 64 ? zlib.deflateRawSync(raw) : null;
      const useDeflate = comp && comp.length < raw.length;
      const body = useDeflate ? comp : raw;
      const { time, date } = dosTime(f.mtime || new Date());
      const crc = crc32(raw);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDeflate ? 8 : 0, 8);
      h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22);
      h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
      const start = offset;
      write(h); write(name); write(body);
      central.push({ name, crc, size: raw.length, csize: body.length, method: useDeflate ? 8 : 0, time, date, offset: start, mode: f.mode || 0o644 });
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(0x031e, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.size, 24);
      h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(((0o100000 | c.mode) << 16) >>> 0, 38); h.writeUInt32LE(c.offset, 42);
      write(h); write(c.name);
    }
    const cdSize = offset - cdStart;
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length, 8); e.writeUInt16LE(central.length, 10); e.writeUInt32LE(cdSize, 12); e.writeUInt32LE(cdStart, 16);
    write(e);
  } finally { fs.closeSync(fd); }
  return { files: files.length, bytes: fs.statSync(outFile).size };
}

/** Zip a directory tree. `skip(relPath, isDir)` returns true to leave something out. */
function zipDir(dir, outFile, prefix, skip) {
  const files = [];
  (function rec(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (skip && skip(r, e.isDirectory())) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) rec(full, r);
      else if (e.isFile()) { const st = fs.statSync(full); files.push({ name: (prefix ? prefix + '/' : '') + r, data: fs.readFileSync(full), mtime: st.mtime, mode: st.mode & 0o777 }); }
    }
  })(dir, '');
  return writeZip(outFile, files);
}

module.exports = { writeZip, zipDir, crc32 };
