/* Personal dictionary: pure helpers (no DOM, no network) for the words saved on each book.
   An entry lives in book.words (see docs/superpowers/specs/2026-10-16-booknest-dictionary-design.md). */

export const MAX_CONTEXTS = 5;
const MAX_WORDS = 3;
const MAX_CHARS = 40;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* The selected text as shown: trimmed, single spaces, no punctuation or quotes at the edges. */
export function cleanWord(text) {
  return String(text || '').normalize('NFC').replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/* Lookup / duplicate key. */
export const wordKey = (text) => cleanWord(text).toLowerCase();

/* Only short selections (1–3 words) can go to the dictionary. */
export function isDictionarySelection(text) {
  const w = cleanWord(text);
  return !!w && w.length <= MAX_CHARS && w.split(' ').length <= MAX_WORDS;
}

/* Save a word on the book, or add the new context to the entry it already has.
   Returns { entry, created }. The definition is filled in later (status 'pending'). */
export function addWord(book, { word, lang = null, page, sentence = '' }, now = Date.now()) {
  book.words = book.words || [];
  const key = wordKey(word);
  let entry = book.words.find((e) => e.key === key);
  const created = !entry;
  if (!entry) {
    entry = {
      id: newId(), word: cleanWord(word), key, lang,
      lemma: null, pos: null, senses: [], source: null, status: 'pending',
      contexts: [], addedAt: now, updatedAt: now,
    };
    book.words.push(entry);
  }
  const ctx = { page, sentence: String(sentence || '').trim() };
  if (!entry.contexts.some((c) => c.page === ctx.page && c.sentence === ctx.sentence)) {
    entry.contexts.push(ctx);
    if (entry.contexts.length > MAX_CONTEXTS) entry.contexts.splice(0, entry.contexts.length - MAX_CONTEXTS);
  }
  entry.updatedAt = now;
  return { entry, created };
}

/* Every saved word across books, alphabetical: [{ entry, book }]. */
export function allEntries(books) {
  const out = [];
  for (const book of books || []) for (const entry of book.words || []) out.push({ entry, book });
  return out.sort((a, b) => a.entry.key.localeCompare(b.entry.key, undefined, { sensitivity: 'base' }));
}

export function filterEntries(items, { query = '', bookId = '' } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter(({ entry, book }) => {
    if (bookId && book.id !== bookId) return false;
    if (!q) return true;
    return [entry.word, entry.lemma || '', ...(entry.senses || [])].some((s) => s.toLowerCase().includes(q));
  });
}

/* Markdown export: alphabetical sections, numbered senses, first context as a quote. */
export function toMarkdown(items, title = 'Dictionary') {
  const lines = ['# ' + title, '', '> ' + items.length + (items.length === 1 ? ' word' : ' words') + ' — BookNest', ''];
  let letter = '';
  for (const { entry, book } of items) {
    const first = (entry.key[0] || '#').normalize('NFD')[0].toUpperCase();
    if (first !== letter) { letter = first; lines.push('## ' + letter, ''); }
    let head = '**' + entry.word + '**';
    if (entry.lemma && entry.lemma.toLowerCase() !== entry.key) head += ' → *' + entry.lemma + '*';
    if (entry.pos) head += ' · ' + entry.pos;
    lines.push(head);
    if (entry.senses && entry.senses.length) entry.senses.forEach((s, i) => lines.push((i + 1) + '. ' + s));
    else lines.push('_(no definition)_');
    const c = (entry.contexts || [])[0];
    if (c && c.sentence) lines.push('', '> ' + c.sentence + ' — *' + (book.title || 'Untitled') + '*, p. ' + c.page);
    lines.push('');
  }
  return lines.join('\n');
}
