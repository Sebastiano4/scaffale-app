// Dictionary: save words from the reader, see their meaning, browse them on the Dictionary page.
import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';
import { mockWiktionary } from './wiktionary-mock.mjs';

const english = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const italian = writeFixture('italiano.pdf', [
  ['Capitolo uno', 'Il ragazzo era sgomento e non sapeva cosa dire.', 'Loro andavano verso la casa con la malinconia nel cuore.'],
  ['Capitolo due', 'Di nuovo andavano per la strada e il cielo era grigio.'],
  ['Fine', 'Era la fine della storia di una casa.'],
], { title: 'Libro Italiano', author: 'Autore' });

async function selectWord(page, word, pageNo = 1) {
  const ok = await page.evaluate(({ word, pageNo }) => {
    const wrap = document.querySelector(`.pdf-page-wrap[data-page="${pageNo}"]`);
    for (const span of wrap.querySelectorAll('.textLayer span')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== 3) continue;
      const i = node.textContent.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
    return false;
  }, { word, pageNo });
  expect(ok).toBe(true);
  await expect(page.locator('#selection-popover')).toBeVisible();
}

async function scrollToPage(page, n) {
  await page.locator('#pdf-scroll').evaluate((s, n) => { s.scrollTop = document.querySelector(`.pdf-page-wrap[data-page="${n}"]`).offsetTop; }, n);
  await expect(page.locator(`.pdf-page-wrap[data-page="${n}"] .textLayer span`).first()).toBeAttached();
}

const storedWords = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('scaffale-db'); r.onsuccess = () => res(r.result); });
  const books = await new Promise((res) => { const r = db.transaction('books').objectStore('books').getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  return books.flatMap((b) => (b.words || []).map((w) => ({ ...w, bookTitle: b.title })));
});

let wk;
test.beforeEach(async ({ page }) => {
  wk = await mockWiktionary(page);
  await freshApp(page);
});

test('saving a word shows its meaning right away and stores it with its sentence', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await selectWord(page, 'dog');
  await page.click('#sel-dict-btn');
  const card = page.locator('#word-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.word-entry__word')).toHaveText('dog');
  await expect(card.locator('.word-entry__senses li').first()).not.toBeEmpty();
  await expect(card).not.toContainText('Looking up');
  const [w] = await storedWords(page);
  expect(w.status).toBe('ok');
  expect(w.lang).toBe('en');
  expect(w.contexts).toEqual([{ page: 1, sentence: 'The quick brown fox jumps over the lazy dog.' }]);
  // tapping elsewhere closes the card
  await page.mouse.click(5, 300);
  await expect(card).toBeHidden();
});

test('the Dictionary button is only offered for 1–3 words', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await selectWord(page, 'lazy dog');
  await expect(page.locator('#sel-dict-btn')).toBeVisible();
  await selectWord(page, 'jumps over the lazy');
  await expect(page.locator('#sel-dict-btn')).toBeHidden();
});

test('Italian book: an inflected verb shows its base form; saving it again adds the new context', async ({ page }) => {
  await addBook(page, italian);
  await openFirstBook(page);
  await selectWord(page, 'andavano');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__lemma')).toHaveText('andare');
  await page.mouse.click(5, 300);

  await scrollToPage(page, 2);
  await selectWord(page, 'andavano', 2);
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__lemma')).toHaveText('andare');
  const words = await storedWords(page);
  expect(words.length).toBe(1);
  expect(words[0].contexts.map((c) => c.page)).toEqual([1, 2]);
  expect(words[0].source).toBe('wiktionary-it');
});

test('Undo on the card removes a word that was just added', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await selectWord(page, 'dog');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__senses li').first()).toBeVisible();
  await page.click('#word-card [data-act="undo"]');
  await expect(page.locator('#word-card')).toBeHidden();
  await expect.poll(async () => (await storedWords(page)).length).toBe(0);
});

test('Dictionary page: all books, alphabetical, search, book filter, opens the book at the page', async ({ page }) => {
  await addBook(page, english);
  await addBook(page, italian);
  // italian first (most recent → first card)
  await openFirstBook(page);
  await selectWord(page, 'sgomento');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__senses li').first()).toBeVisible();
  await page.mouse.click(5, 300);
  await scrollToPage(page, 2);
  await selectWord(page, 'andavano', 2);
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__lemma')).toBeVisible();
  await page.click('#back-btn');
  await page.locator('.book-card', { hasText: 'Fixture Book' }).locator('.book-cover').click();
  await expect(page.locator('.textLayer').first()).toBeVisible();
  await selectWord(page, 'dog');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__senses li').first()).toBeVisible();
  await page.click('#back-btn');

  await page.click('#sidebar-dict-btn');
  const modal = page.locator('#dictionary-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.word-entry__word')).toHaveText(['andavano', 'dog', 'sgomento']);
  await expect(modal.locator('#dict-count')).toHaveText('3 words');
  // the context sentence shows the word in bold
  await expect(modal.locator('.word-entry', { hasText: 'sgomento' }).locator('.word-entry__context b')).toHaveText('sgomento');

  await modal.locator('#dict-search').fill('andare');
  await expect(modal.locator('.word-entry__word')).toHaveText(['andavano']);
  await modal.locator('#dict-search').fill('');
  await modal.locator('#dict-book').selectOption({ label: 'Fixture Book' });
  await expect(modal.locator('.word-entry__word')).toHaveText(['dog']);
  await modal.locator('#dict-book').selectOption('');

  await modal.locator('.word-entry', { hasText: 'andavano' }).locator('.word-entry__ref').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
  await expect(page.locator('#reader-title')).toHaveText('Libro Italiano');
  await expect(page.locator('#reader-progress')).toContainText('Page 2');
});

test('edit a meaning by hand, delete a word and undo', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await selectWord(page, 'dog');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__senses li').first()).toBeVisible();
  await page.click('#back-btn');
  await page.click('#sidebar-dict-btn');
  const entry = page.locator('#dictionary-modal .word-entry').first();
  await entry.locator('[data-act="edit"]').click();
  await entry.locator('textarea').fill('a loyal animal\nman’s best friend');
  await entry.locator('[data-act="save"]').click();
  await expect(page.locator('#dictionary-modal .word-entry__senses li')).toHaveText(['a loyal animal', 'man’s best friend']);
  expect((await storedWords(page))[0].source).toBe('manual');

  await page.locator('#dictionary-modal .word-entry [data-act="delete"]').click();
  await expect(page.locator('#dictionary-modal .word-entry')).toHaveCount(0);
  await page.locator('#toast .toast__action').click();
  await expect(page.locator('#dictionary-modal .word-entry')).toHaveCount(1);
  await expect.poll(async () => (await storedWords(page)).length).toBe(1);
});

test('offline: the word is kept as pending and gets its meaning when the Dictionary opens online', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  wk.offline = true;
  await selectWord(page, 'dog');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card')).toContainText('Waiting for a connection');
  expect((await storedWords(page))[0].status).toBe('pending');
  await page.mouse.click(5, 300);
  await page.click('#back-btn');
  wk.offline = false;
  await page.click('#sidebar-dict-btn');
  await expect(page.locator('#dictionary-modal .word-entry__senses li').first()).toBeVisible();
  await expect.poll(async () => (await storedWords(page))[0].status).toBe('ok');
});

test('not found: offers to write the meaning', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await selectWord(page, 'quick');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card')).toContainText('No definition found');
  await expect(page.locator('#word-card [data-act="edit"]')).toBeVisible();
});

test('Words tab in the reader lists this book’s words and jumps to the page', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await scrollToPage(page, 2);
  await selectWord(page, 'bird', 2);
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__word')).toHaveText('bird');
  await page.mouse.click(5, 300);
  await page.locator('#pdf-scroll').evaluate((s) => { s.scrollTop = 0; });
  await page.click('#panel-btn');
  await page.click('.side-panel__tab[data-tab="words"]');
  await expect(page.locator('#words-list .word-entry__word')).toHaveText(['bird']);
  await page.locator('#words-list .word-entry__ref').click();
  await expect(page.locator('#reader-progress')).toContainText('Page 2');
});

test('export downloads the dictionary as Markdown', async ({ page }) => {
  await addBook(page, english);
  await openFirstBook(page);
  await selectWord(page, 'dog');
  await page.click('#sel-dict-btn');
  await expect(page.locator('#word-card .word-entry__senses li').first()).toBeVisible();
  await page.click('#back-btn');
  await page.click('#sidebar-dict-btn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dict-export')]);
  expect(download.suggestedFilename()).toMatch(/^dictionary.*\.md$/);
  const fs = await import('node:fs');
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('**dog**');
  expect(text).toContain('Fixture Book');
});
