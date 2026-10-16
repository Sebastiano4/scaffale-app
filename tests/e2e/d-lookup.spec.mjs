// Wiktionary parsing + lookup, run in the browser (DOMParser) against saved real responses.
import { test, expect } from '@playwright/test';
import { mockWiktionary } from './wiktionary-mock.mjs';

let wk;
test.beforeEach(async ({ page }) => {
  wk = await mockWiktionary(page);
  await page.goto('index.html');
});

const lookup = (page, word, lang) => page.evaluate(async ({ word, lang }) => {
  const m = await import('./js/dictionary-lookup.js');
  return m.lookupWord(word, lang);
}, { word, lang });

test('Italian word: senses from the Italian section, examples stripped, part of speech', async ({ page }) => {
  const r = await lookup(page, 'sgomento', 'it');
  expect(r.status).toBe('ok');
  expect(r.source).toBe('wiktionary-it');
  expect(r.pos).toBe('Aggettivo');
  expect(r.senses[0]).toBe('che esprime o denota smarrimento');
  expect(r.lemma).toBeNull();
});

test('Italian: several leading labels collapse to the first one, at most 3 senses', async ({ page }) => {
  const r = await lookup(page, 'malinconia', 'it');
  expect(r.pos).toBe('Sostantivo');
  expect(r.senses[0]).toBe('(psicologia) stato di costante malumore');
  expect(r.senses.length).toBeLessThanOrEqual(3);
});

test('Italian inflected forms follow the pointer to the base word', async ({ page }) => {
  const plural = await lookup(page, 'sgomenti', 'it');
  expect(plural.status).toBe('ok');
  expect(plural.lemma).toBe('sgomento');
  expect(plural.senses[0]).toBe('che esprime o denota smarrimento');

  const verb = await lookup(page, 'andavano', 'it');
  expect(verb.lemma).toBe('andare');
  expect(verb.pos).toMatch(/Verbo/i);
  expect(verb.senses.length).toBeGreaterThan(0);
  expect(verb.senses[0]).not.toMatch(/persona plurale/);
});

test('capitalised word at a sentence start is looked up in lowercase', async ({ page }) => {
  const r = await lookup(page, 'Malinconia', 'it');
  expect(r.status).toBe('ok');
  expect(r.senses[0]).toContain('malumore');
});

test('English: REST definitions, "plural of" follows the base word', async ({ page }) => {
  const r = await lookup(page, 'dismay', 'en');
  expect(r.status).toBe('ok');
  expect(r.source).toBe('wiktionary-en');
  expect(r.senses[0]).not.toMatch(/</);
  expect(r.senses[0].length).toBeGreaterThan(3);

  const dogs = await lookup(page, 'dogs', 'en');
  expect(dogs.lemma).toBe('dog');
  expect(dogs.senses[0]).not.toMatch(/plural of/);
});

test('not found anywhere → notfound; network down → pending', async ({ page }) => {
  expect((await lookup(page, 'xqzzyw', 'it')).status).toBe('notfound');
  expect(wk.calls).toEqual(expect.arrayContaining(['it:xqzzyw', 'en:xqzzyw']));
  wk.offline = true;
  expect((await lookup(page, 'sgomento', 'it')).status).toBe('pending');
});
