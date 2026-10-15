import { state } from './state.js';
import { $, el, escapeHtml } from './dom.js';
import { renderSinglePage } from './reader.js';
import { findOccurrences } from './search-core.js';

/* ---- search within the book: occurrence list with context ---- */
let results = [];
let pos = -1;

function currentQuery() { return $('#reader-search-input').value.trim(); }

function setProgress(done, total) {
  const p = $('#search-progress');
  if (done >= total) { p.hidden = true; return; }
  if ($('#reader-search-bar').hidden) { p.hidden = true; return; }
  p.hidden = false;
  p.textContent = 'Indexing ' + done + '/' + total + '…';
}

export async function buildSearchIndex() {
  const { pdfDoc } = state.reader;
  if (!pdfDoc) return;
  const index = state.reader.textIndex; // this book's Map, never a later book's
  const total = pdfDoc.numPages;
  for (let n = 1; n <= total; n++) {
    if (!index.has(n)) {
      try {
        const page = await pdfDoc.getPage(n);
        const tc = await page.getTextContent();
        if (state.reader.pdfDoc !== pdfDoc) return;
        index.set(n, tc.items.map((i) => i.str).join(' '));
      } catch (e) { /* ignore */ }
    }
    if (state.reader.pdfDoc !== pdfDoc) return; // reader closed / changed book meanwhile
    if (n % 10 === 0 || n === total) setProgress(n, total);
  }
  if (currentQuery()) runSearch();
}

function renderResults() {
  const list = $('#search-results');
  list.innerHTML = '';
  list.hidden = results.length === 0;
  results.forEach((r, i) => {
    const item = el('button', 'search-result' + (i === pos ? ' search-result--active' : ''));
    item.type = 'button';
    item.appendChild(el('span', 'search-result__page', 'p. ' + r.page));
    item.appendChild(el('span', 'search-result__text',
      escapeHtml(r.before) + '<mark>' + escapeHtml(r.match) + '</mark>' + escapeHtml(r.after)));
    item.onclick = () => { pos = i; showCurrent(); };
    list.appendChild(item);
  });
}

function updateCount() {
  $('#reader-search-count').textContent = results.length ? (pos + 1) + '/' + results.length : 'no results';
}

function runSearch() {
  const q = currentQuery();
  if (!q) { results = []; pos = -1; $('#reader-search-count').textContent = ''; renderResults(); return; }
  results = findOccurrences(state.reader.textIndex, q);
  pos = results.length ? 0 : -1;
  updateCount();
  renderResults();
}

async function showCurrent() {
  const r = results[pos];
  if (!r) return;
  updateCount();
  $('#search-results').querySelectorAll('.search-result').forEach((n, i) => n.classList.toggle('search-result--active', i === pos));
  const q = currentQuery().toLowerCase();
  if (state.reader.mode === 'paginated') {
    await renderSinglePage(r.page);
    highlightQueryOnPage(r.page, q);
  } else {
    const wrap = document.querySelector(`.pdf-page-wrap[data-page="${r.page}"]`);
    if (wrap) {
      $('#pdf-scroll').scrollTo({ top: Math.max(0, wrap.offsetTop - 8), behavior: 'smooth' });
      setTimeout(() => highlightQueryOnPage(r.page, q), 350);
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

function step(d) {
  if (!results.length) return;
  pos = (pos + d + results.length) % results.length;
  showCurrent();
}

function closeSearch() {
  $('#reader-search-bar').hidden = true;
  $('#reader-search-input').value = '';
  results = []; pos = -1;
  $('#reader-search-count').textContent = '';
  renderResults();
  $('#search-progress').hidden = true;
}

export function resetSearchUI() { closeSearch(); }

export function initReaderSearch() {
  $('#reader-search-btn').addEventListener('click', () => {
    $('#reader-search-bar').hidden = false;
    $('#reader-search-input').focus();
    const total = state.reader.pdfDoc ? state.reader.pdfDoc.numPages : 0;
    setProgress(state.reader.textIndex.size, total);
  });
  $('#reader-search-close').addEventListener('click', closeSearch);
  $('#reader-search-input').addEventListener('input', runSearch);
  $('#reader-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); showCurrent(); }
  });
  $('#reader-search-next').addEventListener('click', () => step(1));
  $('#reader-search-prev').addEventListener('click', () => step(-1));
}
