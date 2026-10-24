'use strict';
const { LLMError, kindFromStatus } = require('./errors');
const { sleep, isAbort } = require('../util');

function withTimeout(signal, ms) {
  const t = AbortSignal.timeout(ms);
  if (!signal) return t;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, t]) : signal;
}

/** One JSON request. Throws LLMError. `fetchImpl` is injectable for tests. */
async function requestJson(fetchImpl, url, { method = 'POST', headers, body, signal, timeoutMs = 600000, errorParser }) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: withTimeout(signal, timeoutMs) });
  } catch (e) {
    if (isAbort(e) || (signal && signal.aborted)) throw new LLMError('aborted', 'stopped');
    if (e && e.name === 'TimeoutError') throw new LLMError('network', 'the provider did not answer in time');
    throw new LLMError('network', 'network error: ' + ((e && e.cause && e.cause.code) || (e && e.message) || e));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error page */ }
  if (!res.ok) {
    const parsed = (errorParser && errorParser(json)) || {};
    const message = parsed.message || (json && json.error && json.error.message) || ('HTTP ' + res.status);
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new LLMError(kindFromStatus(res.status, parsed.code), message, { status: res.status, retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined });
  }
  if (json === null) throw new LLMError('server', 'the provider returned an empty or non-JSON response');
  return json;
}

/** Retry transient failures with exponential backoff, honouring retry-after. */
async function withRetry(fn, { retries = 4, baseMs = 1500, signal, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof LLMError) || !e.retryable || attempt >= retries) throw e;
      const wait = Math.min(60000, e.retryAfter ? e.retryAfter * 1000 : baseMs * 2 ** attempt) + Math.floor(Math.random() * 250);
      if (onRetry) onRetry(e, attempt + 1, wait);
      await sleep(wait, signal).catch(() => { throw new LLMError('aborted', 'stopped'); });
    }
  }
}

module.exports = { requestJson, withRetry };
