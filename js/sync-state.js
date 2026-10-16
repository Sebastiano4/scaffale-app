/* Device-side sync bookkeeping (localStorage): deleted books, account, last sync. */
const KEY = 'booknest-sync';

export function loadSyncState() {
  try { return { deleted: {}, ...JSON.parse(localStorage.getItem(KEY)) }; } catch (e) { return { deleted: {} }; }
}

export function saveSyncState(patch) {
  const s = { ...loadSyncState(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage full */ }
  return s;
}

export function clearSyncState() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

/* Something that syncs changed on this device: the sync engine schedules a push. */
export function notifyChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('booknest:changed'));
}
