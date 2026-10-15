/* ======================================================================
   DB — tiny promise wrapper around IndexedDB
   ====================================================================== */
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
    async put(book) {
      const store = await tx('books', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.put(book);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async delete(id) {
      const store = await tx('books', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
  };
})();
