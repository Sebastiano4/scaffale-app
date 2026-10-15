import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

async function selectWord(page, word) {
  await page.evaluate((w) => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes(w));
    const node = span.firstChild;
    const i = node.textContent.indexOf(w);
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + w.length);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, word);
  await expect(page.locator('#selection-popover')).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    window.__spoken = [];
    // headless Chromium may lack speech synthesis: provide minimal stubs
    if (!window.speechSynthesis) window.speechSynthesis = { cancel() {}, speak() {} };
    if (typeof window.SpeechSynthesisUtterance !== 'function') {
      window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    }
    window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 10); };
  });
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
});

test('copy puts the selection on the clipboard', async ({ page }) => {
  await selectWord(page, 'brown');
  await page.click('#sel-copy-btn');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('brown');
});

test('define and translate open the right URLs', async ({ page }) => {
  await selectWord(page, 'brown');
  await page.click('#sel-define-btn');
  await selectWord(page, 'brown');
  await page.click('#sel-translate-btn');
  const opened = await page.evaluate(() => window.__opened);
  expect(opened[0]).toBe('https://en.wiktionary.org/wiki/Special:Search?search=brown');
  expect(opened[1]).toMatch(/^https:\/\/translate\.google\.com\/\?sl=auto&tl=[a-z]{2}&text=brown&op=translate$/);
});

test('speak reads the selection', async ({ page }) => {
  await selectWord(page, 'brown');
  await page.click('#sel-speak-btn');
  expect(await page.evaluate(() => window.__spoken)).toEqual(['brown']);
});
