// Google Drive sync: two browser contexts ("PC" and "tablet") share one fake Drive.
import { test, expect } from '@playwright/test';
import { addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';
import { createFakeDrive } from './fake-drive.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const other = writeFixture('other.pdf', [['Something else']], { title: 'Other', author: 'X' });

let drive;
async function device(browser, baseURL) {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 1100, height: 800 } });
  await drive.attach(context);
  const page = await context.newPage();
  await page.goto('index.html');
  return page;
}

async function sync(page) {
  await page.click('#sync-btn');
  await expect(page.locator('#sync-btn')).toHaveAttribute('data-status', 'ok');
}

const inPage = (page, fn, arg) => page.evaluate(fn, arg);
const firstBook = (page) => inPage(page, async () => (await (await import('./js/db.js')).DB.all())[0]);

test.beforeEach(() => { drive = createFakeDrive(); });

test('without a client ID the sync button stays hidden', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.locator('#sync-btn')).toBeHidden();
});

test('a book added on the PC appears on the tablet, PDF included, and opens there', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await expect(pc.locator('#sync-btn')).toHaveText(/Connect Google Drive/);
  await sync(pc);
  expect(drive.library().books).toBeTruthy();
  expect(Object.keys(drive.library().books)).toHaveLength(1);
  expect([...drive.files.values()].some((f) => /^book-[0-9a-f]{64}\.pdf$/.test(f.name))).toBe(true);

  const tablet = await device(browser, baseURL);
  await sync(tablet);
  await expect(tablet.locator('.book-card')).toHaveCount(1);
  await expect(tablet.locator('.book-card .book-title')).toHaveText('Fixture Book');
  await expect(tablet.locator('.book-cloud')).toHaveCount(0); // PDF downloaded
  await tablet.locator('.book-card .book-cover').click();
  await expect(tablet.locator('.textLayer').first()).toBeVisible();
});

test('the tablet opens the book where it was left on the PC', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  const tablet = await device(browser, baseURL);
  await sync(tablet);

  await pc.locator('.book-card .book-cover').click();
  await pc.click('#mode-toggle');
  await pc.click('#next-page');
  await pc.click('#next-page');
  await expect(pc.locator('#reader-progress')).toHaveText('Page 3 of 3');
  await pc.waitForTimeout(2600); // the position settles
  await pc.click('#back-btn');
  await sync(pc);

  await sync(tablet);
  await tablet.locator('.book-card .book-cover').click();
  await expect(tablet.locator('#reader-progress')).toHaveText('Page 3 of 3');
});

test('quotes and words added on each device end up on both; a rating change wins by time', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  const tablet = await device(browser, baseURL);
  await sync(tablet);

  const addQuote = (page, text) => inPage(page, async (text) => {
    const { DB } = await import('./js/db.js');
    const b = (await DB.all())[0];
    b.quotes.push({ id: 'q-' + text, page: 1, text, rects: [], note: '', addedAt: Date.now() });
    await DB.put(b);
  }, text);
  await addQuote(pc, 'from pc');
  await addQuote(tablet, 'from tablet');
  await inPage(tablet, async () => {
    const { DB } = await import('./js/db.js');
    const b = (await DB.all())[0];
    b.rating = 4.5;
    await DB.put(b);
  });
  await sync(pc);
  await sync(tablet);
  await sync(pc);

  for (const page of [pc, tablet]) {
    const b = await firstBook(page);
    expect(b.quotes.map((q) => q.text).sort()).toEqual(['from pc', 'from tablet']);
    expect(b.rating).toBe(4.5);
  }
});

test('a quote deleted on one device is deleted on the other', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await inPage(pc, async () => {
    const { DB } = await import('./js/db.js');
    const b = (await DB.all())[0];
    b.quotes.push({ id: 'q1', page: 1, text: 'keep me?', rects: [], note: '' });
    await DB.put(b);
  });
  await sync(pc);
  const tablet = await device(browser, baseURL);
  await sync(tablet);
  expect((await firstBook(tablet)).quotes).toHaveLength(1);

  await inPage(tablet, async () => {
    const { DB } = await import('./js/db.js');
    const b = (await DB.all())[0];
    b.quotes = [];
    await DB.put(b);
  });
  await sync(tablet);
  await sync(pc);
  expect((await firstBook(pc)).quotes).toHaveLength(0);
});

test('a book deleted on the PC disappears from the tablet and from Drive', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await addBook(pc, other);
  await sync(pc);
  const tablet = await device(browser, baseURL);
  await sync(tablet);
  await expect(tablet.locator('.book-card')).toHaveCount(2);

  await pc.locator('.book-card', { hasText: 'Other' }).locator('.book-card__menu-btn').click();
  await pc.click('#card-menu [data-action="delete"]');
  await inPage(pc, async () => (await import('./js/library.js')).flushPendingDeletes());
  await sync(pc);
  expect(Object.keys(drive.library().books)).toHaveLength(1);
  expect([...drive.files.values()].filter((f) => f.name.startsWith('book-'))).toHaveLength(1);

  await sync(tablet);
  await expect(tablet.locator('.book-card')).toHaveCount(1);
  await expect(tablet.locator('.book-card .book-title')).toHaveText('Fixture Book');
});

test('changes made offline are sent when the connection comes back', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  await pc.context().setOffline(true);
  drive.offline = true;
  await inPage(pc, async () => {
    const { DB } = await import('./js/db.js');
    const b = (await DB.all())[0];
    b.title = 'Renamed offline';
    await DB.put(b);
  });
  await pc.click('#sync-btn');
  await expect(pc.locator('#sync-btn')).toHaveAttribute('data-status', 'offline');
  drive.offline = false;
  await pc.context().setOffline(false);
  await expect(pc.locator('#sync-btn')).toHaveAttribute('data-status', 'ok');
  await expect.poll(() => Object.values(drive.library().books)[0].title).toBe('Renamed offline');
});

test('an expired sign-in asks for one tap, then syncs', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  await inPage(pc, () => {
    const t = JSON.parse(localStorage.getItem('booknest-drive-token'));
    localStorage.setItem('booknest-drive-token', JSON.stringify({ ...t, exp: Date.now() - 1000 }));
  });
  await pc.reload();
  await expect(pc.locator('#sync-btn')).toHaveAttribute('data-status', 'needs-auth');
  await expect(pc.locator('#sync-btn')).toHaveText(/Tap to sync/);
  await sync(pc);
});

test('a revoked token (401) falls back to "Tap to sync"', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  const token = await inPage(pc, () => JSON.parse(localStorage.getItem('booknest-drive-token')).value);
  drive.revoked.add(token);
  await pc.click('#sync-btn');
  await expect(pc.locator('#sync-btn')).toHaveAttribute('data-status', 'needs-auth');
  await sync(pc);
});

test('the same PDF added on both devices stays one book', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  const tablet = await device(browser, baseURL);
  await addBook(tablet, fixture);
  await sync(tablet);
  await expect(tablet.locator('.book-card')).toHaveCount(1);
  await sync(pc);
  await expect(pc.locator('.book-card')).toHaveCount(1);
  expect(Object.keys(drive.library().books)).toHaveLength(1);
});

test('after a change the app pushes by itself, without tapping', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL);
  await addBook(pc, fixture);
  await sync(pc);
  await inPage(pc, async () => {
    const { DB } = await import('./js/db.js');
    const b = (await DB.all())[0];
    b.author = 'Changed automatically';
    await DB.put(b);
  });
  await expect.poll(() => Object.values(drive.library().books)[0].author, { timeout: 20_000 }).toBe('Changed automatically');
});
