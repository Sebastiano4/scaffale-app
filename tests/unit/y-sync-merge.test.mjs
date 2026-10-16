import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampChanges, mergeBook, mergeLibrary, toRemoteRecord } from '../../js/sync-merge.js';

const base = () => ({
  id: 'L1', hash: 'h1', title: 'T', author: 'A', addedAt: 100, lastPage: 1, lastOpenedAt: 0,
  bookmarks: [], quotes: [], words: [], filename: 'f.pdf', numPages: 10, thumbnail: 'data:x',
});

test('stampChanges: a new book gets meta and pos stamps', () => {
  const b = base();
  assert.equal(stampChanges(null, b, 500), true);
  assert.deepEqual(b._t, { meta: 500, pos: 500 });
});

test('stampChanges: only the group that changed is stamped', () => {
  const old = { ...base(), _t: { meta: 1, pos: 2 } };
  const next = { ...structuredClone(old), lastPage: 7 };
  assert.equal(stampChanges(old, next, 900), true);
  assert.deepEqual(next._t, { meta: 1, pos: 900 });
  const next2 = { ...structuredClone(old), rating: 4.5 };
  stampChanges(old, next2, 950);
  assert.deepEqual(next2._t, { meta: 950, pos: 2 });
});

test('stampChanges: nothing sync-relevant changed → false, stamps untouched', () => {
  const old = { ...base(), _t: { meta: 1, pos: 2 } };
  const next = structuredClone(old);
  next.fileBlob = { fake: true };
  assert.equal(stampChanges(old, next, 900), false);
  assert.deepEqual(next._t, { meta: 1, pos: 2 });
});

test('stampChanges: list items get _t when added or edited, tombstones when removed', () => {
  const old = { ...base(), _t: { meta: 1, pos: 1 }, quotes: [{ id: 'q1', text: 'a', _t: 5 }, { id: 'q2', text: 'b', _t: 6 }] };
  const next = structuredClone(old);
  next.quotes[0].note = 'edited';
  next.quotes.splice(1, 1);
  next.quotes.push({ id: 'q3', text: 'c' });
  assert.equal(stampChanges(old, next, 1000), true);
  assert.equal(next.quotes[0]._t, 1000);
  assert.equal(next.quotes[1]._t, 1000);
  assert.deepEqual(next._gone, { quotes: { q2: 1000 } });
});

test('stampChanges: unchanged items keep their _t; old tombstones survive a stale write', () => {
  const old = { ...base(), words: [{ id: 'w1', word: 'x', _t: 5 }], _gone: { quotes: { q9: 3 } } };
  const next = { ...base(), words: [{ id: 'w1', word: 'x' }] }; // stale copy without _t/_gone
  stampChanges(old, next, 1000);
  assert.equal(next.words[0]._t, 5);
  assert.deepEqual(next._gone, { quotes: { q9: 3 } });
});

test('mergeBook: newer meta and newer position win independently', () => {
  const local = { ...base(), title: 'Local', lastPage: 50, _t: { meta: 10, pos: 300 } };
  const remote = { ...base(), id: 'R1', title: 'Remote', rating: 4, lastPage: 20, _t: { meta: 200, pos: 100 } };
  const m = mergeBook(local, remote);
  assert.equal(m.id, 'L1');
  assert.equal(m.title, 'Remote');
  assert.equal(m.rating, 4);
  assert.equal(m.lastPage, 50);
  assert.deepEqual(m._t, { meta: 200, pos: 300 });
});

test('mergeBook: a field removed on the winning side is removed', () => {
  const local = { ...base(), rating: 3, _t: { meta: 10, pos: 1 } };
  const remote = { ...base(), _t: { meta: 20, pos: 1 } };
  assert.equal('rating' in mergeBook(local, remote), false);
});

test('mergeBook: lists are unioned, newer item wins, tombstones drop items', () => {
  const local = { ...base(), _t: { meta: 1, pos: 1 },
    quotes: [{ id: 'q1', text: 'a', note: 'old', _t: 5 }, { id: 'q2', text: 'b', _t: 5 }] };
  const remote = { ...base(), _t: { meta: 1, pos: 1 },
    quotes: [{ id: 'q1', text: 'a', note: 'new', _t: 9 }, { id: 'q3', text: 'c', _t: 7 }],
    _gone: { quotes: { q2: 8 } } };
  const m = mergeBook(local, remote);
  assert.deepEqual(m.quotes.map((q) => q.id), ['q1', 'q3']);
  assert.equal(m.quotes[0].note, 'new');
  assert.deepEqual(m._gone, { quotes: { q2: 8 } });
});

test('mergeBook: an item edited after its tombstone survives', () => {
  const local = { ...base(), words: [{ id: 'w1', word: 'x', _t: 20 }] };
  const remote = { ...base(), _gone: { words: { w1: 10 } } };
  assert.equal(mergeBook(local, remote).words.length, 1);
});

test('mergeBook: books without stamps fall back to lastOpenedAt for the position', () => {
  const local = { ...base(), lastPage: 3, lastOpenedAt: 50 };
  const remote = { ...base(), lastPage: 9, lastOpenedAt: 80 };
  assert.equal(mergeBook(local, remote).lastPage, 9);
});

test('mergeLibrary: books from each side reach the other; ids stay local', () => {
  const local = [{ ...base(), _t: { meta: 1, pos: 1 } }];
  const remote = { books: { h2: { ...base(), id: 'R2', hash: 'h2', title: 'Other', _t: { meta: 1, pos: 1 } } }, deleted: {} };
  const r = mergeLibrary({ books: local, deleted: {} }, remote);
  assert.deepEqual(r.create.map((b) => b.hash), ['h2']);
  assert.equal(r.create[0].id, 'R2');
  assert.equal(r.update.length, 0);
  assert.deepEqual(Object.keys(r.remote.books).sort(), ['h1', 'h2']);
  assert.equal(r.remoteChanged, true);
});

test('mergeLibrary: same content on both sides → nothing to do', () => {
  const b = { ...base(), _t: { meta: 1, pos: 1 } };
  const r = mergeLibrary({ books: [b], deleted: {} }, { books: { h1: toRemoteRecord({ ...b, id: 'R9' }) }, deleted: {} });
  assert.equal(r.create.length + r.update.length + r.remove.length, 0);
  assert.equal(r.remoteChanged, false);
});

test('mergeLibrary: a remote deletion removes the local copy; a later re-add survives', () => {
  const b = { ...base(), addedAt: 5, _t: { meta: 10, pos: 10 } };
  const r = mergeLibrary({ books: [b], deleted: {} }, { books: {}, deleted: { h1: 50 } });
  assert.deepEqual(r.remove.map((x) => x.id), ['L1']);
  assert.equal(r.remote.books.h1, undefined);
  assert.equal(r.deleted.h1, 50);

  const readded = { ...base(), addedAt: 100, _t: { meta: 100, pos: 100 } };
  const r2 = mergeLibrary({ books: [readded], deleted: {} }, { books: {}, deleted: { h1: 50 } });
  assert.equal(r2.remove.length, 0);
  assert.ok(r2.remote.books.h1);
  assert.equal(r2.deleted.h1, undefined);
});

test('mergeLibrary: a local deletion removes the book from remote', () => {
  const remoteRec = toRemoteRecord({ ...base(), addedAt: 5, _t: { meta: 10, pos: 10 } });
  const r = mergeLibrary({ books: [], deleted: { h1: 50 } }, { books: { h1: remoteRec }, deleted: {} });
  assert.equal(r.create.length, 0);
  assert.equal(r.remote.books.h1, undefined);
  assert.equal(r.remoteChanged, true);
});

test('mergeLibrary: stats keep the max per day, goal the newest', () => {
  const r = mergeLibrary(
    { books: [], deleted: {}, stats: { days: { d1: { pages: 5, seconds: 10 } } }, goal: { target: 10, savedAt: 1 } },
    { books: {}, deleted: {}, stats: { days: { d1: { pages: 2, seconds: 99 }, d2: { pages: 1, seconds: 1 } } }, goal: { target: 20, savedAt: 2 } },
  );
  assert.deepEqual(r.stats.days, { d1: { pages: 5, seconds: 99 }, d2: { pages: 1, seconds: 1 } });
  assert.equal(r.goal.target, 20);
});

test('toRemoteRecord drops device-only fields', () => {
  const rec = toRemoteRecord({ ...base(), fileBlob: {}, remoteOnly: true });
  assert.equal('fileBlob' in rec, false);
  assert.equal('remoteOnly' in rec, false);
  assert.equal(rec.hash, 'h1');
});
