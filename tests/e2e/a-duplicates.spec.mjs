import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const other = writeFixture('other.pdf', [['Something else']], { title: 'Other', author: 'X' });

test('adding the same PDF twice keeps one copy', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await page.setInputFiles('#file-input', fixture);
  await expect(page.locator('#toast')).toContainText('Already in library: Fixture Book');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await addBook(page, other);
  await expect(page.locator('.book-card')).toHaveCount(2);
});
