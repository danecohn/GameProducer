// Server calls and the live event stream.
export async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (res.status === 401 && data && data.code === 'login') { location.href = '/login.html'; return new Promise(() => {}); }
  if (!res.ok) { const err = new Error((data && data.error) || res.statusText || 'request failed'); err.status = res.status; err.code = data && data.code; throw err; }
  return data;
}

export const fileUrl = (projectId, rel, extra) => '/api/projects/' + projectId + '/file?path=' + encodeURIComponent(rel) + (extra || '');

/** Server-sent events with automatic reconnect (the browser resends Last-Event-ID, the server replays what was missed). */
export function stream(projectId, since, onEvent, onState) {
  const es = new EventSource('/api/projects/' + projectId + '/events?since=' + since);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.error('bad event', e); } };
  es.onopen = () => onState && onState('live');
  es.onerror = () => onState && onState('reconnecting');
  return () => es.close();
}
