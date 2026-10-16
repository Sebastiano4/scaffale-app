/* Dictionary UI: the meaning card shown when a word is saved from the reader, the
   "Words" tab of the reader's side panel, and the Dictionary page (all books). */
import { state } from './state.js';
import { $, el, showToast, escapeHtml } from './dom.js';
import { DB } from './db.js';
import { addWord, allEntries, filterEntries, toMarkdown } from './dictionary-core.js';
import { lookupWord } from './dictionary-lookup.js';
import { openReader, goToPage } from './reader.js';
import { currentBookLanguage } from './reader-tts.js';
import { loadLibrary } from './library.js';

const RETRY_BATCH = 10;          // pending words looked up per pass
const RETRY_GAP_MS = 30_000;     // don't hammer Wiktionary while still offline

const loading = new WeakSet();   // entries being looked up right now
const editing = new WeakSet();   // entries with the meaning editor open
const lastTry = new WeakMap();   // entry -> time of the last automatic retry

/* ---- lookup ---- */
async function fillDefinition(entry) {
  loading.add(entry);
  try {
    const r = await lookupWord(entry.word, entry.lang);
    entry.status = r.status;
    if (r.status === 'ok') Object.assign(entry, { lemma: r.lemma, pos: r.pos, senses: r.senses, source: r.source });
    entry.updatedAt = Date.now();
  } finally {
    loading.delete(entry);
  }
}

/* Look up words saved offline; `after` re-renders when something changed. */
async function retryPending(items, after) {
  const now = Date.now();
  const todo = items.filter(({ entry }) => entry.status === 'pending' && !loading.has(entry)
    && now - (lastTry.get(entry) || 0) > RETRY_GAP_MS).slice(0, RETRY_BATCH);
  if (!todo.length) return;
  todo.forEach(({ entry }) => lastTry.set(entry, now));
  let changed = false;
  for (const { entry, book } of todo) {
    await fillDefinition(entry);
    if (entry.status !== 'pending') { changed = true; await DB.put(book); }
  }
  if (changed) after();
}

/* ---- one entry (card, side panel and Dictionary page share it) ---- */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function contextHtml(sentence, word) {
  const re = new RegExp('(^|[^\\p{L}])(' + reEscape(escapeHtml(word)) + ')(?![\\p{L}])', 'iu');
  return '“' + escapeHtml(sentence).replace(re, '$1<b>$2</b>') + '”';
}

function wiktionaryUrl(entry) {
  const host = entry.lang === 'it' && entry.source !== 'wiktionary-en' ? 'it' : 'en';
  return 'https://' + host + '.wiktionary.org/wiki/' + encodeURIComponent(entry.lemma || entry.key);
}

/* opts: { inCard, showBook, persist(), rerender(), onOpen(page), onDelete(entry) } */
export function renderWordEntry(entry, book, opts) {
  const item = el('div', 'word-entry');
  const head = el('div', 'word-entry__head');
  head.appendChild(el('span', 'word-entry__word', escapeHtml(entry.word)));
  if (entry.lemma) {
    head.appendChild(el('span', 'word-entry__arrow', '→'));
    head.appendChild(el('span', 'word-entry__lemma', escapeHtml(entry.lemma)));
  }
  if (entry.pos) head.appendChild(el('span', 'word-entry__pos', escapeHtml(entry.pos)));
  item.appendChild(head);

  if (editing.has(entry)) {
    const ta = el('textarea', 'note-editor');
    ta.value = (entry.senses || []).join('\n');
    ta.placeholder = 'One meaning per line…';
    item.appendChild(ta);
    const bar = el('div', 'word-entry__actions');
    bar.appendChild(actionBtn('save', 'Save'));
    bar.appendChild(actionBtn('cancel', 'Cancel'));
    item.appendChild(bar);
    setTimeout(() => ta.focus(), 0);
  } else {
    let status = '';
    if (loading.has(entry)) status = 'Looking up…';
    else if (entry.status === 'pending') status = 'Waiting for a connection — the meaning will be looked up later.';
    else if (entry.status === 'notfound') status = 'No definition found.';
    if (status) item.appendChild(el('div', 'word-entry__status', status));
    if (entry.senses && entry.senses.length) {
      const ol = el('ol', 'word-entry__senses');
      entry.senses.forEach((s) => ol.appendChild(el('li', '', escapeHtml(s))));
      item.appendChild(ol);
    }
  }

  if (!opts.inCard) {
    const c = (entry.contexts || [])[entry.contexts.length - 1];
    if (c && c.sentence) item.appendChild(el('div', 'word-entry__context', contextHtml(c.sentence, entry.word)));
    if (c) {
      const ref = el('button', 'word-entry__ref', escapeHtml(opts.showBook ? (book.title || 'Untitled') + ' · p. ' + c.page : 'Page ' + c.page));
      ref.type = 'button';
      ref.onclick = () => opts.onOpen(c.page);
      item.appendChild(ref);
    }
  }

  if (!editing.has(entry)) {
    const bar = el('div', 'word-entry__actions');
    bar.appendChild(actionBtn('edit', entry.status === 'notfound' && !entry.senses.length ? 'Write it' : 'Edit'));
    if (!loading.has(entry)) bar.appendChild(actionBtn('retry', entry.status === 'ok' ? 'Look up again' : 'Retry'));
    const link = el('a', 'panel-item__link', 'Wiktionary ↗');
    link.href = wiktionaryUrl(entry);
    link.target = '_blank';
    link.rel = 'noopener';
    bar.appendChild(link);
    if (!opts.inCard) bar.appendChild(actionBtn('delete', 'Delete', 'panel-item__delete'));
    item.appendChild(bar);
  }

  item.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    e.stopPropagation();
    if (act === 'edit') { editing.add(entry); opts.rerender(); }
    else if (act === 'cancel') { editing.delete(entry); opts.rerender(); }
    else if (act === 'save') {
      entry.senses = item.querySelector('textarea').value.split('\n').map((s) => s.trim()).filter(Boolean);
      Object.assign(entry, { source: 'manual', status: 'ok', updatedAt: Date.now() });
      editing.delete(entry);
      await opts.persist();
      opts.rerender();
    } else if (act === 'retry') {
      const p = fillDefinition(entry);
      opts.rerender();
      await p;
      await opts.persist();
      opts.rerender();
    } else if (act === 'delete') opts.onDelete(entry);
  });
  return item;
}

function actionBtn(act, label, cls = 'panel-item__link') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.dataset.act = act;
  return b;
}

/* Delete with an Undo toast; puts the entry back where it was. */
async function deleteEntry(book, entry, rerender) {
  const idx = book.words.indexOf(entry);
  if (idx < 0) return;
  book.words.splice(idx, 1);
  await DB.put(book);
  rerender();
  showToast('Word deleted', 5000, {
    label: 'Undo',
    onClick: async () => {
      book.words.splice(Math.min(idx, book.words.length), 0, entry);
      await DB.put(book);
      rerender();
    },
  });
}

/* ---- reader: Words tab of the side panel ---- */
export function renderWordsList(list, book) {
  list.innerHTML = '';
  const items = allEntries([book]);
  if (!items.length) {
    list.appendChild(el('div', 'panel-empty', 'No words yet. Select a word and tap 📖 Dictionary.'));
    return;
  }
  const rerender = () => renderWordsList(list, book);
  retryPending(items, rerender);
  for (const { entry } of items) {
    list.appendChild(renderWordEntry(entry, book, {
      persist: () => DB.put(book),
      rerender,
      onOpen: (page) => goToPage(page),
      onDelete: (e) => deleteEntry(book, e, rerender),
    }));
  }
}

function refreshWordsTab() {
  const book = state.reader.book;
  if (book && !$('#side-panel').hidden && !$('#words-list').hidden) renderWordsList($('#words-list'), book);
}

/* ---- reader: save the selected word and show its meaning ---- */
let cardEntry = null;
let cardUndo = null;   // book.words as it was before the save (JSON)

function renderCard() {
  const card = $('#word-card');
  const book = state.reader.book;
  if (!cardEntry || !book) { card.hidden = true; return; }
  card.innerHTML = '';
  card.appendChild(renderWordEntry(cardEntry, book, {
    inCard: true,
    persist: () => DB.put(book),
    rerender: () => { renderCard(); refreshWordsTab(); },
  }));
  const foot = el('div', 'word-card__foot');
  const undo = actionBtn('undo', 'Undo');
  undo.onclick = async () => {
    book.words = JSON.parse(cardUndo);
    await DB.put(book);
    hideCard();
    refreshWordsTab();
    showToast('Removed from the dictionary');
  };
  const close = actionBtn('close', 'Close');
  close.onclick = hideCard;
  foot.append(undo, close);
  card.appendChild(foot);
}

function hideCard() {
  $('#word-card').hidden = true;
  cardEntry = null;
}

function placeCard(rect) {
  const card = $('#word-card');
  const base = $('#reader-view').getBoundingClientRect();
  const scroll = $('#pdf-scroll').getBoundingClientRect();
  const half = card.offsetWidth / 2;
  const cx = Math.max(scroll.left + half + 6, Math.min(scroll.right - half - 6, rect.left + rect.width / 2));
  const below = rect.top - scroll.top < scroll.bottom - rect.bottom;
  card.classList.toggle('word-card--below', below);
  card.style.left = (cx - base.left) + 'px';
  card.style.top = ((below ? rect.bottom + 8 : rect.top - 8) - base.top) + 'px';
}

/* Called by the selection popover's 📖 Dictionary button. */
export async function saveWordFromSelection({ text, page, sentence, rect }) {
  const book = state.reader.book;
  if (!book) return;
  const lang = await currentBookLanguage();
  const before = JSON.stringify(book.words || []);
  const { entry } = addWord(book, { word: text, lang, page, sentence });
  if (!entry.lang && lang) entry.lang = lang;
  await DB.put(book);
  cardEntry = entry;
  cardUndo = before;
  const card = $('#word-card');
  card.hidden = false;
  const needsLookup = entry.status !== 'ok';
  const lookup = needsLookup ? fillDefinition(entry) : null;
  renderCard();
  if (rect) placeCard(rect);
  refreshWordsTab();
  if (!lookup) return;
  await lookup;
  if (state.reader.book !== book) return;
  await DB.put(book);
  if (cardEntry === entry) renderCard();
  refreshWordsTab();
}

/* ---- Dictionary page (all books) ---- */
let dictBooks = [];

function fillBookFilter() {
  const sel = $('#dict-book');
  const keep = sel.value;
  sel.innerHTML = '<option value="">All books</option>';
  dictBooks.filter((b) => (b.words || []).length)
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .forEach((b) => sel.appendChild(new Option(b.title || 'Untitled', b.id)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}

function currentItems() {
  return filterEntries(allEntries(dictBooks), { query: $('#dict-search').value, bookId: $('#dict-book').value });
}

function renderDictionary() {
  const list = $('#dict-list');
  const all = allEntries(dictBooks);
  const items = currentItems();
  $('#dict-count').textContent = all.length + (all.length === 1 ? ' word' : ' words');
  $('#dict-export').disabled = items.length === 0;
  list.innerHTML = '';
  if (!all.length) {
    list.appendChild(el('div', 'panel-empty', 'Your dictionary is empty.<br>While reading, select a word and tap <b>📖 Dictionary</b>: it is saved here with its meaning.'));
    return;
  }
  if (!items.length) list.appendChild(el('div', 'panel-empty', 'No matching words.'));
  retryPending(all, renderDictionary);
  for (const { entry, book } of items) {
    list.appendChild(renderWordEntry(entry, book, {
      showBook: true,
      persist: () => DB.put(book),
      rerender: renderDictionary,
      onOpen: (page) => { closeDictionary(); openReader(book.id, { page }); },
      onDelete: (e) => deleteEntry(book, e, () => { fillBookFilter(); renderDictionary(); }),
    }));
  }
}

export async function openDictionary() {
  dictBooks = await DB.all();
  fillBookFilter();
  $('#dictionary-modal').hidden = false;
  renderDictionary();
}

function closeDictionary() {
  $('#dictionary-modal').hidden = true;
  // the library keeps its own copies of the books: refresh them so a later save can't drop words
  loadLibrary();
}

function exportDictionary() {
  const items = currentItems();
  if (!items.length) { showToast('No words to export'); return; }
  const bookId = $('#dict-book').value;
  const book = bookId && dictBooks.find((b) => b.id === bookId);
  const md = toMarkdown(items, book ? 'Dictionary — ' + book.title : 'Dictionary');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  const safe = book ? '-' + (book.title || '').replace(/[^\w\sÀ-ÿ-]/g, '').trim().slice(0, 60) : '';
  a.download = 'dictionary' + safe + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast('Dictionary exported');
}

export function initDictionary() {
  $('#sidebar-dict-btn').addEventListener('click', openDictionary);
  $('#menu-dict').addEventListener('click', () => { $('#library-menu').hidden = true; openDictionary(); });
  $('#dict-close').addEventListener('click', closeDictionary);
  $('#dictionary-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDictionary(); });
  $('#dict-search').addEventListener('input', renderDictionary);
  $('#dict-book').addEventListener('change', renderDictionary);
  $('#dict-export').addEventListener('click', exportDictionary);

  // tapping anywhere else closes the meaning card
  document.addEventListener('pointerdown', (e) => {
    const card = $('#word-card');
    if (card.hidden || card.contains(e.target) || (e.target.closest && e.target.closest('#sel-dict-btn'))) return;
    hideCard();
  });

  window.addEventListener('online', () => {
    if (!$('#dictionary-modal').hidden) { renderDictionary(); return; }
    if (state.reader.book) retryPending(allEntries([state.reader.book]), () => { refreshWordsTab(); if (cardEntry) renderCard(); });
  });
}
