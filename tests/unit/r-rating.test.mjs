import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRating, starFills, ratingLabel } from '../../js/rating.js';

test('normalizeRating keeps half steps between 0.5 and 5', () => {
  assert.equal(normalizeRating(3.5), 3.5);
  assert.equal(normalizeRating(4), 4);
  assert.equal(normalizeRating(3.26), 3.5);
  assert.equal(normalizeRating(7), 5);
  assert.equal(normalizeRating(0), 0);
  assert.equal(normalizeRating(undefined), 0);
  assert.equal(normalizeRating('2.5'), 2.5);
});

test('starFills gives full / half / empty for the five stars', () => {
  assert.deepEqual(starFills(3.5), ['full', 'full', 'full', 'half', 'empty']);
  assert.deepEqual(starFills(4), ['full', 'full', 'full', 'full', 'empty']);
  assert.deepEqual(starFills(0.5), ['half', 'empty', 'empty', 'empty', 'empty']);
  assert.deepEqual(starFills(0), ['empty', 'empty', 'empty', 'empty', 'empty']);
});

test('ratingLabel reads naturally', () => {
  assert.equal(ratingLabel(3.5), '3.5 stars');
  assert.equal(ratingLabel(1), '1 star');
  assert.equal(ratingLabel(0), 'No rating');
});
