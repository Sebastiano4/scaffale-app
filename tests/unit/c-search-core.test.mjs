import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOccurrences } from '../../js/search-core.js';

const idx = new Map([
  [3, 'The end of the nest story.'],
  [2, 'A bird builds a nest. The nest is warm.  Every NEST is different.'],
  [1, 'Nothing here.'],
]);

test('finds every occurrence, ordered by page', () => {
  const r = findOccurrences(idx, 'nest');
  assert.deepEqual(r.map((o) => o.page), [2, 2, 2, 3]);
  assert.equal(r[2].match, 'NEST');
});

test('context is trimmed with ellipses', () => {
  const r = findOccurrences(new Map([[1, 'x'.repeat(100) + 'needle' + 'y'.repeat(100)]]), 'needle', 10);
  assert.equal(r[0].before, '…' + 'x'.repeat(10));
  assert.equal(r[0].after, 'y'.repeat(10) + '…');
});

test('empty or whitespace query → no results', () => {
  assert.deepEqual(findOccurrences(idx, '   '), []);
});

test('whitespace in text is normalized', () => {
  assert.equal(findOccurrences(new Map([[1, 'a   b']]), 'a b').length, 1);
});
