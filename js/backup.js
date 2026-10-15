import { $, showToast } from './dom.js';
import { DB } from './db.js';
import { Stats, Goal } from './stats.js';
import { loadLibrary, flushPendingDeletes } from './library.js';
import { createZip, readZip } from './zip.js';
import { buildManifest, bookFilePath, validateManifest, mergeStats } from './backup-format.js';

/* ---- backup: export / import the whole library as a .zip (legacy .json still imports) ---- */
function base64ToBlob(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'application/pdf' });
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportBackup() {
  const books = await DB.all();
  if (books.length === 0) { showToast('The library is empty, nothing to export'); return; }
  showToast('Preparing the backup… this may take a moment', 6000);
  try {
    // a stored blob can become unreadable (iOS "WebKitBlobResource" error): skip that book, export the rest
    const ok = [];
    let unreadable = 0;
    for (const b of books) {
      if (b.fileBlob) {
        try { await b.fileBlob.slice(0, 1).arrayBuffer(); } catch (e) { unreadable++; continue; }
      }
      ok.push(b);
    }
    if (ok.length === 0) { showToast("Backup failed: the books' files couldn't be read"); return; }
    const manifest = buildManifest(ok, Stats.load(), Goal.load());
    const entries = [{ name: 'library.json', data: JSON.stringify(manifest) }];
    for (const b of ok) if (b.fileBlob) entries.push({ name: bookFilePath(b.id), data: b.fileBlob });
    const zip = await createZip(entries);
    download(zip, 'booknest-backup-' + new Date().toISOString().slice(0, 10) + '.zip');
    showToast('Backup downloaded: ' + ok.length + (ok.length === 1 ? ' book' : ' books')
      + (unreadable ? ' (' + unreadable + " couldn't be read)" : ''), unreadable ? 5000 : 2200);
  } catch (e) {
    console.error(e);
    showToast(/too large/.test(e.message) ? 'Library too large for a single backup (4 GB max)' : 'Error during backup');
  }
}

async function importBackup(file) {
  await flushPendingDeletes();
  showToast('Importing the backup…', 6000);
  try {
    let count = 0;
    let stats = null;
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
    if (isZip) {
      const files = await readZip(file);
      const lib = files.get('library.json');
      if (!lib) throw new Error('invalid backup');
      const data = JSON.parse(await lib.text());
      validateManifest(data);
      for (const { file: path, ...meta } of data.books) {
        const pdf = files.get(path);
        if (!pdf) continue;
        await DB.put({ ...meta, fileBlob: new Blob([pdf], { type: 'application/pdf' }) });
        count++;
      }
      stats = data.stats;
      if (data.goal && !Goal.load()) Goal.save(data.goal);
    } else {
      const data = JSON.parse(await file.text());
      validateManifest(data);
      for (const { fileB64, ...meta } of data.books) {
        if (!fileB64) continue;
        await DB.put({ ...meta, fileBlob: base64ToBlob(fileB64) });
        count++;
      }
      stats = data.stats;
    }
    if (stats && stats.days) Stats.save(mergeStats(Stats.load(), stats));
    await loadLibrary();
    showToast('Imported ' + count + (count === 1 ? ' book' : ' books'));
  } catch (err) {
    console.error(err);
    showToast('Invalid backup file');
  }
}

export function initBackup() {
  $('#menu-export').addEventListener('click', () => {
    $('#library-menu').hidden = true;
    exportBackup();
  });

  $('#menu-import').addEventListener('click', () => {
    $('#library-menu').hidden = true;
    $('#import-input').click();
  });
  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await importBackup(file);
  });
}
