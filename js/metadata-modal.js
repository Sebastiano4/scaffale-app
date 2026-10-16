import { $, el, showToast, fmtDate } from './dom.js';
import { DB } from './db.js';
import { loadLibrary, deleteBooksWithUndo } from './library.js';
import { normalizeRating, starFills, ratingLabel } from './rating.js';

/* ---- metadata modal (used for add-fallback edits and later edits) ---- */
let modalCtx = null; // { mode: 'edit', book }

function paintStars(rating) {
  const fills = starFills(rating);
  document.querySelectorAll('#meta-rating .star').forEach((s, i) => {
    s.classList.toggle('star--on', fills[i] === 'full');
    s.classList.toggle('star--half', fills[i] === 'half');
  });
  $('#meta-rating').setAttribute('aria-label', 'Rating: ' + ratingLabel(rating));
}

/* The review box grows with its text (from its 4 rows up to half the screen, then scrolls inside). */
const REVIEW_MAX_SCREEN = 0.5;
function fitReview() {
  const ta = $('#meta-review');
  if (!ta || ta.offsetParent === null) return;
  ta.style.height = 'auto';
  const border = ta.offsetHeight - ta.clientHeight;
  const max = Math.round(window.innerHeight * REVIEW_MAX_SCREEN);
  const h = Math.min(ta.scrollHeight + border, max);
  ta.style.height = h + 'px';
  ta.style.overflowY = ta.scrollHeight + border > max ? 'auto' : 'hidden';
}

export function openMetadataModal({ mode, book }) {
  modalCtx = { mode, book, rating: normalizeRating(book.rating) };
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
  $('#metadata-modal .modal__card').scrollTop = 0;
  fitReview(); // only measurable once the modal is visible

  let delBtn = document.getElementById('meta-delete');
  if (mode === 'edit') {
    if (!delBtn) {
      delBtn = el('button', 'btn btn--ghost', 'Delete book');
      delBtn.id = 'meta-delete';
      delBtn.style.marginTop = '4px';
      delBtn.style.width = '100%';
      $('#metadata-modal .modal__card').appendChild(delBtn);
      delBtn.onclick = () => {
        $('#metadata-modal').hidden = true;
        deleteBooksWithUndo([modalCtx.book.id]);
      };
    }
    delBtn.hidden = false;
  } else if (delBtn) {
    delBtn.hidden = true;
  }
}

export function initMetadataModal() {
  $('#meta-cancel').addEventListener('click', () => { $('#metadata-modal').hidden = true; });
  $('#meta-review').addEventListener('input', fitReview);
  window.addEventListener('resize', fitReview);

  // star rating interaction
  document.querySelectorAll('#meta-rating .star').forEach((star) => {
    // left half of a star = half a star less; keyboard clicks (no pointer position) give the whole star
    star.addEventListener('click', (e) => {
      if (!modalCtx) return;
      const r = star.getBoundingClientRect();
      const leftHalf = e.detail > 0 && e.clientX < r.left + r.width / 2;
      modalCtx.rating = Number(star.dataset.v) - (leftHalf ? 0.5 : 0);
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
