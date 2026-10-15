import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, bookFilePath, validateManifest, mergeStats } from '../../js/backup-format.js';

test('buildManifest strips blobs and references files', () => {
  const m = buildManifest([{ id: 'a1', title: 'T', fileBlob: {} }], { days: {} }, null, 5);
  assert.equal(m.version, 2);
  assert.equal(m.exportedAt, 5);
  assert.deepEqual(m.books, [{ id: 'a1', title: 'T', file: 'books/a1.pdf' }]);
  assert.equal(bookFilePath('a1'), 'books/a1.pdf');
});

test('validateManifest', () => {
  assert.throws(() => validateManifest({ app: 'X', books: [] }), /invalid backup/);
  assert.doesNotThrow(() => validateManifest({ app: 'BookNest', books: [] }));
});

test('mergeStats keeps per-day maximum', () => {
  const cur = { days: { d1: { pages: 5, seconds: 10 } } };
  const inc = { days: { d1: { pages: 3, seconds: 50 }, d2: { pages: 1 } } };
  assert.deepEqual(mergeStats(cur, inc).days, {
    d1: { pages: 5, seconds: 50 }, d2: { pages: 1, seconds: 0 },
  });
});
