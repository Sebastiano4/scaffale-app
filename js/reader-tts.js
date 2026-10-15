import { state } from './state.js';
import { $ } from './dom.js';
import { goToPage } from './reader.js';
import { speak, stopSpeaking, speechSupported } from './speech.js';

const PLAY = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
const PAUSE = '<path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/>';
let playing = false;
let session = 0; // generation token: callbacks from a previous play session are ignored

function setPlaying(on) {
  playing = on;
  const btn = $('#read-aloud-btn');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#read-aloud-icon').innerHTML = on ? PAUSE : PLAY;
}

async function pageText(n) {
  const r = state.reader;
  if (r.textIndex.has(n)) return r.textIndex.get(n);
  const page = await r.pdfDoc.getPage(n);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join(' ');
  r.textIndex.set(n, text);
  return text;
}

async function readFrom(n, gen) {
  const r = state.reader;
  if (gen !== session || !playing || !r.pdfDoc) return;
  if (n > r.pdfDoc.numPages) { setPlaying(false); return; }
  if (n !== r.currentPage) goToPage(n);
  const text = (await pageText(n)).trim();
  if (gen !== session || !playing) return;
  if (!text) { readFrom(n + 1, gen); return; }
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
    const gen = ++session;
    setPlaying(true);
    readFrom(state.reader.currentPage, gen);
  });
}
