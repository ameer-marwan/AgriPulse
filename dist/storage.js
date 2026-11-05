/** Account workspaces live on the server. Guest work lasts only in this tab. */
const guestKey = 'fieldshift.guest.workspace.v1';
const entries = new Map();
let session = { user: null, guest: true, googleConfigured: false };
let revision = 0, version = 0, timer, saving = false, conflict = false, loadFailed = false;
let status = { state: 'loading', message: 'Connecting to your workspace…', updatedAt: null };
const allowed = key => typeof key === 'string' && key.startsWith('fieldshift.') && !key.startsWith('fieldshift.auth') && !key.startsWith('fieldshift.guest');
const notify = () => window.dispatchEvent(new CustomEvent('fieldshift:storage', { detail: { ...status, user: session.user, guest: !session.user } }));
function setStatus(state, message, updatedAt = status.updatedAt) { status = { state, message, updatedAt }; notify(); }
function guestSave() { try { sessionStorage.setItem(guestKey, JSON.stringify(Object.fromEntries(entries))); } catch { setStatus('error', 'This tab cannot hold more guest data. Download a backup before closing it.'); } }
async function api(path, options = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...options, signal: controller.signal, headers: { 'content-type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) { const error = new Error(body.error || 'Could not connect to your account.'); error.status = response.status; throw error; }
    return body;
  } finally { clearTimeout(timeout); }
}
async function flush() {
  if (!session.user || conflict || loadFailed || saving) return;
  saving = true;
  const sentVersion = version;
  setStatus('saving', 'Saving to your account…');
  try {
    const result = await api('/api/workspace', { method: 'PUT', body: JSON.stringify({ data: Object.fromEntries(entries), revision }) });
    revision = result.revision;
    setStatus('saved', 'Saved to your account', result.updatedAt || new Date().toISOString());
  } catch (error) {
    if (error.status === 409) { conflict = true; setStatus('conflict', 'Another tab or device changed this workspace. Download your work, then reload to get the latest version.'); }
    else if (error.status === 401) { loadFailed = true; setStatus('expired', 'Your session expired. Download a backup and sign in again.'); }
    else setStatus('offline', 'Changes have not reached your account. Keep this tab open and retry when connected.');
  } finally { saving = false; if (version !== sentVersion && !conflict && !loadFailed && status.state === 'saved') schedule(); }
}
function schedule() { clearTimeout(timer); timer = setTimeout(flush, 700); }
function changed() {
  version += 1;
  if (session.user) { if (!conflict && !loadFailed) { setStatus('pending', 'Changes waiting to save…'); schedule(); } }
  else { guestSave(); if (status.state !== 'error') setStatus('guest', 'Guest workspace · available in this tab only'); }
}
function importEntries(data) { for (const [key, value] of Object.entries(data || {})) if (allowed(key) && typeof value === 'string') entries.set(key, value); }
export const workspaceStorage = {
  getItem(key) { return entries.has(key) ? entries.get(key) : null; },
  setItem(key, value) { if (!allowed(key)) return; const string = String(value); if (entries.get(key) === string) return; entries.set(key, string); changed(); },
  removeItem(key) { if (entries.delete(key)) changed(); },
  key(index) { return [...entries.keys()][index] ?? null; },
  get length() { return entries.size; },
  get session() { return session; },
  get status() { return { ...status }; },
  snapshot() { return Object.fromEntries(entries); },
  retry() { if (loadFailed || conflict) return; return flush(); },
  async importData(data) { if (!session.user || conflict || loadFailed) throw new Error('An active connected account is required to import.'); importEntries(data); changed(); clearTimeout(timer); while (saving) await new Promise(resolve => setTimeout(resolve, 50)); await flush(); if (status.state !== 'saved') throw new Error(status.message); },
  async clearGuest() { sessionStorage.removeItem(guestKey); },
  guestSnapshot() { try { return JSON.parse(sessionStorage.getItem(guestKey) || '{}'); } catch { return {}; } },
};
export const storageReady = (async () => {
  try {
    session = await api('/api/auth/session');
    if (session.user) {
      const workspace = await api('/api/workspace');
      importEntries(workspace.data); revision = Number(workspace.revision) || 0;
      setStatus('saved', 'Saved to your account', workspace.updatedAt || null);
    } else {
      if (!session.guest) session = { ...session, ...await api('/api/auth/guest', { method: 'POST', body: '{}' }) };
      importEntries(workspaceStorage.guestSnapshot()); setStatus('guest', 'Guest workspace · available in this tab only');
    }
  } catch (error) {
    if (session.user) { loadFailed = true; setStatus('error', 'Your saved workspace could not be loaded. Reload before editing to protect your account data.'); }
    else { importEntries(workspaceStorage.guestSnapshot()); setStatus('offline', 'Account connection unavailable. Guest work is available in this tab only.'); }
  }
})();
window.__fieldshiftStorage = workspaceStorage;
window.addEventListener('online', () => { if (status.state === 'offline' && session.user) flush(); });
window.addEventListener('beforeunload', event => { if (session.user && ['pending', 'saving', 'offline', 'conflict', 'expired'].includes(status.state)) { event.preventDefault(); event.returnValue = ''; } });
