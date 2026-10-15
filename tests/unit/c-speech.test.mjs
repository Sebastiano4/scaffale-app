import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitForSpeech } from '../../js/speech.js';

const words = (s) => s.split(/\s+/).filter(Boolean);

test('splits on sentence punctuation', () => {
  const text = 'First sentence here. Second one! Is this the third? Yes.';
  const chunks = splitForSpeech(text, 25);
  assert.deepEqual(chunks, ['First sentence here.', 'Second one!', 'Is this the third? Yes.']);
});

test('packs short sentences together up to max', () => {
  assert.deepEqual(splitForSpeech('One. Two. Three.'), ['One. Two. Three.']);
});

test('hard-wraps a 1000-char sentence at word boundaries', () => {
  const sentence = Array.from({ length: 200 }, (_, i) => 'w' + (i % 10) + 'xy').join(' ') + '.';
  assert.ok(sentence.length >= 1000);
  const chunks = splitForSpeech(sentence, 200);
  assert.ok(chunks.length >= 5);
  for (const c of chunks) {
    assert.ok(c.length <= 200, 'chunk too long: ' + c.length);
    assert.equal(c, c.trim());
    assert.match(c, /^w\d/); // starts on a word boundary
  }
  assert.deepEqual(words(chunks.join(' ')), words(sentence));
});

test('every chunk <= max and all words preserved on mixed text', () => {
  const long = 'lorem ipsum dolor sit amet '.repeat(60);
  const text = 'Short intro. ' + long + 'end. Another sentence follows!   And   a last one';
  for (const max of [50, 120, 200]) {
    const chunks = splitForSpeech(text, max);
    for (const c of chunks) assert.ok(c.length > 0 && c.length <= max);
    assert.deepEqual(words(chunks.join(' ')), words(text));
  }
});

test('a single word longer than max is cut, nothing lost', () => {
  const w = 'x'.repeat(450);
  const chunks = splitForSpeech('Hi. ' + w + ' bye', 200);
  for (const c of chunks) assert.ok(c.length <= 200);
  assert.equal(chunks.join('').replace(/\s+/g, ''), ('Hi.' + w + 'bye'));
});

test('empty / whitespace text gives no chunks', () => {
  assert.deepEqual(splitForSpeech(''), []);
  assert.deepEqual(splitForSpeech('   \n '), []);
});
