/* Word meanings from Wiktionary.
   Italian books: it.wiktionary (action=parse HTML, Italian section only), falling back to the
   English Wiktionary's Italian entries. Other languages: en.wiktionary REST definitions.
   Inflected forms ("plurale di X", "… indicativo di X", "plural of X") follow X once. */

const TIMEOUT_MS = 8000;
const MAX_SENSES = 3;
const IT_API = 'https://it.wiktionary.org/w/api.php?action=parse&prop=text&format=json&formatversion=2&origin=*&page=';
const EN_REST = 'https://en.wiktionary.org/api/rest_v1/page/definition/';

// h3 headings on it.wiktionary that are not a part of speech
const NOT_POS = /sillabazione|pronuncia|etimologia|sinonimi|contrari|derivat|correlat|variant|traduzion|proverbi|alterat|citazion|note|riferiment|iponimi|iperonimi|locuzioni|parole/i;
// an Italian sense that only points to another form ("plurale di sgomento")
const IT_POINTER = /^(plurale|singolare|femminile|maschile|.*\b(persona|participio|gerundio|infinito|indicativo|congiuntivo|condizionale|imperativo|passato remoto))\b.*\bdi\s+([\p{L}'’-]+)\s*$/iu;

class NetworkError extends Error {}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

function textOf(node) {
  node.querySelectorAll('style, script, ul, ol, dl, sup.reference').forEach((n) => n.remove());
  return squash(node.textContent || '');
}

/* "(psicologia) (medicina) stato di…" → "(psicologia) stato di…" */
function tidySense(s) {
  return s.replace(/^(\([^)]*\))(\s*\([^)]*\))+/, '$1').replace(/\s+([,.;:])/g, '$1');
}

/* it.wiktionary parse HTML → [{ pos, senses: [{ text, target }] }] for the Italian section. */
export function parseItalian(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') || doc.body;
  const sections = [];
  let inItalian = false;
  let pos = null;
  for (const child of root.children) {
    const h2 = child.matches('h2') ? child : child.querySelector('h2');
    if (h2) {
      if (inItalian) break;
      inItalian = /italiano/i.test(h2.textContent);
      continue;
    }
    if (!inItalian) continue;
    const h3 = child.matches('h3') ? child : child.querySelector('h3');
    if (h3) {
      const t = squash(h3.textContent);
      pos = NOT_POS.test(t) ? null : t;
      continue;
    }
    if (child.tagName !== 'OL' || !pos) continue;
    const senses = [];
    for (const li of child.children) {
      if (li.tagName !== 'LI') continue;
      const text = tidySense(textOf(li.cloneNode(true)));
      if (!text) continue;
      const m = text.match(IT_POINTER);
      senses.push({ text, target: m ? m[m.length - 1] : null });
    }
    if (senses.length) sections.push({ pos, senses });
  }
  return sections;
}

/* en.wiktionary REST JSON → same shape, for one language code. */
export function parseEnglishRest(json, lang) {
  const entries = (json && json[lang]) || [];
  return entries.map((e) => ({
    pos: e.partOfSpeech || null,
    senses: (e.definitions || []).map((d) => {
      const doc = new DOMParser().parseFromString(d.definition || '', 'text/html');
      const link = doc.querySelector('.form-of-definition-link a') || [...doc.querySelectorAll('.form-of-definition a')].pop();
      const formOf = !!doc.querySelector('.form-of-definition');
      const text = tidySense(textOf(doc.body));
      return { text, target: formOf && link ? squash(link.textContent) : null };
    }).filter((s) => s.text),
  })).filter((s) => s.senses.length);
}

/* Choose what to show from the first section (the main meaning; a part of speech matching
   `posHint` goes first): its real senses, or — if it only points to a base form — that pointer. */
function pick(sections, posHint) {
  const ordered = posHint
    ? [...sections.filter((s) => posHint.test(s.pos)), ...sections.filter((s) => !posHint.test(s.pos))]
    : sections;
  for (const s of ordered) {
    const real = s.senses.filter((x) => !x.target);
    if (real.length) return { pos: cleanPos(s.pos), senses: real.slice(0, MAX_SENSES).map((x) => x.text) };
    const p = s.senses.find((x) => x.target);
    if (p) return { pos: cleanPos(s.pos), senses: [p.text], redirect: p.target, posHint: hintFor(s.pos) };
  }
  return null;
}

const cleanPos = (pos) => (pos ? pos.split(',')[0].trim() : null);
function hintFor(pos) {
  if (/verb/i.test(pos || '')) return /verb/i;           // "Voce verbale" → "Verbo"; "Verb" → "Verb"
  const base = cleanPos(pos);
  return base ? new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new NetworkError('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    if (e instanceof NetworkError) throw e;
    throw new NetworkError(e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function italianSections(word) {
  const j = await getJson(IT_API + encodeURIComponent(word));
  if (!j || j.error || !j.parse) return null;
  return parseItalian(j.parse.text);
}

async function englishSections(word, lang) {
  const j = await getJson(EN_REST + encodeURIComponent(word));
  return j ? parseEnglishRest(j, lang) : null;
}

/* One source, following an inflection pointer once. */
async function fromSource(fetchSections, word, posHint = null, depth = 0) {
  const sections = await fetchSections(word);
  if (!sections || !sections.length) return null;
  const d = pick(sections, posHint);
  if (!d) return null;
  if (d.redirect && depth === 0) {
    const base = await fromSource(fetchSections, d.redirect, d.posHint, 1);
    if (base) return { ...base, lemma: base.lemma || d.redirect };
  }
  return { pos: d.pos, senses: d.senses, lemma: d.redirect || null };
}

/* → { status: 'ok', lemma, pos, senses, source } | { status: 'notfound' } | { status: 'pending' } */
export async function lookupWord(word, lang) {
  const w = String(word || '').trim();
  const forms = [...new Set([w, w.toLowerCase()])].filter(Boolean);
  const base = String(lang || (typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2).toLowerCase();
  const sources = base === 'it'
    ? [['wiktionary-it', italianSections], ['wiktionary-en', (x) => englishSections(x, 'it')]]
    : [['wiktionary-en', (x) => englishSections(x, base)]];
  try {
    for (const [source, fetchSections] of sources) {
      for (const f of forms) {
        const r = await fromSource(fetchSections, f);
        if (r) return { status: 'ok', source, lemma: r.lemma && r.lemma.toLowerCase() !== f.toLowerCase() ? r.lemma : null, pos: r.pos, senses: r.senses };
      }
    }
    return { status: 'notfound' };
  } catch (e) {
    if (e instanceof NetworkError) return { status: 'pending' };
    throw e;
  }
}
