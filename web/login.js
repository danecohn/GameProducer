const webBase=document.querySelector('meta[name="vigil-base"]')?.content||'';
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = document.getElementById('e');
  err.hidden = true;
  try {
    const res = await fetch(webBase+'/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: document.getElementById('t').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'sign in failed');
    location.href = webBase+'/';
  } catch (e) { err.textContent = e.message; err.hidden = false; }
});
