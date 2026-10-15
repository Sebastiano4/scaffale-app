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
