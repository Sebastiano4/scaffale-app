import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessFromFilename, titleCase } from '../../js/metadata.js';

test('titleCase', () => {
  assert.equal(titleCase('the GREAT gatsby'), 'The Great Gatsby');
});

test('guessFromFilename: "Author - Title"', () => {
  assert.deepEqual(guessFromFilename('Italo Calvino - le citta invisibili.pdf'),
    { title: 'Le Citta Invisibili', author: 'Italo Calvino' });
});

test('guessFromFilename: plain name', () => {
  assert.deepEqual(guessFromFilename('my_notes.pdf'), { title: 'My Notes', author: '' });
});
