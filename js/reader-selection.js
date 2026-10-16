import { pdfjsLib } from './pdf.js';
import { state } from './state.js';
import { $, el, uid, showToast } from './dom.js';
import { DB } from './db.js';
import { renderSidePanel } from './reader-panel.js';
import { speak, speechSupported } from './speech.js';
import { stopReadAloud } from './reader-tts.js';

/* ---- text layer (selection + search highlighting) via pdf.js's official TextLayer ---- */
export async function buildTextLayer(wrap, textContent, viewport) {
  const layer = el('div', 'textLayer');
  layer.style.width = viewport.width + 'px';
  layer.style.height = viewport.height + 'px';
  // pdf.js sizes and places every text span with calc(var(--total-scale-factor) * …px).
  // Without it the invisible text is the wrong size and drifts away from the printed
  // glyphs, so a finger on one word selects its neighbour.
  layer.style.setProperty('--scale-factor', viewport.scale);
  layer.style.setProperty('--total-scale-factor', viewport.scale * (viewport.userUnit || 1));
  layer.style.setProperty('--scale-round-x', '1px');
  layer.style.setProperty('--scale-round-y', '1px');
  wrap.appendChild(layer);
  try {
    const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: layer, viewport });
    await textLayer.render();
    layer.appendChild(el('div', 'endOfContent')); // anti-jump target while selecting (see css/selection.css)
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
  // a rect without its own page belongs to the quote's page (quotes saved before
  // selections could span pages); a quote can also reach onto this page from the previous one
  const rectPage = (q, r) => (r.page != null ? r.page : q.page);
  const hasRects = (q) => Array.isArray(q.rects) && q.rects.length;
  const all = book.quotes || [];
  const withRects = all.filter((q) => hasRects(q) && q.rects.some((r) => rectPage(q, r) === n));
  const legacy = all.filter((q) => q.page === n && !hasRects(q));
  if (withRects.length === 0 && legacy.length === 0) return;

  if (withRects.length) {
    const layer = el('div', 'quote-highlight-layer');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    withRects.forEach((q) => q.rects.filter((r) => rectPage(q, r) === n).forEach((r) => {
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

/* Capture selection rectangles as fractions of their page wrap (0..1), one tidy
   uniform box per line, so saved highlights match the text precisely. A selection
   can span pages: every rect is measured against, and tagged with, its own page. */
/* Rects of the selected TEXT only. range.getClientRects() also returns the boxes of every
   element fully inside the range — across a page break that includes whole page layers,
   which would paint a highlight over the entire page. */
function textRects(range) {
  const root = range.commonAncestorContainer.nodeType === 3
    ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (range.intersectsNode(n) && n.parentElement && n.parentElement.closest('.textLayer')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const out = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const r = document.createRange();
    r.selectNodeContents(n);
    if (n === range.startContainer) r.setStart(n, range.startOffset);
    if (n === range.endContainer) r.setEnd(n, range.endOffset);
    out.push(...r.getClientRects());
  }
  return out;
}

function captureQuoteRects(range) {
  if (!range) return [];
  const rects = textRects(range);
  const out = [];
  document.querySelectorAll('#pdf-pages .pdf-page-wrap').forEach((wrap) => {
    const wr = wrap.getBoundingClientRect();
    if (!wr.width || !wr.height) return;
    const local = [];
    for (const r of rects) {
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      if (cx >= wr.left && cx <= wr.right && cy >= wr.top && cy <= wr.bottom) {
        local.push({ left: r.left - wr.left, top: r.top - wr.top, right: r.right - wr.left, bottom: r.bottom - wr.top });
      }
    }
    const page = Number(wrap.dataset.page);
    mergeRectsToLines(local).forEach((L) => out.push({
      page,
      x: L.left / wr.width,
      y: L.top / wr.height,
      w: (L.right - L.left) / wr.width,
      h: (L.bottom - L.top) / wr.height,
    }));
  });
  return out;
}
export function refreshQuoteHighlights(page) {
  // a quote may cover the next page too: refresh every rendered page that shows it
  document.querySelectorAll('#pdf-pages .pdf-page-wrap').forEach((wrap) => {
    const n = Number(wrap.dataset.page);
    if (page == null || n === page || n === page + 1) applyQuoteHighlights(wrap);
  });
}

/* ---- live selection overlay ----
   The native ::selection band is uneven (mixed font sizes per span). We hide it
   (CSS) and paint our own uniform per-line bands as the user drags, using the
   same line-merge as saved highlights so the two always look identical. */
export function clearLiveSelection() {
  document.querySelectorAll('.sel-live-layer').forEach((l) => l.remove());
}
function drawLiveSelection(range) {
  clearLiveSelection();
  if (!range) return;
  const rects = textRects(range);
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

export function initReaderSelection() {
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
    popover._rects = captureQuoteRects(range);
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

  /* ---- extra actions on the selected text ---- */
  const popoverText = () => $('#selection-popover').dataset.text || '';
  const dismissSelection = () => {
    $('#selection-popover').hidden = true;
    window.getSelection().removeAllRanges();
    clearLiveSelection();
  };
  $('#sel-speak-btn').hidden = !speechSupported;
  $('#sel-copy-btn').addEventListener('click', async () => {
    const t = popoverText();
    try { await navigator.clipboard.writeText(t); showToast('Copied'); }
    catch (e) { showToast("Couldn't copy"); }
    dismissSelection();
  });
  $('#sel-define-btn').addEventListener('click', () => {
    window.open('https://en.wiktionary.org/wiki/Special:Search?search=' + encodeURIComponent(popoverText()), '_blank', 'noopener');
    dismissSelection();
  });
  $('#sel-translate-btn').addEventListener('click', () => {
    const tl = (navigator.language || 'en').slice(0, 2).toLowerCase();
    window.open('https://translate.google.com/?sl=auto&tl=' + tl + '&text=' + encodeURIComponent(popoverText()) + '&op=translate', '_blank', 'noopener');
    dismissSelection();
  });
  $('#sel-speak-btn').addEventListener('click', () => {
    stopReadAloud();
    speak(popoverText());
    dismissSelection();
  });
}
