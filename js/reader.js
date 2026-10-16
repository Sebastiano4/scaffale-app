import { pdfjsLib } from './pdf.js';
import { state } from './state.js';
import { $, el, showToast } from './dom.js';
import { DB } from './db.js';
import { Stats, flushReadingTime } from './stats.js';
import { loadLibrary } from './library.js';
import { buildSearchIndex, resetSearchUI } from './reader-search.js';
import { initReaderTts, stopReadAloud } from './reader-tts.js';
import { buildTextLayer, clearLiveSelection } from './reader-selection.js';

/* ======================================================================
   Reader
   ====================================================================== */
/* opts.page opens the book at that page instead of where it was left (Dictionary references). */
export async function openReader(id, opts = {}) {
  const book = await DB.get(id);
  if (!book) return;

  state.reader.book = book;
  state.reader.mode = book.readingMode || 'continuous';
  state.reader.currentPage = Math.max(1, Number(opts.page) || book.lastPage || 1);
  state.reader.openedAtPage = state.reader.currentPage;
  state.reader.textIndex = new Map();
  state.reader.outline = undefined;

  $('#library-view').classList.remove('view--active');
  $('#reader-view').classList.add('view--active');
  // a library "Undo" toast belongs to the library: don't carry it into the book
  const toast = $('#toast');
  if (toast.querySelector('.toast__action')) toast.hidden = true;
  $('#reader-title').textContent = book.title;
  $('#reader-loading').hidden = false;
  updateModeIcon();

  const buf = await book.fileBlob.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
  state.reader.pdfDoc = pdfDoc;
  book.numPages = pdfDoc.numPages;

  book.lastOpenedAt = Date.now();
  if (!book.startedAt) book.startedAt = Date.now();
  await DB.put(book);

  state.reader.sessionStart = Date.now();
  state.reader.committedPage = state.reader.currentPage;
  state.reader.countedPages = new Set();
  applyReadingFilter();

  await renderReader();
  $('#reader-loading').hidden = true;
  buildSearchIndex(); // background, not awaited
}

export async function closeReader() {
  stopReadAloud();
  flushReadingTime();
  clearTimeout(dwellTimer);
  // save the last settled reading position (don't let a pending dwell drop it)
  const closing = state.reader.book;
  if (closing) {
    closing.lastPage = state.reader.committedPage || state.reader.currentPage || 1;
    try { await DB.put(closing); } catch (e) { /* best effort */ }
  }
  if (state.reader.io) state.reader.io.disconnect();
  state.reader.book = null;
  state.reader.pdfDoc = null;
  $('#pdf-pages').innerHTML = '';
  $('#reader-view').classList.remove('view--active');
  $('#library-view').classList.add('view--active');
  $('#side-panel').hidden = true;
  $('#word-card').hidden = true;
  resetSearchUI();
  $('#goto-popover').hidden = true;
  $('#appearance-popover').hidden = true;
  loadLibrary();
}

function updateModeIcon() {
  $('#mode-icon').innerHTML =
    state.reader.mode === 'continuous'
      ? '<path d="M4 4h16v2H4zm0 7h16v2H4zm0 7h16v2H4z"/>'
      : '<rect x="6" y="4" width="12" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>';
}

export function updateProgressUI() {
  const { currentPage, book } = state.reader;
  const total = book.numPages || 1;
  $('#reader-progress').textContent = `Page ${currentPage} of ${total}`;
  $('#page-progress-fill').style.width = Math.round((currentPage / total) * 100) + '%';
  const isBookmarked = (book.bookmarks || []).some((b) => b.page === currentPage);
  $('#bookmark-icon').setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
}

/* A page is only counted as "read" — and only becomes the saved reading position —
   after you actually DWELL on it for a moment. Quickly flipping forward or jumping
   back to check something old no longer inflates your stats or moves your progress. */
const READ_DWELL_MS = 2000;
let dwellTimer = null;
function notePageSeen(n) {
  clearTimeout(dwellTimer);
  dwellTimer = setTimeout(() => confirmPageRead(n), READ_DWELL_MS);
}
function confirmPageRead(n) {
  const r = state.reader;
  if (!r.book || r.currentPage !== n) return; // moved on before settling → ignore
  r.committedPage = n;
  if (!r.countedPages) r.countedPages = new Set();
  if (!r.countedPages.has(n)) { r.countedPages.add(n); Stats.addPages(1); } // once per page per session
  persistProgress();
}

function persistProgress() {
  clearTimeout(state.reader.saveTimer);
  state.reader.saveTimer = setTimeout(async () => {
    const { book, committedPage, currentPage } = state.reader;
    if (!book) return;
    const page = committedPage || currentPage;
    book.lastPage = page;
    // only reaching the end during this session finishes a book: reopening one that was
    // marked unread while sitting on its last page must not re-finish it
    if (!book.finishedAt && book.numPages > 1 && page >= book.numPages && state.reader.openedAtPage < book.numPages) {
      book.finishedAt = Date.now();
      showToast('Book finished — congratulations!');
    }
    await DB.put(book);
  }, 350);
}

/* ---- reading appearance: fully customizable (preset + brightness + contrast + warmth) ----
   Every setting is stored in localStorage and composed into one CSS filter string
   (--read-filter) so the adjustments stack on top of the chosen preset. */
const READ_DEFAULTS = { brightness: 100, contrast: 100, warmth: 0 };
function readAppearance() {
  return {
    preset: localStorage.getItem('booknest-readfilter') || 'none',
    brightness: Number(localStorage.getItem('booknest-brightness') || READ_DEFAULTS.brightness),
    contrast: Number(localStorage.getItem('booknest-contrast') || READ_DEFAULTS.contrast),
    warmth: Number(localStorage.getItem('booknest-warmth') || READ_DEFAULTS.warmth),
  };
}
function applyReadingFilter() {
  const s = readAppearance();
  const scroll = $('#pdf-scroll');
  scroll.classList.toggle('filter-night', s.preset === 'night');

  // warmth (0..1). A sepia preset adds a comfortable baseline warmth.
  let warm = s.warmth / 100;
  if (s.preset === 'sepia') warm = Math.max(warm, 0.5);

  const parts = [];
  if (s.preset === 'night') parts.push('invert(0.92)', 'hue-rotate(180deg)');
  if (s.preset === 'grey') parts.push('grayscale(1)');
  parts.push(`brightness(${(s.brightness / 100).toFixed(2)})`);
  parts.push(`contrast(${(s.contrast / 100).toFixed(2)})`);
  if (warm > 0.001) parts.push(`sepia(${warm.toFixed(2)})`);
  scroll.style.setProperty('--read-filter', parts.join(' '));

  // reflect current state in the appearance popover
  document.querySelectorAll('#appearance-filters .appearance-chip').forEach((c) =>
    c.classList.toggle('appearance-chip--active', c.dataset.filter === s.preset));
  const set = (id, val, label, suffix = '%') => {
    const inp = $(id); if (inp) inp.value = val;
    const out = $(label); if (out) out.textContent = val + suffix;
  };
  set('#brightness-slider', s.brightness, '#brightness-val');
  set('#contrast-slider', s.contrast, '#contrast-val');
  set('#warmth-slider', s.warmth, '#warmth-val');
}

/* ---- shared canvas rendering (high-DPI aware for crisp text) ---- */
function renderPageToCanvas(page, viewport, wrap) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  wrap.appendChild(canvas);
  return page.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
}

/* ---- rendering: continuous mode ----
   Renders are queued: a second render (e.g. leaving immersive mode while it was still
   drawing) starts only after the first is done, so pages of two modes never mix. */
let renderQueue = Promise.resolve();
let renderedWidth = 0; // width of #pdf-scroll the pages were last fitted to
export function renderReader() {
  renderQueue = renderQueue.then(doRenderReader, doRenderReader);
  return renderQueue;
}

async function doRenderReader() {
  const { pdfDoc, mode } = state.reader;
  if (!pdfDoc) return;
  renderedWidth = $('#pdf-scroll').clientWidth;
  if (state.reader.io) { state.reader.io.disconnect(); state.reader.io = null; }
  const container = $('#pdf-pages');
  container.innerHTML = '';
  $('#prev-page').hidden = mode !== 'paginated';
  $('#next-page').hidden = mode !== 'paginated';

  if (mode === 'continuous') await renderContinuous();
  else await renderPaginated();

  updateProgressUI();
}

async function renderContinuous() {
  const { pdfDoc, scale } = state.reader;
  const container = $('#pdf-pages');
  const firstPage = await pdfDoc.getPage(1);
  const baseVp = firstPage.getViewport({ scale: 1 });
  const wrapW = Math.min(container.parentElement.clientWidth - 24, 900);
  const fitScale = (wrapW / baseVp.width) * scale;

  const wraps = [];
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const vp = firstPage.getViewport({ scale: fitScale }); // approximate, refined per page below
    const wrap = el('div', 'pdf-page-wrap');
    wrap.dataset.page = n;
    wrap.style.width = vp.width + 'px';
    wrap.style.height = vp.height + 'px';
    container.appendChild(wrap);
    wraps.push(wrap);
  }

  const rendered = new Set();
  const renderPageInto = async (wrap) => {
    const n = Number(wrap.dataset.page);
    if (rendered.has(n)) return;
    rendered.add(n);
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: fitScale });
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';

    await renderPageToCanvas(page, viewport, wrap);

    const textContent = await page.getTextContent();
    state.reader.textIndex.set(n, textContent.items.map((i) => i.str).join(' '));
    await buildTextLayer(wrap, textContent, viewport);
  };

  // IntersectionObserver only drives lazy rendering (render slightly ahead of view).
  // The "current page" is tracked separately from scroll position (see below), because
  // a page taller than the viewport never reaches a high intersection ratio, which used
  // to leave the page counter stuck or jumping.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) renderPageInto(entry.target);
    });
  }, { root: $('#pdf-scroll'), rootMargin: '300px 0px', threshold: 0 });

  wraps.forEach((w) => io.observe(w));
  state.reader.io = io;

  // jump to last-read page (scroll ONLY the container: scrollIntoView would
  // also scroll the outer document and shift the whole UI)
  requestAnimationFrame(() => {
    const target = wraps[state.reader.currentPage - 1];
    if (target) $('#pdf-scroll').scrollTop = Math.max(0, target.offsetTop - 8);
  });
}

/* ---- current page tracking while scrolling (continuous mode) ----
   Picks the page crossing a reference line ~38% down the viewport. This is robust
   even when a page is taller than the viewport, unlike an intersection-ratio test. */
function updateCurrentPageFromScroll() {
  if (state.reader.mode !== 'continuous' || !state.reader.pdfDoc) return;
  const scroll = $('#pdf-scroll');
  const wraps = scroll.querySelectorAll('.pdf-page-wrap');
  if (!wraps.length) return;
  const sr = scroll.getBoundingClientRect();
  const line = sr.top + sr.height * 0.38;
  let page = null;
  for (const w of wraps) {
    const r = w.getBoundingClientRect();
    if (r.top <= line && r.bottom >= line) { page = Number(w.dataset.page); break; }
    // once we've scrolled past the line, the last page above it is the best guess
    if (r.top > line) break;
    page = Number(w.dataset.page);
  }
  if (page && page !== state.reader.currentPage) {
    state.reader.currentPage = page;
    notePageSeen(page); // dwell-gated: persists + counts only if you settle here
    updateProgressUI();
  }
}

/* ---- rendering: paginated mode ---- */
async function renderPaginated() {
  await renderSinglePage(state.reader.currentPage);
}

export async function renderSinglePage(n) {
  const { pdfDoc, scale } = state.reader;
  n = Math.max(1, Math.min(pdfDoc.numPages, n));
  state.reader.currentPage = n;
  notePageSeen(n);
  const container = $('#pdf-pages');
  container.innerHTML = '';

  const page = await pdfDoc.getPage(n);
  const baseVp = page.getViewport({ scale: 1 });
  const wrapW = Math.min(container.parentElement.clientWidth - 24, 900);
  const fitScale = (wrapW / baseVp.width) * scale;
  const viewport = page.getViewport({ scale: fitScale });

  const wrap = el('div', 'pdf-page-wrap');
  wrap.dataset.page = n;
  wrap.style.width = viewport.width + 'px';
  wrap.style.height = viewport.height + 'px';
  container.appendChild(wrap);
  await renderPageToCanvas(page, viewport, wrap);

  const textContent = await page.getTextContent();
  state.reader.textIndex.set(n, textContent.items.map((i) => i.str).join(' '));
  await buildTextLayer(wrap, textContent, viewport);

  updateProgressUI();
}

let resizeTimer = null;

export function goToPage(n) {
  $('#side-panel').hidden = true;
  if (state.reader.mode === 'paginated') { renderSinglePage(n); return; }
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${n}"]`);
  if (wrap) $('#pdf-scroll').scrollTo({ top: Math.max(0, wrap.offsetTop - 8), behavior: 'smooth' });
}

/* ---- quick "go to page" popover ---- */
function toggleGotoPopover() {
  const pop = $('#goto-popover');
  const book = state.reader.book;
  if (!book || !book.numPages) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  const input = $('#goto-input');
  input.max = book.numPages;
  input.value = state.reader.currentPage;
  pop.hidden = false;
  input.focus();
  input.select();
}
function commitGotoPage() {
  const book = state.reader.book;
  if (!book) return;
  const n = parseInt($('#goto-input').value, 10);
  $('#goto-popover').hidden = true;
  if (!isNaN(n)) goToPage(Math.min(book.numPages, Math.max(1, n)));
}

export function initReader() {
  $('#back-btn').addEventListener('click', closeReader);
  initReaderTts();

  $('#mode-toggle').addEventListener('click', async () => {
    state.reader.mode = state.reader.mode === 'continuous' ? 'paginated' : 'continuous';
    state.reader.book.readingMode = state.reader.mode;
    await DB.put(state.reader.book);
    updateModeIcon();
    await renderReader();
  });

  $('#zoom-in').addEventListener('click', () => { state.reader.scale = Math.min(2.2, state.reader.scale + 0.15); renderReader(); });
  $('#zoom-out').addEventListener('click', () => { state.reader.scale = Math.max(0.6, state.reader.scale - 0.15); renderReader(); });

  $('#filter-toggle').addEventListener('click', () => {
    const pop = $('#appearance-popover');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) applyReadingFilter();
  });
  document.querySelectorAll('#appearance-filters .appearance-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      localStorage.setItem('booknest-readfilter', chip.dataset.filter);
      applyReadingFilter();
    });
  });
  $('#brightness-slider').addEventListener('input', (e) => {
    localStorage.setItem('booknest-brightness', e.target.value);
    applyReadingFilter();
  });
  $('#contrast-slider').addEventListener('input', (e) => {
    localStorage.setItem('booknest-contrast', e.target.value);
    applyReadingFilter();
  });
  $('#warmth-slider').addEventListener('input', (e) => {
    localStorage.setItem('booknest-warmth', e.target.value);
    applyReadingFilter();
  });
  $('#appearance-reset').addEventListener('click', () => {
    localStorage.setItem('booknest-readfilter', 'none');
    localStorage.setItem('booknest-brightness', READ_DEFAULTS.brightness);
    localStorage.setItem('booknest-contrast', READ_DEFAULTS.contrast);
    localStorage.setItem('booknest-warmth', READ_DEFAULTS.warmth);
    applyReadingFilter();
  });
  // close the goto / appearance popovers when tapping elsewhere
  document.addEventListener('pointerdown', (e) => {
    const goto = $('#goto-popover');
    if (!goto.hidden && !goto.contains(e.target) && e.target !== $('#reader-progress')) goto.hidden = true;
    const appear = $('#appearance-popover');
    if (!appear.hidden && !appear.contains(e.target) && !$('#filter-toggle').contains(e.target)) appear.hidden = true;
  }, true);

  /* ---- tap/click on the progress bar to jump anywhere in the book ---- */
  $('#page-progress-bar').addEventListener('click', (e) => {
    const book = state.reader.book;
    if (!book || !book.numPages) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const n = Math.min(book.numPages, Math.max(1, Math.round(frac * book.numPages) || 1));
    goToPage(n);
  });

  (() => {
    let ticking = false;
    $('#pdf-scroll').addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; updateCurrentPageFromScroll(); });
    }, { passive: true });
  })();

  $('#prev-page').addEventListener('click', () => renderSinglePage(state.reader.currentPage - 1));
  $('#next-page').addEventListener('click', () => renderSinglePage(state.reader.currentPage + 1));

  // swipe + edge-tap support in paginated mode
  (() => {
    let startX = null;
    let startTime = 0;
    const scroll = $('#pdf-scroll');
    scroll.addEventListener('touchstart', (e) => {
      if (state.reader.mode === 'paginated') { startX = e.touches[0].clientX; startTime = Date.now(); }
    }, { passive: true });
    scroll.addEventListener('touchend', (e) => {
      if (startX == null || state.reader.mode !== 'paginated') return;
      const dx = e.changedTouches[0].clientX - startX;
      const longPress = Date.now() - startTime > 450; // finger rested first: a selection gesture
      if (longPress || window.getSelection().toString().trim()) { startX = null; return; }
      if (Math.abs(dx) > 60) {
        if (dx < 0) renderSinglePage(state.reader.currentPage + 1);
        else renderSinglePage(state.reader.currentPage - 1);
      }
      startX = null;
    });
    // tap near the left/right edge to turn the page (only when nothing is selected)
    scroll.addEventListener('click', (e) => {
      if (state.reader.mode !== 'paginated') return;
      if (window.getSelection().toString()) return;
      const rect = scroll.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (x < 0.16) renderSinglePage(state.reader.currentPage - 1);
      else if (x > 0.84) renderSinglePage(state.reader.currentPage + 1);
    });
  })();

  // keyboard navigation (desktop / tablet with keyboard)
  document.addEventListener('keydown', (e) => {
    if (!state.reader.pdfDoc || !$('#reader-view').classList.contains('view--active')) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      $('#side-panel').hidden = true;
      $('#selection-popover').hidden = true;
      window.getSelection().removeAllRanges();
      clearLiveSelection();
      return;
    }
    if (state.reader.mode === 'paginated') {
      if (e.key === 'ArrowRight') renderSinglePage(state.reader.currentPage + 1);
      else if (e.key === 'ArrowLeft') renderSinglePage(state.reader.currentPage - 1);
    }
  });

  // re-render on resize / rotation so pages always fit the screen — only when the width
  // really changed (entering full screen changes only the height: no need to re-render)
  window.addEventListener('resize', () => {
    if (!state.reader.pdfDoc || !$('#reader-view').classList.contains('view--active')) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if ($('#pdf-scroll').clientWidth === renderedWidth) return;
      renderReader();
    }, 250);
  });

  $('#reader-progress').addEventListener('click', toggleGotoPopover);
  $('#goto-go').addEventListener('click', commitGotoPage);
  $('#goto-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitGotoPage(); }
    else if (e.key === 'Escape') $('#goto-popover').hidden = true;
  });
}
