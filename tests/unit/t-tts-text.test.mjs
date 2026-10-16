import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPageText, splitSentences, detectRepeatedLines, linesFromItems, endsSentence,
} from '../../js/tts-text.js';

const words = (s) => s.split(/\s+/).filter(Boolean);

/* ---- cleanPageText ---- */

test('joins hyphenated line breaks', () => {
  assert.equal(cleanPageText('era un uomo libe-\nro e felice.'), 'era un uomo libero e felice.');
});

test('keeps a hyphen before a capitalized continuation (compound), no space', () => {
  assert.equal(cleanPageText('the Franco-\nGerman border.'), 'the Franco-German border.');
});

test('collapses single line breaks into spaces', () => {
  assert.equal(cleanPageText('The cat sat\non the mat\nall day long.'), 'The cat sat on the mat all day long.');
});

test('keeps paragraph breaks on blank lines', () => {
  assert.equal(cleanPageText('First paragraph ends.\n\nSecond one starts\nhere.'),
    'First paragraph ends.\n\nSecond one starts here.');
});

test('a short line ending a sentence followed by a capitalized line is a paragraph end', () => {
  const raw = [
    'This is a fairly long line of prose that fills the',
    'whole width of the page and then it ends.',
    'Short last line.',
    'A new paragraph begins on this long line of the page',
    'and continues here.',
  ].join('\n');
  const out = cleanPageText(raw);
  assert.equal(out.split('\n\n').length, 2);
  assert.ok(out.split('\n\n')[0].endsWith('Short last line.'));
});

test('an indented line after a sentence end starts a paragraph', () => {
  const raw = 'A line that ends a sentence right at the margin.\n  Indented new paragraph here.';
  assert.equal(cleanPageText(raw), 'A line that ends a sentence right at the margin.\n\nIndented new paragraph here.');
});

test('a full-width line ending with a period followed by a capital is NOT a paragraph', () => {
  const raw = 'This line is long and ends exactly with a period.\nThen the paragraph goes on with more words.';
  assert.equal(cleanPageText(raw).includes('\n\n'), false);
});

test('a short heading line becomes its own paragraph', () => {
  const out = cleanPageText('Chapter one\nThe quick brown fox jumps over the lazy dog.');
  assert.equal(out, 'Chapter one\n\nThe quick brown fox jumps over the lazy dog.');
});

test('drops lone page numbers', () => {
  assert.equal(cleanPageText('42\nSome text here.\n- 43 -'), 'Some text here.');
  assert.equal(cleanPageText('Some text here.\nxii'), 'Some text here.');
});

test('drops repeated header/footer lines (digits normalized)', () => {
  const repeated = detectRepeatedLines([
    ['THE LONG NOVEL 10', 'body a.'], ['THE LONG NOVEL 11', 'body b.'], ['THE LONG NOVEL 12', 'body c.'],
  ]);
  assert.equal(cleanPageText('THE LONG NOVEL 99\nReal text of the page.', { repeatedLines: repeated }), 'Real text of the page.');
});

test('prevPageTail is prepended (and hyphen-joined)', () => {
  assert.equal(cleanPageText('the next page.', { prevPageTail: 'This goes on' }), 'This goes on the next page.');
  assert.equal(cleanPageText('ro and more.', { prevPageTail: 'he was libe-' }), 'he was libero and more.');
});

test('empty input gives empty string', () => {
  assert.equal(cleanPageText(''), '');
  assert.equal(cleanPageText('  \n 12 \n'), '');
});

/* ---- detectRepeatedLines ---- */

test('detectRepeatedLines needs >= 3 pages and only looks at page edges', () => {
  const two = detectRepeatedLines([['Header', 'x.'], ['Header', 'y.']]);
  assert.equal(two.size, 0);
  const pages = [
    ['Header', 'one.', 'a.', 'Same body line.', 'b.', 'two.'],
    ['Header', 'three.', 'c.', 'Same body line.', 'd.', 'four.'],
    ['Header', 'five.', 'e.', 'Same body line.', 'f.', 'six.'],
  ];
  const r = detectRepeatedLines(pages);
  assert.ok(r.has('header'));
  assert.equal(r.has('same body line.'), false);
});

/* ---- splitSentences ---- */

test('splits into sentences with paragraphEnd flags', () => {
  const out = splitSentences('One here. Two there!\n\nThree now? Four.');
  assert.deepEqual(out, [
    { text: 'One here.', paragraphEnd: false },
    { text: 'Two there!', paragraphEnd: true },
    { text: 'Three now?', paragraphEnd: false },
    { text: 'Four.', paragraphEnd: true },
  ]);
});

test('does not split after common abbreviations or initials', () => {
  const out = splitSentences('Mr. Smith met J. R. Tolkien, e.g. at noon. Then left.');
  assert.deepEqual(out.map((s) => s.text), ['Mr. Smith met J. R. Tolkien, e.g. at noon.', 'Then left.']);
});

test('closing quotes stay with their sentence', () => {
  const out = splitSentences('He said "Go home." She left.');
  assert.deepEqual(out.map((s) => s.text), ['He said "Go home."', 'She left.']);
});

test('long sentence is split at commas, never mid-word, each <= max', () => {
  const clause = 'the river ran slowly past the old mill and the fields';
  const sentence = Array.from({ length: 8 }, () => clause).join(', ') + '.';
  assert.ok(sentence.length > 400);
  const out = splitSentences(sentence, 220);
  assert.ok(out.length >= 2);
  for (const p of out) {
    assert.ok(p.text.length <= 220, 'too long: ' + p.text.length);
    assert.ok(p.text.endsWith(',') || p.text.endsWith('.'), 'should cut at a comma: ' + p.text);
  }
  assert.deepEqual(words(out.map((p) => p.text).join(' ')), words(sentence));
  assert.deepEqual(out.map((p) => p.paragraphEnd), out.map((_, i) => i === out.length - 1));
});

test('semicolons are preferred over commas', () => {
  const a = 'alpha beta, gamma delta '.repeat(5).trim();
  const sentence = a + '; ' + a + ', ' + a + '.';
  const out = splitSentences(sentence, 220);
  assert.ok(out[0].text.endsWith(';'), out[0].text);
});

test('without punctuation a long sentence splits on word boundaries', () => {
  const sentence = Array.from({ length: 120 }, (_, i) => 'word' + i).join(' ') + '.';
  const out = splitSentences(sentence, 220);
  for (const p of out) assert.ok(p.text.length <= 220 && /^word\d/.test(p.text));
  assert.deepEqual(words(out.map((p) => p.text).join(' ')), words(sentence));
});

test('empty text gives no sentences', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences(' \n\n '), []);
});

test('endsSentence', () => {
  assert.equal(endsSentence('Done.'), true);
  assert.equal(endsSentence('Really?»'), true);
  assert.equal(endsSentence('goes on'), false);
  assert.equal(endsSentence('goes on,'), false);
});

/* ---- linesFromItems (pdf.js text items -> lines) ---- */

test('linesFromItems groups items by hasEOL and marks blank gaps and indents', () => {
  const it = (str, x, y, hasEOL = false) => ({ str, hasEOL, transform: [12, 0, 0, 12, x, y], height: 12 });
  const items = [
    it('First line ', 72, 700), it('of text.', 140, 700, true),
    it('Second line.', 72, 686, true),
    it('After a gap.', 72, 640, true),
    it('Indented line.', 100, 626, true),
  ];
  assert.deepEqual(linesFromItems(items), ['First line of text.', 'Second line.', '', 'After a gap.', '  Indented line.']);
});
