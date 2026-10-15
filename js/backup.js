import { $, showToast } from './dom.js';
import { DB } from './db.js';
import { Stats } from './stats.js';
import { loadLibrary } from './library.js';

/* ---- backup: export / import the whole library as JSON ---- */
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'application/pdf' });
}

export function initBackup() {
  $('#menu-export').addEventListener('click', async () => {
    $('#library-menu').hidden = true;
    const books = await DB.all();
    if (books.length === 0) { showToast('The library is empty, nothing to export'); return; }
    showToast('Preparing the backup… this may take a moment', 6000);
    try {
      const out = [];
      for (const b of books) {
        const { fileBlob, ...meta } = b;
        out.push({ ...meta, fileB64: fileBlob ? await blobToBase64(fileBlob) : '' });
      }
      const payload = JSON.stringify({ app: 'BookNest', version: 1, exportedAt: Date.now(), stats: Stats.load(), books: out });
      const blob = new Blob([payload], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      a.download = 'booknest-backup-' + d.toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast('Backup downloaded: ' + out.length + (out.length === 1 ? ' book' : ' books'));
    } catch (e) {
      console.error(e);
      showToast('Error during backup');
    }
  });

  $('#menu-import').addEventListener('click', () => {
    $('#library-menu').hidden = true;
    $('#import-input').click();
  });
  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    showToast('Importing the backup…', 6000);
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'BookNest' || !Array.isArray(data.books)) throw new Error('invalid format');
      let count = 0;
      for (const entry of data.books) {
        const { fileB64, ...meta } = entry;
        if (!fileB64) continue;
        await DB.put({ ...meta, fileBlob: base64ToBlob(fileB64) });
        count++;
      }
      if (data.stats && data.stats.days) {
        // merge stats, keeping the larger value per day
        const cur = Stats.load();
        for (const [k, v] of Object.entries(data.stats.days)) {
          const c = cur.days[k] || { pages: 0, seconds: 0 };
          cur.days[k] = { pages: Math.max(c.pages, v.pages || 0), seconds: Math.max(c.seconds, v.seconds || 0) };
        }
        Stats.save(cur);
      }
      await loadLibrary();
      showToast('Imported ' + count + (count === 1 ? ' book' : ' books'));
    } catch (err) {
      console.error(err);
      showToast('Invalid backup file');
    }
  });
}
