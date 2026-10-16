import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultVoice, sortVoices, guessLanguage, normalizeSettings, sameLang } from '../../js/tts-voices.js';

const v = (name, lang, localService = true, extra = {}) => ({ name, lang, voiceURI: name, localService, ...extra });

test('prefers a natural/online voice of the same language', () => {
  const voices = [
    v('English Basic', 'en-US', true, { default: true }),
    v('Google italiano', 'it-IT', false),
    v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
    v('Samantha', 'en-US'),
  ];
  assert.equal(pickDefaultVoice(voices, 'en-US').name, 'Microsoft Aria Online (Natural) - English (United States)');
  assert.equal(pickDefaultVoice(voices, 'it').name, 'Google italiano');
});

test('same language beats a natural voice of another language', () => {
  const voices = [v('Google UK English Female', 'en-GB', false), v('Alice', 'it-IT')];
  assert.equal(pickDefaultVoice(voices, 'it-IT').name, 'Alice');
});

test('exact region preferred among equally good voices; android-style underscores accepted', () => {
  const voices = [v('Google English GB', 'en_GB', false), v('Google English US', 'en_US', false)];
  assert.equal(pickDefaultVoice(voices, 'en-US').name, 'Google English US');
});

test('no voice of the language: null (the engine then picks by utterance lang)', () => {
  assert.equal(pickDefaultVoice([v('A', 'de-DE'), v('B', 'fr-FR', true, { default: true })], 'it'), null);
  assert.equal(pickDefaultVoice([], 'it'), null);
});

test('sortVoices puts the language first, best first, then the rest by name', () => {
  const voices = [v('Zed', 'de-DE'), v('Basic', 'en-US'), v('Aaa', 'fr-FR'), v('Google US English', 'en-US', false)];
  const { same, other } = sortVoices(voices, 'en');
  assert.deepEqual(same.map((x) => x.name), ['Google US English', 'Basic']);
  assert.deepEqual(other.map((x) => x.name), ['Aaa', 'Zed']);
});

test('sameLang compares the base language', () => {
  assert.ok(sameLang('it-IT', 'it'));
  assert.ok(sameLang('en_GB', 'en-US'));
  assert.ok(!sameLang('es-ES', 'en-US'));
});

test('guessLanguage from stopwords', () => {
  assert.equal(guessLanguage('Il gatto era sul tavolo e la casa non era di nessuno, che peccato per il cane.'), 'it');
  assert.equal(guessLanguage('The cat was on the table and the house was not of anyone, that is what it is.'), 'en');
  assert.equal(guessLanguage('Le chat est sur la table et la maison ne est pas à nous, les enfants sont dans le jardin.'), 'fr');
  assert.equal(guessLanguage('Der Hund ist nicht in dem Haus und die Katze ist mit der Frau auf dem Tisch.'), 'de');
  assert.equal(guessLanguage('El perro no está en la casa y los niños que son de mi hermano están con el gato.'), 'es');
  assert.equal(guessLanguage('12 34 56'), null);
});

test('normalizeSettings clamps and defaults', () => {
  assert.deepEqual(normalizeSettings(null), { voiceURI: '', rate: 1, pitch: 1 });
  assert.deepEqual(normalizeSettings({ voiceURI: 'x', rate: 9, pitch: 0.1 }), { voiceURI: 'x', rate: 1.5, pitch: 0.8 });
  assert.deepEqual(normalizeSettings({ rate: 'abc', pitch: 1.1 }), { voiceURI: '', rate: 1, pitch: 1.1 });
});
