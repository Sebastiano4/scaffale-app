import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const standard = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const paragraphs = writeFixture('t-paragraphs.pdf',
  [['First sentence here. Second sentence here.', '', 'New paragraph after a gap.', 'It goes on a bit more here.']],
  { title: 'Paragraphs', author: 'T' });
const crossPage = writeFixture('t-cross-page.pdf',
  [['Page one starts here.', 'This sentence continues on'], ['the next page and ends.', 'Final words here.']],
  { title: 'Cross Page', author: 'T' });

/* Recording speechSynthesis stub: text, rate, pitch, voice, timestamp; onend after 20 ms
   (never, while window.__hold is true). Voices: a basic and a "natural" English, an Italian. */
const stub = `
  window.__utt = [];
  window.__hold = false;
  const voices = [
    { name: 'Basic English', lang: 'en-US', voiceURI: 'basic-en', localService: true, default: true },
    { name: 'Google US English Natural', lang: 'en-US', voiceURI: 'google-en', localService: false, default: false },
    { name: 'Google italiano', lang: 'it-IT', voiceURI: 'google-it', localService: false, default: false },
  ];
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  if (!window.speechSynthesis) window.speechSynthesis = {};
  const s = window.speechSynthesis;
  let current = null;
  s.getVoices = () => voices;
  s.addEventListener = s.addEventListener || (() => {});
  s.removeEventListener = s.removeEventListener || (() => {});
  s.cancel = () => { current = null; };
  s.speak = (u) => {
    window.__utt.push({ text: u.text, rate: u.rate, pitch: u.pitch, voice: u.voice ? u.voice.name : null, t: performance.now() });
    current = u;
    if (window.__hold) return;
    setTimeout(() => { if (current === u) { current = null; u.onend && u.onend(); } }, 20);
  };
`;

const spoken = (page) => page.evaluate(() => window.__utt.filter((u) => u.text.trim()));
const texts = async (page) => (await spoken(page)).map((u) => u.text);
const setRange = (page, sel, value) => page.$eval(sel, (el, v) => {
  el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);

async function readAll(page) {
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false', { timeout: 10000 });
}

test('one utterance per sentence, in order, with the best voice by default', async ({ page }) => {
  await page.addInitScript(stub);
  await freshApp(page);
  await addBook(page, standard);
  await openFirstBook(page);
  await readAll(page);
  expect(await texts(page)).toEqual([
    'Chapter one', 'The quick brown fox jumps over the lazy dog.',
    'Chapter two', 'A bird builds a nest.', 'The nest is warm.', 'Every nest is different.',
    'Chapter three', 'The end of the nest story.',
  ]);
  const u = (await spoken(page))[1];
  expect(u.voice).toBe('Google US English Natural');
  expect(u.rate).toBe(1);
  expect(u.pitch).toBe(1);
});

test('the pause after a paragraph is longer than between sentences', async ({ page }) => {
  await page.addInitScript(stub);
  await freshApp(page);
  await addBook(page, paragraphs);
  await openFirstBook(page);
  await readAll(page);
  const u = await spoken(page);
  expect(u.map((x) => x.text).slice(0, 3)).toEqual(['First sentence here.', 'Second sentence here.', 'New paragraph after a gap.']);
  const sentenceGap = u[1].t - u[0].t;
  const paragraphGap = u[2].t - u[1].t;
  expect(sentenceGap).toBeGreaterThan(200);
  expect(paragraphGap - sentenceGap).toBeGreaterThan(300);
});

test('a sentence split across pages is spoken once, joined', async ({ page }) => {
  await page.addInitScript(stub);
  await freshApp(page);
  await addBook(page, crossPage);
  await openFirstBook(page);
  await readAll(page);
  const all = await texts(page);
  expect(all).toEqual(['Page one starts here.', 'This sentence continues on the next page and ends.', 'Final words here.']);
});

test('settings: voice, speed and pitch are applied and persist across reload', async ({ page }) => {
  await page.addInitScript(stub);
  await freshApp(page);
  await addBook(page, standard);
  await openFirstBook(page);
  await expect(page.locator('#tts-settings')).toBeHidden();
  await page.click('#tts-settings-btn');
  await expect(page.locator('#tts-settings')).toBeVisible();
  // book-language voices come first, best first
  const opts = await page.$$eval('#tts-voice-select option', (os) => os.map((o) => o.value));
  expect(opts.slice(0, 3)).toEqual(['', 'google-en', 'basic-en']);
  await page.selectOption('#tts-voice-select', 'basic-en');
  await setRange(page, '#tts-rate', '1.3');
  await setRange(page, '#tts-pitch', '0.9');
  await expect(page.locator('#tts-rate-val')).toHaveText('1.3×');
  await expect(page.locator('#tts-pitch-val')).toHaveText('0.9');

  await page.reload();
  await openFirstBook(page);
  await page.click('#tts-settings-btn');
  await expect(page.locator('#tts-voice-select')).toHaveValue('basic-en');
  await expect(page.locator('#tts-rate')).toHaveValue('1.3');
  await expect(page.locator('#tts-pitch')).toHaveValue('0.9');
  await page.click('#tts-settings-btn');
  await expect(page.locator('#tts-settings')).toBeHidden();
  await readAll(page);
  for (const u of await spoken(page)) {
    expect(u.rate).toBe(1.3);
    expect(u.pitch).toBe(0.9);
    expect(u.voice).toBe('Basic English');
  }
});

test('"Test voice" speaks a sample with the chosen settings', async ({ page }) => {
  await page.addInitScript(stub);
  await freshApp(page);
  await addBook(page, standard);
  await openFirstBook(page);
  await page.click('#tts-settings-btn');
  await setRange(page, '#tts-rate', '0.8');
  await page.click('#tts-test-btn');
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
  const u = (await spoken(page))[0];
  expect(u.rate).toBe(0.8);
  expect(u.voice).toBe('Google US English Natural');
});

test('the sentence being read is highlighted on the page; stop clears it', async ({ page }) => {
  await page.addInitScript(stub + 'window.__hold = true;');
  await freshApp(page);
  await addBook(page, standard);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  const current = page.locator('.pdf-page-wrap[data-page="1"] .textLayer span.tts-current');
  await expect(current.first()).toBeVisible();
  await expect(current.first()).toContainText('Chapter one');
  await page.click('#read-aloud-btn');
  await expect(page.locator('.textLayer span.tts-current')).toHaveCount(0);
});

test('the highlight follows the sentences', async ({ page }) => {
  await page.addInitScript(stub + `
    window.__hold = true;
    const speak = window.speechSynthesis.speak;
    window.__advance = () => { const u = window.__lastU; window.__lastU = null; u && u.onend && u.onend(); };
    window.speechSynthesis.speak = (u) => { window.__lastU = u; speak(u); };
  `);
  await freshApp(page);
  await addBook(page, standard);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  const current = page.locator('.pdf-page-wrap[data-page="1"] .textLayer span.tts-current');
  await expect(current.first()).toContainText('Chapter one');
  await page.evaluate(() => window.__advance());
  await expect(current.first()).toContainText('quick brown fox', { timeout: 3000 });
  await expect(current).toHaveCount(1);
  await page.click('#read-aloud-btn');
  await expect(page.locator('.textLayer span.tts-current')).toHaveCount(0);
});

test('popover Speak path (speech.speak) uses sentences and the chosen rate', async ({ page }) => {
  await page.addInitScript(stub);
  await freshApp(page);
  await page.evaluate(() => localStorage.setItem('booknest-tts', JSON.stringify({ voiceURI: '', rate: 1.2, pitch: 1.1 })));
  await page.evaluate(async () => { const m = await import('./js/speech.js'); m.speak('One here. Two there.'); });
  await expect.poll(() => texts(page)).toEqual(['One here.', 'Two there.']);
  for (const u of await spoken(page)) { expect(u.rate).toBe(1.2); expect(u.pitch).toBe(1.1); }
});
