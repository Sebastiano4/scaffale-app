/* Immersive reading mode: full-screen pages only; exit with a left-to-right swipe or Android back. */
import { state } from './state.js';
import { $, el } from './dom.js';
import { renderReader } from './reader.js';
import { stopReadAloud } from './reader-tts.js';

const HINT_KEY = 'booknest-immersive-hint';
// A swipe exits only when it is clearly horizontal, long and quick, so that scrolling
// and long-press selection never trigger it.
const SWIPE_MIN_FRACTION = 0.35; // of the reading area's width
const SWIPE_MAX_SLOPE = 0.5;     // |dy| / dx
const SWIPE_MAX_MS = 800;
const LONG_PRESS_MS = 400;
const LONG_PRESS_SLOP = 10;

let active = false;
let switchedFromPaginated = false;
let ownHistoryEntry = false;

function isReaderOpen() {
  return $('#reader-view').classList.contains('view--active');
}

function showHintOnce() {
  try { if (localStorage.getItem(HINT_KEY)) return; localStorage.setItem(HINT_KEY, '1'); } catch (e) { return; }
  const hint = el('div', 'immersive-hint', 'Swipe left → right to exit');
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 2000);
}

export async function enterImmersive() {
  if (active || !state.reader.pdfDoc) return;
  active = true;
  document.body.classList.add('immersive');
  history.pushState({ immersive: true }, '');
  ownHistoryEntry = true;
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => { /* allowed to refuse: chrome is hidden anyway */ });
  }
  // the reader's infinite page: paginated books are shown continuous for the session
  if (state.reader.mode === 'paginated') {
    switchedFromPaginated = true;
    state.reader.mode = 'continuous';
    await renderReader();
  }
  showHintOnce();
}

/* fromPopstate: the browser already consumed our history entry (Android back). */
export async function exitImmersive({ fromPopstate = false } = {}) {
  if (!active) return;
  active = false;
  document.body.classList.remove('immersive');
  document.querySelectorAll('.immersive-hint').forEach((h) => h.remove());
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  if (ownHistoryEntry) {
    ownHistoryEntry = false;
    if (!fromPopstate && history.state && history.state.immersive) history.back();
  }
  if (switchedFromPaginated) {
    switchedFromPaginated = false;
    if (state.reader.pdfDoc) { state.reader.mode = 'paginated'; await renderReader(); }
  }
}

function initSwipeToExit() {
  const scroll = $('#pdf-scroll');
  let start = null;
  scroll.addEventListener('touchstart', (e) => {
    if (!active || e.touches.length !== 1) { start = null; return; }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, time: Date.now(), longPress: false };
    const s = start;
    s.timer = setTimeout(() => { if (start === s) s.longPress = true; }, LONG_PRESS_MS);
  }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > LONG_PRESS_SLOP) clearTimeout(start.timer);
  }, { passive: true });
  scroll.addEventListener('touchend', (e) => {
    const s = start; start = null;
    if (!s || !active) return;
    clearTimeout(s.timer);
    if (s.longPress) return; // finger rested first: that was a selection gesture
    // pinch-zoomed in: a sideways drag pans the page, it is not an exit swipe
    if (window.visualViewport && window.visualViewport.scale > 1.01) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = Math.abs(t.clientY - s.y);
    const width = scroll.clientWidth || window.innerWidth;
    if (dx < width * SWIPE_MIN_FRACTION || dy > dx * SWIPE_MAX_SLOPE) return;
    if (Date.now() - s.time > SWIPE_MAX_MS) return;
    if (window.getSelection().toString().trim()) return;
    exitImmersive();
  });
  scroll.addEventListener('touchcancel', () => { if (start) clearTimeout(start.timer); start = null; });
}

/* While read-aloud plays, a single small pause button floats over the pages (the top bar
   with the normal control is hidden). It disappears as soon as reading stops. */
function initReadAloudPause() {
  const ttsBtn = $('#read-aloud-btn');
  if (!ttsBtn) return;
  const pause = el('button', 'immersive-tts-pause',
    '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/></svg>');
  pause.type = 'button';
  pause.setAttribute('aria-label', 'Pause reading aloud');
  pause.hidden = true;
  pause.addEventListener('click', () => stopReadAloud());
  document.body.appendChild(pause);
  const sync = () => { pause.hidden = ttsBtn.getAttribute('aria-pressed') !== 'true'; };
  new MutationObserver(sync).observe(ttsBtn, { attributes: true, attributeFilter: ['aria-pressed'] });
  sync();
}

export function initImmersive() {
  const btn = $('#immersive-btn');
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener('click', () => enterImmersive());
  // reloaded while immersive: our old history entry would make the next "back" do nothing
  if (history.state && history.state.immersive) history.replaceState(null, '');
  initReadAloudPause();

  initSwipeToExit();

  window.addEventListener('popstate', () => {
    if (active) exitImmersive({ fromPopstate: true });
  });
  document.addEventListener('fullscreenchange', () => {
    if (active && !document.fullscreenElement) exitImmersive();
  });
  document.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape') exitImmersive();
  });
  // the reader can close by other paths: never leave the app stuck without chrome
  new MutationObserver(() => {
    if (active && !isReaderOpen()) exitImmersive();
  }).observe($('#reader-view'), { attributes: true, attributeFilter: ['class'] });
}
