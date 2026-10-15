export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance === 'function';

let speaking = false;
let token = 0; // bumped on every speak/stop so callbacks of cancelled utterances are ignored

export function speak(text, { onend, onerror } = {}) {
  if (!speechSupported || !text) return;
  window.speechSynthesis.cancel();
  const mine = ++token;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = navigator.language || 'en-US';
  speaking = true;
  u.onend = () => { if (mine !== token) return; speaking = false; if (onend) onend(); };
  u.onerror = () => { if (mine !== token) return; speaking = false; if (onerror) onerror(); };
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  token++;
  speaking = false;
  if (speechSupported) window.speechSynthesis.cancel();
}

export function isSpeaking() { return speaking; }
