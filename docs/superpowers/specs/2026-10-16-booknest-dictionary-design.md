# BookNest — Dictionary (personal vocabulary)

Date: 2026-10-16 · Status: approved in chat

## Goal
Select a word while reading, save it, and get its meaning automatically. All saved
words live on one Dictionary page (all books) and in a "Words" tab of the reader's
side panel (current book).

## User flow
1. Select 1–3 words in the reader (long-press, tap-extend, mouse). The selection
   popover's **Define** button becomes **📖 Dictionary** (shown only for 1–3 words;
   for longer selections it is hidden).
2. Tapping it saves the word and turns the popover into a small **definition card**:
   word, lemma (if different), part of speech, 1–3 senses, plus `Edit` and `Undo`.
   While fetching: "Looking up…". Tapping outside closes it.
3. Saving the same word again (same book, same normalized word) does not duplicate:
   the new context is appended to the entry (max 5 contexts kept).

## Data model
Stored on the book, like quotes (no DB schema change; backups include it):

```js
book.words = [{
  id, word,            // as selected, trimmed ("Sgomenti")
  key,                 // normalized lookup key: lowercase, NFC, no edge punctuation ("sgomenti")
  lang,                // 'it' | 'en' | … | null  (book language at save time)
  lemma,               // base form if the entry redirected ("sgomento"), else null
  pos,                 // part of speech ("Sostantivo", "Noun"…), or null
  senses: [string],    // 1–3 plain-text definitions; [] = none found
  source,              // 'wiktionary-it' | 'wiktionary-en' | 'manual' | null
  status,              // 'ok' | 'pending' (offline / network error) | 'notfound'
  contexts: [{ page, sentence }],
  addedAt, updatedAt,
}]
```
Deleting a book deletes its words (accepted by the user).

## Lookup (js/dictionary-lookup.js, pure parsing + fetch wrapper)
- Language = the book's language (same guess the audiobook uses); fallback `navigator.language`.
- **Italian** (`lang === 'it'`): `it.wiktionary.org/w/api.php?action=parse&page=<w>&prop=text&format=json&formatversion=2&origin=*`.
  Parse the Italian section's first `<ol>`; each `<li>` is a sense, with nested
  example lists (`<dl>`, `<ul>`) and tags stripped. Part of speech = nearest heading before the list.
  If every sense is an inflection pointer ("plurale di X", "… indicativo di X",
  "femminile di X", "participio … di X"…), follow the link target X once and use its senses,
  setting `lemma = X`. Try the word as typed, then lowercase.
- **English and other languages**: `en.wiktionary.org/api/rest_v1/page/definition/<w>`,
  pick the entry for the book's language (`en`, `it`, `fr`…), strip HTML, skip empty
  senses; "plural of X"/"… form of X" follows X once the same way.
- Italian not found → try the English Wiktionary REST for `it` before giving up.
- 8 s timeout per request (AbortController). Network error → `status: 'pending'`;
  definitely missing → `status: 'notfound'`.
- **Pending retry**: when the Dictionary page or Words tab opens, and on `online`,
  entries with `status: 'pending'` are looked up again (max 10 per pass).

## Dictionary page (js/dictionary-view.js)
- Sidebar entry "Dictionary" (between Statistics and Select books) opens a full-height
  modal `#dictionary-modal` (same pattern as Statistics).
- Header: search box (matches word, lemma, senses), book filter `<select>` ("All books" + books
  that have words), count, **Export** (Markdown, grouped alphabetically).
- List: alphabetical by word (locale compare). Each entry: **word** (→ *lemma*), pos,
  numbered senses, first context sentence in italics with the word in bold, and
  "Book title · p. N" which opens the book at that page.
- Entry ⋮ menu: Edit meaning (inline textarea, one sense per line → `source: 'manual'`,
  `status: 'ok'`), Look up again, Delete (with Undo toast).
- Status display: pending → "Waiting for connection…" + Retry; notfound → "No definition
  found" + Write it / Retry.
- Empty state explains how to add words.

## Reader side panel
New tab **Words** next to Bookmarks / Quotes / Contents, same entry renderer, current
book only; tapping the page reference jumps there.

## Opening a book at a page
`openReader(id, { page })` starts at `page` instead of `lastPage` (also sets `openedAtPage`).

## Context sentence
`sentenceAround(range)` exported from `reader-touch-select.js`: uses the existing layer
model + `sentenceBounds` to return the sentence containing the selection start
(whitespace collapsed, max 300 chars).

## Files
- New: `js/dictionary-lookup.js` (parse + fetch), `js/dictionary-core.js` (pure: normalize key,
  add/merge entry, search/filter/sort, markdown export), `js/dictionary-view.js`
  (page + entry renderer + definition card), `css/dictionary.css`.
- Changed: `index.html` (sidebar item, modal, panel tab, popover button), `js/reader-selection.js`
  (Dictionary button), `js/reader-panel.js` (Words tab), `js/reader.js` (openReader page),
  `js/reader-touch-select.js` (`sentenceAround`), `js/reader-tts.js` (export book language),
  `app.js`, `sw.js` (v16 + new files), README.

## Testing
- Unit (node:test): Italian HTML parsing (senses, examples stripped, pos, inflection
  pointer detection + target), English REST parsing, key normalization, merge/no-duplicate,
  search/filter/sort, markdown export. Fixtures are saved HTML/JSON snippets.
- E2E (Playwright, Wiktionary mocked with `page.route`): save word → card shows meaning;
  inflected word follows lemma; duplicate merges contexts; Dictionary page lists, searches,
  filters by book, opens the book at the page; edit meaning; delete + undo; offline →
  pending → retry fills it; Words tab in reader; export downloads a .md.

## Out of scope
Pronunciation audio, flashcards/spaced repetition, translations.
