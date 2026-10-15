/* ======================================================================
   App state
   ====================================================================== */
export const state = {
  books: [],              // cached list from DB
  activeCategory: 'All',
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
export function bookStatus(b) {
  if (b.status && b.status !== 'auto') return b.status;
  if (b.finishedAt) return 'read';
  if (b.lastOpenedAt) return 'reading';
  return 'toread';
}
export const STATUS_LABELS = { all: 'All', toread: 'To read', reading: 'Reading', read: 'Read' };
