import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords, wordAt, sentenceBounds } from '../../js/word-geometry.js';

test('splitWords finds words with offsets, keeping apostrophes and accents', () => {
  const ws = splitWords("L'amico è qui, no?");
  assert.deepEqual(ws.map((w) => w.word), ["L'amico", 'è', 'qui', 'no']);
  assert.deepEqual([ws[0].start, ws[0].end], [0, 7]);
  assert.deepEqual([ws[3].start, ws[3].end], [15, 17]);
});

test('wordAt returns the word under an offset, or the nearest one in a gap', () => {
  const t = 'quick  brown fox';
  assert.equal(wordAt(t, 8).word, 'brown');
  assert.equal(wordAt(t, 5).word, 'quick'); // gap right after "quick"
  assert.equal(wordAt(t, 6).word, 'brown'); // gap right before "brown"
  assert.equal(wordAt('', 0), null);
});

test('sentenceBounds picks the sentence around an index', () => {
  const t = 'A bird builds a nest. The nest is warm. Every nest is different.';
  const at = (word) => t.slice(...Object.values(sentenceBounds(t, t.indexOf(word))));
  assert.equal(at('builds'), 'A bird builds a nest.');
  assert.equal(at('warm'), 'The nest is warm.');
  assert.equal(at('different'), 'Every nest is different.');
});

test('sentenceBounds keeps closing quotes and stops at paragraph breaks', () => {
  const t = 'Chapter two\n\nHe said "go away!" Then left.';
  const s1 = sentenceBounds(t, t.indexOf('said'));
  assert.equal(t.slice(s1.start, s1.end), 'He said "go away!"');
  const s0 = sentenceBounds(t, t.indexOf('two'));
  assert.equal(t.slice(s0.start, s0.end), 'Chapter two');
});

test('sentenceBounds does not split on abbreviations like "e.g." or initials mid-word', () => {
  const t = 'Use tools e.g. hammers. Next one.';
  const s = sentenceBounds(t, t.indexOf('hammers'));
  assert.equal(t.slice(s.start, s.end), 'Use tools e.g. hammers.');
});

test('nearestRect: the closest box, same line preferred, null when too far', async () => {
  const { nearestRect } = await import('../../js/word-geometry.js');
  const R = (left, top, right, bottom) => ({ left, top, right, bottom });
  const boxes = [R(0, 0, 100, 20), R(110, 0, 200, 20), R(0, 30, 100, 50)];
  assert.equal(nearestRect(boxes, 50, 10, 30), 0);        // inside
  assert.equal(nearestRect(boxes, 225, 10, 30), 1);       // past the line end → last box of that line
  assert.equal(nearestRect(boxes, 50, 24, 30), 0);        // gap between lines, closer to the upper one
  assert.equal(nearestRect(boxes, 50, 27, 30), 2);
  assert.equal(nearestRect(boxes, 150, 26, 30), 1);       // same distance-ish: vertical counts double
  assert.equal(nearestRect(boxes, 400, 400, 30), null);   // nothing near
  assert.equal(nearestRect([], 0, 0, 30), null);
});
