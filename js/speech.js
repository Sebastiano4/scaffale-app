import { splitSentences } from './tts-text.js';
import { currentSpeechOptions } from './tts-voices.js';

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance === 'function';

export const PAUSE_SENTENCE = 250; // ms of silence between sentences at speed 1
export const PAUSE_PARAGRAPH = 700; // ms of silence after a paragraph end at speed 1

let token = 0; // bumped on every speak/stop so callbacks of cancelled utterances are ignored
let current = null; // the utterance being spoken: kept referenced so Chrome can't GC it (and drop onend)
let pauseTimer = null;

/* Split text into chunks of at most `max` chars: whole sentences packed together,
   over-long sentences hard-wrapped at word boundaries. Long utterances get cut off
   (desktop Chrome ~15 s) or rejected (Android ~4000 chars).
   (Kept for compatibility; speaking now goes sentence by sentence via tts-text.js.) */
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

/* Speak a queue of sentences ([{ text, paragraphEnd }]), one utterance each, with a
   natural pause after every sentence (longer after a paragraph end), scaled by the speed.
   Voice, speed and pitch are read from the settings for every utterance, so changes made
   while listening apply from the next sentence. onstart(i, item) fires as item i starts;
   onend() after the last one. */
export function speakQueue(items, { onstart, onend, onerror } = {}) {
  if (!speechSupported) return;
  const queue = (items || []).filter((it) => it && it.text && it.text.trim());
  if (!queue.length) return;
  clearTimeout(pauseTimer);
  window.speechSynthesis.cancel();
  const mine = ++token;
  const say = (i) => {
    if (mine !== token) return;
    const opts = currentSpeechOptions();
    const u = new SpeechSynthesisUtterance(queue[i].text);
    u.lang = opts.lang;
    u.rate = opts.rate;
    u.pitch = opts.pitch;
    if (opts.voice) { try { u.voice = opts.voice; } catch (e) { /* not a real SpeechSynthesisVoice */ } }
    u.onend = () => {
      if (mine !== token) return;
      current = null;
      if (i + 1 < queue.length) {
        const pause = (queue[i].paragraphEnd ? PAUSE_PARAGRAPH : PAUSE_SENTENCE) / (opts.rate || 1);
        pauseTimer = setTimeout(() => say(i + 1), pause);
        return;
      }
      if (onend) onend();
    };
    u.onerror = () => { if (mine !== token) return; current = null; if (onerror) onerror(); };
    current = u;
    if (onstart) onstart(i, queue[i]);
    window.speechSynthesis.speak(u);
  };
  say(0);
}

/* Free text (e.g. the selection popover's Speak): same sentence pacing and voice settings. */
export function speak(text, callbacks = {}) {
  speakQueue(splitSentences(text), callbacks);
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
  clearTimeout(pauseTimer);
  current = null;
  if (speechSupported) window.speechSynthesis.cancel();
}
