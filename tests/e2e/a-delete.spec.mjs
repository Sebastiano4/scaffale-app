import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test.beforeEach(async ({ page }) => { await freshApp(page); await addBook(page, fixture); });

test('card ⋮ menu → Delete → Undo restores the book', async ({ page }) => {
  await page.locator('.book-card .book-card__menu-btn').first().click();
  await page.click('#card-menu [data-action="delete"]');
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.click('#toast .toast__action');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(1);
});

test('delete is committed after the undo window', async ({ page }) => {
  await page.locator('.book-card .book-card__menu-btn').first().click();
  await page.click('#card-menu [data-action="delete"]');
  await page.waitForTimeout(6500);
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(0);
});

test('card ⋮ menu → Edit opens the modal', async ({ page }) => {
  await page.locator('.book-card .book-card__menu-btn').first().click();
  await page.click('#card-menu [data-action="edit"]');
  await expect(page.locator('#metadata-modal')).toBeVisible();
});

test('modal delete uses undo (no confirm dialog)', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.locator('.book-card .book-meta').first().click();
  await page.click('#meta-delete');
  await expect(page.locator('.book-card')).toHaveCount(0);
  await expect(page.locator('#toast .toast__action')).toHaveText('Undo');
  expect(dialogs).toBe(0);
});
