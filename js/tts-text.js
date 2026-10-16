/* Text preparation for read-aloud: pure functions (no DOM), unit-tested in node.
   Goal: natural pacing — one sentence per utterance, clean text without hyphen
   breaks, running headers/footers or page numbers. */

const TERMINAL = /[.!?…]["'”’»)\]]*$/;
const CLOSERS = `"'”’»)\\]`;
// a sentence end: punctuation (+ closing quotes/brackets) followed by whitespace or end
const SENTENCE_END = new RegExp(`[.!?…]+[${CLOSERS}]*(?=\\s|$)`, 'g');
// words after which a "." does not end the sentence
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'cf', 'no', 'nr', 'vol', 'ch',
  'fig', 'pp', 'p', 'ca', 'sig', 'sigg', 'dott', 'ing', 'avv', 'mme', 'mlle', 'hr', 'fr', 'sra', 'sr', 'ed', 'eds', 'op', 'cit']);
// ambiguous: end the sentence only when the next word is capitalized
const SOFT_ABBR = new Set(['etc', 'ecc', 'usw', 'etc']);

export const endsSentence = (t) => TERMINAL.test(String(t || '').trim());
const startsLikeNewSentence = (t) => /^["'“‘«(\[—–-]?\s*[\p{Lu}\p{N}]/u.test(t);
const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const lineKey = (s) => collapse(s).toLowerCase().replace(/\d+/g, '#');

const PAGE_NUM = /^[-–—\s([]*\d{1,4}[-–—\s)\]]*$/;
const PAGE_ROMAN = /^[-–—\s([]*[ivxlcdm]{1,7}[-–—\s)\]]*$/i;
const PAGE_LABEL = /^(page|p\.|pag\.|pagina|seite|página)\s*\d+(\s*(of|di|von|de|\/)\s*\d+)?$/i;
const EDGE = 2; // header/footer candidates: the first/last EDGE non-empty lines of a page

/* Headers/footers: edge lines (digits normalized) found on >= 3 of the sampled pages. */
export function detectRepeatedLines(pagesLines, minPages = 3) {
  const counts = new Map();
  for (const lines of pagesLines || []) {
    const ne = (lines || []).map(collapse).filter(Boolean);
    const edges = new Set([...ne.slice(0, EDGE), ...ne.slice(Math.max(EDGE, ne.length - EDGE))].map(lineKey));
    for (const k of edges) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = new Set();
  for (const [k, c] of counts) if (c >= minPages && /\p{L}/u.test(k)) out.add(k);
  return out;
}

/* Raw page text (lines separated by "\n"; a blank line = vertical gap; leading spaces = indent)
   → clean text: paragraphs separated by "\n\n", lines joined, hyphen breaks healed,
   page numbers and the given repeated header/footer lines dropped. */
export function cleanPageText(rawText, { prevPageTail = '', repeatedLines = null } = {}) {
  const repeated = repeatedLines instanceof Set ? repeatedLines : new Set(repeatedLines || []);
  let lines = String(rawText || '').split(/\r?\n/).map((raw) => ({
    text: collapse(raw), indent: /^\s{2,}\S/.test(raw),
  }));
  // drop page numbers and running headers/footers
  const nonEmpty = lines.map((l, i) => (l.text ? i : -1)).filter((i) => i >= 0);
  const edgeIdx = new Set([...nonEmpty.slice(0, EDGE), ...nonEmpty.slice(-EDGE)]);
  lines = lines.filter((l, i) => {
    if (!l.text) return true;
    if (PAGE_NUM.test(l.text) || PAGE_LABEL.test(l.text)) return false;
    if (edgeIdx.has(i) && PAGE_ROMAN.test(l.text)) return false;
    if (edgeIdx.has(i) && repeated.has(lineKey(l.text))) return false;
    return true;
  });
  const maxLen = Math.max(0, ...lines.map((l) => l.text.length));
  const nextText = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].text) return lines[j].text; return ''; };

  const paragraphs = [];
  let cur = collapse(prevPageTail || '');
  let prevLine = cur;
  const flush = () => { if (cur) paragraphs.push(cur); cur = ''; prevLine = ''; };
  lines.forEach((l, i) => {
    const t = l.text;
    if (!t) { flush(); return; }
    if (!cur) {
      // short heading ("Chapter one") followed by a new sentence: its own paragraph
      const nx = nextText(i);
      if (!endsSentence(t) && !/[,;:\-]$/.test(t) && maxLen >= 20 && t.length <= 0.6 * maxLen
        && nx && startsLikeNewSentence(t) && startsLikeNewSentence(nx)) {
        paragraphs.push(t);
        return;
      }
      cur = t; prevLine = t; return;
    }
    if (/\p{L}-$/u.test(cur)) {
      cur = /^\p{Ll}/u.test(t) ? cur.slice(0, -1) + t : cur + t; // libe-|ro → libero ; Franco-|German
    } else if (endsSentence(prevLine) && startsLikeNewSentence(t) && (l.indent || prevLine.length < 0.75 * maxLen)) {
      flush(); cur = t;
    } else {
      cur += ' ' + t;
    }
    prevLine = t;
  });
  flush();
  return paragraphs.join('\n\n');
}

function splitParagraphIntoSentences(p) {
  const out = [];
  let start = 0;
  let m;
  SENTENCE_END.lastIndex = 0;
  while ((m = SENTENCE_END.exec(p))) {
    const end = m.index + m[0].length;
    if (/^\.[^.]*$/.test(m[0].replace(new RegExp(`[${CLOSERS}]+$`), ''))) { // a single "."
      const word = (p.slice(start, m.index).match(/(\S+)$/) || ['', ''])[1].replace(/^["'“‘«(\[]+/, '');
      const lw = word.toLowerCase();
      const next = p.slice(end).trimStart();
      if (ABBR.has(lw)) continue;
      if (/^\p{Lu}$/u.test(word) && word !== 'I') continue; // initials: J. R. R. Tolkien
      if (/^(\p{L}\.)+\p{L}$/u.test(word)) continue; // e.g. i.e. z.B.
      if (SOFT_ABBR.has(lw) && !/^\p{Lu}/u.test(next)) continue;
    }
    const s = p.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  }
  const rest = p.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/* Cut an over-long sentence at ; or : then , then a space — never mid-word
   (only a single "word" longer than max is hard-cut). */
function splitLong(s, max) {
  const out = [];
  const minLen = Math.floor(max * 0.25);
  const lastCut = (win, re) => {
    let best = -1;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(win))) if (m.index + 1 >= minLen) best = m.index + 1;
    return best;
  };
  while (s.length > max) {
    const win = s.slice(0, max + 1);
    let c = lastCut(win, /[;:](?=\s)/g);
    if (c < 0) c = lastCut(win, /,(?=\s)/g);
    if (c < 0) c = win.lastIndexOf(' ');
    if (c <= 0) c = max;
    out.push(s.slice(0, c).trim());
    s = s.slice(c).trim();
  }
  if (s) out.push(s);
  return out;
}

/* Clean text → [{ text, paragraphEnd }], each text <= max chars. */
export function splitSentences(text, max = 220) {
  const out = [];
  for (const para of String(text || '').split(/\n\s*\n/)) {
    const p = collapse(para);
    if (!p) continue;
    const pieces = splitParagraphIntoSentences(p).flatMap((s) => (s.length <= max ? [s] : splitLong(s, max)));
    pieces.forEach((t, i) => out.push({ text: t, paragraphEnd: i === pieces.length - 1 }));
  }
  return out;
}

/* pdf.js text items → lines. A line ends on hasEOL or when the baseline moves;
   a vertical gap well above the usual line spacing becomes a blank line; lines
   starting right of the left margin get a two-space indent marker. */
export function linesFromItems(items) {
  const lines = [];
  let cur = null;
  const push = () => { if (cur && collapse(cur.str)) lines.push({ ...cur, str: collapse(cur.str) }); cur = null; };
  for (const it of items || []) {
    const str = it.str || '';
    const x = it.transform ? it.transform[4] : 0;
    const y = it.transform ? it.transform[5] : 0;
    const h = it.height || (it.transform ? Math.abs(it.transform[3]) : 10) || 10;
    if (str.trim()) {
      if (cur && cur.str.trim() && Math.abs(y - cur.y) > h * 0.5) push();
      if (!cur || !cur.str.trim()) cur = { str: (cur ? cur.str : ''), x, y, h };
      cur.str += str;
    } else if (cur) {
      cur.str += str;
    }
    if (it.hasEOL) push();
  }
  push();
  if (!lines.length) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) { const g = lines[i - 1].y - lines[i].y; if (g > 0) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const median = gaps.length >= 2 ? gaps[Math.floor((gaps.length - 1) / 2)] : 0; // lower median: the usual line spacing
  const minX = Math.min(...lines.map((l) => l.x));
  const out = [];
  lines.forEach((l, i) => {
    if (i > 0 && median > 0 && lines[i - 1].y - l.y > median * 1.6) out.push('');
    const indented = l.x - minX > Math.max(l.h, 8);
    out.push((indented ? '  ' : '') + l.str);
  });
  return out;
}

const lineCache = new WeakMap(); // pdfDoc → Map(pageNumber → lines)

/* The lines of page n (cached per document). */
export async function getPageLines(pdfDoc, n) {
  let m = lineCache.get(pdfDoc);
  if (!m) { m = new Map(); lineCache.set(pdfDoc, m); }
  if (m.has(n)) return m.get(n);
  const page = await pdfDoc.getPage(n);
  const tc = await page.getTextContent();
  const lines = linesFromItems(tc.items);
  m.set(n, lines);
  return lines;
}
