/* ======================================================================
   DB — tiny promise wrapper around IndexedDB
   ====================================================================== */
import { stampChanges } from './sync-merge.js';
import { loadSyncState, saveSyncState, notifyChanged } from './sync-state.js';

export const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('scaffale-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }
  return {
    async all() {
      const store = await tx('books', 'readonly');
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async get(id) {
      const store = await tx('books', 'readonly');
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    /* Saves a book and stamps what changed since the stored copy (for sync between devices). */
    async put(book) {
      const store = await tx('books', 'readwrite');
      let changed = false;
      await new Promise((res, rej) => {
        const g = store.get(book.id);
        g.onsuccess = () => {
          changed = stampChanges(g.result || null, book);
          const r = store.put(book);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        };
        g.onerror = () => rej(g.error);
      });
      if (changed) notifyChanged();
    },
    /* Saves exactly what it is given (sync applying data from another device). */
    async putRaw(book) {
      const store = await tx('books', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.put(book);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    /* Deletes a book; the deletion reaches the other devices (tombstone by content hash). */
    async delete(id, { raw = false } = {}) {
      const store = await tx('books', 'readwrite');
      let hash = null;
      await new Promise((res, rej) => {
        const g = store.get(id);
        g.onsuccess = () => {
          hash = g.result && g.result.hash;
          const r = store.delete(id);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        };
        g.onerror = () => rej(g.error);
      });
      if (hash && !raw) {
        const s = loadSyncState();
        saveSyncState({ deleted: { ...s.deleted, [hash]: Date.now() } });
        notifyChanged();
      }
    },
  };
})();
