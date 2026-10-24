'use strict';
// Access control. Local mode: loopback only, a per-start session cookie, Host/Origin checks (no DNS rebinding, no CSRF).
// Hosted mode: everything additionally needs the access token (GP_ACCESS_TOKEN), exchanged for a session cookie.
const crypto = require('crypto');

const COOKIE = 'gp_session';

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

class Auth {
  constructor({ hosted, accessToken, port }) {
    this.hosted = hosted;
    this.accessToken = accessToken || '';
    this.port = port;
    this.sessions = new Map();           // id -> expiry ms
    this.localSession = crypto.randomBytes(24).toString('hex');
    this.attempts = new Map();           // ip -> [timestamps]
    this.allowedHosts = new Set(String(process.env.GP_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  }

  hostOk(req) {
    const host = String(req.headers.host || '').toLowerCase();
    if (this.hosted) return !this.allowedHosts.size || this.allowedHosts.has(host) || this.allowedHosts.has(host.replace(/:\d+$/, ''));
    const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(name);
  }

  originOk(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch (e) { return false; }
  }

  authed(req) {
    const c = parseCookies(req.headers.cookie)[COOKIE];
    if (!c) return false;
    if (!this.hosted) return safeEqual(c, this.localSession);
    const exp = this.sessions.get(c);
    if (!exp) return false;
    if (exp < Date.now()) { this.sessions.delete(c); return false; }
    return true;
  }

  cookie(req, value, maxAgeSec) {
    const secure = this.hosted && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSec + (secure ? '; Secure' : '');
  }

  /** Local mode hands out the session cookie with the first page load. Hosted mode needs login. */
  issueLocal(req) { return this.cookie(req, this.localSession, 60 * 60 * 24 * 30); }

  login(req, password) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now();
    const recent = (this.attempts.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= 6) return { ok: false, status: 429, error: 'too many attempts; wait a minute' };
    recent.push(now); this.attempts.set(ip, recent);
    if (!this.accessToken || !safeEqual(password || '', this.accessToken)) return { ok: false, status: 401, error: 'wrong access token' };
    const id = crypto.randomBytes(24).toString('hex');
    this.sessions.set(id, now + 1000 * 60 * 60 * 24 * 14);
    return { ok: true, cookie: this.cookie(req, id, 60 * 60 * 24 * 14) };
  }
}

module.exports = { Auth, COOKIE, safeEqual, parseCookies };
