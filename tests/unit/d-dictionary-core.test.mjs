import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordKey, isDictionarySelection, addWord, allEntries, filterEntries, toMarkdown, MAX_CONTEXTS } from '../../js/dictionary-core.js';

test('wordKey: lowercase, NFC, no edge punctuation or quotes', () => {
  assert.equal(wordKey('  «Sgomenti», '), 'sgomenti');
  assert.equal(wordKey('Perché?'), 'perché');
  assert.equal(wordKey("l'uomo"), "l'uomo");
  assert.equal(wordKey('a  bruciapelo'), 'a bruciapelo');
  assert.equal(wordKey('café'), 'café');
});

test('isDictionarySelection: 1 to 3 words, not too long', () => {
  assert.equal(isDictionarySelection('sgomento'), true);
  assert.equal(isDictionarySelection('a bruciapelo'), true);
  assert.equal(isDictionarySelection('uno due tre'), true);
  assert.equal(isDictionarySelection('uno due tre quattro'), false);
  assert.equal(isDictionarySelection('  '), false);
  assert.equal(isDictionarySelection('…'), false);
  assert.equal(isDictionarySelection('x'.repeat(50)), false);
});

test('addWord creates an entry, then merges repeats into contexts', () => {
  const book = { id: 'b1' };
  const r1 = addWord(book, { word: 'Sgomento,', lang: 'it', page: 3, sentence: 'Lo sgomento era grande.' }, 100);
  assert.equal(r1.created, true);
  assert.equal(book.words.length, 1);
  const e = book.words[0];
  assert.equal(e.word, 'Sgomento');
  assert.equal(e.key, 'sgomento');
  assert.equal(e.status, 'pending');
  assert.deepEqual(e.senses, []);
  assert.deepEqual(e.contexts, [{ page: 3, sentence: 'Lo sgomento era grande.' }]);

  const r2 = addWord(book, { word: 'sgomento', lang: 'it', page: 9, sentence: 'Altro sgomento.' }, 200);
  assert.equal(r2.created, false);
  assert.equal(r2.entry, e);
  assert.equal(book.words.length, 1);
  assert.equal(e.contexts.length, 2);
  assert.equal(e.updatedAt, 200);

  // same page + sentence is not added twice
  addWord(book, { word: 'sgomento', page: 9, sentence: 'Altro sgomento.' }, 300);
  assert.equal(e.contexts.length, 2);
});

test('addWord keeps at most MAX_CONTEXTS contexts (the most recent)', () => {
  const book = {};
  for (let i = 1; i <= MAX_CONTEXTS + 2; i++) addWord(book, { word: 'casa', page: i, sentence: 's' + i }, i);
  const ctx = book.words[0].contexts;
  assert.equal(ctx.length, MAX_CONTEXTS);
  assert.equal(ctx[ctx.length - 1].page, MAX_CONTEXTS + 2);
});

test('allEntries + filterEntries: alphabetical, search in word/lemma/senses, filter by book', () => {
  const books = [
    { id: 'a', title: 'Alpha', words: [
      { id: '1', word: 'zeta', key: 'zeta', lemma: null, senses: ['lettera greca'], contexts: [] },
      { id: '2', word: 'Andavano', key: 'andavano', lemma: 'andare', senses: ['muoversi'], contexts: [] },
    ] },
    { id: 'b', title: 'Beta', words: [{ id: '3', word: 'èbano', key: 'èbano', lemma: null, senses: ['legno scuro'], contexts: [] }] },
    { id: 'c', title: 'Gamma' },
  ];
  const all = allEntries(books);
  assert.deepEqual(all.map((x) => x.entry.word), ['Andavano', 'èbano', 'zeta']);
  assert.equal(all[0].book.title, 'Alpha');
  assert.deepEqual(filterEntries(all, { query: 'ANDARE' }).map((x) => x.entry.id), ['2']);
  assert.deepEqual(filterEntries(all, { query: 'legno' }).map((x) => x.entry.id), ['3']);
  assert.deepEqual(filterEntries(all, { bookId: 'a' }).map((x) => x.entry.id), ['2', '1']);
  assert.equal(filterEntries(all, {}).length, 3);
});

test('toMarkdown groups by first letter and lists senses + context', () => {
  const books = [{ id: 'a', title: 'Alpha', words: [
    { id: '1', word: 'sgomenti', key: 'sgomenti', lemma: 'sgomento', pos: 'Aggettivo', senses: ['che esprime smarrimento'], contexts: [{ page: 4, sentence: 'Erano sgomenti.' }] },
    { id: '2', word: 'casa', key: 'casa', lemma: null, pos: null, senses: [], contexts: [] },
  ] }];
  const md = toMarkdown(allEntries(books), 'Dictionary');
  assert.match(md, /^# Dictionary/);
  assert.match(md, /## C\n/);
  assert.match(md, /## S\n/);
  assert.match(md, /\*\*sgomenti\*\* → \*sgomento\* · Aggettivo/);
  assert.match(md, /1\. che esprime smarrimento/);
  assert.match(md, /> Erano sgomenti\. — \*Alpha\*, p\. 4/);
  assert.match(md, /\*\*casa\*\*\n_\(no definition\)_/);
  assert.ok(md.indexOf('## C') < md.indexOf('## S'));
});
