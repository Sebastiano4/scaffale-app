/* Voice choice + read-aloud settings (voice, speed, pitch) persisted in localStorage.
   The pure helpers (pickDefaultVoice, sortVoices, guessLanguage, normalizeSettings)
   are unit-tested in node; the rest touches window only when called. */

export const TTS_KEY = 'booknest-tts';
export const RATE = { min: 0.7, max: 1.5, def: 1 };
export const PITCH = { min: 0.8, max: 1.2, def: 1 };

const norm = (l) => String(l || '').replace(/_/g, '-').toLowerCase();
const base = (l) => norm(l).split('-')[0];
export const sameLang = (a, b) => !!base(a) && base(a) === base(b);

function score(v, lang) {
  let s = 0;
  if (/natural|neural/i.test(v.name)) s += 4;
  if (/google|online|enhanced|premium/i.test(v.name)) s += 2;
  if (v.localService === false) s += 2;
  if (norm(v.lang) === norm(lang) && norm(lang).includes('-')) s += 1;
  if (v.default) s += 0.5;
  return s;
}
const byScore = (lang) => (a, b) => score(b, lang) - score(a, lang) || a.name.localeCompare(b.name);

/* Best installed voice for `lang`: same language first, then natural/neural/online names. */
export function pickDefaultVoice(voices, lang) {
  const same = (voices || []).filter((v) => sameLang(v.lang, lang));
  if (!same.length) return null;
  return same.sort(byScore(lang))[0];
}

/* For the voice <select>: { same: book-language voices best first, other: the rest by name }. */
export function sortVoices(voices, lang) {
  const all = voices || [];
  return {
    same: all.filter((v) => sameLang(v.lang, lang)).sort(byScore(lang)),
    other: all.filter((v) => !sameLang(v.lang, lang)).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const STOPWORDS = {
  it: 'il lo la gli le di che e è non un una per con del della sono era nel alla anche come più',
  en: 'the and of to is was that it in with not for on he she what are be have this',
  fr: 'le la les et est des une un pas que dans sur nous ne pour sont du au qui il elle',
  de: 'der die das und ist nicht mit dem den ein eine auf zu ich sie es von sich auch',
  es: 'el la los las y que de no en un una está son con por del mi se lo como pero',
};
const STOP_SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, w]) => [k, new Set(w.split(' '))]));

/* Rough language of a text (it/en/fr/de/es) from stopword counts; null if unclear. */
export function guessLanguage(text) {
  const tokens = String(text || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).slice(0, 600);
  const counts = Object.keys(STOP_SETS).map((k) => [k, tokens.filter((t) => STOP_SETS[k].has(t)).length])
    .sort((a, b) => b[1] - a[1]);
  const [[best, n1], [, n2]] = counts;
  return n1 >= 3 && n1 > n2 * 1.3 ? best : null;
}

const clamp = (x, { min, max, def }) => {
  const n = Number(x);
  return Number.isFinite(n) && x !== null && x !== '' ? Math.min(max, Math.max(min, n)) : def;
};
export function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    voiceURI: typeof o.voiceURI === 'string' ? o.voiceURI : '',
    rate: clamp(o.rate, RATE),
    pitch: clamp(o.pitch, PITCH),
  };
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(TTS_KEY) || 'null')); }
  catch (e) { return normalizeSettings(null); }
}
export function saveSettings(patch) {
  const next = normalizeSettings({ ...loadSettings(), ...patch });
  try { localStorage.setItem(TTS_KEY, JSON.stringify(next)); } catch (e) { /* private mode: session only */ }
  return next;
}

/* ---- runtime (browser) ---- */
let bookLang = null; // guessed from the book's text; null → navigator.language
export function setBookLang(lang) { bookLang = lang || null; }
export function getBookLang() {
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  if (!bookLang) return nav;
  return sameLang(bookLang, nav) ? nav : bookLang; // keep the user's region when it matches
}

export function availableVoices() {
  try { return (window.speechSynthesis.getVoices() || []).slice(); } catch (e) { return []; }
}

/* Voices load asynchronously on Chrome/Android: resolve when the list is non-empty (or after timeout). */
export function whenVoicesReady(timeout = 1500) {
  return new Promise((resolve) => {
    const now = availableVoices();
    if (now.length || typeof window === 'undefined' || !window.speechSynthesis) { resolve(now); return; }
    const done = () => { clearTimeout(t); try { window.speechSynthesis.removeEventListener('voiceschanged', done); } catch (e) { /* stub */ } resolve(availableVoices()); };
    const t = setTimeout(done, timeout);
    try { window.speechSynthesis.addEventListener('voiceschanged', done); } catch (e) { /* stub without events */ }
  });
}

/* What the next utterance should use: chosen (or best) voice, language, rate, pitch. */
export function currentSpeechOptions() {
  const s = loadSettings();
  const voices = availableVoices();
  const lang = getBookLang();
  const voice = (s.voiceURI && voices.find((v) => v.voiceURI === s.voiceURI)) || pickDefaultVoice(voices, lang);
  return { voice: voice || null, lang: (voice && voice.lang) || lang, rate: s.rate, pitch: s.pitch };
}
