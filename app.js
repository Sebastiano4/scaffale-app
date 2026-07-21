import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

/* ======================================================================
   DB — tiny promise wrapper around IndexedDB
   ====================================================================== */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('scaffale-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }
  return {
    async all() {
      const store = await tx('books', 'readonly');
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async get(id) {
      const store = await tx('books', 'readonly');
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async put(book) {
      const store = await tx('books', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.put(book);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async delete(id) {
      const store = await tx('books', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
  };
})();

/* ======================================================================
   Helpers
   ====================================================================== */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function showToast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.hidden = true), ms);
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Guess { title, author } from a filename when PDF metadata is missing.
function guessFromFilename(filename) {
  let base = filename.replace(/\.pdf$/i, '');
  base = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

  const seps = [' - ', ' – ', ' — '];
  let parts = null;
  for (const sep of seps) {
    if (base.includes(sep)) { parts = base.split(sep).map((s) => s.trim()); break; }
  }

  if (parts && parts.length >= 2) {
    const [a, b] = [parts[0], parts.slice(1).join(' - ')];
    const wordsA = a.split(' ').filter(Boolean);
    // Short, capitalized, comma-free chunk looks like "Author Name"
    const looksLikeName = (s, words) =>
      words.length <= 4 && !/\d/.test(s) && words.every((w) => /^[A-ZÀ-Ý]/.test(w));
    if (looksLikeName(a, wordsA)) {
      return { title: titleCase(b), author: titleCase(a) };
    }
    return { title: titleCase(a), author: titleCase(b) };
  }

  return { title: titleCase(base) || 'Senza titolo', author: '' };
}

async function extractMetadata(pdfDoc, filename) {
  let title = '', author = '';
  try {
    const meta = await pdfDoc.getMetadata();
    title = (meta.info && meta.info.Title || '').trim();
    author = (meta.info && meta.info.Author || '').trim();
  } catch (e) { /* ignore */ }

  const guess = guessFromFilename(filename);
  return {
    title: title || guess.title,
    author: author || guess.author,
  };
}

async function renderThumbnail(pdfDoc) {
  const page = await pdfDoc.getPage(1);
  const baseVp = page.getViewport({ scale: 1 });
  const targetW = 340;
  const scale = targetW / baseVp.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.75);
}

/* ======================================================================
   App state
   ====================================================================== */
const state = {
  books: [],              // cached list from DB
  activeCategory: 'Tutti',
  activeStatus: 'all',    // 'all' | 'toread' | 'reading' | 'read'
  sortBy: 'recent',       // 'recent' | 'title' | 'author' | 'progress'
  librarySearch: '',
  reader: {
    book: null,
    pdfDoc: null,
    mode: 'continuous',    // 'continuous' | 'paginated'
    scale: 1.05,
    currentPage: 1,
    textIndex: new Map(),  // pageNum -> full text (for search)
    saveTimer: null,
    io: null,              // IntersectionObserver
    sessionStart: null,    // reading-time tracking
  },
};

/* ======================================================================
   Book status ("shelves"): manual override or derived from reading
   ====================================================================== */
function bookStatus(b) {
  if (b.status && b.status !== 'auto') return b.status;
  if (b.finishedAt) return 'read';
  if (b.lastOpenedAt) return 'reading';
  return 'toread';
}
const STATUS_LABELS = { all: 'Tutti', toread: 'Da leggere', reading: 'In lettura', read: 'Letti' };

/* ======================================================================
   Reading stats (stored in localStorage)
   ====================================================================== */
const Stats = {
  key: 'booknest-stats',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || { days: {} }; }
    catch (e) { return { days: {} }; }
  },
  save(s) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) { /* full */ } },
  dayKey(offset = 0) {
    const d = new Date(); d.setDate(d.getDate() - offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  bump(field, amount) {
    const s = this.load();
    const k = this.dayKey();
    const day = s.days[k] || (s.days[k] = { pages: 0, seconds: 0 });
    day[field] += amount;
    this.save(s);
  },
  addPages(n) { this.bump('pages', n); },
  addSeconds(sec) { if (sec > 0 && sec < 60 * 60 * 12) this.bump('seconds', sec); },
  summary() {
    const s = this.load();
    const today = s.days[this.dayKey()] || { pages: 0, seconds: 0 };
    let wPages = 0, wSeconds = 0, streak = 0;
    for (let i = 0; i < 7; i++) {
      const d = s.days[this.dayKey(i)];
      if (d) { wPages += d.pages; wSeconds += d.seconds; }
    }
    for (let i = 0; i < 365; i++) {
      const d = s.days[this.dayKey(i)];
      if (d && (d.pages > 0 || d.seconds > 60)) streak++;
      else if (i > 0) break; // today can still be empty without breaking the streak
    }
    return { today, wPages, wSeconds, streak };
  },
};

function flushReadingTime() {
  if (state.reader.sessionStart) {
    Stats.addSeconds(Math.round((Date.now() - state.reader.sessionStart) / 1000));
    state.reader.sessionStart = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushReadingTime();
  else if (state.reader.book && $('#reader-view').classList.contains('view--active')) state.reader.sessionStart = Date.now();
});
window.addEventListener('pagehide', flushReadingTime);

/* ======================================================================
   Theme
   ====================================================================== */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#14171F' : '#F6F1E4');
}
function initTheme() {
  // 'scaffale-theme' kept as fallback so an older install keeps its choice
  applyTheme(localStorage.getItem('booknest-theme') || localStorage.getItem('scaffale-theme') || 'dark');
}
$('#theme-toggle').addEventListener('click', () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('booknest-theme', next);
});

/* ======================================================================
   Library view
   ====================================================================== */
async function loadLibrary() {
  state.books = await DB.all();
  renderStatusBar();
  renderCategoryBar();
  renderGrid();
}

function renderStatusBar() {
  const bar = $('#status-bar');
  if (state.books.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  const chips = $('#status-chips');
  chips.innerHTML = '';
  for (const key of ['all', 'toread', 'reading', 'read']) {
    const count = key === 'all' ? state.books.length : state.books.filter((b) => bookStatus(b) === key).length;
    if (key !== 'all' && count === 0 && state.activeStatus !== key) continue;
    const chip = el('button', 'chip' + (state.activeStatus === key ? ' chip--active' : ''),
      STATUS_LABELS[key] + ' · ' + count);
    chip.onclick = () => { state.activeStatus = key; renderStatusBar(); renderGrid(); };
    chips.appendChild(chip);
  }
}

$('#sort-select').addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  renderGrid();
});

function sortBooks(list) {
  const by = state.sortBy;
  const copy = list.slice();
  if (by === 'title') copy.sort((a, b) => a.title.localeCompare(b.title, 'it'));
  else if (by === 'author') copy.sort((a, b) => (a.author || 'zzz').localeCompare(b.author || 'zzz', 'it'));
  else if (by === 'progress') copy.sort((a, b) =>
    ((b.lastPage / (b.numPages || 1)) - (a.lastPage / (a.numPages || 1))));
  else copy.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt));
  return copy;
}

function renderCategoryBar() {
  const bar = $('#category-bar');
  const cats = Array.from(new Set(state.books.map((b) => b.category).filter(Boolean))).sort();
  if (cats.length === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = '';
  const allChip = el('button', 'chip' + (state.activeCategory === 'Tutti' ? ' chip--active' : ''), 'Tutti');
  allChip.onclick = () => { state.activeCategory = 'Tutti'; renderCategoryBar(); renderGrid(); };
  bar.appendChild(allChip);
  cats.forEach((c) => {
    const chip = el('button', 'chip' + (state.activeCategory === c ? ' chip--active' : ''), c);
    chip.onclick = () => { state.activeCategory = c; renderCategoryBar(); renderGrid(); };
    bar.appendChild(chip);
  });

  // also refresh the datalist used in the metadata modal
  const dl = $('#category-options');
  dl.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

function renderGrid() {
  const grid = $('#book-grid');
  const empty = $('#empty-state');
  const noResults = $('#no-results');
  const fab = $('#fab-add');

  if (state.books.length === 0) {
    grid.hidden = true; grid.innerHTML = '';
    noResults.hidden = true;
    empty.hidden = false;
    fab.hidden = true;
    return;
  }
  fab.hidden = false;
  empty.hidden = true;

  const q = state.librarySearch.trim().toLowerCase();
  let list = sortBooks(state.books);
  if (state.activeStatus !== 'all') list = list.filter((b) => bookStatus(b) === state.activeStatus);
  if (state.activeCategory !== 'Tutti') list = list.filter((b) => b.category === state.activeCategory);
  if (q) list = list.filter((b) => (b.title + ' ' + b.author).toLowerCase().includes(q));

  if (list.length === 0) {
    grid.hidden = true; grid.innerHTML = '';
    noResults.hidden = false;
    return;
  }
  noResults.hidden = true;
  grid.hidden = false;
  grid.innerHTML = '';

  const mostRecentId = state.books.slice().sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0]?.lastOpenedAt
    ? state.books.slice().sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0].id
    : null;

  list.forEach((book) => {
    const card = el('div', 'book-card' + (book.id === mostRecentId ? ' book-card--current' : ''));

    const cover = el('div', 'book-cover');
    if (book.thumbnail) {
      const img = el('img'); img.src = book.thumbnail; img.alt = book.title;
      cover.appendChild(img);
    } else {
      cover.appendChild(el('div', 'book-cover__placeholder', escapeHtml(book.title)));
    }
    const ribbon = el('div', 'ribbon');
    const fill = el('div', 'ribbon__fill');
    const pct = book.numPages ? Math.min(100, Math.round((book.lastPage / book.numPages) * 100)) : 0;
    fill.style.height = pct + '%';
    ribbon.appendChild(fill);
    cover.appendChild(ribbon);

    const st = bookStatus(book);
    if (st === 'read') cover.appendChild(el('div', 'book-badge book-badge--read', 'Letto'));
    else if (st === 'reading' && pct > 0) cover.appendChild(el('div', 'book-badge book-badge--reading', pct + '%'));

    cover.onclick = () => openReader(book.id);

    const meta = el('div', 'book-meta');
    meta.appendChild(el('p', 'book-title', escapeHtml(book.title)));
    meta.appendChild(el('p', 'book-author', escapeHtml(book.author || 'Autore sconosciuto')));
    meta.onclick = () => openMetadataModal({ mode: 'edit', book });

    card.appendChild(cover);
    card.appendChild(meta);
    grid.appendChild(card);
  });
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---- library search ---- */
$('#library-search-btn').addEventListener('click', () => {
  $('#library-search-bar').hidden = false;
  $('#library-search-input').focus();
});
$('#library-search-close').addEventListener('click', () => {
  $('#library-search-bar').hidden = true;
  $('#library-search-input').value = '';
  state.librarySearch = '';
  renderGrid();
});
$('#library-search-input').addEventListener('input', (e) => {
  state.librarySearch = e.target.value;
  renderGrid();
});

/* ======================================================================
   Adding books
   ====================================================================== */
$('#fab-add').addEventListener('click', () => $('#file-input').click());
$('#empty-add-btn').addEventListener('click', () => $('#file-input').click());

$('#file-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const file of files) {
    try { await addBookFromFile(file); }
    catch (err) { console.error(err); showToast('Non sono riuscito ad aprire ' + file.name); }
  }
});

async function addBookFromFile(file) {
  showToast('Aggiungo ' + file.name + '…', 4000);
  const buf = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const { title, author } = await extractMetadata(pdfDoc, file.name);
  const thumbnail = await renderThumbnail(pdfDoc);

  const book = {
    id: uid(),
    title, author,
    category: '',
    filename: file.name,
    numPages: pdfDoc.numPages,
    lastPage: 1,
    addedAt: Date.now(),
    lastOpenedAt: 0,
    thumbnail,
    readingMode: 'continuous',
    bookmarks: [],
    quotes: [],
    fileBlob: file,
  };
  await DB.put(book);
  await loadLibrary();
  showToast('Aggiunto: ' + title);
}

/* ---- metadata modal (used for add-fallback edits and later edits) ---- */
let modalCtx = null; // { mode: 'edit', book }

function openMetadataModal({ mode, book }) {
  modalCtx = { mode, book };
  $('#metadata-modal-title').textContent = mode === 'edit' ? 'Modifica libro' : 'Conferma i dati del libro';
  $('#meta-title').value = book.title || '';
  $('#meta-author').value = book.author || '';
  $('#meta-category').value = book.category || '';
  $('#meta-status').value = book.status || 'auto';
  $('#metadata-modal').hidden = false;

  let delBtn = document.getElementById('meta-delete');
  if (mode === 'edit') {
    if (!delBtn) {
      delBtn = el('button', 'btn btn--ghost', 'Elimina libro');
      delBtn.id = 'meta-delete';
      delBtn.style.marginTop = '4px';
      delBtn.style.width = '100%';
      $('.modal__card').appendChild(delBtn);
      delBtn.onclick = async () => {
        if (!confirm('Eliminare "' + modalCtx.book.title + '" dallo scaffale?')) return;
        await DB.delete(modalCtx.book.id);
        $('#metadata-modal').hidden = true;
        await loadLibrary();
        showToast('Libro eliminato');
      };
    }
    delBtn.hidden = false;
  } else if (delBtn) {
    delBtn.hidden = true;
  }
}

$('#meta-cancel').addEventListener('click', () => { $('#metadata-modal').hidden = true; });

$('#meta-save').addEventListener('click', async () => {
  if (!modalCtx) return;
  const book = modalCtx.book;
  book.title = $('#meta-title').value.trim() || 'Senza titolo';
  book.author = $('#meta-author').value.trim();
  book.category = $('#meta-category').value.trim();
  const st = $('#meta-status').value;
  if (st === 'auto') delete book.status;
  else {
    book.status = st;
    if (st === 'read' && !book.finishedAt) book.finishedAt = Date.now();
    if (st !== 'read') delete book.finishedAt;
  }
  await DB.put(book);
  $('#metadata-modal').hidden = true;
  await loadLibrary();
  showToast('Salvato');
});

/* ======================================================================
   Library menu: backup, import, stats
   ====================================================================== */
$('#library-menu-btn').addEventListener('click', () => { $('#library-menu').hidden = false; });
$('#menu-close').addEventListener('click', () => { $('#library-menu').hidden = true; });
$('#library-menu').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
$('#stats-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
$('#stats-close').addEventListener('click', () => { $('#stats-modal').hidden = true; });

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'application/pdf' });
}

$('#menu-export').addEventListener('click', async () => {
  $('#library-menu').hidden = true;
  const books = await DB.all();
  if (books.length === 0) { showToast('La libreria è vuota, niente da esportare'); return; }
  showToast('Preparo il backup… può volerci un momento', 6000);
  try {
    const out = [];
    for (const b of books) {
      const { fileBlob, ...meta } = b;
      out.push({ ...meta, fileB64: fileBlob ? await blobToBase64(fileBlob) : '' });
    }
    const payload = JSON.stringify({ app: 'BookNest', version: 1, exportedAt: Date.now(), stats: Stats.load(), books: out });
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = 'booknest-backup-' + d.toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showToast('Backup scaricato: ' + out.length + (out.length === 1 ? ' libro' : ' libri'));
  } catch (e) {
    console.error(e);
    showToast('Errore durante il backup');
  }
});

$('#menu-import').addEventListener('click', () => {
  $('#library-menu').hidden = true;
  $('#import-input').click();
});
$('#import-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  showToast('Importo il backup…', 6000);
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'BookNest' || !Array.isArray(data.books)) throw new Error('formato non valido');
    let count = 0;
    for (const entry of data.books) {
      const { fileB64, ...meta } = entry;
      if (!fileB64) continue;
      await DB.put({ ...meta, fileBlob: base64ToBlob(fileB64) });
      count++;
    }
    if (data.stats && data.stats.days) {
      // merge stats, keeping the larger value per day
      const cur = Stats.load();
      for (const [k, v] of Object.entries(data.stats.days)) {
        const c = cur.days[k] || { pages: 0, seconds: 0 };
        cur.days[k] = { pages: Math.max(c.pages, v.pages || 0), seconds: Math.max(c.seconds, v.seconds || 0) };
      }
      Stats.save(cur);
    }
    await loadLibrary();
    showToast('Importati ' + count + (count === 1 ? ' libro' : ' libri'));
  } catch (err) {
    console.error(err);
    showToast('File di backup non valido');
  }
});

function fmtMinutes(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

$('#menu-stats').addEventListener('click', () => {
  $('#library-menu').hidden = true;
  const s = Stats.summary();
  const finished = state.books.filter((b) => bookStatus(b) === 'read').length;
  const inProgress = state.books.filter((b) => bookStatus(b) === 'reading').length;
  const body = $('#stats-body');
  body.innerHTML = '';
  const row = (label, value) => {
    const r = el('div', 'stat-row');
    r.appendChild(el('span', 'stat-row__label', label));
    r.appendChild(el('span', 'stat-row__value', value));
    body.appendChild(r);
  };
  row('Oggi', s.today.pages + ' pagine · ' + fmtMinutes(s.today.seconds));
  row('Ultimi 7 giorni', s.wPages + ' pagine · ' + fmtMinutes(s.wSeconds));
  row('Giorni di fila con lettura', String(s.streak));
  row('Libri in lettura', String(inProgress));
  row('Libri finiti', String(finished));
  $('#stats-modal').hidden = false;
});

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
  await DB.put(book);

  state.reader.sessionStart = Date.now();
  lastStatsPage = state.reader.currentPage;
  applyReadingFilter();

  await renderReader();
  $('#reader-loading').hidden = true;
  buildSearchIndex(); // background, not awaited
}

function closeReader() {
  flushReadingTime();
  if (state.reader.io) state.reader.io.disconnect();
  state.reader.book = null;
  state.reader.pdfDoc = null;
  $('#pdf-pages').innerHTML = '';
  $('#reader-view').classList.remove('view--active');
  $('#library-view').classList.add('view--active');
  $('#side-panel').hidden = true;
  $('#reader-search-bar').hidden = true;
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
  $('#reader-progress').textContent = `Pagina ${currentPage} di ${total}`;
  $('#page-progress-fill').style.width = Math.round((currentPage / total) * 100) + '%';
  const isBookmarked = (book.bookmarks || []).some((b) => b.page === currentPage);
  $('#bookmark-icon').setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
}

let lastStatsPage = null;
function notePageSeen(n) {
  if (lastStatsPage !== null && n !== lastStatsPage) Stats.addPages(1);
  lastStatsPage = n;
}

function persistProgress() {
  clearTimeout(state.reader.saveTimer);
  state.reader.saveTimer = setTimeout(async () => {
    const { book, currentPage } = state.reader;
    if (!book) return;
    book.lastPage = currentPage;
    if (!book.finishedAt && book.numPages > 1 && currentPage >= book.numPages) {
      book.finishedAt = Date.now();
      showToast('Libro terminato — complimenti!');
    }
    await DB.put(book);
  }, 350);
}

/* ---- reading filter: normal / sepia / night ---- */
const READ_FILTERS = ['none', 'sepia', 'night'];
function applyReadingFilter() {
  const mode = localStorage.getItem('booknest-readfilter') || 'none';
  const scroll = $('#pdf-scroll');
  scroll.classList.toggle('filter-sepia', mode === 'sepia');
  scroll.classList.toggle('filter-night', mode === 'night');
}
$('#filter-toggle').addEventListener('click', () => {
  const cur = localStorage.getItem('booknest-readfilter') || 'none';
  const next = READ_FILTERS[(READ_FILTERS.indexOf(cur) + 1) % READ_FILTERS.length];
  localStorage.setItem('booknest-readfilter', next);
  applyReadingFilter();
  showToast(next === 'none' ? 'Filtro: normale' : next === 'sepia' ? 'Filtro: seppia' : 'Filtro: notte');
});

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

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) renderPageInto(entry.target);
      if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
        const n = Number(entry.target.dataset.page);
        if (n !== state.reader.currentPage) {
          state.reader.currentPage = n;
          notePageSeen(n);
          updateProgressUI();
          persistProgress();
        }
      }
    });
  }, { root: $('#pdf-scroll'), threshold: [0, 0.55] });

  wraps.forEach((w) => io.observe(w));
  state.reader.io = io;

  // jump to last-read page (scroll ONLY the container: scrollIntoView would
  // also scroll the outer document and shift the whole UI)
  requestAnimationFrame(() => {
    const target = wraps[state.reader.currentPage - 1];
    if (target) $('#pdf-scroll').scrollTop = Math.max(0, target.offsetTop - 8);
  });
}

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
  persistProgress();
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

/* ---- permanent highlights for saved quotes ---- */
function applyQuoteHighlights(wrap) {
  const book = state.reader.book;
  if (!book) return;
  const n = Number(wrap.dataset.page);
  wrap.querySelectorAll('.quote-highlight').forEach((s) => s.classList.remove('quote-highlight'));
  const quotes = (book.quotes || []).filter((q) => q.page === n);
  if (quotes.length === 0) return;
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const qtexts = quotes.map((q) => norm(q.text)).filter((t) => t.length >= 3);
  if (qtexts.length === 0) return;
  wrap.querySelectorAll('.textLayer span').forEach((span) => {
    const t = norm(span.textContent);
    if (t.length < 3) return;
    if (qtexts.some((q) => q.includes(t) || t.includes(q))) span.classList.add('quote-highlight');
  });
}
function refreshQuoteHighlights(page) {
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${page}"]`);
  if (wrap) applyQuoteHighlights(wrap);
}

/* ---- text selection -> save as quote ---- */
document.addEventListener('selectionchange', () => {
  if (!state.reader.book || $('#reader-view').classList.contains('view--active') === false) return;
  const sel = window.getSelection();
  const text = sel.toString().trim();
  const popover = $('#selection-popover');
  if (!text || sel.rangeCount === 0) { popover.hidden = true; return; }
  const range = sel.getRangeAt(0);
  const anchorNode = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  if (!anchorNode || !anchorNode.closest('.textLayer')) { popover.hidden = true; return; }

  const rect = range.getBoundingClientRect();
  const scrollRect = $('#pdf-scroll').getBoundingClientRect();
  popover.style.left = (rect.left + rect.width / 2 - scrollRect.left) + 'px';
  popover.style.top = (rect.top - scrollRect.top) + 'px';
  popover.hidden = false;
  popover.dataset.text = text;
  const wrap = anchorNode.closest('.pdf-page-wrap');
  popover.dataset.page = wrap ? wrap.dataset.page : state.reader.currentPage;
});

$('#save-highlight-btn').addEventListener('click', async () => {
  const popover = $('#selection-popover');
  const text = popover.dataset.text;
  const page = Number(popover.dataset.page) || state.reader.currentPage;
  if (!text) return;
  const book = state.reader.book;
  book.quotes = book.quotes || [];
  book.quotes.push({ id: uid(), page, text, addedAt: Date.now() });
  await DB.put(book);
  popover.hidden = true;
  window.getSelection().removeAllRanges();
  refreshQuoteHighlights(page);
  showToast('Citazione salvata ed evidenziata');
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
  showToast(idx >= 0 ? 'Segnalibro rimosso' : 'Segnalibro aggiunto');
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
  });
});

function renderSidePanel() {
  const book = state.reader.book;
  const bmList = $('#bookmarks-list');
  const qList = $('#quotes-list');
  bmList.innerHTML = '';
  qList.innerHTML = '';

  const bookmarks = (book.bookmarks || []).slice().sort((a, b) => a.page - b.page);
  if (bookmarks.length === 0) bmList.appendChild(el('div', 'panel-empty', 'Nessun segnalibro ancora.'));
  bookmarks.forEach((b) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Pagina ' + b.page));
    item.onclick = () => goToPage(b.page);
    const del = el('button', 'panel-item__delete', 'Rimuovi');
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
  if (quotes.length === 0) qList.appendChild(el('div', 'panel-empty', 'Nessuna citazione salvata ancora.'));
  quotes.forEach((q) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Pagina ' + q.page));
    item.appendChild(el('div', 'panel-item__text', '"' + escapeHtml(q.text) + '"'));
    item.onclick = () => goToPage(q.page);
    const del = el('button', 'panel-item__delete', 'Elimina');
    del.onclick = async (ev) => {
      ev.stopPropagation();
      book.quotes = book.quotes.filter((x) => x.id !== q.id);
      await DB.put(book);
      refreshQuoteHighlights(q.page);
      renderSidePanel();
    };
    item.appendChild(del);
    qList.appendChild(item);
  });
}

function goToPage(n) {
  $('#side-panel').hidden = true;
  if (state.reader.mode === 'paginated') { renderSinglePage(n); return; }
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${n}"]`);
  if (wrap) $('#pdf-scroll').scrollTo({ top: Math.max(0, wrap.offsetTop - 8), behavior: 'smooth' });
}

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
    : 'nessun risultato';
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
loadLibrary();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
