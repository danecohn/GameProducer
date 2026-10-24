'use strict';

/** kind: auth | quota | rate_limit | overloaded | server | invalid_request | too_large | network | aborted | no_key */
class LLMError extends Error {
  constructor(kind, message, extra) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    Object.assign(this, extra || {});
  }
  get retryable() { return this.kind === 'rate_limit' || this.kind === 'overloaded' || this.kind === 'server' || this.kind === 'network'; }
}

function kindFromStatus(status, code) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || code === 'insufficient_quota' || code === 'billing_not_active') return 'quota';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limit';
  if (status === 529 || status === 503) return 'overloaded';
  if (status >= 500) return 'server';
  return 'invalid_request';
}

/** Human text for the Producer; never includes the key. */
function explain(e) {
  switch (e && e.kind) {
    case 'no_key': return 'No API key is set. Open Settings and add your OpenAI or Anthropic key.';
    case 'auth': return 'The provider rejected the API key. Check it in Settings.';
    case 'quota': return 'The provider says this account is out of credit or over its quota.';
    case 'rate_limit': return 'The provider is rate limiting this key. The team will retry; if it keeps happening, slow down or raise your limits.';
    case 'overloaded': return 'The provider is overloaded right now.';
    case 'too_large': return 'The conversation got too large for the model. Start a new session with the Director or trim the project bible.';
    case 'network': return 'Could not reach the provider (network error).';
    case 'aborted': return 'Stopped.';
    default: return (e && e.message) || 'Unknown model error';
  }
}

module.exports = { LLMError, kindFromStatus, explain };
