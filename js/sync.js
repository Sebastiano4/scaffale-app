/* Sync engine: keeps this device and Google Drive's appDataFolder in step.
   library.json holds every book's data (no PDF bytes); book-<hash>.pdf holds each PDF once.
   See docs/superpowers/specs/2026-10-17-booknest-drive-sync-design.md */
import { state } from './state.js';
import { DB } from './db.js';
import { Stats, Goal } from './stats.js';
import { hashBlob } from './hash.js';
import { mergeLibrary, mergeBook } from './sync-merge.js';
import { loadSyncState, saveSyncState } from './sync-state.js';
import { syncConfigured, preloadAuth, currentToken, requestToken, dropToken, signOut } from './drive-auth.js';
import { listFiles, downloadJson, downloadBlob, createFile, updateFile, deleteFile, DriveError } from './drive-api.js';

const LIBRARY_FILE = 'library.json';
const pdfName = (hash) => 'book-' + hash + '.pdf';
const PUSH_DELAY_MS = 10_000;     // after a change, wait for more before pushing
const REFRESH_AFTER_MS = 60_000;  // coming back to the app pulls again after this long

/* ---- status: 'off' | 'needs-auth' | 'syncing' | 'ok' | 'offline' | 'error' ---- */
let status = 'off';
let lastError = '';
const listeners = new Set();
function setStatus(s, err = '') {
  status = s;
  lastError = err;
  listeners.forEach((fn) => fn(s, err));
}
export const syncStatus = () => ({ status, error: lastError, lastSync: loadSyncState().lastSync || 0 });
export function onSyncStatus(fn) { listeners.add(fn); fn(status, lastError); return () => listeners.delete(fn); }

/* Called after sync changed local books (library view refresh). */
let onLocalChange = () => {};
export function setOnLocalChange(fn) { onLocalChange = fn; }

/* ---- running ---- */
let running = null;
let again = false;
let pushTimer = null;

/* interactive: called from a tap — may open Google's sign-in (must not await before it). */
export function syncNow({ interactive = false } = {}) {
  if (!syncConfigured()) return Promise.resolve();
  let token = currentToken();
  if (!token) {
    if (!interactive) {
      if (loadSyncState().connected) setStatus('needs-auth');
      return Promise.resolve();
    }
    return requestToken()
      .then(() => { saveSyncState({ connected: true }); return syncNow(); })
      .catch((e) => { setStatus(loadSyncState().connected ? 'needs-auth' : 'off', e.message); });
  }
  if (!loadSyncState().connected) saveSyncState({ connected: true });
  if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(); }
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce(token);
        token = currentToken() || token;
      } while (again);
      setStatus('ok');
    } catch (e) {
      if (e instanceof DriveError && e.status === 401) { dropToken(); setStatus('needs-auth'); }
      else if (e instanceof DriveError && e.status === 0) setStatus('offline', e.message);
      else { console.error(e); setStatus('error', e.message); }
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedulePush(delay = PUSH_DELAY_MS) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), delay);
}

/* Books added before hashes existed get one, so they can be matched across devices. */
async function backfillHashes() {
  if (!(globalThis.crypto && crypto.subtle)) return;
  for (const b of await DB.all()) {
    if (b.hash || !b.fileBlob) continue;
    try {
      const hash = await hashBlob(b.fileBlob);
      const fresh = await DB.get(b.id);
      if (fresh && !fresh.hash) { fresh.hash = hash; await DB.put(fresh); }
    } catch (e) { /* unreadable blob: stays local-only */ }
  }
}

async function runOnce(token) {
  setStatus('syncing');
  await backfillHashes();
  const files = await listFiles(token);
  const byName = new Map(files.map((f) => [f.name, f]));
  const libFile = byName.get(LIBRARY_FILE);
  const remote = libFile ? await downloadJson(token, libFile.id) : null;

  const st = loadSyncState();
  const local = { books: await DB.all(), deleted: st.deleted || {}, stats: Stats.load(), goal: Goal.raw() };
  const m = mergeLibrary(local, remote || {});

  // apply to this device (without stamping: these are not new edits)
  let localChanged = false;
  for (const b of m.create) {
    await DB.putRaw({ ...b, fileBlob: null, remoteOnly: true });
    localChanged = true;
  }
  for (const b of m.update) {
    const cur = await DB.get(b.id);
    const merged = cur ? mergeBook(cur, b) : b; // an edit saved meanwhile is not lost
    await DB.putRaw(merged);
    if (state.reader.book && state.reader.book.id === b.id) {
      const { fileBlob, ...data } = merged; // the open book sees the other device's changes
      Object.assign(state.reader.book, data);
    }
    localChanged = true;
  }
  for (const b of m.remove) {
    if (state.reader.book && state.reader.book.id === b.id) continue; // never pull the book being read
    await DB.delete(b.id, { raw: true });
    localChanged = true;
  }
  saveSyncState({ deleted: m.deleted });
  Stats.saveRaw(m.stats);
  if (m.goal) Goal.saveRaw(m.goal);
  if (localChanged) onLocalChange();

  // push the merged library
  if (m.remoteChanged || !libFile) {
    m.remote.updatedAt = Date.now();
    const blob = new Blob([JSON.stringify(m.remote)], { type: 'application/json' });
    if (libFile) await updateFile(token, libFile.id, blob);
    else await createFile(token, LIBRARY_FILE, blob);
  }

  // PDFs: upload the ones Drive lacks, remove the deleted ones, download the ones this device lacks
  const books = await DB.all();
  for (const b of books) {
    if (b.hash && b.fileBlob && !byName.has(pdfName(b.hash)) && m.remote.books[b.hash]) {
      const id = await createFile(token, pdfName(b.hash), new Blob([b.fileBlob], { type: 'application/pdf' }));
      byName.set(pdfName(b.hash), { id, name: pdfName(b.hash) });
    }
  }
  for (const hash of Object.keys(m.deleted)) {
    const f = byName.get(pdfName(hash));
    if (f && !m.remote.books[hash]) await deleteFile(token, f.id);
  }
  saveSyncState({ lastSync: Date.now(), dirty: false });
  for (const b of books) {
    if (b.fileBlob || !b.hash) continue;
    const f = byName.get(pdfName(b.hash));
    if (!f) continue;
    const blob = await downloadBlob(token, f.id);
    const cur = await DB.get(b.id);
    if (!cur) continue;
    cur.fileBlob = blob;
    delete cur.remoteOnly;
    await DB.putRaw(cur);
    onLocalChange();
  }
}

/* ---- connect / disconnect ---- */
export function disconnect() {
  signOut();
  saveSyncState({ connected: false, deleted: {}, lastSync: 0, dirty: false });
  setStatus('off');
}

export function initSync() {
  if (!syncConfigured()) return;
  preloadAuth();
  const st = loadSyncState();
  if (st.connected) setStatus(currentToken() ? 'ok' : 'needs-auth');

  window.addEventListener('booknest:changed', () => {
    if (!loadSyncState().connected) return;
    saveSyncState({ dirty: true });
    schedulePush();
  });
  window.addEventListener('booknest:sync-soon', () => { if (loadSyncState().dirty) schedulePush(0); });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => { if (loadSyncState().connected) setStatus('offline'); });
  document.addEventListener('visibilitychange', () => {
    const s = loadSyncState();
    if (!s.connected) return;
    if (document.visibilityState === 'hidden') { if (s.dirty) syncNow(); }
    else if (Date.now() - (s.lastSync || 0) > REFRESH_AFTER_MS) syncNow();
  });
  if (st.connected) syncNow();
}
