import { state } from './state.js';
import { $, el, uid, showToast, escapeHtml } from './dom.js';
import { DB } from './db.js';
import { updateProgressUI, goToPage } from './reader.js';
import { refreshQuoteHighlights } from './reader-selection.js';
import { renderWordsList } from './dictionary-view.js';

export function renderSidePanel() {
  const book = state.reader.book;
  const bmList = $('#bookmarks-list');
  const qList = $('#quotes-list');
  bmList.innerHTML = '';
  qList.innerHTML = '';

  const bookmarks = (book.bookmarks || []).slice().sort((a, b) => a.page - b.page);
  if (bookmarks.length === 0) bmList.appendChild(el('div', 'panel-empty', 'No bookmarks yet.'));
  bookmarks.forEach((b) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Page ' + b.page));
    item.onclick = () => goToPage(b.page);
    const del = el('button', 'panel-item__delete', 'Remove');
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
    qList.appendChild(el('div', 'panel-empty', 'No quotes saved yet.'));
  } else {
    const bar = el('div', 'panel-toolbar');
    const exportBtn = el('button', 'panel-toolbar__btn', '↧ Export quotes');
    exportBtn.onclick = () => exportQuotes(book);
    bar.appendChild(exportBtn);
    qList.appendChild(bar);
  }
  quotes.forEach((q) => {
    const item = el('div', 'panel-item');
    item.appendChild(el('div', 'panel-item__page', 'Page ' + q.page));
    const textEl = el('div', 'panel-item__text', '"' + escapeHtml(q.text) + '"');
    textEl.onclick = () => goToPage(q.page);
    item.appendChild(textEl);

    // note (shown if present)
    const noteEl = el('div', 'panel-item__note');
    noteEl.hidden = !q.note;
    if (q.note) noteEl.textContent = q.note;
    item.appendChild(noteEl);

    const actions = el('div', 'panel-item__actions');
    const noteBtn = el('button', 'panel-item__link', q.note ? 'Edit note' : 'Add note');
    noteBtn.onclick = (ev) => {
      ev.stopPropagation();
      // toggle an inline editor
      const existing = item.querySelector('.note-editor');
      if (existing) { existing.remove(); return; }
      const ta = el('textarea', 'note-editor');
      ta.value = q.note || '';
      ta.placeholder = 'Write a note about this quote…';
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

    const del = el('button', 'panel-item__delete', 'Delete');
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

  renderWordsList($('#words-list'), book);
}

/* ---- export a book's quotes + notes as a Markdown file ---- */
function exportQuotes(book) {
  const quotes = (book.quotes || []).slice().sort((a, b) => a.page - b.page);
  if (quotes.length === 0) { showToast('No quotes to export'); return; }
  const lines = [];
  lines.push('# ' + (book.title || 'Untitled'));
  if (book.author) lines.push('*' + book.author + '*');
  lines.push('');
  lines.push('> ' + quotes.length + (quotes.length === 1 ? ' quote' : ' quotes') + ' — BookNest');
  lines.push('');
  quotes.forEach((q) => {
    lines.push('### Page ' + q.page);
    lines.push('> ' + q.text.replace(/\n+/g, ' ').trim());
    if (q.note) { lines.push(''); lines.push('**Note:** ' + q.note); }
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = (book.title || 'quotes').replace(/[^\w\sÀ-ÿ-]/g, '').trim().slice(0, 60) || 'quotes';
  a.download = 'quotes-' + safe + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast('Quotes exported');
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
    list.appendChild(el('div', 'panel-empty', 'This PDF has no table of contents.'));
    return;
  }
  const addItems = (items, depth) => {
    items.forEach((it) => {
      const row = el('button', 'outline-item');
      row.style.paddingLeft = (10 + depth * 14) + 'px';
      row.textContent = it.title || '(untitled)';
      row.onclick = async () => {
        const p = await outlineDestToPage(it.dest);
        if (p) goToPage(p);
        else showToast('Destination not available');
      };
      list.appendChild(row);
      if (it.items && it.items.length) addItems(it.items, depth + 1);
    });
  };
  addItems(outline, 0);
}

export function initReaderPanel() {
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
    showToast(idx >= 0 ? 'Bookmark removed' : 'Bookmark added');
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
      $('#words-list').hidden = which !== 'words';
      $('#outline-list').hidden = which !== 'outline';
      if (which === 'outline') renderOutline();
    });
  });
}
