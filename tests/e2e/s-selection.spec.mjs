import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

// Center of a word inside the text layer (first occurrence, optional page).
async function wordCenter(page, word, pageNo) {
  return page.evaluate(({ word, pageNo }) => {
    const scope = pageNo ? document.querySelector(`.pdf-page-wrap[data-page="${pageNo}"]`) : document;
    for (const span of scope.querySelectorAll('.textLayer span')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== 3) continue;
      const i = node.textContent.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, { word, pageNo });
}

// One CDP session per gesture: the touch sequence must stay on the same session.
async function press(page, p, holdMs) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
const longPress = (page, p) => press(page, p, 650);
const tap = (page, p) => press(page, p, 40);

const popoverText = (page) => page.locator('#selection-popover').getAttribute('data-text');

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 800, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await freshApp(page);
    await addBook(page, fixture);
    await openFirstBook(page);
    await expect(page.locator('.pdf-page-wrap[data-page="2"] .textLayer span').first()).toBeAttached();
  });

  test('long-press selects the word under the finger', async ({ page }) => {
    await longPress(page, await wordCenter(page, 'brown'));
    await expect(page.locator('#selection-popover')).toBeVisible();
    expect(await popoverText(page)).toBe('brown');
  });

  test('tap on another word extends the selection to it, and tapping again moves the end', async ({ page }) => {
    await longPress(page, await wordCenter(page, 'brown'));
    await tap(page, await wordCenter(page, 'lazy'));
    await expect.poll(() => popoverText(page)).toBe('brown fox jumps over the lazy');
    await tap(page, await wordCenter(page, 'jumps'));
    await expect.poll(() => popoverText(page)).toBe('brown fox jumps');
    await tap(page, await wordCenter(page, 'quick'));
    await expect.poll(() => popoverText(page)).toBe('quick brown');
  });

  test('extension works across pages', async ({ page }) => {
    await longPress(page, await wordCenter(page, 'dog'));
    await page.locator('#pdf-scroll').evaluate((s) => { s.scrollTop = document.querySelector('.pdf-page-wrap[data-page="2"]').offsetTop - 40; });
    await page.waitForTimeout(300);
    await tap(page, await wordCenter(page, 'bird', 2));
    await expect.poll(() => popoverText(page)).toMatch(/^dog\.\s*Chapter two\s*A bird$/);
  });

  test('double-tap selects the whole sentence', async ({ page }) => {
    await page.locator('#pdf-scroll').evaluate((s) => { s.scrollTop = document.querySelector('.pdf-page-wrap[data-page="2"]').offsetTop - 40; });
    await page.waitForTimeout(300);
    const p = await wordCenter(page, 'builds', 2);
    await tap(page, p); await page.waitForTimeout(80); await tap(page, p);
    await expect.poll(() => popoverText(page)).toBe('A bird builds a nest.');
    const w = await wordCenter(page, 'warm', 2);
    await tap(page, w); await page.waitForTimeout(80); await tap(page, w);
    await expect.poll(() => popoverText(page)).toBe('The nest is warm.');
  });

  test('tap away from the text clears the selection', async ({ page }) => {
    await longPress(page, await wordCenter(page, 'brown'));
    await expect(page.locator('#selection-popover')).toBeVisible();
    const box = await page.locator('.pdf-page-wrap[data-page="1"]').boundingBox();
    await tap(page, { x: box.x + box.width * 0.5, y: box.y + box.height * 0.8 });
    await expect(page.locator('#selection-popover')).toBeHidden();
  });

  test('a touch selection can still be saved as a quote with highlight rectangles', async ({ page }) => {
    await longPress(page, await wordCenter(page, 'brown'));
    await tap(page, await wordCenter(page, 'fox'));
    await expect.poll(() => popoverText(page)).toBe('brown fox');
    await page.click('#save-highlight-btn');
    await expect(page.locator('.pdf-page-wrap[data-page="1"] .quote-highlight-box').first()).toBeAttached();
  });
});

test.describe('mouse', () => {
  test.beforeEach(async ({ page }) => {
    await freshApp(page);
    await addBook(page, fixture);
    await openFirstBook(page);
  });

  test('a drag selection snaps to whole words', async ({ page }) => {
    const q = await wordCenter(page, 'quick');
    const f = await wordCenter(page, 'fox');
    await page.mouse.move(q.x + 2, q.y);
    await page.mouse.down();
    await page.mouse.move(f.x - 2, f.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => popoverText(page)).toBe('quick brown fox');
  });

  test('each text layer has the anti-jump end-of-content element', async ({ page }) => {
    await expect(page.locator('.pdf-page-wrap[data-page="1"] .textLayer .endOfContent')).toHaveCount(1);
  });
});
