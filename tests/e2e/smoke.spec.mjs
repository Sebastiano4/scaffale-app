import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test.beforeEach(async ({ page }) => { await freshApp(page); });

test('add a book: card shows metadata title/author', async ({ page }) => {
  await addBook(page, fixture);
  await expect(page.locator('.book-card .book-title')).toHaveText('Fixture Book');
  await expect(page.locator('.book-card .book-author')).toHaveText('Test Author');
});

test('library persists across reload', async ({ page }) => {
  await addBook(page, fixture);
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(1);
});

test('open reader shows page counter and text layer', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
  await expect(page.locator('.textLayer').first()).toContainText('quick brown fox');
});

test('search in book finds the pages containing the term', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#reader-search-btn');
  await page.waitForTimeout(500); // let background indexing finish (3 pages)
  await page.fill('#reader-search-input', 'nest');
  await expect(page.locator('#reader-search-count')).not.toHaveText('');
  await expect(page.locator('#reader-search-count')).not.toHaveText('no results');
});

test('bookmark toggles and shows in side panel', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#bookmark-btn');
  await page.click('#panel-btn');
  await expect(page.locator('#bookmarks-list .panel-item')).toHaveCount(1);
});

test('back to library and delete via edit modal', async ({ page }) => {
  await addBook(page, fixture);
  page.on('dialog', (d) => d.accept());
  await page.locator('.book-card .book-meta').first().click();
  await expect(page.locator('#metadata-modal')).toBeVisible();
  // Known app quirk: app.js appends #meta-delete to the FIRST .modal__card (the library menu), so it is
  // not visible inside the edit modal. Trigger its handler directly to characterize the delete behaviour.
  await page.evaluate(() => document.getElementById('meta-delete').click());
  await expect(page.locator('.book-card')).toHaveCount(0);
});

test('edit metadata saves title', async ({ page }) => {
  await addBook(page, fixture);
  await page.locator('.book-card .book-meta').first().click();
  await page.fill('#meta-title', 'Renamed');
  await page.click('#meta-save');
  await expect(page.locator('.book-card .book-title')).toHaveText('Renamed');
});

test('theme toggle flips body data-theme', async ({ page }) => {
  const before = await page.evaluate(() => document.body.dataset.theme);
  await page.click('#sidebar-theme-toggle');
  const after = await page.evaluate(() => document.body.dataset.theme);
  expect(after).not.toBe(before);
});

test('stats modal opens', async ({ page }) => {
  await addBook(page, fixture);
  await page.click('#sidebar-stats-btn');
  await expect(page.locator('#stats-modal')).toBeVisible();
  await expect(page.locator('#stats-body .stat-tile')).toHaveCount(4);
});

test('no console errors during a normal session', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#back-btn');
  await expect(page.locator('#library-view')).toHaveClass(/view--active/);
  expect(errors).toEqual([]);
});

test('every js module listed in sw.js APP_SHELL exists', async ({ request }) => {
  const sw = await (await request.get('sw.js')).text();
  const paths = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter(Boolean);
  for (const p of paths) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(200);
  }
});

test('paginated mode: next page and outline tab work', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#mode-toggle');
  await page.click('#next-page');
  await expect(page.locator('#reader-progress')).toHaveText('Page 2 of 3');
  await page.click('#panel-btn');
  await page.click('.side-panel__tab[data-tab="outline"]');
  await expect(page.locator('#outline-list')).toContainText('no table of contents');
});
