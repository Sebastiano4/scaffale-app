import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test('toasts are visible inside the reader (e.g. after saving a quote)', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.evaluate(() => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes('brown'));
    const node = span.firstChild; const i = node.textContent.indexOf('brown');
    const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 5);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.click('#save-highlight-btn');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Quote saved');
});

test('the selectable text layer has the same size as the printed text', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  const r = await page.evaluate(() => {
    const wrap = document.querySelector('.pdf-page-wrap[data-page="1"]');
    const scale = wrap.getBoundingClientRect().width / 612; // fixture pages are 612pt wide
    const span = [...wrap.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes('brown'));
    const node = span.firstChild; const i = node.textContent.indexOf('brown');
    const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 5);
    // Helvetica 14pt in the PDF: "brown" starts at 72pt + width of "The quick " (~65pt)
    return { fontPx: parseFloat(getComputedStyle(span).fontSize), expectedFontPx: 14 * scale,
      wordLeft: (range.getBoundingClientRect().left - wrap.getBoundingClientRect().left) / scale };
  });
  expect(Math.abs(r.fontPx - r.expectedFontPx) / r.expectedFontPx).toBeLessThan(0.15);
  expect(Math.abs(r.wordLeft - 137)).toBeLessThan(8);
});

test('immersive mode still allows touch selection and shows the popover', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#immersive-btn');
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/);
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes('brown'));
    const node = span.firstChild; const i = node.textContent.indexOf('brown');
    const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 5);
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#selection-popover')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/); // a long-press is not an exit swipe
  await context.close();
});
