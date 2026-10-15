import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { freshApp, addBook, putRawBook, getRawBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const other = writeFixture('other.pdf', [['Something else']], { title: 'Other', author: 'X' });

const legacyRecord = (id, title) => ({
  id, title, author: 'Old Author', category: 'Novels', filename: 'old.pdf', numPages: 3, lastPage: 2,
  addedAt: 1000, lastOpenedAt: 2000, readingMode: 'paginated', rating: 4,
  bookmarks: [{ page: 2, label: 'mark' }], quotes: [], thumbnail: null,
});

test('adding the same PDF twice keeps one copy', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await page.setInputFiles('#file-input', fixture);
  await expect(page.locator('#toast')).toContainText('Already in library: Fixture Book');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await addBook(page, other);
  await expect(page.locator('.book-card')).toHaveCount(2);
});

test('a legacy book without hash is recognised as duplicate and keeps its fields', async ({ page }) => {
  await freshApp(page);
  await putRawBook(page, legacyRecord('legacy1', 'My Old Copy'), readFileSync(fixture).toString('base64'));
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.setInputFiles('#file-input', fixture);
  await expect(page.locator('#toast')).toContainText('Already in library: My Old Copy');
  await expect(page.locator('.book-card')).toHaveCount(1);
  const rec = await getRawBook(page, 'legacy1');
  expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
  const { hash, fileBlob, ...rest } = rec;
  expect(rest).toEqual(legacyRecord('legacy1', 'My Old Copy'));
  expect(fileBlob).toMatch(/^blob:\d+$/);
});

test('an unreadable legacy blob does not block adding books', async ({ page }) => {
  await freshApp(page);
  // simulates an iOS "WebKitBlobResource" blob: reading it throws
  await putRawBook(page, { ...legacyRecord('broken1', 'Broken Blob'), fileBlob: { notABlob: true } });
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await addBook(page, fixture);
  await expect(page.locator('#toast')).toContainText('Added: Fixture Book');
});
