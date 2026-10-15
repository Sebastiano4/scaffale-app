import { state } from './state.js';
import { $, showToast } from './dom.js';
import { goToPage } from './reader.js';
import { getPageText } from './reader-search.js';
import { speak, stopSpeaking, unlockSpeech, splitForSpeech, speechSupported } from './speech.js';

const PLAY = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
const PAUSE = '<path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/>';
const MAX_EMPTY_PAGES = 3; // consecutive pages without text (scanned book?) before giving up
let playing = false;
let session = 0; // generation token: callbacks from a previous play session are ignored

function setPlaying(on) {
  playing = on;
  const btn = $('#read-aloud-btn');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#read-aloud-icon').innerHTML = on ? PAUSE : PLAY;
}

/* Reads page n, then the next ones. The text is fetched BEFORE navigating, so read-aloud
   never flips onto pages without text (which would count them as read / finish the book). */
async function readFrom(n, gen, emptyRun = 0, isStart = false) {
  const r = state.reader;
  const pdfDoc = r.pdfDoc;
  if (gen !== session || !playing || !pdfDoc) return;
  if (n > pdfDoc.numPages) {
    stopReadAloud();
    if (emptyRun) showToast('No more text to read');
    return;
  }
  let text = '';
  try { text = await getPageText(pdfDoc, n); } catch (e) { /* unreadable page: treat as empty */ }
  if (gen !== session || !playing || r.pdfDoc !== pdfDoc) return;
  if (splitForSpeech(text).length === 0) {
    if (isStart) { stopReadAloud(); showToast('No text to read on this page'); return; }
    if (emptyRun + 1 >= MAX_EMPTY_PAGES) { stopReadAloud(); showToast('No more text to read'); return; }
    readFrom(n + 1, gen, emptyRun + 1);
    return;
  }
  if (n !== r.currentPage) goToPage(n);
  speak(text, {
    onend: () => { if (gen === session && playing) readFrom(n + 1, gen); },
    onerror: () => { if (gen === session) stopReadAloud(); },
  });
}

export function stopReadAloud() {
  session++;
  if (!playing) return;
  setPlaying(false);
  stopSpeaking();
}

export function initReaderTts() {
  const btn = $('#read-aloud-btn');
  if (!btn) return;
  btn.hidden = !speechSupported;
  btn.addEventListener('click', () => {
    if (playing) { stopReadAloud(); return; }
    unlockSpeech(); // synchronously inside the tap: iOS refuses speech started later
    const gen = ++session;
    setPlaying(true);
    readFrom(state.reader.currentPage, gen, 0, true);
  });
}
