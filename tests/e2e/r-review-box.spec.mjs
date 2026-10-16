// The review box in the book editor grows with its text, and the editor scrolls on short screens.
import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const LONG = Array.from({ length: 8 }, (_, i) => 'Riga ' + (i + 1) + ' della recensione, abbastanza lunga da andare a capo almeno una volta nella casella.').join('\n');

test.use({ viewport: { width: 800, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
});

const box = (page) => page.locator('#meta-review').evaluate((t) => ({ client: t.clientHeight, scroll: t.scrollHeight, line: parseFloat(getComputedStyle(t).lineHeight) }));

test('an existing long review is shown whole when the editor opens', async ({ page }) => {
  await page.locator('.book-card .book-meta').first().click();
  await page.fill('#meta-review', LONG);
  await page.click('#meta-save');
  await page.locator('.book-card .book-meta').first().click();
  const b = await box(page);
  expect(b.scroll - b.client).toBeLessThanOrEqual(2); // no hidden text inside the box
});

test('the box starts at about 4 lines and grows while typing', async ({ page }) => {
  await page.locator('.book-card .book-meta').first().click();
  const empty = await box(page);
  expect(empty.client).toBeGreaterThanOrEqual(empty.line * 4);
  await page.locator('#meta-review').pressSequentially('uno\ndue\ntre\nquattro\ncinque\nsei\nsette\n');
  const grown = await box(page);
  expect(grown.client).toBeGreaterThan(empty.client);
  expect(grown.scroll - grown.client).toBeLessThanOrEqual(2);
});

test('very long reviews stop growing at about half the screen and scroll inside', async ({ page }) => {
  await page.locator('.book-card .book-meta').first().click();
  await page.fill('#meta-review', LONG + '\n' + LONG + '\n' + LONG);
  const b = await box(page);
  expect(b.client).toBeLessThanOrEqual(1000 * 0.5 + 2);
  expect(b.scroll).toBeGreaterThan(b.client);
});

test('on a short screen the editor scrolls so Save stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 560 });
  await page.locator('.book-card .book-meta').first().click();
  await page.fill('#meta-review', LONG);
  await page.locator('#meta-save').scrollIntoViewIfNeeded();
  await expect(page.locator('#meta-save')).toBeInViewport();
  await page.click('#meta-save');
  await expect(page.locator('#metadata-modal')).toBeHidden();
});
