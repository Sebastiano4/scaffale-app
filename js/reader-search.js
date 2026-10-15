import { state } from './state.js';
import { $ } from './dom.js';
import { renderSinglePage } from './reader.js';

/* ---- search within the book ---- */
export async function buildSearchIndex() {
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

export function initReaderSearch() {
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
      : 'no results';
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
}
