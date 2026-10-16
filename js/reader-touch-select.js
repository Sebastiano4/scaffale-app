/* Touch-friendly text selection: long-press a word, tap to extend, double-tap for a sentence.
   Selections are applied as real DOM ranges, so the existing selectionchange → popover flow
   (quote / copy / define / translate / speak) keeps working unchanged. Also snaps mouse drag
   selections to whole words and drives pdf.js's anti-jump "selecting" class. */
import { $ } from './dom.js';
import { splitWords, wordAt, sentenceBounds, nearestRect } from './word-geometry.js';

const LONG_PRESS_MS = 450;
const SLOP = 10;              // px a finger may wander and still be a press/tap
const TAP_MAX_MS = 350;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DIST = 30;
const HIT_TOLERANCE = 4;      // px around a span still counts as "on the text"
const PRESS_REACH = 18;       // px: a long-press this close to a word still selects it
const TAP_REACH = 44;         // px: an extending tap / drag snaps to the nearest word within this
const EDGE = 70;              // px from the top/bottom of the reader where a drag auto-scrolls
const MAX_SCROLL_STEP = 18;   // px per frame at the very edge
const SHORT_LINE = 0.75;      // a line ending before 75% of the page's text width ends a paragraph

let anchor = null;            // Range of the word/sentence the current selection grew from

function textLayerOf(node) {
  const e = node && (node.nodeType === 3 ? node.parentElement : node);
  return e && e.closest ? e.closest('.textLayer') : null;
}

function within(rect, x, y) {
  return x >= rect.left - HIT_TOLERANCE && x <= rect.right + HIT_TOLERANCE
    && y >= rect.top - HIT_TOLERANCE && y <= rect.bottom + HIT_TOLERANCE;
}

/* Text node + offset under a screen point, only if the point is really on text. */
function caretAt(x, y) {
  let node = null, offset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  if (node && node.nodeType === 3 && textLayerOf(node) && within(node.parentElement.getBoundingClientRect(), x, y)) {
    return { node, offset };
  }
  // fallback: the span under the point, offset estimated from the horizontal position
  const span = document.elementsFromPoint(x, y).find((e) => e.matches && e.matches('.textLayer span'));
  const t = span && span.firstChild;
  if (!t || t.nodeType !== 3) return null;
  const b = span.getBoundingClientRect();
  return { node: t, offset: Math.round(((x - b.left) / Math.max(1, b.width)) * t.textContent.length) };
}

/* Like caretAt, but a finger that lands near the text (between lines, past a line's end)
   snaps to the nearest span within `reach` px. */
function caretNear(x, y, reach) {
  const exact = caretAt(x, y);
  if (exact) return exact;
  const spans = [];
  for (const wrap of document.querySelectorAll('.pdf-page-wrap')) {
    const w = wrap.getBoundingClientRect();
    if (y < w.top - reach || y > w.bottom + reach) continue;
    for (const s of wrap.querySelectorAll('.textLayer span')) {
      const t = s.firstChild;
      if (t && t.nodeType === 3 && /[\p{L}\p{N}]/u.test(t.textContent)) spans.push(s);
    }
  }
  const rects = spans.map((s) => s.getBoundingClientRect());
  const i = nearestRect(rects, x, y, reach);
  if (i === null) return null;
  const t = spans[i].firstChild;
  const b = rects[i];
  const frac = Math.min(1, Math.max(0, (x - b.left) / Math.max(1, b.width)));
  return { node: t, offset: Math.round(frac * t.textContent.length) };
}

function wordRangeAt(x, y, reach = 0) {
  const c = reach ? caretNear(x, y, reach) : caretAt(x, y);
  if (!c) return null;
  const w = wordAt(c.node.textContent, Math.min(c.offset, c.node.textContent.length));
  if (!w) return null;
  const r = document.createRange();
  r.setStart(c.node, w.start);
  r.setEnd(c.node, w.end);
  return r;
}

/* The page's text as one string, with a map back to the text nodes. Short lines
   (headings, paragraph ends) become paragraph breaks so sentences never swallow them. */
function layerModel(layer) {
  const lr = layer.getBoundingClientRect();
  const spans = [...layer.querySelectorAll('span')];
  const maxRight = Math.max(1, ...spans.map((s) => s.getBoundingClientRect().right - lr.left));
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 3 || n.nodeName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  let text = '';
  let lineRight = 0;
  const segs = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      segs.push({ node: n, start: text.length, end: text.length + n.textContent.length });
      text += n.textContent;
      lineRight = Math.max(lineRight, n.parentElement.getBoundingClientRect().right - lr.left);
    } else {
      const short = lineRight < maxRight * SHORT_LINE && !/[-‐]\s*$/.test(text);
      text += short ? '\n\n' : ' ';
      lineRight = 0;
    }
  }
  return { text, segs };
}

function pointAt(model, index, side) {
  for (let i = 0; i < model.segs.length; i++) {
    const s = model.segs[i];
    if (index >= s.start && index <= s.end) return { node: s.node, offset: index - s.start };
    if (index < s.start) {
      // inside a separator: snap to the neighbouring text
      if (side === 'start') return { node: s.node, offset: 0 };
      const p = model.segs[i - 1] || s;
      return { node: p.node, offset: p === s ? 0 : p.node.textContent.length };
    }
  }
  const last = model.segs[model.segs.length - 1];
  return last ? { node: last.node, offset: last.node.textContent.length } : null;
}

function sentenceRangeAt(x, y) {
  const c = caretAt(x, y);
  if (!c) return null;
  const layer = textLayerOf(c.node);
  const model = layerModel(layer);
  const seg = model.segs.find((s) => s.node === c.node);
  if (!seg) return null;
  const { start, end } = sentenceBounds(model.text, seg.start + Math.min(c.offset, seg.end - seg.start));
  const a = pointAt(model, start, 'start');
  const b = pointAt(model, end, 'end');
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

/* The sentence around the start of a selection, as plain text (for dictionary contexts). */
export function sentenceAround(range) {
  const layer = textLayerOf(range.startContainer);
  if (!layer) return '';
  const model = layerModel(layer);
  const seg = model.segs.find((s) => s.node === range.startContainer);
  if (!seg) return '';
  const { start, end } = sentenceBounds(model.text, seg.start + range.startOffset);
  return model.text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 300);
}

function applyRange(r) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function setAnchor(r) { anchor = r.cloneRange(); }

/* Grow the selection from the anchor to the tapped word, in either direction. */
function extendTo(wr) {
  const r = document.createRange();
  if (anchor.compareBoundaryPoints(Range.START_TO_START, wr) <= 0) {
    r.setStart(anchor.startContainer, anchor.startOffset);
    r.setEnd(wr.endContainer, wr.endOffset);
  } else {
    r.setStart(wr.startContainer, wr.startOffset);
    r.setEnd(anchor.endContainer, anchor.endOffset);
  }
  applyRange(r);
}

function hasSelection() {
  const sel = window.getSelection();
  return sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim() !== '';
}

/* Snap a mouse drag selection outward to whole words. */
function snapToWords() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0 || sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  if (!textLayerOf(r.startContainer) || !textLayerOf(r.endContainer)) return;
  const out = r.cloneRange();
  if (r.startContainer.nodeType === 3) {
    const w = splitWords(r.startContainer.textContent).find((x) => r.startOffset > x.start && r.startOffset < x.end);
    if (w) out.setStart(r.startContainer, w.start);
  }
  if (r.endContainer.nodeType === 3) {
    const w = splitWords(r.endContainer.textContent).find((x) => r.endOffset > x.start && r.endOffset < x.end);
    if (w) out.setEnd(r.endContainer, w.end);
  }
  if (out.compareBoundaryPoints(Range.START_TO_START, r) !== 0 || out.compareBoundaryPoints(Range.END_TO_END, r) !== 0) {
    applyRange(out);
  }
}

function initTouch(scroll) {
  let press = null;     // current touch: { x, y, time, timer, longPressed }
  let lastTap = null;   // { x, y, time } for double-tap detection

  scroll.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { if (press) clearTimeout(press.timer); press = null; return; }
    const t = e.touches[0];
    const p = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false, longPressed: false };
    p.timer = setTimeout(() => {
      if (press !== p || p.moved) return;
      const wr = wordRangeAt(p.x, p.y, PRESS_REACH);
      if (!wr) return;
      p.longPressed = true;
      p.lastX = p.x;
      p.lastY = p.y;
      applyRange(wr);
      setAnchor(wr);
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* not allowed */ } }
      autoScroll(p);
    }, LONG_PRESS_MS);
    press = p;
  }, { passive: true });

  // after a long-press the finger drags the selection end (the page must not scroll)
  const dragTo = (p) => {
    const wr = wordRangeAt(p.lastX, p.lastY, TAP_REACH);
    if (wr && anchor) extendTo(wr);
  };
  // near the top/bottom edge, keep scrolling (and extending) while the finger stays there
  const autoScroll = (p) => {
    if (press !== p) return;
    const r = scroll.getBoundingClientRect();
    let step = 0;
    if (p.lastY > r.bottom - EDGE) step = ((p.lastY - (r.bottom - EDGE)) / EDGE) * MAX_SCROLL_STEP;
    else if (p.lastY < r.top + EDGE) step = -(((r.top + EDGE) - p.lastY) / EDGE) * MAX_SCROLL_STEP;
    if (p.dragged && step) {
      scroll.scrollTop += Math.max(-MAX_SCROLL_STEP, Math.min(MAX_SCROLL_STEP, step));
      dragTo(p);
    }
    p.raf = requestAnimationFrame(() => autoScroll(p));
  };

  scroll.addEventListener('touchmove', (e) => {
    if (!press) return;
    const t = e.touches[0];
    if (press.longPressed) {
      e.preventDefault();
      press.lastX = t.clientX;
      press.lastY = t.clientY;
      if (Math.hypot(t.clientX - press.x, t.clientY - press.y) > SLOP) press.dragged = true;
      if (press.dragged) dragTo(press);
      return;
    }
    if (Math.hypot(t.clientX - press.x, t.clientY - press.y) > SLOP) { press.moved = true; clearTimeout(press.timer); }
  }, { passive: false });

  scroll.addEventListener('touchend', (e) => {
    const p = press; press = null;
    if (!p) return;
    clearTimeout(p.timer);
    cancelAnimationFrame(p.raf);
    if (p.longPressed) { e.preventDefault(); return; } // keep our selection: no click, no collapse
    if (p.moved || Date.now() - p.time > TAP_MAX_MS) return;

    const now = Date.now();
    if (lastTap && now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_DIST) {
      lastTap = null;
      const sr = sentenceRangeAt(p.x, p.y);
      if (sr) { e.preventDefault(); applyRange(sr); setAnchor(sr); }
      return;
    }
    lastTap = { x: p.x, y: p.y, time: now };

    if (!anchor || !hasSelection()) return; // nothing selected: a plain tap stays a plain tap
    e.preventDefault();
    const wr = wordRangeAt(p.x, p.y, TAP_REACH);
    if (wr) extendTo(wr);
    else { window.getSelection().removeAllRanges(); anchor = null; } // far from any text
  }, { passive: false });

  scroll.addEventListener('touchcancel', () => {
    if (press) { clearTimeout(press.timer); cancelAnimationFrame(press.raf); }
    press = null;
  });

  // Android's own long-press selection/callout would fight ours on the text layer
  scroll.addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('.textLayer') && (e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents)) {
      e.preventDefault();
    }
  });
}

function initMouse(scroll) {
  let dragging = false;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const layer = e.target.closest && e.target.closest('.textLayer');
    if (!layer) return;
    dragging = true;
    anchor = null;
    layer.classList.add('selecting'); // pdf.js anti-jump: .endOfContent covers the layer while dragging
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    document.querySelectorAll('.textLayer.selecting').forEach((l) => l.classList.remove('selecting'));
    snapToWords();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

export function initTouchSelect() {
  const scroll = $('#pdf-scroll');
  if (!scroll) return;
  initTouch(scroll);
  initMouse(scroll);
  // a selection cleared elsewhere (popover actions, Escape) must not be extended later
  document.addEventListener('selectionchange', () => { if (!hasSelection()) anchor = null; });
}
