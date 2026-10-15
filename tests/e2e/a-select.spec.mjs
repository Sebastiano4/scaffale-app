import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const a = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const b = writeFixture('b.pdf', [['B book']], { title: 'Book B', author: 'X' });
const c = writeFixture('c.pdf', [['C book']], { title: 'Book C', author: 'Y' });

test('select two books and delete them with undo', async ({ page }) => {
  await freshApp(page);
  for (const f of [a, b, c]) await addBook(page, f);
  await page.locator('#select-mode-btn:visible, #sidebar-select-btn:visible').first().click();
  await page.locator('.book-card').nth(0).locator('.book-cover').click();
  await page.locator('.book-card').nth(1).locator('.book-cover').click();
  await expect(page.locator('#selection-count')).toHaveText('2 selected');
  await expect(page.locator('#reader-view')).not.toHaveClass(/view--active/); // taps select, not open
  await page.click('#selection-delete');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('2 books deleted');
  await page.click('#toast .toast__action');
  await expect(page.locator('.book-card')).toHaveCount(3);
});

test('cancel exits select mode', async ({ page }) => {
  await freshApp(page);
  await addBook(page, a);
  await page.locator('#select-mode-btn:visible, #sidebar-select-btn:visible').first().click();
  await page.click('#selection-cancel');
  await expect(page.locator('#selection-bar')).toBeHidden();
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
});

test('selection is dropped for books hidden by a search', async ({ page }) => {
  await freshApp(page);
  for (const f of [a, b]) await addBook(page, f);
  await page.locator('#select-mode-btn:visible, #sidebar-select-btn:visible').first().click();
  await page.locator('.book-card').nth(0).locator('.book-cover').click();
  await page.locator('.book-card').nth(1).locator('.book-cover').click();
  await expect(page.locator('#selection-count')).toHaveText('2 selected');
  await page.fill('#library-search-input', 'Fixture');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('#selection-count')).toHaveText('1 selected');
});
