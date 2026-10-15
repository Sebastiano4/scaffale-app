import { pdfjsLib } from './js/pdf.js';
import { state } from './js/state.js';
import { $, el, uid, showToast, escapeHtml } from './js/dom.js';
import { DB } from './js/db.js';
import { Stats, flushReadingTime, initReadingTimeTracking } from './js/stats.js';
import { initTheme } from './js/theme.js';
import { initLibrary, loadLibrary } from './js/library.js';
import { initMetadataModal } from './js/metadata-modal.js';
import { initBackup } from './js/backup.js';
import { initStatsView } from './js/stats-view.js';

/* ======================================================================
   Reader
   ====================================================================== */
$('#back-btn').addEventListener('click', closeReader);

async function openReader(id) {
  const book = await DB.get(id);
  if (!book) return;

  state.reader.book = book;
  state.reader.mode = book.readingMode || 'continuous';
  state.reader.currentPage = book.lastPage || 1;
  state.reader.textIndex = new Map();
  state.reader.outline = undefined;

  $('#library-view').classList.remove('view--active');
  $('#reader-view').classList.add('view--active');
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

async function closeReader() {
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
  $('#reader-search-bar').hidden = true;
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

$('#mode-toggle').addEventListener('click', async () => {
  state.reader.mode = state.reader.mode === 'continuous' ? 'paginated' : 'continuous';
  state.reader.book.readingMode = state.reader.mode;
  await DB.put(state.reader.book);
  updateModeIcon();
  await renderReader();
});

$('#zoom-in').addEventListener('click', () => { state.reader.scale = Math.min(2.2, state.reader.scale + 0.15); renderReader(); });
$('#zoom-out').addEventListener('click', () => { state.reader.scale = Math.max(0.6, state.reader.scale - 0.15); renderReader(); });

function updateProgressUI() {
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
    if (!book.finishedAt && book.numPages > 1 && page >= book.numPages) {
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

/* ---- rendering: continuous mode ---- */
async function renderReader() {
  const { pdfDoc, mode } = state.reader;
  if (!pdfDoc) return;
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
(() => {
  let ticking = false;
  $('#pdf-scroll').addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateCurrentPageFromScroll(); });
  }, { passive: true });
})();

/* ---- rendering: paginated mode ---- */
async function renderPaginated() {
  await renderSinglePage(state.reader.currentPage);
}

async function renderSinglePage(n) {
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

$('#prev-page').addEventListener('click', () => renderSinglePage(state.reader.currentPage - 1));
$('#next-page').addEventListener('click', () => renderSinglePage(state.reader.currentPage + 1));

// swipe + edge-tap support in paginated mode
(() => {
  let startX = null;
  const scroll = $('#pdf-scroll');
  scroll.addEventListener('touchstart', (e) => { if (state.reader.mode === 'paginated') startX = e.touches[0].clientX; }, { passive: true });
  scroll.addEventListener('touchend', (e) => {
    if (startX == null || state.reader.mode !== 'paginated') return;
    const dx = e.changedTouches[0].clientX - startX;
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

// re-render on resize / rotation so pages always fit the screen
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!state.reader.pdfDoc || !$('#reader-view').classList.contains('view--active')) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderReader(), 250);
});

/* ---- text layer (selection + search highlighting) via pdf.js's official TextLayer ---- */
async function buildTextLayer(wrap, textContent, viewport) {
  const layer = el('div', 'textLayer');
  layer.style.width = viewport.width + 'px';
  layer.style.height = viewport.height + 'px';
  layer.style.setProperty('--scale-factor', viewport.scale); // required by pdf.js TextLayer
  wrap.appendChild(layer);
  try {
    const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: layer, viewport });
    await textLayer.render();
    applyQuoteHighlights(wrap);
  } catch (e) { /* selection/search just won't work on this page if it fails */ }
}

/* ---- permanent highlights for saved quotes ----
   New quotes store normalized rectangles (0..1 relative to the page) captured
   from the actual selection geometry, so the highlight covers exactly the
   selected text and survives zoom. Legacy quotes (text only) fall back to a
   conservative, length-capped span match so they can never blanket the page. */
function applyQuoteHighlights(wrap) {
  const book = state.reader.book;
  if (!book) return;
  const n = Number(wrap.dataset.page);
  wrap.querySelectorAll('.quote-highlight-layer').forEach((l) => l.remove());
  wrap.querySelectorAll('.quote-highlight').forEach((s) => s.classList.remove('quote-highlight'));
  const quotes = (book.quotes || []).filter((q) => q.page === n);
  if (quotes.length === 0) return;

  const withRects = quotes.filter((q) => Array.isArray(q.rects) && q.rects.length);
  const legacy = quotes.filter((q) => !(Array.isArray(q.rects) && q.rects.length));

  if (withRects.length) {
    const layer = el('div', 'quote-highlight-layer');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    withRects.forEach((q) => q.rects.forEach((r) => {
      const box = el('div', 'quote-highlight-box');
      box.style.left = (r.x * W) + 'px';
      box.style.top = (r.y * H) + 'px';
      box.style.width = (r.w * W) + 'px';
      box.style.height = (r.h * H) + 'px';
      layer.appendChild(box);
    }));
    wrap.insertBefore(layer, wrap.querySelector('.textLayer'));
  }

  if (legacy.length) {
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    // cap at ~160 chars (~2 lines) so an old long quote can't cover the page
    const qtexts = legacy.map((q) => norm(q.text)).filter((t) => t.length >= 3 && t.length <= 160);
    if (qtexts.length) {
      wrap.querySelectorAll('.textLayer span').forEach((span) => {
        const t = norm(span.textContent);
        if (t.length < 3) return;
        if (qtexts.some((q) => q.includes(t))) span.classList.add('quote-highlight');
      });
    }
  }
}

/* Merge the fragmented client-rects of a selection into ONE uniform box per
   visual line. getClientRects() returns one rect per text span, and pdf.js spans
   have mixed font sizes (body text, superscript footnote numbers, …) so the raw
   rects have uneven heights/positions. We size every line to the *median* glyph
   height and center it on the body text, so the highlight bands are homogeneous.
   Input/output are in wrap-local pixel space: [{left,top,right,bottom}]. */
function mergeRectsToLines(rects) {
  const items = rects.filter((r) => (r.right - r.left) >= 1 && (r.bottom - r.top) >= 2);
  if (!items.length) return [];
  const heights = items.map((r) => r.bottom - r.top).sort((a, b) => a - b);
  const bodyH = heights[Math.floor(heights.length / 2)] || heights[0];
  items.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const r of items) {
    const cy = (r.top + r.bottom) / 2;
    let g = lines.find((L) => Math.abs(cy - L.cy) <= bodyH * 0.7);
    if (!g) { g = { cy, left: r.left, right: r.right, sumCy: 0, nTall: 0 }; lines.push(g); }
    g.left = Math.min(g.left, r.left);
    g.right = Math.max(g.right, r.right);
    // refine the vertical center using only full-height (body) rects, so
    // superscripts don't pull the band up or change its height
    if ((r.bottom - r.top) >= bodyH * 0.8) { g.sumCy += cy; g.nTall++; g.cy = g.sumCy / g.nTall; }
  }
  return lines.map((L) => ({ left: L.left, right: L.right, top: L.cy - bodyH / 2, bottom: L.cy + bodyH / 2 }));
}

/* Capture selection rectangles as fractions of the page wrap (0..1), one tidy
   uniform box per line, so saved highlights match the text precisely. */
function captureQuoteRects(range, wrap) {
  if (!range || !wrap) return [];
  const wr = wrap.getBoundingClientRect();
  if (!wr.width || !wr.height) return [];
  const local = [];
  for (const r of range.getClientRects()) {
    local.push({ left: r.left - wr.left, top: r.top - wr.top, right: r.right - wr.left, bottom: r.bottom - wr.top });
  }
  return mergeRectsToLines(local).map((L) => ({
    x: L.left / wr.width,
    y: L.top / wr.height,
    w: (L.right - L.left) / wr.width,
    h: (L.bottom - L.top) / wr.height,
  }));
}
function refreshQuoteHighlights(page) {
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${page}"]`);
  if (wrap) applyQuoteHighlights(wrap);
}

/* ---- live selection overlay ----
   The native ::selection band is uneven (mixed font sizes per span). We hide it
   (CSS) and paint our own uniform per-line bands as the user drags, using the
   same line-merge as saved highlights so the two always look identical. */
function clearLiveSelection() {
  document.querySelectorAll('.sel-live-layer').forEach((l) => l.remove());
}
function drawLiveSelection(range) {
  clearLiveSelection();
  if (!range) return;
  const rects = [...range.getClientRects()];
  if (!rects.length) return;
  document.querySelectorAll('#pdf-pages .pdf-page-wrap').forEach((wrap) => {
    const wr = wrap.getBoundingClientRect();
    const local = [];
    for (const r of rects) {
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      if (cx >= wr.left && cx <= wr.right && cy >= wr.top && cy <= wr.bottom) {
        local.push({ left: r.left - wr.left, top: r.top - wr.top, right: r.right - wr.left, bottom: r.bottom - wr.top });
      }
    }
    const lines = mergeRectsToLines(local);
    if (!lines.length) return;
    const layer = el('div', 'sel-live-layer');
    lines.forEach((L) => {
      const b = el('div', 'sel-live-box');
      b.style.left = L.left + 'px';
      b.style.top = L.top + 'px';
      b.style.width = (L.right - L.left) + 'px';
      b.style.height = (L.bottom - L.top) + 'px';
      layer.appendChild(b);
    });
    wrap.appendChild(layer);
  });
}

/* ---- text selection -> save as quote ---- */
document.addEventListener('selectionchange', () => {
  if (!state.reader.book || $('#reader-view').classList.contains('view--active') === false) return;
  const sel = window.getSelection();
  const text = sel.toString().trim();
  const popover = $('#selection-popover');
  if (!text || sel.rangeCount === 0) { popover.hidden = true; clearLiveSelection(); return; }
  const range = sel.getRangeAt(0);
  const anchorNode = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  if (!anchorNode || !anchorNode.closest('.textLayer')) { popover.hidden = true; clearLiveSelection(); return; }

  drawLiveSelection(range);

  const rect = range.getBoundingClientRect();
  const scrollRect = $('#pdf-scroll').getBoundingClientRect();
  // the popover is absolutely positioned inside its offsetParent (#reader-view),
  // so all coordinates must be expressed relative to that element — not to
  // #pdf-scroll, which sits lower and used to leave the popover floating too high
  const base = (popover.offsetParent || $('#reader-view')).getBoundingClientRect();
  popover.hidden = false;
  // horizontal: centered on the selection, clamped to the visible reader width
  const half = (popover.offsetWidth || 180) / 2;
  const centerX = rect.left + rect.width / 2;
  const clampedX = Math.max(scrollRect.left + half + 6, Math.min(scrollRect.right - half - 6, centerX));
  popover.style.left = (clampedX - base.left) + 'px';
  // flip below the selection when there isn't room above (so it never covers the text)
  const spaceAbove = rect.top - scrollRect.top;
  if (spaceAbove < 52) {
    popover.classList.add('selection-popover--below');
    popover.style.top = (rect.bottom - base.top) + 'px';
  } else {
    popover.classList.remove('selection-popover--below');
    popover.style.top = (rect.top - base.top) + 'px';
  }
  popover.dataset.text = text;
  const wrap = anchorNode.closest('.pdf-page-wrap');
  popover.dataset.page = wrap ? wrap.dataset.page : state.reader.currentPage;
  // stash normalized selection rectangles for a precise, zoom-stable highlight
  popover._rects = wrap ? captureQuoteRects(range, wrap) : [];
});

$('#save-highlight-btn').addEventListener('click', async () => {
  const popover = $('#selection-popover');
  const text = popover.dataset.text;
  const page = Number(popover.dataset.page) || state.reader.currentPage;
  if (!text) return;
  const book = state.reader.book;
  book.quotes = book.quotes || [];
  const rects = Array.isArray(popover._rects) ? popover._rects : [];
  book.quotes.push({ id: uid(), page, text, rects, note: '', addedAt: Date.now() });
  await DB.put(book);
  popover._rects = [];
  popover.hidden = true;
  window.getSelection().removeAllRanges();
  clearLiveSelection();
  refreshQuoteHighlights(page);
  showToast('Quote saved and highlighted');
  if (!$('#side-panel').hidden) renderSidePanel();
});

/* ---- bookmarks ---- */
$('#bookmark-btn').addEventListener('click', async () => {
  const book = state.reader.book;
  const page = state.reader.currentPage;
  book.bookmarks = book.bookmarks || [];
  const idx = book.bookmarks.findIndex((b) => b.page === page);
  if (idx >= 0) book.bookmarks.splice(idx, 1);
  else book.bookmarks.push({ id: uid(), page, addedAt: Date.now() });
  await DB.put(book);
  updateProgressUI();
  showToast(idx >= 0 ? 'Bookmark removed' : 'Bookmark added');
  if (!$('#side-panel').hidden) renderSidePanel();
});

/* ---- side panel (bookmarks / quotes) ---- */
$('#panel-btn').addEventListener('click', () => { $('#side-panel').hidden = false; renderSidePanel(); });
$('#panel-close').addEventListener('click', () => { $('#side-panel').hidden = true; });
document.querySelectorAll('.side-panel__tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.side-panel__tab').forEach((t) => t.classList.remove('side-panel__tab--active'));
    tab.classList.add('side-panel__tab--active');
    const which = tab.dataset.tab;
    $('#bookmarks-list').hidden = which !== 'bookmarks';
    $('#quotes-list').hidden = which !== 'quotes';
    $('#outline-list').hidden = which !== 'outline';
    if (which === 'outline') renderOutline();
  });
});

function renderSidePanel() {
  const book = state.reader.book;
  const bmList = $('#bookmarks-list');
  const qList = $('#quotes-list');
  bmList.innerHTML = '';
  qList.innerHTML = '';

  const bookmarks = (book.bookmarks || []).slice().sort((a, b) => a.page - b.page);
  if (bookmarks.length === 0) bmList.appendChild(el('div', 'panel-empty', 'No bookmarks yet.'));
  bookmarks.forEach((b) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Page ' + b.page));
    item.onclick = () => goToPage(b.page);
    const del = el('button', 'panel-item__delete', 'Remove');
    del.onclick = async (ev) => {
      ev.stopPropagation();
      book.bookmarks = book.bookmarks.filter((x) => x.id !== b.id);
      await DB.put(book);
      renderSidePanel();
      updateProgressUI();
    };
    item.appendChild(del);
    bmList.appendChild(item);
  });

  const quotes = (book.quotes || []).slice().sort((a, b) => a.page - b.page);
  if (quotes.length === 0) {
    qList.appendChild(el('div', 'panel-empty', 'No quotes saved yet.'));
  } else {
    const bar = el('div', 'panel-toolbar');
    const exportBtn = el('button', 'panel-toolbar__btn', '↧ Export quotes');
    exportBtn.onclick = () => exportQuotes(book);
    bar.appendChild(exportBtn);
    qList.appendChild(bar);
  }
  quotes.forEach((q) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Page ' + q.page));
    const textEl = el('div', 'panel-item__text', '"' + escapeHtml(q.text) + '"');
    textEl.onclick = () => goToPage(q.page);
    item.appendChild(textEl);

    // note (shown if present)
    const noteEl = el('div', 'panel-item__note');
    noteEl.hidden = !q.note;
    if (q.note) noteEl.textContent = q.note;
    item.appendChild(noteEl);

    const actions = el('div', 'panel-item__actions');
    const noteBtn = el('button', 'panel-item__link', q.note ? 'Edit note' : 'Add note');
    noteBtn.onclick = (ev) => {
      ev.stopPropagation();
      // toggle an inline editor
      const existing = item.querySelector('.note-editor');
      if (existing) { existing.remove(); return; }
      const ta = el('textarea', 'note-editor');
      ta.value = q.note || '';
      ta.placeholder = 'Write a note about this quote…';
      const saveNote = async () => {
        q.note = ta.value.trim();
        await DB.put(book);
        renderSidePanel();
      };
      ta.addEventListener('blur', saveNote);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ta.blur(); } });
      item.appendChild(ta);
      ta.focus();
    };
    actions.appendChild(noteBtn);

    const del = el('button', 'panel-item__delete', 'Delete');
    del.onclick = async (ev) => {
      ev.stopPropagation();
      book.quotes = book.quotes.filter((x) => x.id !== q.id);
      await DB.put(book);
      refreshQuoteHighlights(q.page);
      renderSidePanel();
    };
    actions.appendChild(del);
    item.appendChild(actions);
    qList.appendChild(item);
  });
}

/* ---- export a book's quotes + notes as a Markdown file ---- */
function exportQuotes(book) {
  const quotes = (book.quotes || []).slice().sort((a, b) => a.page - b.page);
  if (quotes.length === 0) { showToast('No quotes to export'); return; }
  const lines = [];
  lines.push('# ' + (book.title || 'Untitled'));
  if (book.author) lines.push('*' + book.author + '*');
  lines.push('');
  lines.push('> ' + quotes.length + (quotes.length === 1 ? ' quote' : ' quotes') + ' — BookNest');
  lines.push('');
  quotes.forEach((q) => {
    lines.push('### Page ' + q.page);
    lines.push('> ' + q.text.replace(/\n+/g, ' ').trim());
    if (q.note) { lines.push(''); lines.push('**Note:** ' + q.note); }
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = (book.title || 'quotes').replace(/[^\w\sÀ-ÿ-]/g, '').trim().slice(0, 60) || 'quotes';
  a.download = 'quotes-' + safe + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast('Quotes exported');
}

function goToPage(n) {
  $('#side-panel').hidden = true;
  if (state.reader.mode === 'paginated') { renderSinglePage(n); return; }
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${n}"]`);
  if (wrap) $('#pdf-scroll').scrollTo({ top: Math.max(0, wrap.offsetTop - 8), behavior: 'smooth' });
}

/* ---- PDF outline / table of contents ---- */
async function outlineDestToPage(dest) {
  const pdfDoc = state.reader.pdfDoc;
  if (!pdfDoc || dest == null) return null;
  try {
    let explicit = dest;
    if (typeof dest === 'string') explicit = await pdfDoc.getDestination(dest);
    if (!Array.isArray(explicit) || !explicit[0]) return null;
    const idx = await pdfDoc.getPageIndex(explicit[0]);
    return idx + 1;
  } catch (e) { return null; }
}

async function renderOutline() {
  const list = $('#outline-list');
  const pdfDoc = state.reader.pdfDoc;
  list.innerHTML = '';
  if (!pdfDoc) return;
  let outline = state.reader.outline;
  if (outline === undefined) {
    try { outline = await pdfDoc.getOutline(); } catch (e) { outline = null; }
    state.reader.outline = outline;
  }
  if (!outline || outline.length === 0) {
    list.appendChild(el('div', 'panel-empty', 'This PDF has no table of contents.'));
    return;
  }
  const addItems = (items, depth) => {
    items.forEach((it) => {
      const row = el('button', 'outline-item');
      row.style.paddingLeft = (10 + depth * 14) + 'px';
      row.textContent = it.title || '(untitled)';
      row.onclick = async () => {
        const p = await outlineDestToPage(it.dest);
        if (p) goToPage(p);
        else showToast('Destination not available');
      };
      list.appendChild(row);
      if (it.items && it.items.length) addItems(it.items, depth + 1);
    });
  };
  addItems(outline, 0);
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
$('#reader-progress').addEventListener('click', toggleGotoPopover);
$('#goto-go').addEventListener('click', commitGotoPage);
$('#goto-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitGotoPage(); }
  else if (e.key === 'Escape') $('#goto-popover').hidden = true;
});

/* ---- search within the book ---- */
async function buildSearchIndex() {
  const { pdfDoc } = state.reader;
  if (!pdfDoc) return;
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    if (state.reader.textIndex.has(n)) continue;
    try {
      const page = await pdfDoc.getPage(n);
      const tc = await page.getTextContent();
      state.reader.textIndex.set(n, tc.items.map((i) => i.str).join(' '));
    } catch (e) { /* ignore */ }
    if (state.reader.pdfDoc !== pdfDoc) return; // reader closed / changed book meanwhile
  }
}

let searchMatches = [];
let searchMatchPos = -1;

$('#reader-search-btn').addEventListener('click', () => {
  $('#reader-search-bar').hidden = false;
  $('#reader-search-input').focus();
});
$('#reader-search-close').addEventListener('click', () => {
  $('#reader-search-bar').hidden = true;
  $('#reader-search-input').value = '';
  searchMatches = []; searchMatchPos = -1;
  $('#reader-search-count').textContent = '';
});
$('#reader-search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) { searchMatches = []; $('#reader-search-count').textContent = ''; return; }
  searchMatches = [];
  for (const [page, text] of state.reader.textIndex.entries()) {
    if (text.toLowerCase().includes(q)) searchMatches.push(page);
  }
  searchMatches.sort((a, b) => a - b);
  searchMatchPos = searchMatches.length ? 0 : -1;
  $('#reader-search-count').textContent = searchMatches.length
    ? `${searchMatchPos + 1}/${searchMatches.length}`
    : 'no results';
  if (searchMatches.length) jumpToSearchMatch(q);
});
$('#reader-search-next').addEventListener('click', () => {
  if (!searchMatches.length) return;
  searchMatchPos = (searchMatchPos + 1) % searchMatches.length;
  $('#reader-search-count').textContent = `${searchMatchPos + 1}/${searchMatches.length}`;
  jumpToSearchMatch($('#reader-search-input').value.trim().toLowerCase());
});
$('#reader-search-prev').addEventListener('click', () => {
  if (!searchMatches.length) return;
  searchMatchPos = (searchMatchPos - 1 + searchMatches.length) % searchMatches.length;
  $('#reader-search-count').textContent = `${searchMatchPos + 1}/${searchMatches.length}`;
  jumpToSearchMatch($('#reader-search-input').value.trim().toLowerCase());
});

async function jumpToSearchMatch(q) {
  const page = searchMatches[searchMatchPos];
  if (!page) return;
  if (state.reader.mode === 'paginated') {
    await renderSinglePage(page);
    highlightQueryOnPage(page, q);
  } else {
    let wrap = document.querySelector(`.pdf-page-wrap[data-page="${page}"]`);
    if (wrap) {
      $('#pdf-scroll').scrollTo({ top: Math.max(0, wrap.offsetTop - 8), behavior: 'smooth' });
      setTimeout(() => highlightQueryOnPage(page, q), 350);
    }
  }
}

function highlightQueryOnPage(page, q) {
  document.querySelectorAll('.search-highlight').forEach((s) => s.classList.remove('search-highlight'));
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${page}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('.textLayer span').forEach((span) => {
    if (span.textContent.toLowerCase().includes(q)) span.classList.add('search-highlight');
  });
}

/* ======================================================================
   Init
   ====================================================================== */
initTheme();
initReadingTimeTracking();
initLibrary();
initMetadataModal();
initBackup();
initStatsView();
loadLibrary();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Temporary: js/library.js imports openReader from here until the reader moves to js/reader.js.
export { openReader };
