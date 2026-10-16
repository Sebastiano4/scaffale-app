// Ratings in half steps: the left half of a star gives x.5, the right half the whole star.
import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

const storedRating = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('scaffale-db'); r.onsuccess = () => res(r.result); });
  const books = await new Promise((res) => { const r = db.transaction('books').objectStore('books').getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  return books[0].rating;
});

async function clickStarHalf(page, n, half) {
  const star = page.locator(`#meta-rating .star[data-v="${n}"]`);
  const box = await star.boundingBox();
  await star.click({ position: { x: half === 'left' ? box.width * 0.25 : box.width * 0.75, y: box.height / 2 } });
}

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
});

test('left half of the 4th star saves 3.5 and the card shows a half star', async ({ page }) => {
  await page.locator('.book-card .book-meta').first().click();
  await clickStarHalf(page, 4, 'left');
  await expect(page.locator('#meta-rating .star--half')).toHaveCount(1);
  await expect(page.locator('#meta-rating .star--on')).toHaveCount(3);
  await page.click('#meta-save');
  expect(await storedRating(page)).toBe(3.5);
  const stars = page.locator('.book-card .book-stars');
  await expect(stars).toHaveAttribute('aria-label', '3.5 stars');
  await expect(stars.locator('.book-stars__half')).toHaveCount(1);
});

test('right half gives the whole star, and a saved half rating reopens as half', async ({ page }) => {
  await page.locator('.book-card .book-meta').first().click();
  await clickStarHalf(page, 2, 'left');
  await page.click('#meta-save');
  await page.locator('.book-card .book-meta').first().click();
  await expect(page.locator('#meta-rating .star--half')).toHaveCount(1);
  await expect(page.locator('#meta-rating .star--on')).toHaveCount(1);
  await clickStarHalf(page, 5, 'right');
  await expect(page.locator('#meta-rating .star--half')).toHaveCount(0);
  await expect(page.locator('#meta-rating .star--on')).toHaveCount(5);
  await page.click('#meta-save');
  expect(await storedRating(page)).toBe(5);
  await expect(page.locator('.book-card .book-stars__half')).toHaveCount(0);
});

test('existing whole-star ratings still show as before', async ({ page }) => {
  await page.locator('.book-card .book-meta').first().click();
  await clickStarHalf(page, 3, 'right');
  await page.click('#meta-save');
  await expect(page.locator('.book-card .book-stars')).toHaveAttribute('aria-label', '3 stars');
  await expect(page.locator('.book-card .book-stars__off')).toHaveCount(2);
});
