# BookNest — Sync between devices via Google Drive

Date: 2026-10-17 · Status: approved in chat

## Goal
PC and Android tablet show the same library: books (PDFs included), reading position,
ratings/metadata, bookmarks, quotes, dictionary words, reading stats and goal.
Automatic, offline-tolerant, no server of our own.

## Storage on Drive
Google Drive **appDataFolder** (scope `https://www.googleapis.com/auth/drive.appdata`): a hidden,
app-private folder; the app cannot see the user's other files.
- `library.json` — the whole library without PDF bytes:
  `{ app: 'BookNest', syncVersion: 1, updatedAt, books: { [hash]: record }, deleted: { [hash]: ts }, stats, goal }`
  (`record` = the IndexedDB book without `fileBlob`, thumbnail included so covers show before the PDF arrives).
- `book-<hash>.pdf` — one file per PDF, named by its SHA-256 content hash (`book.hash`), uploaded once.

Books are identified across devices by `hash` (local `id`s differ). Books without a hash are
not synced until the existing hash backfill gives them one.

## Change tracking (central, invisible to the rest of the app)
`DB.put(book)` reads the stored record in the same transaction and stamps what changed
(pure `stampChanges(old, next, now)` in `js/sync-merge.js`):
- `book._t.meta` — title, author, category, rating, review, status, startedAt, finishedAt, readingMode
- `book._t.pos` — lastPage, lastOpenedAt
- list items (`bookmarks`, `quotes`, `words`): an item whose JSON changed gets `item._t = now`;
  an item that disappeared is recorded in `book._gone[list][id] = now` (tombstone).
- `DB.delete(id)` records `deleted[hash] = now` in the sync state (localStorage `booknest-sync`).
- Every stamped change dispatches `booknest:changed` (sync schedules a push).
- `DB.putRaw(book)` writes without stamping (used when applying remote data).
- Stats/goal live in localStorage: `Goal.save` stamps `savedAt`; stats merge by per-day max.

## Merge rules (pure, `js/sync-merge.js`)
For the same hash:
- meta group: the side with the newer `_t.meta` wins (whole group).
- pos group: the side with the newer `_t.pos` wins (the device read most recently).
- lists: union by `id`; same id → newer `_t` wins; ids in either side's `_gone` (newer than the
  item's `_t`) are dropped; `_gone` maps are unioned (max ts).
- static fields (filename, numPages, addedAt, thumbnail, hash): keep local if present, else remote.
- book deletion: `deleted[hash]` newer than both sides' latest stamp → removed everywhere;
  a book re-added after its deletion (newer `addedAt`/stamps) survives.
- stats: per-day max (existing `mergeStats`); goal: newer `savedAt` wins.

## Sync engine (`js/sync.js`)
`syncNow()` (serialized, one at a time):
1. Pull `library.json` (if any) and the appData file list.
2. Merge remote + local → apply to IndexedDB with `putRaw` (new books get `fileBlob: null`,
   `remoteOnly: true`); delete local books whose hash is tombstoned.
3. If the merged result differs from remote → upload `library.json`.
4. Upload PDFs whose `book-<hash>.pdf` is missing on Drive (resumable upload).
5. Download PDFs for local books with no `fileBlob` (background, one at a time); then clear `remoteOnly`.
Triggers: app start (after sign-in), `online`, `visibilitychange → visible` (≥ 60 s since last),
`booknest:changed` (debounced 10 s), reader close and `visibilitychange → hidden` (immediate push).
Failures leave a `dirty` flag and retry on the next trigger.

## Sign-in (`js/drive-auth.js`)
Google Identity Services token client (script `https://accounts.google.com/gsi/client`).
Access tokens last ~1 h; kept in localStorage with expiry. A popup can only open from a tap, so:
- valid token → sync runs automatically;
- expired token → the cloud status button reads "Tap to sync"; one tap gets a new token
  (no consent screen after the first time) and syncs.
"Disconnect" revokes the token and clears sync state (local books stay).
Client ID lives in `js/sync-config.js` (public, not a secret). Without a client ID the sync UI is hidden.

## UI
- Sidebar footer + library menu: cloud status button — Connect Google Drive / Synced ✓ /
  Syncing… / Offline / Tap to sync / Error (tap for details). Tapping = sync now.
- Settings panel: account email, "Sync now", "Disconnect".
- Book cards whose PDF isn't downloaded yet show a cloud badge; opening one shows
  "Downloading the book…" until it arrives (or "Not downloaded yet — connect to sync" offline).

## Service worker
Only same-origin requests are handled/cached (Drive and Google auth responses are never cached).
Cache bump v18, new files in APP_SHELL.

## Testing
- Unit (node:test): stampChanges (meta/pos/list items/tombstones), mergeBook, mergeLibrary
  (new on either side, deletions, re-add after delete, conflicts by timestamp), stats/goal merge.
- E2E (Playwright): a fake Drive (`page.route` on googleapis.com, in-memory store shared by two
  browser contexts = PC and tablet) and a stubbed GIS token client. Scenarios: add on A → appears
  on B with its PDF; read to page N on A → B opens at N; quote/word on each side → both have both;
  delete on A → gone on B; offline changes pushed when back online; expired token → "Tap to sync".

## Out of scope
Real-time push between devices (sync happens on the triggers above), sharing with other people,
selective sync, iOS-specific handling.
