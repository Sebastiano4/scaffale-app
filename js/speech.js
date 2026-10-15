export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance === 'function';

let speaking = false;

export function speak(text, { onend } = {}) {
  if (!speechSupported || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = navigator.language || 'en-US';
  speaking = true;
  u.onend = () => { speaking = false; if (onend) onend(); };
  u.onerror = () => { speaking = false; };
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  speaking = false;
  if (speechSupported) window.speechSynthesis.cancel();
}

export function isSpeaking() { return speaking; }
