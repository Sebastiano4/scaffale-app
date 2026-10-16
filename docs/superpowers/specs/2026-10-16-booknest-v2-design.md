# BookNest v2 — selection, immersive mode, audiobook, read shelf

Date: 2026-10-16 · Status: approved in chat · Target device: Android tablet (Chrome PWA)

## 1. Text selection (fix + touch gestures)

**Problem:** selecting words/sentences on the pdf.js text layer is hard on touch: native handles jump to page start/end when the finger crosses gaps between spans, and partial words get selected.

**Base fixes (reader-selection.js):**
- Use pdf.js's anti-jump technique: an `.endOfContent` element at the end of each text layer, and a `selecting` class on the layer while a pointer selection is active (CSS makes `.endOfContent` cover the layer only while selecting).
- When a drag selection ends, snap the range to whole words.
- Selection may span two consecutive pages in continuous mode.

**Touch gestures (new js/reader-touch-select.js):**
- Long-press (~450 ms, finger moved < 10 px) on a word → select that word (suppress the native context menu/selection for that press).
- While a selection exists: tap on another word → extend the selection to that word (start stays anchored; works across pages). Tapping again redefines the end.
- Double-tap on a word → select its whole sentence (sentence = between `.!?…` boundaries, may cross spans and lines on the same page).
- Tap on empty area / outside text → clear selection.
- Words are derived from the pdf.js text-layer spans (split span text into words with offsets); the selection is applied as a real DOM `Range` via `window.getSelection()`, so the existing `selectionchange` → popover (Quote / Copy / Define / Translate / Speak) and the saved-quote rectangles keep working unchanged.
- Mouse drag on desktop keeps working.

## 2. Immersive mode (new js/immersive.js)

- `#immersive-btn` in the reader top bar enters immersive mode: `requestFullscreen()` on the reader (falls back gracefully if refused), hides every UI element (top bar, progress bar, search bar, popovers except the selection popover, zoom/appearance buttons, page nav buttons). Only the pages remain, continuous scroll (the user's infinite-page mode). If the book is in paginated mode, immersive switches the view to continuous for the session and restores the previous mode on exit.
- Exit:
  - a decisive horizontal swipe **left → right** (dx ≥ 35% of width, |dy| < 0.5·dx, duration < 800 ms), not triggered during a text selection or long-press;
  - the Android back gesture/button: on enter push a history state; `popstate` exits immersive instead of leaving the reader;
  - leaving fullscreen by the system (`fullscreenchange` with no fullscreen element) also exits;
  - Esc on desktop.
- First entry shows a 2 s hint: "Swipe left → right to exit" (once per device, remembered in localStorage).
- Long-press selection and the selection popover work inside immersive mode. Reading progress/dwell tracking keeps working.

## 3. Audiobook (device voices, Android)

**Voice:** default = best installed voice for the book language (prefer names containing "Natural", "Neural", "Google", or `localService === false`; language from the text if detectable, else `navigator.language`). A settings panel (`#tts-settings`, opened from a control near `#read-aloud-btn`) lets the user pick the voice, **speed** (0.7–1.5, default 1.0) and **pitch** (0.8–1.2, default 1.0); stored in localStorage.

**Pacing (new js/tts-text.js, pure, unit-tested):**
- Clean page text: join hyphenated line breaks (`libe-\nro` → `libero`), turn line breaks into spaces but keep paragraph breaks (blank line or line ending with sentence punctuation followed by an indented/capitalized line → paragraph), drop running headers/footers and lone page numbers when they repeat across pages.
- Split into sentences; sentences longer than ~220 chars split at `;`, `:`, `,` (never mid-word).
- Speak one sentence per utterance; pause ~250 ms between sentences and ~700 ms between paragraphs (scaled by speed).
- A sentence cut by a page break is joined with the next page's start and read once.
- Highlight the sentence being read on the page (text-layer spans containing it) and keep it scrolled into view.
- Existing guards stay: generation tokens, stop on close, skip textless pages without navigating, iOS unlock.

**Honest limit:** timbre is the system voice's; Google natural voices are far better than the default but not a human narrator.

## 4. Read shelf (library.js)

- Library splits into: main grid (to read + reading) and below it a **"Read · N"** shelf with finished books and their finish date; the shelf is collapsible (state remembered). Filters/search apply to both parts.
- Card ⋮ menu gains **"Mark as read"** / **"Mark as unread"** (sets/clears manual status and `finishedAt`); immediate re-render with Undo toast.
- The "Read" status chip and sidebar shelf entry stay visible even at count 0.

## Execution

Four parallel tracks in separate worktrees (S selection, I immersive, T tts, L shelf) on top of a setup commit that adds per-track CSS files, stub modules wired in app.js, placeholders in index.html, and sw.js entries. Each track only edits its own files. Review per track, merge, full test run, final review, publish only after the user's OK.
