// Touch selection on a real-phone-like setup (isMobile: Chrome's own long-press gestures run):
// long-press + drag extends word by word, auto-scrolls across pages, and imprecise taps snap
// to the nearest word instead of wiping the selection.
import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture } from '../fixtures/make-pdf.mjs';

const lines = [];
for (let i = 0; i < 20; i++) lines.push('Riga numero ' + i + ' del testo con alcune parole per la prova di selezione.');
const fixture = writeFixture('long.pdf', [['Capitolo', ...lines], ['Seconda', ...lines]], { title: 'Lungo', author: 'A' });

test.use({ hasTouch: true, isMobile: true, viewport: { width: 800, height: 1100 }, deviceScaleFactor: 2 });

// nth occurrence of `word` on page `pageNo`: center, height, right edge
async function wordBox(page, word, pageNo, nth = 0) {
  return page.evaluate(({ word, pageNo, nth }) => {
    const wrap = document.querySelector(`.pdf-page-wrap[data-page="${pageNo}"]`);
    let k = 0;
    for (const span of wrap.querySelectorAll('.textLayer span')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== 3) continue;
      const i = node.textContent.indexOf(word);
      if (i < 0 || k++ < nth) continue;
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, h: b.height, right: b.right };
    }
    return null;
  }, { word, pageNo, nth });
}

// one gesture on its own CDP session: press, hold, optional moves (each held `stepMs`), lift
async function touch(page, p, { holdMs = 40, moves = [], stepMs = 25, endHoldMs = 0 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.waitForTimeout(holdMs);
  for (const m of moves) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [m] });
    await page.waitForTimeout(stepMs);
  }
  if (endHoldMs) await page.waitForTimeout(endHoldMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(300);
}
const path = (a, b, n = 6) => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }));
// the app's own reading of the selection (touch turns the browser's native selection off)
const selection = (page) => page.evaluate(async () => (await import('./js/reader-touch-select.js')).selectionText().replace(/\s+/g, ' ').trim());

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
});

test('long-press then drag extends the selection to the word under the finger', async ({ page }) => {
  const a = await wordBox(page, 'numero', 1, 2);
  const b = await wordBox(page, 'alcune', 1, 4);
  await touch(page, a, { holdMs: 700, moves: path(a, b) });
  expect(await selection(page)).toBe('numero 2 del testo con alcune parole per la prova di selezione. Riga numero 3 del testo con alcune parole per la prova di selezione. Riga numero 4 del testo con alcune');
});

test('dragging upwards selects backwards from the pressed word', async ({ page }) => {
  const a = await wordBox(page, 'testo', 1, 5);
  const b = await wordBox(page, 'parole', 1, 4);
  await touch(page, a, { holdMs: 700, moves: path(a, b) });
  expect(await selection(page)).toBe('parole per la prova di selezione. Riga numero 5 del testo');
});

test('the page does not scroll while dragging a selection', async ({ page }) => {
  const a = await wordBox(page, 'numero', 1, 6);
  const before = await page.locator('#pdf-scroll').evaluate((s) => s.scrollTop);
  await touch(page, a, { holdMs: 700, moves: path(a, { x: a.x, y: a.y - 200 }) });
  expect(await page.locator('#pdf-scroll').evaluate((s) => s.scrollTop)).toBe(before);
});

test('dragging to the bottom edge auto-scrolls and continues onto the next page', async ({ page }) => {
  await page.locator('#pdf-scroll').evaluate((s) => { s.scrollTop = document.querySelector('.pdf-page-wrap[data-page="2"]').offsetTop - 900; });
  await page.waitForTimeout(300);
  const a = await wordBox(page, 'numero', 1, 17);
  const edge = await page.locator('#pdf-scroll').evaluate((s) => s.getBoundingClientRect().bottom - 12);
  // hold near the bottom edge until the next page comes into view
  await touch(page, a, { holdMs: 700, moves: path(a, { x: a.x, y: edge }), endHoldMs: 2500 });
  const text = await selection(page);
  expect(text.startsWith('numero 17 del testo')).toBe(true);
  expect(text).toContain('Seconda');
});

test('a tap just past the end of a line extends to that line instead of clearing', async ({ page }) => {
  const a = await wordBox(page, 'numero', 1, 2);
  const b = await wordBox(page, 'selezione', 1, 3);
  await touch(page, a, { holdMs: 700 });
  await touch(page, { x: b.right + 25, y: b.y });
  expect(await selection(page)).toBe('numero 2 del testo con alcune parole per la prova di selezione. Riga numero 3 del testo con alcune parole per la prova di selezione');
});

test('a tap far from any text still clears the selection', async ({ page }) => {
  const a = await wordBox(page, 'numero', 1, 2);
  await touch(page, a, { holdMs: 700 });
  expect(await selection(page)).toBe('numero');
  const far = await page.evaluate(() => {
    const r = document.querySelector('.pdf-page-wrap[data-page="1"]').getBoundingClientRect();
    return { x: r.left + 8, y: r.top + 20 };  // top-left page margin
  });
  await touch(page, far);
  expect(await selection(page)).toBe('');
});

test("with a finger, the browser's own text selection is off (it fought ours and jumped lines)", async ({ page }) => {
  const a = await wordBox(page, 'numero', 1, 2);
  await touch(page, a, { holdMs: 700 });
  const userSelect = await page.locator('.pdf-page-wrap[data-page="1"] .textLayer span').first()
    .evaluate((s) => getComputedStyle(s).webkitUserSelect || getComputedStyle(s).userSelect);
  expect(userSelect).toBe('none');
  // …and the app's selection still drives the popover
  await expect(page.locator('#selection-popover')).toBeVisible();
  await expect(page.locator('#selection-popover')).toHaveAttribute('data-text', 'numero');
});

test('the pressed word is exact even in the middle of a long line', async ({ page }) => {
  for (const [word, nth] of [['testo', 3], ['alcune', 7], ['prova', 9], ['del', 11]]) {
    const b = await wordBox(page, word, 1, nth);
    await touch(page, b, { holdMs: 700 });
    expect(await selection(page)).toBe(word);
    await page.evaluate(() => getSelection().removeAllRanges());
  }
});

test('dragging line by line selects one more line at a time', async ({ page }) => {
  const a = await wordBox(page, 'Riga', 1, 3);
  const words = [];
  for (let n = 3; n <= 6; n++) words.push(await wordBox(page, 'selezione', 1, n));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  await page.waitForTimeout(700);
  const seen = [];
  for (const w of words) {
    for (let i = 1; i <= 4; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: w.x, y: w.y - w.h + (w.h * i) / 4 }] });
      await page.waitForTimeout(20);
    }
    seen.push((await selection(page)).split('selezione').length - 1);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  expect(seen).toEqual([1, 2, 3, 4]);
});
