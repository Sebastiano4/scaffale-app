import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const a = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const b = writeFixture('b.pdf', [['B book']], { title: 'Book B', author: 'X' });

async function cardMenu(page, title, action) {
  await page.locator('.book-card', { hasText: title }).locator('.book-card__menu-btn').click();
  await page.click(`#card-menu [data-action="${action}"]`);
}

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await addBook(page, a);
  await addBook(page, b);
});

test('Read chip is visible even with no read books', async ({ page }) => {
  await expect(page.locator('#sidebar-shelves .chip, #status-chips .chip').filter({ hasText: /^\s*Read/ }).first()).toBeVisible();
  await expect(page.locator('#read-shelf')).toBeHidden();
});

test('mark as read moves the book to the Read shelf, persists, and can be undone', async ({ page }) => {
  await expect(page.locator('.book-card', { hasText: 'Book B' }).locator('.book-card__menu-btn')).toBeVisible();
  await page.locator('.book-card', { hasText: 'Book B' }).locator('.book-card__menu-btn').click();
  await expect(page.locator('#card-menu [data-action="toggle-read"]')).toHaveText('Mark as read');
  await page.click('#card-menu [data-action="toggle-read"]');

  await expect(page.locator('#read-shelf')).toBeVisible();
  await expect(page.locator('#read-shelf .read-shelf__toggle')).toContainText('Read · 1');
  await expect(page.locator('#read-shelf .book-card', { hasText: 'Book B' })).toBeVisible();
  await expect(page.locator('#read-shelf .book-finished')).toContainText('Finished');
  await expect(page.locator('#book-grid .book-card', { hasText: 'Book B' })).toHaveCount(0);

  await page.click('#toast .toast__action');
  await expect(page.locator('#read-shelf')).toBeHidden();
  await expect(page.locator('#book-grid .book-card', { hasText: 'Book B' })).toHaveCount(1);

  await cardMenu(page, 'Book B', 'toggle-read');
  await page.reload();
  await expect(page.locator('#read-shelf .book-card', { hasText: 'Book B' })).toBeVisible();
});

test('mark as unread moves the book back', async ({ page }) => {
  await cardMenu(page, 'Book B', 'toggle-read');
  await page.locator('#read-shelf .book-card', { hasText: 'Book B' }).locator('.book-card__menu-btn').click();
  await expect(page.locator('#card-menu [data-action="toggle-read"]')).toHaveText('Mark as unread');
  await page.click('#card-menu [data-action="toggle-read"]');
  await expect(page.locator('#read-shelf')).toBeHidden();
  await expect(page.locator('#book-grid .book-card', { hasText: 'Book B' })).toHaveCount(1);
});

test('the shelf collapses and stays collapsed after reload', async ({ page }) => {
  await cardMenu(page, 'Book B', 'toggle-read');
  await page.click('#read-shelf .read-shelf__toggle');
  await expect(page.locator('#read-shelf .read-shelf__grid')).toBeHidden();
  await page.reload();
  await expect(page.locator('#read-shelf .read-shelf__toggle')).toContainText('Read · 1');
  await expect(page.locator('#read-shelf .read-shelf__grid')).toBeHidden();
  await page.click('#read-shelf .read-shelf__toggle');
  await expect(page.locator('#read-shelf .read-shelf__grid')).toBeVisible();
});

test('Read filter shows only the shelf; To read hides it; search filters shelf cards', async ({ page }) => {
  await cardMenu(page, 'Book B', 'toggle-read');
  await page.locator('#sidebar-shelves .chip, #status-chips .chip').filter({ hasText: /^\s*Read/ }).first().click();
  await expect(page.locator('#book-grid')).toBeHidden();
  await expect(page.locator('#read-shelf .book-card')).toHaveCount(1);

  await page.locator('#sidebar-shelves .chip, #status-chips .chip').filter({ hasText: 'To read' }).first().click();
  await expect(page.locator('#read-shelf')).toBeHidden();

  await page.locator('#sidebar-shelves .chip, #status-chips .chip').filter({ hasText: 'All' }).first().click();
  await page.evaluate(() => { const i = document.querySelector('#library-search-input'); i.value = 'Fixture'; i.dispatchEvent(new Event('input')); });
  await expect(page.locator('#read-shelf')).toBeHidden();
  await expect(page.locator('#book-grid .book-card')).toHaveCount(1);
});

test('select mode can delete a shelf book', async ({ page }) => {
  await cardMenu(page, 'Book B', 'toggle-read');
  await page.locator('#select-mode-btn:visible, #sidebar-select-btn:visible').first().click();
  await page.locator('#read-shelf .book-card .book-cover').first().click();
  await expect(page.locator('#selection-count')).toHaveText('1 selected');
  await page.click('#selection-delete');
  await expect(page.locator('.book-card', { hasText: 'Book B' })).toHaveCount(0);
});
