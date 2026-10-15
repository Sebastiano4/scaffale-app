import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
// "scanned" pages: no extractable text
const trailingEmpty = writeFixture('tts-trailing-empty.pdf', [['Only page one has words.'], [], []], { title: 'Scanned Tail', author: 'T' });
const leadingEmpty = writeFixture('tts-leading-empty.pdf', [[], ['Text on page two.']], { title: 'Scanned Head', author: 'T' });
// one ~700-char sentence spread over short lines (long lines would run off the page)
const sentenceLines = Array.from({ length: 30 }, (_, i) => 'word' + (2 * i) + ' word' + (2 * i + 1) + ' and more');
const longPage = writeFixture('tts-long-page.pdf', [['Intro sentence.', ...sentenceLines, 'still going.', 'The very end.']], { title: 'Long Page', author: 'T' });

// headless Chromium may lack speech synthesis: provide minimal stubs
const stubs = `
  if (!window.speechSynthesis) window.speechSynthesis = { cancel() {}, speak() {} };
  if (typeof window.SpeechSynthesisUtterance !== 'function') {
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
`;
const autoEnd = stubs + `
  window.__spoken = [];
  window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 50); };
  window.speechSynthesis.cancel = () => {};
`;

// what was actually read (ignores the silent " " unlock utterance)
const spokenText = (page) => page.evaluate(() => window.__spoken.filter((t) => t.trim()));
const joined = async (page) => (await spokenText(page)).join(' ');

test('read aloud speaks pages in order and advances', async ({ page }) => {
  await page.addInitScript(autoEnd);
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect.poll(() => joined(page), { timeout: 5000 }).toContain('end of the nest story');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  const all = await joined(page);
  const i1 = all.indexOf('quick brown fox');
  const i2 = all.indexOf('bird builds a nest');
  const i3 = all.indexOf('end of the nest story');
  expect(i1).toBeGreaterThanOrEqual(0);
  expect(i2).toBeGreaterThan(i1);
  expect(i3).toBeGreaterThan(i2);
  expect(all.split('quick brown fox').length).toBe(2); // each page once
});

test('pressing again stops', async ({ page }) => {
  await page.addInitScript(stubs + `
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); };
    window.speechSynthesis.cancel = () => {};
  `);
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await spokenText(page)).length).toBe(1);
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  expect(await joined(page)).not.toContain('bird builds a nest');
});

test('stop then immediate restart with onend-on-cancel speaks each page once, in order', async ({ page }) => {
  await page.addInitScript(stubs + `
    window.__spoken = [];
    let current = null;
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push(u.text); current = u;
      setTimeout(() => { if (current === u) { current = null; u.onend && u.onend(); } }, 150);
    };
    // like Safari/Firefox: cancel() fires onend of the playing utterance (asynchronously)
    window.speechSynthesis.cancel = () => {
      const u = current; current = null;
      if (u) setTimeout(() => u.onend && u.onend(), 30);
    };
  `);
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect.poll(async () => (await spokenText(page)).length).toBe(1);
  // stop + restart in one task, before the stale onend (fired by cancel) arrives
  await page.evaluate(() => { const b = document.querySelector('#read-aloud-btn'); b.click(); b.click(); });
  await expect.poll(() => joined(page), { timeout: 5000 }).toContain('end of the nest story');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  const all = await joined(page);
  // page 1 (stopped), then pages 1,2,3 once each
  expect(all.split('quick brown fox').length - 1).toBe(2);
  expect(all.split('bird builds a nest').length - 1).toBe(1);
  expect(all.split('end of the nest story').length - 1).toBe(1);
  expect(all.lastIndexOf('quick brown fox')).toBeLessThan(all.indexOf('bird builds a nest'));
});

test('a long page is spoken as a queue of short chunks', async ({ page }) => {
  await page.addInitScript(autoEnd);
  await freshApp(page);
  await addBook(page, longPage);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect.poll(() => joined(page), { timeout: 5000 }).toContain('The very end.');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  const parts = await spokenText(page);
  expect(parts.length).toBeGreaterThan(2);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(200);
  const all = parts.join(' ').replace(/\s+/g, ' ');
  expect(all).toContain('Intro sentence.');
  expect(all).toContain('word0 word1');
  expect(all).toContain('word59 and more');
  const spokenWords = all.split(' ');
  for (let i = 0; i < 60; i++) expect(spokenWords).toContain('word' + i);
  expect(all.trim().endsWith('The very end.')).toBe(true);
});

test('speech is unlocked synchronously inside the tap (iOS)', async ({ page }) => {
  await page.addInitScript(autoEnd);
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  const syncCount = await page.evaluate(() => { document.querySelector('#read-aloud-btn').click(); return window.__spoken.length; });
  expect(syncCount).toBeGreaterThan(0);
});

test('scanned trailing pages: stops after the last page with text, book not finished', async ({ page }) => {
  await page.addInitScript(autoEnd);
  await freshApp(page);
  await addBook(page, trailingEmpty);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect(page.locator('#toast')).toContainText('No more text to read', { timeout: 5000 });
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(await joined(page)).toContain('Only page one has words');
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
  await page.waitForTimeout(2800); // longer than the read dwell + save debounce
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
  await expect(page.locator('#toast')).not.toContainText('Book finished');
  await page.click('#back-btn');
  await expect(page.locator('#library-view')).toHaveClass(/view--active/);
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-badge--read')).toHaveCount(0);
});

test('read aloud on a page without text: toast, nothing spoken', async ({ page }) => {
  await page.addInitScript(autoEnd);
  await freshApp(page);
  await addBook(page, leadingEmpty);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect(page.locator('#toast')).toContainText('No text to read on this page');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  expect(await spokenText(page)).toEqual([]);
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 2');
});
