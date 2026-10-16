import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test.use({ hasTouch: true, viewport: { width: 800, height: 1000 } });

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

// a touch gesture on one CDP session: hold, then optionally slide by dx
async function gesture(page, p, { holdMs = 40, dx = 0 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(holdMs);
  if (dx) {
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + (dx * i) / 6, y: p.y }] });
      await page.waitForTimeout(20);
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
});

test('paginated: a long-press that slides sideways does not turn the page; a quick swipe still does', async ({ page }) => {
  await page.click('#mode-toggle');
  await expect(page.locator('.pdf-page-wrap')).toHaveCount(1);
  await gesture(page, await wordCenter(page, 'lazy'), { holdMs: 650, dx: -150 });
  await page.waitForTimeout(300);
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await gesture(page, { x: 600, y: 600 }, { holdMs: 20, dx: -250 });
  await expect(page.locator('#reader-progress')).toHaveText('Page 2 of 3');
});

test('a quote spanning two pages is highlighted on both pages, inside each page', async ({ page }) => {
  await gesture(page, await wordCenter(page, 'dog'), { holdMs: 650 });
  await page.locator('#pdf-scroll').evaluate((s) => { s.scrollTop = document.querySelector('.pdf-page-wrap[data-page="2"]').offsetTop - 40; });
  await page.waitForTimeout(300);
  await gesture(page, await wordCenter(page, 'bird', 2));
  await expect.poll(() => page.locator('#selection-popover').getAttribute('data-text')).toMatch(/A bird$/);
  await page.click('#save-highlight-btn');
  // no highlight box may cover a whole page (that was the bug: element boxes in the range)
  const maxH = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.quote-highlight-box')]
    .map((b) => b.offsetHeight / b.closest('.pdf-page-wrap').clientHeight)));
  expect(maxH).toBeLessThan(0.1);
  const inside = await page.evaluate(() => [1, 2].map((n) => {
    const wrap = document.querySelector(`.pdf-page-wrap[data-page="${n}"]`);
    const boxes = [...wrap.querySelectorAll('.quote-highlight-box')];
    return { count: boxes.length, allInside: boxes.every((b) => b.offsetTop >= 0 && b.offsetTop < wrap.clientHeight) };
  }));
  expect(inside[0].count).toBeGreaterThan(0);
  expect(inside[1].count).toBeGreaterThan(0);
  expect(inside.every((p) => p.allInside)).toBe(true);
});

test('in immersive mode a pause button appears while reading aloud and stops it', async ({ page }) => {
  await page.evaluate(() => {
    window.speechSynthesis.speak = () => {}; // never ends: stays "playing"
    window.speechSynthesis.cancel = () => {};
  });
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#immersive-btn');
  await expect(page.locator('.immersive-tts-pause')).toBeVisible();
  await page.click('.immersive-tts-pause');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.immersive-tts-pause')).toBeHidden();
});

test('no pause button in immersive mode when nothing is being read', async ({ page }) => {
  await page.click('#immersive-btn');
  await expect(page.locator('body')).toHaveClass(/\bimmersive\b/);
  await expect(page.locator('.immersive-tts-pause')).toBeHidden();
});

test('a book marked unread does not finish itself again when reopened on its last page', async ({ page }) => {
  await page.click('#mode-toggle');
  await page.click('#next-page');
  await page.click('#next-page');
  await expect(page.locator('#reader-progress')).toHaveText('Page 3 of 3');
  await page.waitForTimeout(2600); // dwell → counts as read → finished
  await page.click('#back-btn');
  await expect(page.locator('#read-shelf .book-card')).toHaveCount(1);
  await page.locator('#read-shelf .book-card .book-card__menu-btn').click();
  await page.click('#card-menu [data-action="toggle-read"]');
  await expect(page.locator('#read-shelf')).toBeHidden();
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-progress')).toHaveText('Page 3 of 3');
  await page.waitForTimeout(2600);
  await page.click('#back-btn');
  await expect(page.locator('#read-shelf')).toBeHidden();
});
