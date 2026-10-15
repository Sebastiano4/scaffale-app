import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test('search lists every occurrence with page and context; tap jumps', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#reader-search-btn');
  await expect(page.locator('#search-progress')).toBeHidden({ timeout: 5000 });
  await page.fill('#reader-search-input', 'nest');
  await expect(page.locator('#search-results .search-result')).toHaveCount(4);
  await expect(page.locator('#reader-search-count')).toHaveText('1/4');
  await expect(page.locator('#search-results .search-result').first()).toContainText('p. 2');
  await expect(page.locator('#search-results mark').first()).toHaveText('nest');
  await page.locator('#search-results .search-result').nth(3).click();
  await expect(page.locator('#reader-progress')).toHaveText('Page 3 of 3', { timeout: 3000 });
  await page.click('#reader-search-next');
  await expect(page.locator('#reader-search-count')).toHaveText('1/4'); // wraps around from 4
});

test('no results message', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#reader-search-btn');
  await page.fill('#reader-search-input', 'zebra');
  await expect(page.locator('#reader-search-count')).toHaveText('no results');
  await expect(page.locator('#search-results .search-result')).toHaveCount(0);
});
