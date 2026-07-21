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

/* ---- Reading goal (books or pages, per week or per year) ---- */
const Goal = {
  key: 'booknest-goal',
  load() { try { return JSON.parse(localStorage.getItem(this.key)); } catch (e) { return null; } },
  save(g) { try { localStorage.setItem(this.key, JSON.stringify(g)); } catch (e) { /* full */ } },
  clear() { localStorage.removeItem(this.key); },
  // returns { done, target, label, pct } or null
  progress(books) {
    const g = this.load();
    if (!g || !g.target) return null;
    const now = new Date();
    let done = 0, label = '';
    if (g.type === 'books') {
      if (g.period === 'year') {
        const y = now.getFullYear();
        done = books.filter((b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === y).length;
        label = g.target + ' libri nel ' + y;
      } else {
        const weekAgo = Date.now() - 7 * 864e5;
        done = books.filter((b) => b.finishedAt && b.finishedAt >= weekAgo).length;
        label = g.target + ' libri a settimana';
      }
    } else { // pages
      const s = Stats.load();
      if (g.period === 'year') {
        const y = String(now.getFullYear());
        done = Object.entries(s.days).reduce((sum, [k, v]) => k.startsWith(y) ? sum + (v.pages || 0) : sum, 0);
        label = g.target + ' pagine nel ' + now.getFullYear();
      } else {
        done = Stats.summary().wPages;
        label = g.target + ' pagine a settimana';
      }
    }
    return { done, target: g.target, label, pct: Math.min(100, Math.round((done / g.target) * 100)) };
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
    if (book.rating > 0) {
      meta.appendChild(el('p', 'book-stars', '★'.repeat(book.rating) + '<span class="book-stars__off">' + '★'.repeat(5 - book.rating) + '</span>'));
    }
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

function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return '—'; }
}

function paintStars(rating) {
  document.querySelectorAll('#meta-rating .star').forEach((s) => {
    s.classList.toggle('star--on', Number(s.dataset.v) <= rating);
  });
}

function openMetadataModal({ mode, book }) {
  modalCtx = { mode, book, rating: book.rating || 0 };
  $('#metadata-modal-title').textContent = mode === 'edit' ? 'Modifica libro' : 'Conferma i dati del libro';
  $('#meta-title').value = book.title || '';
  $('#meta-author').value = book.author || '';
  $('#meta-category').value = book.category || '';
  $('#meta-status').value = book.status || 'auto';
  $('#meta-review').value = book.review || '';
  paintStars(modalCtx.rating);

  const dates = $('#meta-dates');
  if (mode === 'edit' && (book.startedAt || book.finishedAt || book.addedAt)) {
    dates.hidden = false;
    dates.innerHTML =
      '<span>Aggiunto: ' + fmtDate(book.addedAt) + '</span>' +
      (book.startedAt ? '<span>Iniziato: ' + fmtDate(book.startedAt) + '</span>' : '') +
      (book.finishedAt ? '<span>Finito: ' + fmtDate(book.finishedAt) + '</span>' : '');
  } else {
    dates.hidden = true;
  }
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

// star rating interaction
document.querySelectorAll('#meta-rating .star').forEach((star) => {
  star.addEventListener('click', () => {
    if (!modalCtx) return;
    modalCtx.rating = Number(star.dataset.v);
    paintStars(modalCtx.rating);
  });
});
$('#meta-rating-clear').addEventListener('click', () => {
  if (!modalCtx) return;
  modalCtx.rating = 0;
  paintStars(0);
});

$('#meta-save').addEventListener('click', async () => {
  if (!modalCtx) return;
  const book = modalCtx.book;
  book.title = $('#meta-title').value.trim() || 'Senza titolo';
  book.author = $('#meta-author').value.trim();
  book.category = $('#meta-category').value.trim();
  book.review = $('#meta-review').value.trim();
  if (modalCtx.rating > 0) book.rating = modalCtx.rating; else delete book.rating;
  const st = $('#meta-status').value;
  if (st === 'auto') delete book.status;
  else {
    book.status = st;
    if (st === 'reading' && !book.startedAt) book.startedAt = Date.now();
    if (st === 'read') {
      if (!book.startedAt) book.startedAt = book.addedAt || Date.now();
      if (!book.finishedAt) book.finishedAt = Date.now();
    }
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

function statTotals() {
  const s = Stats.load();
  let totalPages = 0, totalSeconds = 0;
  for (const d of Object.values(s.days)) { totalPages += d.pages || 0; totalSeconds += d.seconds || 0; }
  return { totalPages, totalSeconds };
}

function mostReadAuthor(books) {
  const counts = {};
  books.filter((b) => bookStatus(b) === 'read' && b.author).forEach((b) => {
    counts[b.author] = (counts[b.author] || 0) + 1;
  });
  let best = null, n = 0;
  for (const [a, c] of Object.entries(counts)) if (c > n) { best = a; n = c; }
  return best ? { author: best, count: n } : null;
}

function dayKeyOf(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function renderHistoryChart(container) {
  const s = Stats.load();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = Stats.dayKey(i);
    days.push({ k, pages: (s.days[k] && s.days[k].pages) || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.pages));
  const chart = el('div', 'chart');
  days.forEach((d) => {
    const col = el('div', 'chart__col');
    const bar = el('div', 'chart__bar' + (d.pages === 0 ? ' chart__bar--empty' : ''));
    bar.style.height = Math.max(d.pages === 0 ? 3 : 6, Math.round((d.pages / max) * 100)) + '%';
    bar.title = d.k + ': ' + d.pages + ' pagine';
    col.appendChild(bar);
    chart.appendChild(col);
  });
  container.appendChild(chart);
  container.appendChild(el('div', 'chart__caption', 'Pagine lette · ultimi 14 giorni'));
}

function renderHeatmap(container) {
  const s = Stats.load();
  const weeks = 13;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const start = new Date(today);
  start.setDate(start.getDate() - (dow + (weeks - 1) * 7));
  const max = Math.max(1, ...Object.values(s.days).map((d) => d.pages || 0));
  const grid = el('div', 'heatmap');
  let col = null;
  for (let i = 0; i < weeks * 7; i++) {
    if (i % 7 === 0) { col = el('div', 'heatmap__col'); grid.appendChild(col); }
    const dt = new Date(start); dt.setDate(dt.getDate() + i);
    const cell = el('div', 'heatmap__cell');
    if (dt > today) { cell.dataset.level = 'future'; col.appendChild(cell); continue; }
    const key = dayKeyOf(dt);
    const pages = (s.days[key] && s.days[key].pages) || 0;
    cell.dataset.level = pages === 0 ? 0 : Math.min(4, Math.ceil((pages / max) * 4));
    cell.title = key + ': ' + pages + ' pagine';
    col.appendChild(cell);
  }
  container.appendChild(grid);
  container.appendChild(el('div', 'chart__caption', 'Costanza · ultime 13 settimane'));
}

function openGoalEditor(rerender) {
  const g = Goal.load() || { type: 'books', period: 'year', target: 12 };
  const host = $('#goal-editor');
  host.innerHTML = '';
  host.hidden = false;
  const mk = (id, label, opts, val) => {
    const wrap = el('label', 'goal-field');
    wrap.appendChild(el('span', null, label));
    const sel = el('select'); sel.id = id;
    opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (v === val) o.selected = true; sel.appendChild(o); });
    wrap.appendChild(sel);
    return wrap;
  };
  host.appendChild(mk('goal-type', 'Conta', [['books', 'Libri'], ['pages', 'Pagine']], g.type));
  host.appendChild(mk('goal-period', 'Periodo', [['week', 'a settimana'], ['year', "quest'anno"]], g.period));
  const numWrap = el('label', 'goal-field');
  numWrap.appendChild(el('span', null, 'Obiettivo'));
  const num = el('input'); num.id = 'goal-target'; num.type = 'number'; num.min = '1'; num.value = g.target;
  numWrap.appendChild(num);
  host.appendChild(numWrap);
  const actions = el('div', 'goal-editor__actions');
  const save = el('button', 'btn btn--primary btn--sm', 'Salva obiettivo');
  save.onclick = () => {
    const t = parseInt($('#goal-target').value, 10);
    if (isNaN(t) || t < 1) { showToast('Inserisci un numero valido'); return; }
    Goal.save({ type: $('#goal-type').value, period: $('#goal-period').value, target: t });
    host.hidden = true;
    rerender();
  };
  const remove = el('button', 'btn btn--ghost btn--sm', 'Rimuovi');
  remove.onclick = () => { Goal.clear(); host.hidden = true; rerender(); };
  actions.appendChild(save); actions.appendChild(remove);
  host.appendChild(actions);
}

function renderStats() {
  const books = state.books;
  const s = Stats.summary();
  const totals = statTotals();
  const finished = books.filter((b) => bookStatus(b) === 'read').length;
  const inProgress = books.filter((b) => bookStatus(b) === 'reading').length;
  const speed = totals.totalSeconds > 0 ? (totals.totalPages / (totals.totalSeconds / 3600)) : 0;
  const author = mostReadAuthor(books);

  const body = $('#stats-body');
  body.innerHTML = '';

  // --- reading goal ---
  const prog = Goal.progress(books);
  const goalBox = el('div', 'goal');
  if (prog) {
    goalBox.appendChild(el('div', 'goal__label', '🎯 ' + prog.label));
    const barWrap = el('div', 'goal__bar');
    const fill = el('div', 'goal__fill'); fill.style.width = prog.pct + '%';
    barWrap.appendChild(fill);
    goalBox.appendChild(barWrap);
    goalBox.appendChild(el('div', 'goal__meta', prog.done + ' / ' + prog.target + (prog.pct >= 100 ? ' · raggiunto! 🎉' : ' · ' + prog.pct + '%')));
    const edit = el('button', 'goal__edit', 'Modifica obiettivo');
    edit.onclick = () => openGoalEditor(renderStats);
    goalBox.appendChild(edit);
  } else {
    const setBtn = el('button', 'goal__edit', '＋ Imposta un obiettivo di lettura');
    setBtn.onclick = () => openGoalEditor(renderStats);
    goalBox.appendChild(setBtn);
  }
  body.appendChild(goalBox);
  const editorHost = el('div', 'goal-editor'); editorHost.id = 'goal-editor'; editorHost.hidden = true;
  body.appendChild(editorHost);

  // --- summary tiles ---
  const tiles = el('div', 'stat-tiles');
  const tile = (big, small) => {
    const t = el('div', 'stat-tile');
    t.appendChild(el('div', 'stat-tile__big', big));
    t.appendChild(el('div', 'stat-tile__small', small));
    tiles.appendChild(t);
  };
  tile(String(s.today.pages), 'pagine oggi');
  tile(String(s.streak), s.streak === 1 ? 'giorno di fila' : 'giorni di fila');
  tile(String(finished), finished === 1 ? 'libro finito' : 'libri finiti');
  tile(String(inProgress), 'in lettura');
  body.appendChild(tiles);

  // --- history chart + heatmap ---
  const charts = el('div', 'stat-charts');
  renderHistoryChart(charts);
  renderHeatmap(charts);
  body.appendChild(charts);

  // --- detail rows ---
  const rows = el('div', 'stat-rows');
  const row = (label, value) => {
    const r = el('div', 'stat-row');
    r.appendChild(el('span', 'stat-row__label', label));
    r.appendChild(el('span', 'stat-row__value', value));
    rows.appendChild(r);
  };
  row('Ultimi 7 giorni', s.wPages + ' pagine · ' + fmtMinutes(s.wSeconds));
  row('Totale letto', totals.totalPages + ' pagine · ' + fmtMinutes(totals.totalSeconds));
  if (speed > 0) row('Velocità media', Math.round(speed) + ' pagine/ora');
  if (author) row('Autore più letto', author.author + ' (' + author.count + ')');
  row('Libri in libreria', String(books.length));
  body.appendChild(rows);

  $('#stats-modal').hidden = false;
}

$('#menu-stats').addEventListener('click', () => {
  $('#library-menu').hidden = true;
  renderStats();
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
    notePageSeen(page);
    updateProgressUI();
    persistProgress();
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

/* Capture selection rectangles as fractions of the page wrap (0..1).
   getClientRects() often returns many fragmented (sometimes overlapping) rects —
   one per text span. We merge them into one tidy box per visual line so the saved
   highlight follows the text precisely instead of looking patchy. */
function captureQuoteRects(range, wrap) {
  if (!range || !wrap) return [];
  const wr = wrap.getBoundingClientRect();
  if (!wr.width || !wr.height) return [];

  // collect usable rects in wrap-local pixel space
  const raw = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 2) continue;
    raw.push({ left: r.left - wr.left, top: r.top - wr.top, right: r.right - wr.left, bottom: r.bottom - wr.top });
  }
  if (!raw.length) return [];

  // group rects that belong to the same line (vertical overlap), union horizontally
  raw.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const r of raw) {
    const mid = (r.top + r.bottom) / 2;
    const g = lines.find((L) => mid >= L.top && mid <= L.bottom);
    if (g) {
      g.left = Math.min(g.left, r.left); g.right = Math.max(g.right, r.right);
      g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom);
    } else {
      lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }

  return lines.map((L) => ({
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
  popover.hidden = false;
  // clamp horizontally so the popover never spills outside the reader
  const half = (popover.offsetWidth || 180) / 2;
  let left = rect.left + rect.width / 2 - scrollRect.left;
  left = Math.max(half + 6, Math.min(scrollRect.width - half - 6, left));
  popover.style.left = left + 'px';
  // flip below the selection when there isn't room above (so it never covers the text)
  const spaceAbove = rect.top - scrollRect.top;
  if (spaceAbove < 52) {
    popover.classList.add('selection-popover--below');
    popover.style.top = (rect.bottom - scrollRect.top) + 'px';
  } else {
    popover.classList.remove('selection-popover--below');
    popover.style.top = spaceAbove + 'px';
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
  if (quotes.length === 0) {
    qList.appendChild(el('div', 'panel-empty', 'Nessuna citazione salvata ancora.'));
  } else {
    const bar = el('div', 'panel-toolbar');
    const exportBtn = el('button', 'panel-toolbar__btn', '↧ Esporta citazioni');
    exportBtn.onclick = () => exportQuotes(book);
    bar.appendChild(exportBtn);
    qList.appendChild(bar);
  }
  quotes.forEach((q) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Pagina ' + q.page));
    const textEl = el('div', 'panel-item__text', '"' + escapeHtml(q.text) + '"');
    textEl.onclick = () => goToPage(q.page);
    item.appendChild(textEl);

    // note (shown if present)
    const noteEl = el('div', 'panel-item__note');
    noteEl.hidden = !q.note;
    if (q.note) noteEl.textContent = q.note;
    item.appendChild(noteEl);

    const actions = el('div', 'panel-item__actions');
    const noteBtn = el('button', 'panel-item__link', q.note ? 'Modifica nota' : 'Aggiungi nota');
    noteBtn.onclick = (ev) => {
      ev.stopPropagation();
      // toggle an inline editor
      const existing = item.querySelector('.note-editor');
      if (existing) { existing.remove(); return; }
      const ta = el('textarea', 'note-editor');
      ta.value = q.note || '';
      ta.placeholder = 'Scrivi una nota su questa citazione…';
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

    const del = el('button', 'panel-item__delete', 'Elimina');
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
  if (quotes.length === 0) { showToast('Nessuna citazione da esportare'); return; }
  const lines = [];
  lines.push('# ' + (book.title || 'Senza titolo'));
  if (book.author) lines.push('*' + book.author + '*');
  lines.push('');
  lines.push('> ' + quotes.length + (quotes.length === 1 ? ' citazione' : ' citazioni') + ' — BookNest');
  lines.push('');
  quotes.forEach((q) => {
    lines.push('### Pagina ' + q.page);
    lines.push('> ' + q.text.replace(/\n+/g, ' ').trim());
    if (q.note) { lines.push(''); lines.push('**Nota:** ' + q.note); }
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = (book.title || 'citazioni').replace(/[^\w\sÀ-ÿ-]/g, '').trim().slice(0, 60) || 'citazioni';
  a.download = 'citazioni-' + safe + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast('Citazioni esportate');
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
    list.appendChild(el('div', 'panel-empty', 'Questo PDF non ha un indice.'));
    return;
  }
  const addItems = (items, depth) => {
    items.forEach((it) => {
      const row = el('button', 'outline-item');
      row.style.paddingLeft = (10 + depth * 14) + 'px';
      row.textContent = it.title || '(senza titolo)';
      row.onclick = async () => {
        const p = await outlineDestToPage(it.dest);
        if (p) goToPage(p);
        else showToast('Destinazione non disponibile');
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

/* ============================================================
   Tablet sidebar logic (variante 2a)
   Non duplica nessuna logica: richiama gli handler già esistenti
   (#menu-stats, #menu-export, #menu-import, #theme-toggle) e legge/scrive
   lo stesso `state` usato dal resto dell'app.
   ============================================================ */

/* ---- shelves nella sidebar: stesso stato di renderStatusBar() ---- */
function renderSidebarShelves() {
  const host = $('#sidebar-shelves');
  if (!host) return;
  host.innerHTML = '';
  for (const key of ['all', 'toread', 'reading', 'read']) {
    const count = key === 'all' ? state.books.length : state.books.filter((b) => bookStatus(b) === key).length;
    if (key !== 'all' && count === 0 && state.activeStatus !== key) continue;
    const item = el('button', 'chip' + (state.activeStatus === key ? ' chip--active' : ''));
    item.type = 'button';
    item.innerHTML = `<span>${STATUS_LABELS[key]}</span><span>${count}</span>`;
    item.onclick = () => { state.activeStatus = key; renderStatusBar(); renderGrid(); };
    host.appendChild(item);
  }
}

// renderStatusBar() è già chiamata da loadLibrary() e dai click sulle chip
// mobile: la "avvolgiamo" così la sidebar resta sempre sincronizzata, senza
// toccare la funzione originale.
const _renderStatusBar = renderStatusBar;
renderStatusBar = function () {
  _renderStatusBar();
  renderSidebarShelves();
};

/* ---- pannello impostazioni: richiama i bottoni esistenti del menu mobile ---- */
(function initSidebarSettings() {
  const btn = $('#sidebar-settings-btn');
  const panel = $('#sidebar-settings-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('#sidebar-menu-export').addEventListener('click', () => { panel.hidden = true; $('#menu-export').click(); });
  $('#sidebar-menu-import').addEventListener('click', () => { panel.hidden = true; $('#menu-import').click(); });
  $('#sidebar-theme-toggle').addEventListener('click', () => $('#theme-toggle').click());
  $('#sidebar-stats-btn').addEventListener('click', () => $('#menu-stats').click());

  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) panel.hidden = true;
  }, true);
})();

/* ---- dropdown di ordinamento: pilota lo stesso state.sortBy / #sort-select ---- */
(function initLibSort() {
  const trigger = $('#lib-sort-trigger');
  const panel = $('#lib-sort-panel');
  const label = $('#lib-sort-label');
  if (!trigger) return;

  const SORT_LABELS = { recent: 'Recenti', title: 'Titolo', author: 'Autore', progress: 'Progresso' };

  function paint() {
    label.textContent = SORT_LABELS[state.sortBy] || 'Recenti';
    panel.innerHTML = '';
    Object.entries(SORT_LABELS).forEach(([value, text]) => {
      const active = state.sortBy === value;
      const opt = el('button', 'lib-sort__opt' + (active ? ' lib-sort__opt--active' : ''));
      opt.type = 'button';
      opt.innerHTML = `<span>${text}</span>` + (active ? '<span class="lib-sort__check">✓</span>' : '');
      opt.onclick = () => {
        state.sortBy = value;
        $('#sort-select').value = value; // tiene sincronizzata la select nativa (mobile)
        panel.hidden = true;
        paint();
        renderGrid();
      };
      panel.appendChild(opt);
    });
  }

  trigger.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) paint(); });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !trigger.contains(e.target)) panel.hidden = true;
  }, true);

  paint();
})();

/* ---- toggle apri/chiudi la sidebar (solo tablet/desktop), stato persistente ---- */
(function initSidebarToggle() {
  const KEY = 'booknest-sidebar-collapsed';
  const view = $('#library-view');
  const btn = $('#sidebar-toggle');
  if (!view || !btn) return;
  if (localStorage.getItem(KEY) === '1') view.classList.add('sidebar-collapsed');
  btn.addEventListener('click', () => {
    const collapsed = view.classList.toggle('sidebar-collapsed');
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  });
})();
