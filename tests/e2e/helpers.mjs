import { expect } from '@playwright/test';

// Opens the app with an empty IndexedDB + localStorage.
export async function freshApp(page) {
  await page.goto('index.html');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((res) => { const r = indexedDB.deleteDatabase('scaffale-db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  });
  await page.reload();
}

export async function addBook(page, filePath) {
  const before = await page.locator('.book-card').count();
  await page.setInputFiles('#file-input', filePath);
  await expect(page.locator('.book-card')).toHaveCount(before + 1);
}

export async function openFirstBook(page) {
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
  await expect(page.locator('#reader-loading')).toBeHidden();
  await expect(page.locator('.textLayer').first()).toBeVisible();
}

// Writes a raw record straight into IndexedDB (e.g. a legacy book saved before hashes existed).
// pdfB64: the PDF bytes as base64 → stored as fileBlob; pass null to keep record.fileBlob as given.
export async function putRawBook(page, record, pdfB64 = null) {
  await page.evaluate(async ({ record, pdfB64 }) => {
    if (pdfB64) {
      const bin = atob(pdfB64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      record.fileBlob = new Blob([arr], { type: 'application/pdf' });
    }
    const db = await new Promise((res, rej) => { const r = indexedDB.open('scaffale-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const t = db.transaction('books', 'readwrite'); t.objectStore('books').put(record); t.oncomplete = res; t.onerror = () => rej(t.error); });
    db.close();
  }, { record, pdfB64 });
}

export async function getRawBook(page, id) {
  return page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('scaffale-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec = await new Promise((res, rej) => { const r = db.transaction('books').objectStore('books').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    db.close();
    if (rec) rec.fileBlob = rec.fileBlob instanceof Blob ? 'blob:' + rec.fileBlob.size : typeof rec.fileBlob;
    return rec;
  }, id);
}
