/* Book ratings: 0 (none) or 0.5 … 5 in half-star steps. */

export function normalizeRating(r) {
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(5, Math.max(0.5, Math.round(n * 2) / 2));
}

/* 'full' | 'half' | 'empty' for each of the five stars */
export function starFills(r) {
  const v = normalizeRating(r);
  return [1, 2, 3, 4, 5].map((i) => (v >= i ? 'full' : v >= i - 0.5 ? 'half' : 'empty'));
}

export function ratingLabel(r) {
  const v = normalizeRating(r);
  return v ? v + (v === 1 ? ' star' : ' stars') : 'No rating';
}

/* Stars for a library card: full, half and empty glyphs. */
export function starsHtml(r) {
  return starFills(r).map((f) => (f === 'full' ? '★'
    : '<span class="book-stars__' + (f === 'half' ? 'half' : 'off') + '">★</span>')).join('');
}
