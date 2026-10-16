/* Words and sentences inside a text string (pure: no DOM, unit-tested in node). */

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const TERMINATORS = '.!?…';
const CLOSERS = '"\'”’»)]';

export function splitWords(text) {
  const out = [];
  for (const m of String(text || '').matchAll(WORD_RE)) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/* The word containing `index`; in a gap, the closest word (ties go to the next word). */
export function wordAt(text, index) {
  let best = null, bestDist = Infinity;
  for (const w of splitWords(text)) {
    if (index >= w.start && index < w.end) return w;
    const dist = index < w.start ? w.start - index : index - w.end + 1;
    if (dist < bestDist) { best = w; bestDist = dist; }
  }
  return best;
}

/* Sentence boundaries: a run of terminators (plus closing quotes/brackets) followed by
   whitespace and a word that does not start lowercase (so "e.g. hammers" stays one
   sentence), or a paragraph break ("\n\n"). */
function sentenceSplits(text) {
  const splits = []; // [endOfSentence, startOfNext]
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      let j = i; while (j < text.length && /\s/.test(text[j])) j++;
      splits.push([i, j]); i = j; continue;
    }
    if (TERMINATORS.includes(text[i])) {
      let k = i; while (k < text.length && TERMINATORS.includes(text[k])) k++;
      while (k < text.length && CLOSERS.includes(text[k])) k++;
      if (k >= text.length) { splits.push([k, k]); i = k; continue; }
      if (/\s/.test(text[k])) {
        let j = k; while (j < text.length && /\s/.test(text[j])) j++;
        const next = text[j] || '';
        if (!(next && next === next.toLowerCase() && next !== next.toUpperCase())) {
          splits.push([k, j]); i = j; continue;
        }
      }
      i = k; continue;
    }
    i++;
  }
  return splits;
}

export function sentenceBounds(text, index) {
  let start = 0, end = text.length;
  for (const [sEnd, nextStart] of sentenceSplits(text)) {
    if (index < nextStart && index >= start) { end = sEnd; break; }
    start = nextStart;
  }
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}
