import { state } from './state.js';
import { $, showToast } from './dom.js';
import { goToPage } from './reader.js';
import {
  speak, speakQueue, stopSpeaking, unlockSpeech, speechSupported, PAUSE_SENTENCE,
} from './speech.js';
import { getPageLines, cleanPageText, splitSentences, detectRepeatedLines, endsSentence } from './tts-text.js';
import {
  loadSettings, saveSettings, sortVoices, pickDefaultVoice, availableVoices, whenVoicesReady,
  guessLanguage, setBookLang, getBookLang, currentSpeechOptions, RATE, PITCH,
} from './tts-voices.js';

const PLAY = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
const PAUSE = '<path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/>';
const MAX_EMPTY_PAGES = 3; // consecutive pages without text (scanned book?) before giving up
const SAMPLE_PAGES = 6; // pages sampled to spot running headers/footers and the language
let playing = false;
let session = 0; // generation token: callbacks from a previous play session are ignored
let pageTimer = null;

function setPlaying(on) {
  playing = on;
  const btn = $('#read-aloud-btn');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#read-aloud-icon').innerHTML = on ? PAUSE : PLAY;
}

/* ---- per-book info: repeated header/footer lines + language (sampled once per document) ---- */
const bookInfoCache = new WeakMap();
function bookInfo(pdfDoc, startPage) {
  if (bookInfoCache.has(pdfDoc)) return bookInfoCache.get(pdfDoc);
  const total = pdfDoc.numPages;
  const first = Math.max(1, Math.min(startPage, total - SAMPLE_PAGES + 1));
  const pages = [];
  for (let n = first; n <= Math.min(total, first + SAMPLE_PAGES - 1); n++) pages.push(n);
  const p = Promise.all(pages.map((n) => getPageLines(pdfDoc, n).catch(() => [])))
    .then((sample) => ({ repeated: detectRepeatedLines(sample), lang: guessLanguage(sample.flat().join(' ')) }))
    .catch(() => ({ repeated: new Set(), lang: null }));
  bookInfoCache.set(pdfDoc, p);
  return p;
}

/* ---- sentence highlight on the text layer ---- */
const normChars = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
let hlPage = 0;
let hlCursor = 0; // normalized offset reached on hlPage: a repeated sentence is found in order
let hlText = '';

function clearHighlight() {
  document.querySelectorAll('.tts-current').forEach((s) => s.classList.remove('tts-current'));
}

function scrollIntoViewIfNeeded(first, last) {
  const sc = $('#pdf-scroll');
  if (!sc) return;
  const sr = sc.getBoundingClientRect();
  const a = first.getBoundingClientRect();
  const b = last.getBoundingClientRect();
  if (a.top >= sr.top + 8 && b.bottom <= sr.bottom - 8) return;
  sc.scrollTo({ top: Math.max(0, sc.scrollTop + (a.top - sr.top) - sr.height / 3), behavior: 'smooth' });
}

/* Best effort: mark the spans of page n whose text overlaps the sentence. Matching ignores
   spaces, punctuation and case, so healed hyphens and joined lines still match. */
function highlightSentence(n, text, gen, tries = 0) {
  clearHighlight();
  hlText = text;
  const spans = [...document.querySelectorAll(`.pdf-page-wrap[data-page="${n}"] .textLayer span`)];
  if (!spans.length) { // page (or its text layer) not rendered yet: retry for a moment
    if (tries < 8) setTimeout(() => { if (gen === session && playing && hlText === text) highlightSentence(n, text, gen, tries + 1); }, 250);
    return;
  }
  let acc = '';
  const ranges = spans.map((sp) => {
    const t = normChars(sp.textContent);
    const r = [acc.length, acc.length + t.length];
    acc += t;
    return r;
  });
  const target = normChars(text);
  if (!target) return;
  if (hlPage !== n) { hlPage = n; hlCursor = 0; }
  let start = acc.indexOf(target, hlCursor);
  if (start < 0) start = acc.indexOf(target);
  let end = start >= 0 ? start + target.length : -1;
  if (start < 0) {
    const k = Math.min(30, target.length);
    const head = acc.indexOf(target.slice(0, k), hlCursor);
    const tail = acc.indexOf(target.slice(-k), Math.max(hlCursor, head));
    if (head >= 0) { start = head; end = tail >= head ? tail + k : Math.min(acc.length, head + target.length); }
    else if (tail >= 0) { end = tail + k; start = Math.max(hlCursor, end - target.length); } // began on the previous page
    else return;
  }
  hlCursor = end;
  const hit = spans.filter((sp, i) => ranges[i][1] > ranges[i][0] && ranges[i][1] > start && ranges[i][0] < end);
  hit.forEach((sp) => sp.classList.add('tts-current'));
  if (hit.length) scrollIntoViewIfNeeded(hit[0], hit[hit.length - 1]);
}

/* ---- reading loop ----
   Reads page n sentence by sentence, then the next pages. The text is fetched BEFORE
   navigating, so read-aloud never flips onto pages without text (which would count them
   as read / finish the book). A sentence cut by the page end is carried over and read
   once, joined with the start of the next page. */
async function readFrom(n, gen, emptyRun = 0, isStart = false, carry = '') {
  const r = state.reader;
  const pdfDoc = r.pdfDoc;
  if (gen !== session || !playing || !pdfDoc) return;
  const stale = () => gen !== session || !playing || r.pdfDoc !== pdfDoc;
  if (n > pdfDoc.numPages) {
    if (carry) { speakItems(n - 1, [{ text: carry, paragraphEnd: true }], gen, () => readFrom(n, gen, emptyRun)); return; }
    stopReadAloud();
    if (emptyRun) showToast('No more text to read');
    return;
  }
  const info = await bookInfo(pdfDoc, n);
  if (stale()) return;
  if (isStart) setBookLang(info.lang); // null when unclear: never reuse the previous book's language
  let raw = '';
  try { raw = (await getPageLines(pdfDoc, n)).join('\n'); } catch (e) { /* unreadable page: treat as empty */ }
  if (stale()) return;
  const own = cleanPageText(raw, { repeatedLines: info.repeated });
  if (!own) {
    if (isStart) { stopReadAloud(); showToast('No text to read on this page'); return; }
    const next = () => {
      if (emptyRun + 1 >= MAX_EMPTY_PAGES) { stopReadAloud(); showToast('No more text to read'); return; }
      readFrom(n + 1, gen, emptyRun + 1);
    };
    if (carry) speakItems(n - 1, [{ text: carry, paragraphEnd: true }], gen, next);
    else next();
    return;
  }
  const text = carry ? cleanPageText(raw, { prevPageTail: carry, repeatedLines: info.repeated }) : own;
  const items = splitSentences(text);
  let nextCarry = '';
  if (n < pdfDoc.numPages && items.length > 1 && !endsSentence(items[items.length - 1].text)) {
    nextCarry = items.pop().text;
  }
  if (n !== r.currentPage) goToPage(n);
  speakItems(n, items, gen, () => readFrom(n + 1, gen, 0, false, nextCarry));
}

function speakItems(n, items, gen, then) {
  speakQueue(items, {
    onstart: (i, item) => { if (gen === session) highlightSentence(n, item.text, gen); },
    onend: () => {
      if (gen !== session || !playing) return;
      clearTimeout(pageTimer);
      pageTimer = setTimeout(() => { if (gen === session && playing) then(); }, PAUSE_SENTENCE / (loadSettings().rate || 1));
    },
    onerror: () => { if (gen === session) stopReadAloud(); },
  });
}

export function stopReadAloud() {
  session++;
  clearTimeout(pageTimer);
  hlText = '';
  clearHighlight();
  stopSpeaking(); // also silences the popover's Speak / "Test voice", e.g. when the book closes
  if (!playing) return;
  setPlaying(false);
}

/* ---- settings panel: voice, speed, pitch, test ---- */
const SAMPLES = {
  it: 'Ciao! Questa è la voce che leggerà i tuoi libri.',
  en: 'Hello! This is the voice that will read your books.',
  fr: 'Bonjour ! Voici la voix qui lira vos livres.',
  de: 'Hallo! Das ist die Stimme, die deine Bücher vorliest.',
  es: '¡Hola! Esta es la voz que leerá tus libros.',
};
const fmtNum = (v) => Number(v).toFixed(2).replace(/0$/, '');

function populateVoices() {
  const sel = $('#tts-voice-select');
  if (!sel) return;
  const s = loadSettings();
  const lang = getBookLang();
  const voices = availableVoices();
  const { same, other } = sortVoices(voices, lang);
  const best = pickDefaultVoice(voices, lang);
  sel.innerHTML = '';
  sel.add(new Option(best ? `Automatic (${best.name})` : 'Automatic', ''));
  const group = (label, list, withLang) => {
    if (!list.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const v of list) g.appendChild(new Option(withLang ? `${v.name} (${v.lang})` : v.name, v.voiceURI));
    sel.appendChild(g);
  };
  group('Book language', same, false);
  group('Other languages', other, true);
  sel.value = voices.some((v) => v.voiceURI === s.voiceURI) ? s.voiceURI : '';
}

function syncSliders() {
  const s = loadSettings();
  $('#tts-rate').value = String(s.rate);
  $('#tts-pitch').value = String(s.pitch);
  $('#tts-rate-val').textContent = fmtNum(s.rate) + '×';
  $('#tts-pitch-val').textContent = fmtNum(s.pitch);
}

function buildSettingsPanel() {
  const panel = $('#tts-settings');
  panel.innerHTML = `
    <div class="tts-settings__title">Read aloud</div>
    <label class="tts-field">
      <span>Voice</span>
      <select id="tts-voice-select" aria-label="Voice"></select>
    </label>
    <label class="tts-slider">
      <span>Speed <b id="tts-rate-val">1.0×</b></span>
      <input id="tts-rate" type="range" min="${RATE.min}" max="${RATE.max}" step="0.05" aria-label="Speed">
    </label>
    <label class="tts-slider">
      <span>Pitch <b id="tts-pitch-val">1.0</b></span>
      <input id="tts-pitch" type="range" min="${PITCH.min}" max="${PITCH.max}" step="0.05" aria-label="Pitch">
    </label>
    <button id="tts-test-btn" class="tts-test" type="button">Test voice</button>
    <p class="tts-hint">More natural voices: Android Settings › Text-to-speech output › Google › Install voice data.</p>`;
  $('#tts-voice-select').addEventListener('change', (e) => saveSettings({ voiceURI: e.target.value }));
  $('#tts-rate').addEventListener('input', (e) => { saveSettings({ rate: e.target.value }); syncSliders(); });
  $('#tts-pitch').addEventListener('input', (e) => { saveSettings({ pitch: e.target.value }); syncSliders(); });
  $('#tts-test-btn').addEventListener('click', () => {
    stopReadAloud();
    unlockSpeech(); // inside the tap (iOS)
    const { lang } = currentSpeechOptions();
    speak(SAMPLES[String(lang).slice(0, 2).toLowerCase()] || SAMPLES.en);
  });
  try { window.speechSynthesis.addEventListener('voiceschanged', populateVoices); } catch (e) { /* stub */ }
}

async function openSettings() {
  const panel = $('#tts-settings');
  populateVoices();
  syncSliders();
  panel.hidden = false;
  // the book's language decides which voices come first
  const pdfDoc = state.reader.pdfDoc;
  if (pdfDoc) {
    try {
      const info = await bookInfo(pdfDoc, state.reader.currentPage || 1);
      setBookLang(info.lang);
    } catch (e) { /* keep navigator.language */ }
  }
  await whenVoicesReady();
  if (!panel.hidden) populateVoices();
}

function hideSettings() { const p = $('#tts-settings'); if (p) p.hidden = true; }

export function initReaderTts() {
  const btn = $('#read-aloud-btn');
  if (!btn) return;
  btn.hidden = !speechSupported;
  btn.addEventListener('click', () => {
    if (playing) { stopReadAloud(); return; }
    unlockSpeech(); // synchronously inside the tap: iOS refuses speech started later
    hideSettings();
    const gen = ++session;
    hlPage = 0;
    setPlaying(true);
    readFrom(state.reader.currentPage, gen, 0, true);
  });

  const setBtn = $('#tts-settings-btn');
  const panel = $('#tts-settings');
  if (!setBtn || !panel) return;
  setBtn.hidden = !speechSupported;
  if (!speechSupported) return;
  buildSettingsPanel();
  setBtn.addEventListener('click', () => { if (panel.hidden) openSettings(); else hideSettings(); });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !setBtn.contains(e.target)) hideSettings();
  }, true);
  $('#back-btn').addEventListener('click', hideSettings);
  whenVoicesReady(); // warm up the voice list (Chrome loads it lazily)
}
