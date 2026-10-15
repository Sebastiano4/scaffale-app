import { $, el, showToast, fmtDate } from './dom.js';
import { DB } from './db.js';
import { loadLibrary } from './library.js';

/* ---- metadata modal (used for add-fallback edits and later edits) ---- */
let modalCtx = null; // { mode: 'edit', book }

function paintStars(rating) {
  document.querySelectorAll('#meta-rating .star').forEach((s) => {
    s.classList.toggle('star--on', Number(s.dataset.v) <= rating);
  });
}

export function openMetadataModal({ mode, book }) {
  modalCtx = { mode, book, rating: book.rating || 0 };
  $('#metadata-modal-title').textContent = mode === 'edit' ? 'Edit book' : 'Confirm the book details';
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
      '<span>Added: ' + fmtDate(book.addedAt) + '</span>' +
      (book.startedAt ? '<span>Started: ' + fmtDate(book.startedAt) + '</span>' : '') +
      (book.finishedAt ? '<span>Finished: ' + fmtDate(book.finishedAt) + '</span>' : '');
  } else {
    dates.hidden = true;
  }
  $('#metadata-modal').hidden = false;

  let delBtn = document.getElementById('meta-delete');
  if (mode === 'edit') {
    if (!delBtn) {
      delBtn = el('button', 'btn btn--ghost', 'Delete book');
      delBtn.id = 'meta-delete';
      delBtn.style.marginTop = '4px';
      delBtn.style.width = '100%';
      $('.modal__card').appendChild(delBtn);
      delBtn.onclick = async () => {
        if (!confirm('Delete "' + modalCtx.book.title + '" from the shelf?')) return;
        await DB.delete(modalCtx.book.id);
        $('#metadata-modal').hidden = true;
        await loadLibrary();
        showToast('Book deleted');
      };
    }
    delBtn.hidden = false;
  } else if (delBtn) {
    delBtn.hidden = true;
  }
}

export function initMetadataModal() {
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
    book.title = $('#meta-title').value.trim() || 'Untitled';
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
    showToast('Saved');
  });
}
