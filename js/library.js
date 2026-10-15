import { pdfjsLib } from './pdf.js';
import { state, bookStatus, STATUS_LABELS } from './state.js';
import { $, el, uid, showToast, escapeHtml } from './dom.js';
import { DB } from './db.js';
import { extractMetadata, renderThumbnail } from './metadata.js';
import { openMetadataModal } from './metadata-modal.js';
import { openReader } from './reader.js';
import { hashBlob } from './hash.js';
import { requestPersistence, storageInfo, formatStorageInfo } from './storage.js';

/* ======================================================================
   Library view
   ====================================================================== */
async function refreshStorageInfo() {
  const text = formatStorageInfo(await storageInfo());
  for (const id of ['#storage-info', '#sidebar-storage-info']) { const n = $(id); if (n) n.textContent = text; }
}

export async function loadLibrary() {
  state.books = await DB.all();
  renderStatusBar();
  renderCategoryBar();
  renderGrid();
  refreshStorageInfo();
}

export function renderStatusBar() {
  const bar = $('#status-bar');
  if (state.books.length === 0) { bar.hidden = true; renderSidebarShelves(); return; }
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
  renderSidebarShelves(); // keep the tablet sidebar shelves in sync
}

function sortBooks(list) {
  const by = state.sortBy;
  const copy = list.slice();
  if (by === 'title') copy.sort((a, b) => a.title.localeCompare(b.title, 'en'));
  else if (by === 'author') copy.sort((a, b) => (a.author || 'zzz').localeCompare(b.author || 'zzz', 'en'));
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
  const allChip = el('button', 'chip' + (state.activeCategory === 'All' ? ' chip--active' : ''), 'All');
  allChip.onclick = () => { state.activeCategory = 'All'; renderCategoryBar(); renderGrid(); };
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

export function renderGrid() {
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
  if (state.activeCategory !== 'All') list = list.filter((b) => b.category === state.activeCategory);
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
    if (st === 'read') cover.appendChild(el('div', 'book-badge book-badge--read', 'Read'));
    else if (st === 'reading' && pct > 0) cover.appendChild(el('div', 'book-badge book-badge--reading', pct + '%'));

    cover.onclick = () => openReader(book.id);

    const meta = el('div', 'book-meta');
    meta.appendChild(el('p', 'book-title', escapeHtml(book.title)));
    meta.appendChild(el('p', 'book-author', escapeHtml(book.author || 'Unknown author')));
    if (book.rating > 0) {
      meta.appendChild(el('p', 'book-stars', '★'.repeat(book.rating) + '<span class="book-stars__off">' + '★'.repeat(5 - book.rating) + '</span>'));
    }
    meta.onclick = () => openMetadataModal({ mode: 'edit', book });

    card.appendChild(cover);
    card.appendChild(meta);
    grid.appendChild(card);
  });
}

// Legacy books have no hash: compute it lazily the first time we need to compare.
async function findBookByHash(hash) {
  for (const b of await DB.all()) {
    if (!b.hash && b.fileBlob) { b.hash = await hashBlob(b.fileBlob); await DB.put(b); }
    if (b.hash === hash) return b;
  }
  return null;
}

export async function addBookFromFile(file) {
  const hash = await hashBlob(file);
  const existing = await findBookByHash(hash);
  if (existing) { showToast('Already in library: ' + existing.title, 3500); return; }
  showToast('Adding ' + file.name + '…', 4000);
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
    hash,
  };
  await DB.put(book);
  await loadLibrary();
  showToast('Added: ' + title);
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

export function initLibrary() {
  $('#sort-select').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderGrid();
  });

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
      catch (err) { console.error(err); showToast("Couldn't open " + file.name); }
    }
  });

  $('#library-menu-btn').addEventListener('click', () => { $('#library-menu').hidden = false; });
  $('#menu-close').addEventListener('click', () => { $('#library-menu').hidden = true; });
  $('#library-menu').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

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

    const SORT_LABELS = { recent: 'Recent', title: 'Title', author: 'Author', progress: 'Progress' };

    function paint() {
      label.textContent = SORT_LABELS[state.sortBy] || 'Recent';
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

  requestPersistence().then(refreshStorageInfo);
}
