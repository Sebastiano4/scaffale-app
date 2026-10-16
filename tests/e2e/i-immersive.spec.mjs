import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test.use({ hasTouch: true });

// Real touch events through the DevTools protocol (what a finger on Android produces).
async function swipe(page, from, to, steps = 8, ms = 200) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(ms / steps);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function enter(page) {
  await page.click('#immersive-btn');
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/);
}

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
});

test('entering hides all chrome and the pages fill the screen', async ({ page }) => {
  await expect(page.locator('#immersive-btn')).toBeVisible();
  await enter(page);
  await expect(page.locator('.reader-topbar')).toBeHidden();
  await expect(page.locator('#page-progress-bar')).toBeHidden();
  await expect(page.locator('.zoom-controls')).toBeHidden();
  const box = await page.locator('#pdf-scroll').boundingBox();
  const vp = page.viewportSize();
  expect(box.y).toBeLessThanOrEqual(1);
  expect(box.height).toBeGreaterThanOrEqual(vp.height - 2);
});

test('a left-to-right swipe exits; vertical and right-to-left swipes do not', async ({ page }) => {
  await enter(page);
  const vp = page.viewportSize();
  await swipe(page, { x: vp.width * 0.5, y: vp.height * 0.7 }, { x: vp.width * 0.5, y: vp.height * 0.2 });
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/);
  await swipe(page, { x: vp.width * 0.85, y: vp.height * 0.5 }, { x: vp.width * 0.15, y: vp.height * 0.5 });
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/);
  await swipe(page, { x: vp.width * 0.1, y: vp.height * 0.5 }, { x: vp.width * 0.8, y: vp.height * 0.52 });
  await expect(page.locator('body')).not.toHaveClass(/\bimmersive\b/);
  await expect(page.locator('.reader-topbar')).toBeVisible();
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
});

test('a short left-to-right swipe does not exit', async ({ page }) => {
  await enter(page);
  const vp = page.viewportSize();
  await swipe(page, { x: vp.width * 0.4, y: vp.height * 0.5 }, { x: vp.width * 0.55, y: vp.height * 0.5 });
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/);
});

test('Android back exits immersive mode but stays in the reader', async ({ page }) => {
  await enter(page);
  await page.goBack();
  await expect(page.locator('body')).not.toHaveClass(/\bimmersive\b/);
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
  await expect(page.locator('.reader-topbar')).toBeVisible();
});

test('Escape exits; swiping out does not leave a stale history entry', async ({ page }) => {
  await enter(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/\bimmersive\b/);
  const len1 = await page.evaluate(() => history.length);
  await enter(page);
  const vp = page.viewportSize();
  await swipe(page, { x: vp.width * 0.1, y: vp.height * 0.5 }, { x: vp.width * 0.8, y: vp.height * 0.5 });
  await expect(page.locator('body')).not.toHaveClass(/\bimmersive\b/);
  // the reader must still be open: our own history entry was consumed, not the page's
  await page.waitForTimeout(300);
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
  expect(await page.evaluate(() => history.state && history.state.immersive)).toBeFalsy();
  expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(len1);
});

test('a paginated book is shown continuous while immersive, and paginated again after', async ({ page }) => {
  await page.click('#mode-toggle');
  await expect(page.locator('.pdf-page-wrap')).toHaveCount(1);
  await enter(page);
  await expect(page.locator('.pdf-page-wrap')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pdf-page-wrap')).toHaveCount(1);
});

test('the exit hint is shown only the first time', async ({ page }) => {
  await enter(page);
  await expect(page.locator('.immersive-hint')).toBeVisible();
  await expect(page.locator('.immersive-hint')).toHaveText('Swipe left → right to exit');
  await page.keyboard.press('Escape');
  await expect(page.locator('.immersive-hint')).toHaveCount(0);
  await enter(page);
  await page.waitForTimeout(300);
  await expect(page.locator('.immersive-hint')).toHaveCount(0);
});

test('closing the reader while immersive leaves no immersive state behind', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => document.querySelector('#back-btn').click());
  await expect(page.locator('#library-view')).toHaveClass(/view--active/);
  await expect(page.locator('body')).not.toHaveClass(/\bimmersive\b/);
});
