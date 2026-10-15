import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

async function openMenu(page) {
  // desktop viewport may show the sidebar instead of the ⋮ menu; force the menu open
  await page.evaluate(() => { document.querySelector('#library-menu').hidden = false; });
}

test('export .zip then import restores the library', async ({ page }, testInfo) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openMenu(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#menu-export')]);
  expect(download.suggestedFilename()).toMatch(/^booknest-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const zipPath = testInfo.outputPath('backup.zip');
  await download.saveAs(zipPath);

  await freshApp(page);
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.setInputFiles('#import-input', zipPath);
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-card .book-title')).toHaveText('Fixture Book');
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
});

test('legacy .json backup still imports', async ({ page }, testInfo) => {
  await freshApp(page);
  const fs = await import('node:fs');
  const b64 = fs.readFileSync(fixture).toString('base64');
  const legacy = { app: 'BookNest', version: 1, exportedAt: 1, stats: { days: {} },
    books: [{ id: 'legacy1', title: 'Legacy', author: 'Old', numPages: 3, lastPage: 1, addedAt: 1, lastOpenedAt: 0, bookmarks: [], quotes: [], fileB64: b64 }] };
  const p = testInfo.outputPath('legacy.json');
  fs.writeFileSync(p, JSON.stringify(legacy));
  await page.setInputFiles('#import-input', p);
  await expect(page.locator('.book-card .book-title')).toHaveText('Legacy');
});
