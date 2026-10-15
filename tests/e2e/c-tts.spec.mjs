import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

// headless Chromium may lack speech synthesis: provide minimal stubs
const stubs = `
  if (!window.speechSynthesis) window.speechSynthesis = { cancel() {}, speak() {} };
  if (typeof window.SpeechSynthesisUtterance !== 'function') {
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
`;

test('read aloud speaks pages in order and advances', async ({ page }) => {
  await page.addInitScript(stubs + `
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 50); };
    window.speechSynthesis.cancel = () => {};
  `);
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect.poll(() => page.evaluate(() => window.__spoken.length), { timeout: 5000 }).toBe(3);
  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken[0]).toContain('quick brown fox');
  expect(spoken[1]).toContain('bird builds a nest');
  expect(spoken[2]).toContain('end of the nest story');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
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
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__spoken.length)).toBe(1);
});
