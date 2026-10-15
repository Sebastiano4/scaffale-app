# BookNest — A/B/C improvements design

Date: 2026-10-15 · Status: approved in chat

BookNest is a no-build PWA (`index.html`, `styles.css`, `app.js` as `type="module"`, `sw.js`, pdf.js in `vendor/`). Books live in IndexedDB (`scaffale-db`), settings and stats in localStorage. UI text is English.

## Execution order

1. **B (refactor)** — sequential, committed on `main`.
2. **A (data safety)** and **C (reader)** — in parallel, each in its own git worktree/branch (`feat/data-safety`, `feat/reader`), touching disjoint modules; merged into `main` afterwards.

Shared files both A and C may need (`index.html`, `styles.css`, `sw.js`) are edited with *appends / local insertions only* to keep merges trivial. Each branch bumps nothing in `sw.js` except adding its own new module paths to the asset list; the cache version is bumped once after the merge.

## B — Refactor into ES modules (no behaviour change)

- `app.js` becomes a thin bootstrap that imports modules from `js/`.
- Modules (indicative, follow natural seams in the current file):
  - `js/state.js` — shared mutable `state` object and constants.
  - `js/dom.js` — `$`, `el`, `escapeHtml`, `showToast`, `uid`, `fmtDate`, formatting helpers.
  - `js/db.js` — IndexedDB wrapper `DB`.
  - `js/stats.js` — `Stats`, `Goal`, reading-time tracking.
  - `js/theme.js` — app theme.
  - `js/library.js` — load/sort/filter/render grid, status bar, category bar, sidebar shelves, add-book flow.
  - `js/metadata.js` — PDF metadata extraction + thumbnail rendering.
  - `js/metadata-modal.js` — edit/delete modal.
  - `js/backup.js` — export/import.
  - `js/stats-view.js` — stats modal, charts, heatmap, goal editor.
  - `js/reader.js` — open/close, rendering (continuous/paginated), progress, appearance filter, outline, goto.
  - `js/reader-selection.js` — text layer, selection popover, quotes/highlights, side panel, quote export.
  - `js/reader-search.js` — search index and search UI.
- Cross-module calls use explicit imports; no globals except `pdfjsLib` passed via import.
- `sw.js`: one clearly marked `CACHE_NAME` + `APP_SHELL` list that includes every `js/*.js` module.
- Acceptance: every flow in README still works identically (verified in browser).

## A — Data safety & library management

1. **Persistent storage**: on startup call `navigator.storage.persist()` (if available). Library ⋮ menu shows "Storage: X MB used of Y MB · Protected / Not protected" via `navigator.storage.estimate()` / `persisted()`.
2. **Backup as .zip**: export produces `booknest-backup-YYYY-MM-DD.zip` containing `library.json` (metadata + stats, no blobs) and `books/<id>.pdf`. Zip writer/reader is a small local module `js/zip.js` (STORE method, CRC32), no dependencies. Export streams books one at a time into Blob parts (no giant base64 string). Import accepts `.zip` and legacy `.json`.
3. **Duplicate detection**: on add, compute SHA-256 (`crypto.subtle.digest`) of the file, store as `book.hash`. If a book with the same hash exists → toast "Already in library: <title>", skip. Books without hash (legacy) are hashed lazily on first duplicate check.
4. **Discoverable delete**:
   - ⋮ button on each book card → menu with Edit / Delete.
   - Delete (from card menu or modal) removes the book from the grid immediately and shows toast "Book deleted · Undo" for ~6 s; actual `DB.delete` happens when the toast expires (or on page hide). Undo restores it.
   - "Select" mode in the library toolbar: tap covers to select, bar shows "N selected · Delete", same undo toast for the batch.

## C — Reader improvements

1. **Search results panel**: searching lists every occurrence as `p. N — …context with <mark>term</mark>…`, total occurrence count, tap to jump (and highlight). Indexing shows progress ("Indexing 34/210") while `buildSearchIndex` runs.
2. **Selection popover actions**: existing Quote plus **Copy** (clipboard), **Define** (opens Wiktionary search in a new tab), **Translate** (opens Google Translate with the text in a new tab), **Speak** (`speechSynthesis`).
3. **Read page aloud**: ▶/⏸ button in the reader toolbar reads the current page's text with `speechSynthesis` and advances to the next page when finished; stops on reader close. Hidden if `speechSynthesis` is unavailable.

## Testing

No test framework exists; verification is manual-by-script with Playwright against a local static server (`python -m http.server`), using a small generated PDF fixture. Each phase: add book, open, read/scroll, search, quote, backup → import, delete → undo, plus phase-specific checks. Screenshots reported to the user.

## Out of scope

D–G from the brainstorm (Obsidian export, tags, EPUB, sync).
