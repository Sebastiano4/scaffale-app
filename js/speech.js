export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance === 'function';

let token = 0; // bumped on every speak/stop so callbacks of cancelled utterances are ignored
let current = null; // the utterance being spoken: kept referenced so Chrome can't GC it (and drop onend)

/* Split text into chunks of at most `max` chars: whole sentences packed together,
   over-long sentences hard-wrapped at word boundaries. Long utterances get cut off
   (desktop Chrome ~15 s) or rejected (Android ~4000 chars). */
export function splitForSpeech(text, max = 200) {
  const sentences = String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) || [];
  const pieces = [];
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (s.length <= max) { pieces.push(s); continue; }
    let line = '';
    for (let w of s.split(' ')) {
      while (w.length > max) { // a single "word" longer than max: cut it
        if (line) { pieces.push(line); line = ''; }
        pieces.push(w.slice(0, max)); w = w.slice(max);
      }
      if (!w) continue;
      if (line && line.length + 1 + w.length > max) { pieces.push(line); line = ''; }
      line = line ? line + ' ' + w : w;
    }
    if (line) pieces.push(line);
  }
  const chunks = [];
  for (const p of pieces) {
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + 1 + p.length <= max) chunks[last] += ' ' + p;
    else chunks.push(p);
  }
  return chunks;
}

export function speak(text, { onend, onerror } = {}) {
  if (!speechSupported) return;
  const chunks = splitForSpeech(text);
  if (!chunks.length) return;
  window.speechSynthesis.cancel();
  const mine = ++token;
  const sayChunk = (i) => {
    const u = new SpeechSynthesisUtterance(chunks[i]);
    u.lang = navigator.language || 'en-US';
    u.onend = () => {
      if (mine !== token) return;
      if (i + 1 < chunks.length) { sayChunk(i + 1); return; }
      current = null;
      if (onend) onend();
    };
    u.onerror = () => { if (mine !== token) return; current = null; if (onerror) onerror(); };
    current = u;
    window.speechSynthesis.speak(u);
  };
  sayChunk(0);
}

/* iOS Safari only allows speech started synchronously inside a user gesture:
   call this first thing in the tap handler, before any await. */
export function unlockSpeech() {
  if (!speechSupported) return;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  current = u;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  token++;
  current = null;
  if (speechSupported) window.speechSynthesis.cancel();
}
