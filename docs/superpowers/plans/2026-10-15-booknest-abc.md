# BookNest A/B/C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split BookNest's monolithic `app.js` into ES modules (B), then in parallel add data-safety/library-management features (A) and reader improvements (C).

**Architecture:** No-build PWA. `app.js` becomes a bootstrap importing `js/*.js` modules; each module exposes an `init*()` that binds its DOM listeners (previously top-level code). New pure logic (zip, hashing, backup format, search) lives in DOM-free modules unit-tested with `node --test`; UI flows are covered by Playwright e2e tests against a local static server.

**Tech Stack:** Vanilla JS ES modules, IndexedDB, pdf.js (vendored), Node 24 (`node:test`), `@playwright/test` (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-15-booknest-abc-design.md`

## Global Constraints

- No build step, no runtime dependencies. Everything the browser loads is a plain file in the repo. Dev-only deps (Playwright) live in `package.json` `devDependencies`.
- UI copy is **English** (match existing strings).
- Repo root: `C:\Users\gjela\OneDrive\Documenti\APP\scaffale-app`. Branch `main` for Phase 1; Phase 2 uses worktrees `feat/data-safety` (A) and `feat/reader` (C).
- IndexedDB name `scaffale-db`, store `books`, keyPath `id` — unchanged (existing user data must keep working).
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Phase 2 file ownership (to keep merges trivial):**
  - A may edit: `js/library.js`, `js/backup.js`, `js/metadata-modal.js`, `js/dom.js`, `css/library-extras.css`, library-view parts of `index.html`, and create `js/zip.js`, `js/hash.js`, `js/backup-format.js`, `js/storage.js`, tests under `tests/unit/a-*` and `tests/e2e/a-*`.
  - C may edit: `js/reader.js`, `js/reader-search.js`, `js/reader-selection.js`, `css/reader-extras.css`, reader-view parts of `index.html`, and create `js/search-core.js`, `js/speech.js`, `js/reader-tts.js`, tests under `tests/unit/c-*` and `tests/e2e/c-*`.
  - Neither A nor C edits `app.js`, `js/state.js`, `sw.js`, `README.md`, `styles.css`, `package.json`. New modules are imported from the owning module, not from `app.js`. `sw.js`/README are updated in Phase 3.

## File Structure (after Phase 1)

```
app.js                 bootstrap: imports + init order + SW registration
js/pdf.js              pdfjsLib import + worker config (re-export)
js/state.js            shared `state`, bookStatus(), STATUS_LABELS
js/dom.js              $, el, uid, showToast, escapeHtml, fmtDate, fmtMinutes
js/db.js               DB (IndexedDB wrapper)
js/metadata.js         titleCase, guessFromFilename, extractMetadata, renderThumbnail
js/stats.js            Stats, Goal, flushReadingTime, initReadingTimeTracking
js/theme.js            initTheme
js/library.js          library grid/filters/sort/search/sidebar/add-book/menu open-close
js/metadata-modal.js   edit modal + delete button
js/backup.js           export/import
js/stats-view.js       stats modal, charts, goal editor
js/reader.js           open/close, render, progress/dwell, appearance, nav, goto, goToPage
js/reader-selection.js text layer, quote highlights, live selection, selection popover
js/reader-panel.js     bookmarks, side panel, quote export, outline
js/reader-search.js    search index + search UI
css/library-extras.css (empty in Phase 1; A's styles)
css/reader-extras.css  (empty in Phase 1; C's styles)
tests/serve.mjs        static server for e2e
tests/fixtures/make-pdf.mjs   generates fixture PDFs
tests/e2e/*.spec.mjs   Playwright tests
tests/unit/*.test.mjs  node:test unit tests
playwright.config.mjs
package.json
```

---

# Phase 1 — B (sequential, on `main`)

### Task 1: Test harness + baseline smoke tests (against current app)

**Files:**
- Create: `package.json`, `playwright.config.mjs`, `tests/serve.mjs`, `tests/fixtures/make-pdf.mjs`, `tests/e2e/helpers.mjs`, `tests/e2e/smoke.spec.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `makePdf(pageLines: string[][], {title, author}) -> Buffer`; `writeFixture(name, pageLines, meta) -> absolutePath`; e2e helpers `freshApp(page)`, `addBook(page, filePath)`, `openFirstBook(page)`. Every later e2e test uses these.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "booknest",
  "private": true,
  "type": "module",
  "scripts": {
    "test:unit": "node --test tests/unit/",
    "test:e2e": "playwright test",
    "test": "node --test tests/unit/ && playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0"
  }
}
```

Run: `npm install` then `npx playwright install chromium` (no-op if already cached).

- [ ] **Step 2: Append to `.gitignore`**

```
node_modules/
test-results/
playwright-report/
tests/fixtures/out/
```

- [ ] **Step 3: Create `tests/serve.mjs`**

```js
// Minimal static server for e2e tests: serves the repo root on PORT.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    await stat(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log('serving ' + ROOT + ' on ' + PORT));
```

- [ ] **Step 4: Create `playwright.config.mjs`**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173/',
    serviceWorkers: 'block',
    acceptDownloads: true,
    viewport: { width: 1100, height: 800 },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 5: Create `tests/fixtures/make-pdf.mjs`**

```js
// Builds tiny valid PDFs with real (extractable) text, for tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function makePdf(pageLines, { title = 'Fixture Book', author = 'Test Author' } = {}) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => '\\' + c);
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const info = add(`<< /Title (${esc(title)}) /Author (${esc(author)}) >>`);
  const kids = [];
  for (const lines of pageLines) {
    const body = 'BT /F1 14 Tf 72 720 Td 18 TL ' + lines.map((l) => `(${esc(l)}) '`).join(' ') + ' ET';
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const OUT = fileURLToPath(new URL('./out/', import.meta.url));

export function writeFixture(name, pageLines, meta) {
  mkdirSync(OUT, { recursive: true });
  const p = join(OUT, name);
  writeFileSync(p, makePdf(pageLines, meta));
  return p;
}

// Standard 3-page fixture used across e2e tests. "nest" appears 3x on page 2, 1x on page 3.
export const STANDARD_PAGES = [
  ['Chapter one', 'The quick brown fox jumps over the lazy dog.'],
  ['Chapter two', 'A bird builds a nest. The nest is warm.', 'Every nest is different.'],
  ['Chapter three', 'The end of the nest story.'],
];
```

- [ ] **Step 6: Create `tests/e2e/helpers.mjs`**

```js
import { expect } from '@playwright/test';

// Opens the app with an empty IndexedDB + localStorage.
export async function freshApp(page) {
  await page.goto('index.html');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((res) => { const r = indexedDB.deleteDatabase('scaffale-db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  });
  await page.reload();
}

export async function addBook(page, filePath) {
  const before = await page.locator('.book-card').count();
  await page.setInputFiles('#file-input', filePath);
  await expect(page.locator('.book-card')).toHaveCount(before + 1);
}

export async function openFirstBook(page) {
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
  await expect(page.locator('#reader-loading')).toBeHidden();
  await expect(page.locator('.textLayer').first()).toBeVisible();
}
```

- [ ] **Step 7: Create `tests/e2e/smoke.spec.mjs`** (characterizes current behaviour — must pass before AND after refactor)

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test.beforeEach(async ({ page }) => { await freshApp(page); });

test('add a book: card shows metadata title/author', async ({ page }) => {
  await addBook(page, fixture);
  await expect(page.locator('.book-card .book-title')).toHaveText('Fixture Book');
  await expect(page.locator('.book-card .book-author')).toHaveText('Test Author');
});

test('library persists across reload', async ({ page }) => {
  await addBook(page, fixture);
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(1);
});

test('open reader shows page counter and text layer', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
  await expect(page.locator('.textLayer').first()).toContainText('quick brown fox');
});

test('search in book finds the pages containing the term', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#reader-search-btn');
  await page.waitForTimeout(500); // let background indexing finish (3 pages)
  await page.fill('#reader-search-input', 'nest');
  await expect(page.locator('#reader-search-count')).not.toHaveText('');
  await expect(page.locator('#reader-search-count')).not.toHaveText('no results');
});

test('bookmark toggles and shows in side panel', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#bookmark-btn');
  await page.click('#panel-btn');
  await expect(page.locator('#bookmarks-list .panel-item')).toHaveCount(1);
});

test('back to library and delete via edit modal', async ({ page }) => {
  await addBook(page, fixture);
  page.on('dialog', (d) => d.accept());
  await page.locator('.book-card .book-meta').first().click();
  await expect(page.locator('#metadata-modal')).toBeVisible();
  await page.click('#meta-delete');
  await expect(page.locator('.book-card')).toHaveCount(0);
});

test('edit metadata saves title', async ({ page }) => {
  await addBook(page, fixture);
  await page.locator('.book-card .book-meta').first().click();
  await page.fill('#meta-title', 'Renamed');
  await page.click('#meta-save');
  await expect(page.locator('.book-card .book-title')).toHaveText('Renamed');
});

test('theme toggle flips body data-theme', async ({ page }) => {
  const before = await page.evaluate(() => document.body.dataset.theme);
  await page.click('#theme-toggle');
  const after = await page.evaluate(() => document.body.dataset.theme);
  expect(after).not.toBe(before);
});

test('stats modal opens', async ({ page }) => {
  await addBook(page, fixture);
  await page.click('#library-menu-btn');
  await page.click('#menu-stats');
  await expect(page.locator('#stats-modal')).toBeVisible();
  await expect(page.locator('#stats-body .stat-tile')).toHaveCount(4);
});

test('no console errors during a normal session', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#back-btn');
  await expect(page.locator('#library-view')).toHaveClass(/view--active/);
  expect(errors).toEqual([]);
});
```

Note: some selectors (e.g. `#theme-toggle`, `#library-menu-btn`) may be hidden at the 1100px desktop viewport when the tablet sidebar is shown. If a click fails because the element is not visible, read `index.html`/`styles.css` and use the visible equivalent (e.g. `#sidebar-theme-toggle`, `#sidebar-settings-btn` → `#sidebar-stats-btn`) — do NOT change app code to make the test pass.

- [ ] **Step 8: Run tests against the CURRENT, unmodified app**

Run: `npx playwright test`
Expected: all PASS. If a test fails, the test is wrong (the app is the reference) — fix the test.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore playwright.config.mjs tests/
git commit -m "test: add Playwright smoke tests and PDF fixture generator"
```

---

### Task 2: Extract foundation modules (pdf, state, dom, db, metadata, stats, theme)

**Files:**
- Create: `js/pdf.js`, `js/state.js`, `js/dom.js`, `js/db.js`, `js/metadata.js`, `js/stats.js`, `js/theme.js`, `tests/unit/foundation.test.mjs`
- Modify: `app.js` (remove moved code, add imports)

**Interfaces:**
- Produces (exact exports):
  - `js/pdf.js`: `export { pdfjsLib }` (namespace re-export after setting `GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs'`).
  - `js/state.js`: `export const state`, `export function bookStatus(b)`, `export const STATUS_LABELS`.
  - `js/dom.js`: `export const $`, `export const el`, `export const uid`, `export function showToast(msg, ms = 2200)`, `export function escapeHtml(s)`, `export function fmtDate(ts)`, `export function fmtMinutes(seconds)`.
  - `js/db.js`: `export const DB` (same API: `all()`, `get(id)`, `put(book)`, `delete(id)`).
  - `js/metadata.js`: `export function titleCase`, `export function guessFromFilename`, `export async function extractMetadata(pdfDoc, filename)`, `export async function renderThumbnail(pdfDoc)`.
  - `js/stats.js`: `export const Stats`, `export const Goal`, `export function flushReadingTime()`, `export function initReadingTimeTracking()` (binds the `visibilitychange` and `pagehide` listeners currently at app.js:260-264).
  - `js/theme.js`: `export function initTheme()` (applies saved theme AND binds `#theme-toggle` click, currently app.js:269-282).

Source mapping (current `app.js` line numbers): DB 8-63; `$`/`el`/`uid`/`showToast` 68-83; `titleCase`/`guessFromFilename`/`extractMetadata`/`renderThumbnail` 85-142; `state` 147-164; `bookStatus`/`STATUS_LABELS` 169-175; `Stats`/`Goal` 180-252; `flushReadingTime` + listeners 254-264; theme 269-282; `escapeHtml` 418-420; `fmtDate` 483-487; `fmtMinutes` 668-672.

- [ ] **Step 1: Write unit test for the pure helpers** — `tests/unit/foundation.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessFromFilename, titleCase } from '../../js/metadata.js';

test('titleCase', () => {
  assert.equal(titleCase('the GREAT gatsby'), 'The Great Gatsby');
});

test('guessFromFilename: "Author - Title"', () => {
  assert.deepEqual(guessFromFilename('Italo Calvino - le citta invisibili.pdf'),
    { title: 'Le Citta Invisibili', author: 'Italo Calvino' });
});

test('guessFromFilename: plain name', () => {
  assert.deepEqual(guessFromFilename('my_notes.pdf'), { title: 'My Notes', author: '' });
});
```

`js/metadata.js` must therefore NOT import `js/pdf.js` or touch the DOM at module load (it only uses `pdfDoc` passed in and `document.createElement` inside `renderThumbnail`, which is fine at call time).

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module .../js/metadata.js`)

Run: `node --test tests/unit/`

- [ ] **Step 3: Create the seven modules** by moving code verbatim from `app.js` per the mapping, adding `export` and the imports each needs (`stats.js` imports `state` and `$`; `theme.js` imports `$`; `db.js` imports nothing). Create `js/pdf.js`:

```js
import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

export { pdfjsLib };
```

In `app.js`, delete the moved code, replace line 1-3 with imports from the new modules, and replace the top-level theme/listener code with calls `initTheme(); initReadingTimeTracking();` placed where `initTheme()` is currently called (Init section).

- [ ] **Step 4: Run unit + e2e**

Run: `node --test tests/unit/ && npx playwright test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js js/ tests/unit/
git commit -m "refactor: extract foundation modules from app.js"
```

---

### Task 3: Extract library-side modules (library, metadata-modal, backup, stats-view)

**Files:**
- Create: `js/library.js`, `js/metadata-modal.js`, `js/backup.js`, `js/stats-view.js`
- Modify: `app.js`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
  - `js/library.js`: `export async function loadLibrary()`, `export function renderGrid()`, `export function renderStatusBar()`, `export async function addBookFromFile(file)`, `export function initLibrary()`.
    `initLibrary()` binds: `#sort-select` change, library search (app.js:423-436), add-book inputs (441-451), library menu open/close + backdrop (583-585), and the three sidebar IIFEs (1818-1881). `renderStatusBar()` must call `renderSidebarShelves()` at its end directly — **delete** the `renderStatusBar = function` monkey-patch (1811-1815); imported bindings cannot be reassigned.
    `renderGrid` calls `openReader` (moves to `js/reader.js` in Task 4) and `openMetadataModal` (from `js/metadata-modal.js`). For this task, `app.js` temporarily exports it (`export { openReader };`) and `library.js` does `import { openReader } from '../app.js';`; Task 4 switches the import to `'./reader.js'`. ES module cycles are fine because these functions are only called at runtime, never during module evaluation.
  - `js/metadata-modal.js`: `export function openMetadataModal({ mode, book })`, `export function initMetadataModal()` (binds 539-578 listeners). Imports `loadLibrary` from `library.js`.
  - `js/backup.js`: `export function initBackup()` (binds `#menu-export`, `#menu-import`, `#import-input`; contains `blobToBase64`/`base64ToBlob`). Imports `loadLibrary`.
  - `js/stats-view.js`: `export function renderStats()`, `export function initStatsView()` (binds `#menu-stats`, `#stats-modal` backdrop, `#stats-close`; 586-587, 848-851).

Source mapping: library 287-416 + 422-478 + 583-585 + 1793-1881; modal 480-578 (minus `fmtDate`, already in dom.js); backup 589-666; stats-view 674-851 (minus `fmtMinutes`).

- [ ] **Step 1: Move code into the four modules** with `export`s and imports as above. In `app.js` call, in this order: `initLibrary(); initMetadataModal(); initBackup(); initStatsView();` after `initTheme(); initReadingTimeTracking();` and before `loadLibrary()`.

- [ ] **Step 2: Run e2e**

Run: `npx playwright test`
Expected: all PASS (add/persist/edit/delete/stats/theme tests cover these modules).

- [ ] **Step 3: Commit**

```bash
git add app.js js/
git commit -m "refactor: extract library, metadata modal, backup and stats view modules"
```

---

### Task 4: Extract reader modules; finalize bootstrap, CSS hooks, service worker

**Files:**
- Create: `js/reader.js`, `js/reader-selection.js`, `js/reader-panel.js`, `js/reader-search.js`, `css/library-extras.css`, `css/reader-extras.css`
- Modify: `app.js`, `js/library.js` (import `openReader` from `./reader.js`), `index.html` (two `<link>`s), `sw.js`

**Interfaces:**
- Produces:
  - `js/reader.js`: `export async function openReader(id)`, `export async function closeReader()`, `export async function renderReader()`, `export async function renderSinglePage(n)`, `export function goToPage(n)`, `export function updateProgressUI()`, `export function initReader()`. Contains 856-1270 (open/close, mode toggle, zoom, progress, dwell/persist, appearance, popover dismiss, progress-bar jump, canvas render, continuous/paginated, scroll tracking, swipe/edge tap, keyboard, resize), `goToPage` 1616-1621, goto popover 1668-1692. `initReader()` binds every listener in those ranges (wrap the two IIFEs at 1176-1183 and 1222-1244 inside it). `closeReader` calls `loadLibrary` from `library.js`; `openReader` calls `buildSearchIndex` from `reader-search.js`; the keydown Escape handler calls `clearLiveSelection` from `reader-selection.js`.
  - `js/reader-selection.js`: `export async function buildTextLayer(wrap, textContent, viewport)`, `export function refreshQuoteHighlights(page)`, `export function clearLiveSelection()`, `export function initReaderSelection()`. Contains 1273-1473 (text layer, highlights, rect merge, live selection, `selectionchange`, `#save-highlight-btn`). Save-quote handler calls `renderSidePanel` from `reader-panel.js`.
  - `js/reader-panel.js`: `export function renderSidePanel()`, `export function initReaderPanel()`. Contains bookmarks 1476-1487, side panel 1490-1586, `exportQuotes` 1589-1614, outline 1624-1665.
  - `js/reader-search.js`: `export async function buildSearchIndex()`, `export function initReaderSearch()`. Contains 1695-1771.
  - Final `app.js` is ONLY:

```js
import { initTheme } from './js/theme.js';
import { initReadingTimeTracking } from './js/stats.js';
import { initLibrary, loadLibrary } from './js/library.js';
import { initMetadataModal } from './js/metadata-modal.js';
import { initBackup } from './js/backup.js';
import { initStatsView } from './js/stats-view.js';
import { initReader } from './js/reader.js';
import { initReaderSelection } from './js/reader-selection.js';
import { initReaderPanel } from './js/reader-panel.js';
import { initReaderSearch } from './js/reader-search.js';

initTheme();
initReadingTimeTracking();
initLibrary();
initMetadataModal();
initBackup();
initStatsView();
initReader();
initReaderSelection();
initReaderPanel();
initReaderSearch();
loadLibrary();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
```

- [ ] **Step 1: Move reader code** into the four modules as mapped; remove the temporary `export { openReader }` from `app.js` and switch `library.js` to `import { openReader } from './reader.js'`.

- [ ] **Step 2: CSS hook files.** Create `css/library-extras.css` with content `/* Library-view additions (data safety & library management). */` and `css/reader-extras.css` with `/* Reader-view additions. */`. In `index.html`, right after the existing `styles.css` `<link>`, add:

```html
<link rel="stylesheet" href="css/library-extras.css">
<link rel="stylesheet" href="css/reader-extras.css">
```

- [ ] **Step 3: `sw.js`** — replace the header and `APP_SHELL` with:

```js
/* Bump CACHE_NAME on every release, and list every file the app loads in APP_SHELL. */
const CACHE_NAME = 'booknest-v12';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './css/library-extras.css',
  './css/reader-extras.css',
  './app.js',
  './js/pdf.js',
  './js/state.js',
  './js/dom.js',
  './js/db.js',
  './js/metadata.js',
  './js/stats.js',
  './js/theme.js',
  './js/library.js',
  './js/metadata-modal.js',
  './js/backup.js',
  './js/stats-view.js',
  './js/reader.js',
  './js/reader-selection.js',
  './js/reader-panel.js',
  './js/reader-search.js',
  './manifest.json',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];
```

The fetch handler's "app code" branch already covers `/js/` and `/css/` (network-first) — leave it.

- [ ] **Step 4: Add an e2e test for module coverage** — append to `tests/e2e/smoke.spec.mjs`:

```js
test('every js module listed in sw.js APP_SHELL exists', async ({ request }) => {
  const sw = await (await request.get('sw.js')).text();
  const paths = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter(Boolean);
  for (const p of paths) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(200);
  }
});

test('paginated mode: next page and outline tab work', async ({ page }) => {
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#mode-toggle');
  await page.click('#next-page');
  await expect(page.locator('#reader-progress')).toHaveText('Page 2 of 3');
  await page.click('#panel-btn');
  await page.click('.side-panel__tab[data-tab="outline"]');
  await expect(page.locator('#outline-list')).toContainText('no table of contents');
});
```

- [ ] **Step 5: Run everything**

Run: `node --test tests/unit/ && npx playwright test`
Expected: all PASS, and `app.js` is under 40 lines (`(Get-Content app.js).Count`).

- [ ] **Step 6: Commit**

```bash
git add app.js js/ css/ index.html sw.js tests/
git commit -m "refactor: extract reader modules, slim bootstrap, CSS hook files, SW asset list"
```

---

# Phase 2 — A and C in parallel (separate worktrees)

Before dispatch: from `main` after Task 4, create worktrees:
```
git worktree add ../scaffale-app-A -b feat/data-safety
git worktree add ../scaffale-app-C -b feat/reader
```
Each worker runs `npm install` in its worktree. Workers obey the file-ownership rules in Global Constraints.

## Track A — Data safety & library management (worktree `feat/data-safety`)

### Task A1: Persistent storage + storage info in the menu

**Files:**
- Create: `js/storage.js`, `tests/e2e/a-storage.spec.mjs`
- Modify: `js/library.js` (call into storage), `index.html` (one menu row in `#library-menu` and one in `#sidebar-settings-panel`)

**Interfaces:**
- Produces: `export async function requestPersistence(): Promise<boolean>`; `export async function storageInfo(): Promise<{usedMB:number, quotaMB:number, persisted:boolean} | null>`; `export function formatStorageInfo(info): string`.

- [ ] **Step 1: Failing e2e test** — `tests/e2e/a-storage.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp } from './helpers.mjs';

test('library menu shows storage usage line', async ({ page }) => {
  await freshApp(page);
  await page.evaluate(() => {
    document.querySelectorAll('#library-menu').forEach((m) => (m.hidden = false));
  });
  await expect(page.locator('#storage-info')).toContainText(/Storage: .* MB/);
});
```

- [ ] **Step 2: Run** `npx playwright test tests/e2e/a-storage.spec.mjs` — Expected FAIL (no `#storage-info`).

- [ ] **Step 3: Implement `js/storage.js`**

```js
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return false; }
}

export async function storageInfo() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usedMB: usage / 1048576, quotaMB: quota / 1048576, persisted };
  } catch (e) { return null; }
}

export function formatStorageInfo(info) {
  if (!info) return 'Storage: unavailable';
  const fmt = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(mb < 10 ? 1 : 0) + ' MB');
  return 'Storage: ' + fmt(info.usedMB) + ' used of ' + fmt(info.quotaMB) +
    ' · ' + (info.persisted ? 'Protected' : 'Not protected');
}
```

Note: `fmt` yields "MB" for values < 1024 MB; the e2e regex expects "MB" on an empty library — correct.

In `index.html`, add `<div id="storage-info" class="menu-info"></div>` as the last child inside `#library-menu`'s menu card, and `<div id="sidebar-storage-info" class="menu-info"></div>` inside `#sidebar-settings-panel`. In `js/library.js`:

```js
import { requestPersistence, storageInfo, formatStorageInfo } from './storage.js';

async function refreshStorageInfo() {
  const text = formatStorageInfo(await storageInfo());
  for (const id of ['#storage-info', '#sidebar-storage-info']) { const n = $(id); if (n) n.textContent = text; }
}
```

Call `requestPersistence().then(refreshStorageInfo)` once at the end of `initLibrary()`, and `refreshStorageInfo()` at the end of `loadLibrary()`.

In `css/library-extras.css`:

```css
.menu-info { font-size: 12px; opacity: 0.7; padding: 10px 16px 4px; line-height: 1.4; }
```

- [ ] **Step 4: Run** the spec — Expected PASS. Run full `npx playwright test` — all PASS.

- [ ] **Step 5: Commit** `git commit -m "feat: request persistent storage and show storage usage"`

---

### Task A2: Zip writer/reader (`js/zip.js`)

**Files:**
- Create: `js/zip.js`, `tests/unit/a-zip.test.mjs`

**Interfaces:**
- Produces: `export function crc32(bytes: Uint8Array): number`; `export async function createZip(entries: {name:string, data: Blob|Uint8Array|string}[]): Promise<Blob>`; `export async function readZip(blob: Blob): Promise<Map<string, Blob>>`. STORE only, no ZIP64 (max 4 GB total — documented limit).

- [ ] **Step 1: Failing unit tests** — `tests/unit/a-zip.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createZip, readZip } from '../../js/zip.js';

test('crc32 of "123456789" is CBF43926', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('roundtrip text and binary entries', async () => {
  const bin = new Uint8Array(70000).map((_, i) => i % 251);
  const zip = await createZip([
    { name: 'library.json', data: '{"a":1}' },
    { name: 'books/x.pdf', data: new Blob([bin]) },
  ]);
  assert.equal(zip.type, 'application/zip');
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()], ['library.json', 'books/x.pdf']);
  assert.equal(await files.get('library.json').text(), '{"a":1}');
  assert.deepEqual(new Uint8Array(await files.get('books/x.pdf').arrayBuffer()), bin);
});

test('starts with local-file signature PK\\x03\\x04', async () => {
  const zip = await createZip([{ name: 'a.txt', data: 'hi' }]);
  const head = new Uint8Array(await zip.slice(0, 4).arrayBuffer());
  assert.deepEqual([...head], [0x50, 0x4b, 0x03, 0x04]);
});

test('readZip rejects non-zip', async () => {
  await assert.rejects(readZip(new Blob(['not a zip at all'])), /not a zip/);
});
```

- [ ] **Step 2: Run** `node --test tests/unit/a-zip.test.mjs` — Expected FAIL (module missing).

- [ ] **Step 3: Implement `js/zip.js`**

```js
/* Minimal ZIP (STORE, no compression, no ZIP64) — enough for backups of PDFs,
   which are already compressed. Reads one entry at a time to keep memory low. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = new TextEncoder();
const DOS_DATE_1980_01_01 = 0x21;

export async function createZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const blob = e.data instanceof Blob ? e.data
      : new Blob([typeof e.data === 'string' ? enc.encode(e.data) : e.data]);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, 0, true);      // STORE
    h.setUint16(10, 0, true);
    h.setUint16(12, DOS_DATE_1980_01_01, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, size, true);
    h.setUint32(22, size, true);
    h.setUint16(26, nameBytes.length, true);
    h.setUint16(28, 0, true);
    parts.push(h.buffer, nameBytes, blob);
    central.push({ nameBytes, crc, size, offset });
    offset += 30 + nameBytes.length + size;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, 0, true);
    h.setUint16(12, 0, true);
    h.setUint16(14, DOS_DATE_1980_01_01, true);
    h.setUint32(16, c.crc, true);
    h.setUint32(20, c.size, true);
    h.setUint32(24, c.size, true);
    h.setUint16(28, c.nameBytes.length, true);
    h.setUint32(42, c.offset, true);
    parts.push(h.buffer, c.nameBytes);
    cdSize += 46 + c.nameBytes.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, cdStart, true);
  parts.push(end.buffer);
  return new Blob(parts, { type: 'application/zip' });
}

const dec = new TextDecoder();

export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 22 + 65535);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = cd.getUint16(p + 10, true);
    const csize = cd.getUint32(p + 20, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    if (method !== 0) throw new Error('compressed zip entries are not supported: ' + name);
    const lh = new DataView(await blob.slice(lho, lho + 30).arrayBuffer());
    const start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    out.set(name, blob.slice(start, start + csize));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
```

- [ ] **Step 4: Run** `node --test tests/unit/` — Expected PASS.

- [ ] **Step 5: Commit** `git commit -m "feat: add minimal zip writer/reader for backups"`

---

### Task A3: Backup v2 (.zip) with legacy .json import

**Files:**
- Create: `js/backup-format.js`, `tests/unit/a-backup-format.test.mjs`, `tests/e2e/a-backup.spec.mjs`
- Modify: `js/backup.js`, `index.html` (`#import-input` `accept` attribute → `.zip,.json,application/zip,application/json`)

**Interfaces:**
- Consumes: `createZip`, `readZip` (A2); `Stats`, `Goal` (stats.js); `DB`; `loadLibrary`.
- Produces (`js/backup-format.js`, DOM-free):
  - `export function buildManifest(books, stats, goal, now = Date.now())` → `{ app:'BookNest', version:2, exportedAt, stats, goal, books: [meta + { file: 'books/<id>.pdf' }] }` (meta = book without `fileBlob`).
  - `export function bookFilePath(id)` → `'books/' + id + '.pdf'`.
  - `export function validateManifest(data)` → throws `Error('invalid backup')` unless `data.app === 'BookNest' && Array.isArray(data.books)`.
  - `export function mergeStats(current, incoming)` → per-day max of `pages`/`seconds` (moved from current import code).

- [ ] **Step 1: Failing unit tests** — `tests/unit/a-backup-format.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, bookFilePath, validateManifest, mergeStats } from '../../js/backup-format.js';

test('buildManifest strips blobs and references files', () => {
  const m = buildManifest([{ id: 'a1', title: 'T', fileBlob: {} }], { days: {} }, null, 5);
  assert.equal(m.version, 2);
  assert.equal(m.exportedAt, 5);
  assert.deepEqual(m.books, [{ id: 'a1', title: 'T', file: 'books/a1.pdf' }]);
  assert.equal(bookFilePath('a1'), 'books/a1.pdf');
});

test('validateManifest', () => {
  assert.throws(() => validateManifest({ app: 'X', books: [] }), /invalid backup/);
  assert.doesNotThrow(() => validateManifest({ app: 'BookNest', books: [] }));
});

test('mergeStats keeps per-day maximum', () => {
  const cur = { days: { d1: { pages: 5, seconds: 10 } } };
  const inc = { days: { d1: { pages: 3, seconds: 50 }, d2: { pages: 1 } } };
  assert.deepEqual(mergeStats(cur, inc).days, {
    d1: { pages: 5, seconds: 50 }, d2: { pages: 1, seconds: 0 },
  });
});
```

- [ ] **Step 2: Run** — Expected FAIL.

- [ ] **Step 3: Implement `js/backup-format.js`**

```js
export const bookFilePath = (id) => 'books/' + id + '.pdf';

export function buildManifest(books, stats, goal, now = Date.now()) {
  return {
    app: 'BookNest',
    version: 2,
    exportedAt: now,
    stats,
    goal,
    books: books.map(({ fileBlob, ...meta }) => ({ ...meta, file: bookFilePath(meta.id) })),
  };
}

export function validateManifest(data) {
  if (!data || data.app !== 'BookNest' || !Array.isArray(data.books)) throw new Error('invalid backup');
}

export function mergeStats(current, incoming) {
  const out = { ...current, days: { ...(current.days || {}) } };
  for (const [k, v] of Object.entries((incoming && incoming.days) || {})) {
    const c = out.days[k] || { pages: 0, seconds: 0 };
    out.days[k] = { pages: Math.max(c.pages || 0, v.pages || 0), seconds: Math.max(c.seconds || 0, v.seconds || 0) };
  }
  return out;
}
```

- [ ] **Step 4: Rewrite export/import in `js/backup.js`** (keep `blobToBase64`-free; keep `base64ToBlob` for legacy import):

```js
import { createZip, readZip } from './zip.js';
import { buildManifest, bookFilePath, validateManifest, mergeStats } from './backup-format.js';

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportBackup() {
  const books = await DB.all();
  if (books.length === 0) { showToast('The library is empty, nothing to export'); return; }
  showToast('Preparing the backup… this may take a moment', 6000);
  try {
    const manifest = buildManifest(books, Stats.load(), Goal.load());
    const entries = [{ name: 'library.json', data: JSON.stringify(manifest) }];
    for (const b of books) if (b.fileBlob) entries.push({ name: bookFilePath(b.id), data: b.fileBlob });
    const zip = await createZip(entries);
    download(zip, 'booknest-backup-' + new Date().toISOString().slice(0, 10) + '.zip');
    showToast('Backup downloaded: ' + books.length + (books.length === 1 ? ' book' : ' books'));
  } catch (e) {
    console.error(e);
    showToast('Error during backup');
  }
}

async function importBackup(file) {
  showToast('Importing the backup…', 6000);
  try {
    let count = 0;
    let stats = null;
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
    if (isZip) {
      const files = await readZip(file);
      const lib = files.get('library.json');
      if (!lib) throw new Error('invalid backup');
      const data = JSON.parse(await lib.text());
      validateManifest(data);
      for (const { file: path, ...meta } of data.books) {
        const pdf = files.get(path);
        if (!pdf) continue;
        await DB.put({ ...meta, fileBlob: new Blob([pdf], { type: 'application/pdf' }) });
        count++;
      }
      stats = data.stats;
      if (data.goal && !Goal.load()) Goal.save(data.goal);
    } else {
      const data = JSON.parse(await file.text());
      validateManifest(data);
      for (const { fileB64, ...meta } of data.books) {
        if (!fileB64) continue;
        await DB.put({ ...meta, fileBlob: base64ToBlob(fileB64) });
        count++;
      }
      stats = data.stats;
    }
    if (stats && stats.days) Stats.save(mergeStats(Stats.load(), stats));
    await loadLibrary();
    showToast('Imported ' + count + (count === 1 ? ' book' : ' books'));
  } catch (err) {
    console.error(err);
    showToast('Invalid backup file');
  }
}
```

Wire them in `initBackup()`: `#menu-export` click → close menu, `exportBackup()`; `#import-input` change → `importBackup(file)` (reset `e.target.value` as today).

- [ ] **Step 5: e2e roundtrip** — `tests/e2e/a-backup.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

async function openMenu(page) {
  // desktop viewport may show the sidebar instead of the ⋮ menu; force the menu open
  await page.evaluate(() => { document.querySelector('#library-menu').hidden = false; });
}

test('export .zip then import restores the library', async ({ page }, testInfo) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openMenu(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#menu-export')]);
  expect(download.suggestedFilename()).toMatch(/^booknest-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const zipPath = testInfo.outputPath('backup.zip');
  await download.saveAs(zipPath);

  await freshApp(page);
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.setInputFiles('#import-input', zipPath);
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-card .book-title')).toHaveText('Fixture Book');
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-progress')).toHaveText('Page 1 of 3');
});

test('legacy .json backup still imports', async ({ page }, testInfo) => {
  await freshApp(page);
  const fs = await import('node:fs');
  const b64 = fs.readFileSync(fixture).toString('base64');
  const legacy = { app: 'BookNest', version: 1, exportedAt: 1, stats: { days: {} },
    books: [{ id: 'legacy1', title: 'Legacy', author: 'Old', numPages: 3, lastPage: 1, addedAt: 1, lastOpenedAt: 0, bookmarks: [], quotes: [], fileB64: b64 }] };
  const p = testInfo.outputPath('legacy.json');
  fs.writeFileSync(p, JSON.stringify(legacy));
  await page.setInputFiles('#import-input', p);
  await expect(page.locator('.book-card .book-title')).toHaveText('Legacy');
});
```

- [ ] **Step 6: Run** `node --test tests/unit/ && npx playwright test` — all PASS.

- [ ] **Step 7: Commit** `git commit -m "feat: zip-based backup with legacy json import"`

---

### Task A4: Duplicate detection on add

**Files:**
- Create: `js/hash.js`, `tests/unit/a-hash.test.mjs`, `tests/e2e/a-duplicates.spec.mjs`
- Modify: `js/library.js` (`addBookFromFile`)

**Interfaces:**
- Produces: `export async function hashBlob(blob: Blob): Promise<string>` (lowercase hex SHA-256). `book.hash` field on new books.

- [ ] **Step 1: Failing unit test** — `tests/unit/a-hash.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBlob } from '../../js/hash.js';

test('sha-256 of "abc"', async () => {
  assert.equal(await hashBlob(new Blob(['abc'])),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement `js/hash.js`**

```js
export async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Use it in `addBookFromFile`** (in `js/library.js`), at the top, before parsing the PDF:

```js
const hash = await hashBlob(file);
const existing = await findBookByHash(hash);
if (existing) { showToast('Already in library: ' + existing.title, 3500); return; }
```

add `hash,` to the new `book` object, and add to `library.js`:

```js
// Legacy books have no hash: compute it lazily the first time we need to compare.
async function findBookByHash(hash) {
  for (const b of await DB.all()) {
    if (!b.hash && b.fileBlob) { b.hash = await hashBlob(b.fileBlob); await DB.put(b); }
    if (b.hash === hash) return b;
  }
  return null;
}
```

- [ ] **Step 5: e2e** — `tests/e2e/a-duplicates.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const other = writeFixture('other.pdf', [['Something else']], { title: 'Other', author: 'X' });

test('adding the same PDF twice keeps one copy', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await page.setInputFiles('#file-input', fixture);
  await expect(page.locator('#toast')).toContainText('Already in library: Fixture Book');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await addBook(page, other);
  await expect(page.locator('.book-card')).toHaveCount(2);
});
```

- [ ] **Step 6: Run all tests** — PASS. **Step 7: Commit** `git commit -m "feat: skip duplicate PDFs using a SHA-256 fingerprint"`

---

### Task A5: Toast with action + undoable delete + ⋮ menu on cards

**Files:**
- Modify: `js/dom.js` (`showToast` gains optional action), `js/library.js`, `js/metadata-modal.js`, `index.html` (`#toast` stays; add `#card-menu` popover in library view), `css/library-extras.css`
- Create: `tests/e2e/a-delete.spec.mjs`

**Interfaces:**
- Produces:
  - `showToast(msg, ms = 2200, action = null)` where `action = { label: string, onClick: () => void }`. Backward compatible.
  - `js/library.js`: `export function deleteBooksWithUndo(ids: string[])`; `export async function flushPendingDeletes()`.
- Behaviour: `deleteBooksWithUndo` removes the ids from `state.books` and re-renders immediately; shows `"Book deleted"` / `"N books deleted"` with **Undo** for 6000 ms; on Undo → ids restored to view, nothing deleted; on expiry, on a new delete, or on `pagehide`/`visibilitychange→hidden` → `DB.delete` for pending ids. `loadLibrary()` filters pending ids out so a reload during the window does not resurrect them visually.

- [ ] **Step 1: Failing e2e** — `tests/e2e/a-delete.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test.beforeEach(async ({ page }) => { await freshApp(page); await addBook(page, fixture); });

test('card ⋮ menu → Delete → Undo restores the book', async ({ page }) => {
  await page.locator('.book-card .book-card__menu-btn').first().click();
  await page.click('#card-menu [data-action="delete"]');
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.click('#toast .toast__action');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(1);
});

test('delete is committed after the undo window', async ({ page }) => {
  await page.locator('.book-card .book-card__menu-btn').first().click();
  await page.click('#card-menu [data-action="delete"]');
  await page.waitForTimeout(6500);
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(0);
});

test('card ⋮ menu → Edit opens the modal', async ({ page }) => {
  await page.locator('.book-card .book-card__menu-btn').first().click();
  await page.click('#card-menu [data-action="edit"]');
  await expect(page.locator('#metadata-modal')).toBeVisible();
});

test('modal delete uses undo (no confirm dialog)', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.locator('.book-card .book-meta').first().click();
  await page.click('#meta-delete');
  await expect(page.locator('.book-card')).toHaveCount(0);
  await expect(page.locator('#toast .toast__action')).toHaveText('Undo');
  expect(dialogs).toBe(0);
});
```

Also update the Phase-1 smoke test `back to library and delete via edit modal`: it still passes (count goes to 0 immediately) — leave it.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: `showToast` with action** (replace in `js/dom.js`):

```js
export function showToast(msg, ms = 2200, action = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = el('button', 'toast__action', escapeHtml(action.label));
    b.type = 'button';
    b.onclick = () => { clearTimeout(showToast._t); t.hidden = true; action.onClick(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.hidden = true), ms);
}
```

(`escapeHtml` must be declared before use in the module or hoisted as a `function` — it is a function declaration, fine.)

- [ ] **Step 4: Undoable delete in `js/library.js`**

```js
const UNDO_MS = 6000;
let pending = null; // { ids: Set<string>, timer }

export async function flushPendingDeletes() {
  if (!pending) return;
  const { ids, timer } = pending;
  pending = null;
  clearTimeout(timer);
  for (const id of ids) { try { await DB.delete(id); } catch (e) { console.error(e); } }
}

export function deleteBooksWithUndo(ids) {
  flushPendingDeletes();
  const set = new Set(ids);
  state.books = state.books.filter((b) => !set.has(b.id));
  renderStatusBar(); renderCategoryBar(); renderGrid();
  pending = { ids: set, timer: setTimeout(flushPendingDeletes, UNDO_MS) };
  const msg = set.size === 1 ? 'Book deleted' : set.size + ' books deleted';
  showToast(msg, UNDO_MS, {
    label: 'Undo',
    onClick: () => { clearTimeout(pending && pending.timer); pending = null; loadLibrary(); },
  });
}
```

In `loadLibrary()`: after `state.books = await DB.all();` add `if (pending) state.books = state.books.filter((b) => !pending.ids.has(b.id));`.
In `initLibrary()`: `window.addEventListener('pagehide', flushPendingDeletes); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingDeletes(); });`

In `js/metadata-modal.js` replace the delete handler body with:

```js
delBtn.onclick = () => {
  $('#metadata-modal').hidden = true;
  deleteBooksWithUndo([modalCtx.book.id]);
};
```

(import `deleteBooksWithUndo` from `./library.js`; no `confirm()`.)

- [ ] **Step 5: ⋮ card menu.** In `renderGrid`, after building `meta`, add:

```js
const menuBtn = el('button', 'book-card__menu-btn', '⋮');
menuBtn.type = 'button';
menuBtn.setAttribute('aria-label', 'Book options');
menuBtn.onclick = (ev) => { ev.stopPropagation(); openCardMenu(book, menuBtn); };
card.appendChild(menuBtn);
```

Add to `index.html` inside the library view (sibling of `#book-grid`):

```html
<div id="card-menu" class="card-menu" hidden>
  <button type="button" data-action="edit">Edit</button>
  <button type="button" data-action="delete" class="card-menu__danger">Delete</button>
</div>
```

In `library.js`:

```js
let cardMenuBook = null;
function openCardMenu(book, anchor) {
  const menu = $('#card-menu');
  cardMenuBook = book;
  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
  menu.style.left = Math.max(8, r.right + window.scrollX - 150) + 'px';
  menu.hidden = false;
}
```

and in `initLibrary()`:

```js
$('#card-menu').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || !cardMenuBook) return;
  $('#card-menu').hidden = true;
  if (action === 'edit') openMetadataModal({ mode: 'edit', book: cardMenuBook });
  if (action === 'delete') deleteBooksWithUndo([cardMenuBook.id]);
});
document.addEventListener('pointerdown', (e) => {
  const m = $('#card-menu');
  if (!m.hidden && !m.contains(e.target) && !e.target.closest('.book-card__menu-btn')) m.hidden = true;
}, true);
```

CSS (`css/library-extras.css`; reuse existing CSS variables from `styles.css` — read it to pick the right token names for surface/text/accent colors):

```css
.book-card { position: relative; }
.book-card__menu-btn {
  position: absolute; top: 6px; right: 6px; z-index: 2;
  width: 30px; height: 30px; border-radius: 50%; border: 0;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 18px; line-height: 1; cursor: pointer;
}
.card-menu {
  position: absolute; z-index: 50; min-width: 150px; padding: 6px;
  border-radius: 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  display: flex; flex-direction: column;
}
.card-menu[hidden] { display: none; }
.card-menu button { text-align: left; padding: 10px 12px; border: 0; background: none; border-radius: 8px; cursor: pointer; font: inherit; color: inherit; }
.card-menu__danger { color: #e5534b; }
.toast__action { margin-left: 12px; border: 0; background: none; color: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; font: inherit; }
```

Give `.card-menu` the same background/text tokens as the existing modal card.

- [ ] **Step 6: Run all tests** — PASS. **Step 7: Commit** `git commit -m "feat: discoverable delete with undo via card menu"`

---

### Task A6: Select mode for batch delete

**Files:**
- Modify: `js/library.js`, `index.html` (Select button in library toolbar + selection bar), `css/library-extras.css`
- Create: `tests/e2e/a-select.spec.mjs`

**Interfaces:**
- Consumes: `deleteBooksWithUndo(ids)` (A5).
- Produces: `state`-independent module-level `selectMode: boolean`, `selected: Set<string>` in `library.js`. DOM: button `#select-mode-btn` (in the library header next to the search button, and `#sidebar-select-btn` in the sidebar if a sidebar toolbar exists), bar `#selection-bar` with `#selection-count`, `#selection-delete`, `#selection-cancel`.

- [ ] **Step 1: Failing e2e** — `tests/e2e/a-select.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const a = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });
const b = writeFixture('b.pdf', [['B book']], { title: 'Book B', author: 'X' });
const c = writeFixture('c.pdf', [['C book']], { title: 'Book C', author: 'Y' });

test('select two books and delete them with undo', async ({ page }) => {
  await freshApp(page);
  for (const f of [a, b, c]) await addBook(page, f);
  await page.locator('#select-mode-btn:visible, #sidebar-select-btn:visible').first().click();
  await page.locator('.book-card').nth(0).locator('.book-cover').click();
  await page.locator('.book-card').nth(1).locator('.book-cover').click();
  await expect(page.locator('#selection-count')).toHaveText('2 selected');
  await expect(page.locator('#reader-view')).not.toHaveClass(/view--active/); // taps select, not open
  await page.click('#selection-delete');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('2 books deleted');
  await page.click('#toast .toast__action');
  await expect(page.locator('.book-card')).toHaveCount(3);
});

test('cancel exits select mode', async ({ page }) => {
  await freshApp(page);
  await addBook(page, a);
  await page.locator('#select-mode-btn:visible, #sidebar-select-btn:visible').first().click();
  await page.click('#selection-cancel');
  await expect(page.locator('#selection-bar')).toBeHidden();
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('#reader-view')).toHaveClass(/view--active/);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** Read `index.html` to find the library header (where `#library-search-btn` lives) and add, next to it, an icon button `<button id="select-mode-btn" class="icon-btn" aria-label="Select books">` with a checkbox-style SVG matching the neighbours' markup. Add the bar near `#fab-add`:

```html
<div id="selection-bar" class="selection-bar" hidden>
  <span id="selection-count">0 selected</span>
  <button type="button" id="selection-cancel" class="btn btn--ghost btn--sm">Cancel</button>
  <button type="button" id="selection-delete" class="btn btn--primary btn--sm" disabled>Delete</button>
</div>
```

In `library.js`:

```js
let selectMode = false;
const selected = new Set();

function setSelectMode(on) {
  selectMode = on;
  selected.clear();
  $('#selection-bar').hidden = !on;
  $('#library-view').classList.toggle('select-mode', on);
  updateSelectionBar();
  renderGrid();
}
function updateSelectionBar() {
  $('#selection-count').textContent = selected.size + ' selected';
  $('#selection-delete').disabled = selected.size === 0;
}
```

In `renderGrid`, change the cover click and mark selected cards:

```js
if (selectMode && selected.has(book.id)) card.classList.add('book-card--selected');
cover.onclick = () => {
  if (!selectMode) { openReader(book.id); return; }
  if (selected.has(book.id)) selected.delete(book.id); else selected.add(book.id);
  card.classList.toggle('book-card--selected', selected.has(book.id));
  updateSelectionBar();
};
```

In `initLibrary()`:

```js
for (const id of ['#select-mode-btn', '#sidebar-select-btn']) {
  const b = $(id); if (b) b.addEventListener('click', () => setSelectMode(!selectMode));
}
$('#selection-cancel').addEventListener('click', () => setSelectMode(false));
$('#selection-delete').addEventListener('click', () => {
  const ids = [...selected];
  setSelectMode(false);
  deleteBooksWithUndo(ids);
});
```

If the tablet sidebar has its own toolbar, add `#sidebar-select-btn` there with the same markup pattern; if not, skip it (the test uses `:visible` on either).

CSS:

```css
.selection-bar {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 40;
  display: flex; gap: 10px; align-items: center; padding: 10px 14px;
  border-radius: 14px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}
.selection-bar[hidden] { display: none; }
.select-mode #fab-add, .select-mode .book-card__menu-btn { display: none; }
.book-card--selected .book-cover { outline: 3px solid currentColor; outline-offset: 2px; }
.book-card--selected .book-cover::after {
  content: '✓'; position: absolute; top: 6px; left: 6px; width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center; background: #2f81f7; color: #fff; font-size: 14px;
}
```

Use the modal surface tokens for `.selection-bar` background/text, and the app accent token instead of `#2f81f7` if one exists. Ensure `.book-cover` has `position: relative` (add it if missing).

- [ ] **Step 4: Run all tests** — PASS. **Step 5: Commit** `git commit -m "feat: select mode for deleting several books at once"`

---

## Track C — Reader improvements (worktree `feat/reader`)

### Task C1: Occurrence search core

**Files:**
- Create: `js/search-core.js`, `tests/unit/c-search-core.test.mjs`

**Interfaces:**
- Produces: `export function findOccurrences(textIndex: Map<number,string>, query: string, contextChars = 40): {page:number, before:string, match:string, after:string}[]` — case-insensitive, whitespace-normalized, sorted by page then position, every occurrence (not just one per page). `before` gets a leading `…` when truncated, `after` a trailing `…`.

- [ ] **Step 1: Failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOccurrences } from '../../js/search-core.js';

const idx = new Map([
  [3, 'The end of the nest story.'],
  [2, 'A bird builds a nest. The nest is warm.  Every NEST is different.'],
  [1, 'Nothing here.'],
]);

test('finds every occurrence, ordered by page', () => {
  const r = findOccurrences(idx, 'nest');
  assert.deepEqual(r.map((o) => o.page), [2, 2, 2, 3]);
  assert.equal(r[2].match, 'NEST');
});

test('context is trimmed with ellipses', () => {
  const r = findOccurrences(new Map([[1, 'x'.repeat(100) + 'needle' + 'y'.repeat(100)]]), 'needle', 10);
  assert.equal(r[0].before, '…' + 'x'.repeat(10));
  assert.equal(r[0].after, 'y'.repeat(10) + '…');
});

test('empty or whitespace query → no results', () => {
  assert.deepEqual(findOccurrences(idx, '   '), []);
});

test('whitespace in text is normalized', () => {
  assert.equal(findOccurrences(new Map([[1, 'a   b']]), 'a b').length, 1);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```js
export function findOccurrences(textIndex, query, contextChars = 40) {
  const q = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const pages = [...textIndex.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const text = textIndex.get(page).replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    let i = lower.indexOf(q);
    while (i !== -1) {
      const s = Math.max(0, i - contextChars);
      const e = Math.min(text.length, i + q.length + contextChars);
      out.push({
        page,
        before: (s > 0 ? '…' : '') + text.slice(s, i),
        match: text.slice(i, i + q.length),
        after: text.slice(i + q.length, e) + (e < text.length ? '…' : ''),
      });
      i = lower.indexOf(q, i + q.length);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git commit -m "feat: occurrence-level search with context snippets"`

---

### Task C2: Search results panel + indexing progress

**Files:**
- Modify: `js/reader-search.js`, `index.html` (reader search bar area), `css/reader-extras.css`
- Create: `tests/e2e/c-search.spec.mjs`

**Interfaces:**
- Consumes: `findOccurrences` (C1); `goToPage`, `renderSinglePage` from `reader.js`; `state.reader.textIndex`, `state.reader.pdfDoc`.
- Produces: DOM `#search-results` (list under the search bar), `#search-progress` (text "Indexing N/M…", hidden when complete). Each result is `.search-result` button with `.search-result__page` ("p. N") and `.search-result__text` (before + `<mark>match</mark>` + after, escaped). Count text in `#reader-search-count`: `"<k>/<total>"` where total = number of occurrences, or `"no results"`. Prev/next buttons step through occurrences (not pages). `buildSearchIndex()` updates progress and re-runs the current query when finished.

- [ ] **Step 1: Failing e2e** — `tests/e2e/c-search.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test('search lists every occurrence with page and context; tap jumps', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#reader-search-btn');
  await expect(page.locator('#search-progress')).toBeHidden({ timeout: 5000 });
  await page.fill('#reader-search-input', 'nest');
  await expect(page.locator('#search-results .search-result')).toHaveCount(4);
  await expect(page.locator('#reader-search-count')).toHaveText('1/4');
  await expect(page.locator('#search-results .search-result').first()).toContainText('p. 2');
  await expect(page.locator('#search-results mark').first()).toHaveText('nest');
  await page.locator('#search-results .search-result').nth(3).click();
  await expect(page.locator('#reader-progress')).toHaveText('Page 3 of 3', { timeout: 3000 });
  await page.click('#reader-search-next');
  await expect(page.locator('#reader-search-count')).toHaveText('1/4'); // wraps around from 4
});

test('no results message', async ({ page }) => {
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#reader-search-btn');
  await page.fill('#reader-search-input', 'zebra');
  await expect(page.locator('#reader-search-count')).toHaveText('no results');
  await expect(page.locator('#search-results .search-result')).toHaveCount(0);
});
```

Note: the "tap jumps" assertion relies on continuous-mode scroll updating `#reader-progress`; if the smooth scroll + 38% reference line lands on page 3 only after the scroll ends, the 3 s timeout covers it.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Markup.** Read `index.html` for `#reader-search-bar`; directly after it, add:

```html
<div id="search-progress" class="search-progress" hidden></div>
<div id="search-results" class="search-results" hidden></div>
```

- [ ] **Step 4: Rewrite `js/reader-search.js`** (keep `highlightQueryOnPage` as is):

```js
import { state } from './state.js';
import { $, el, escapeHtml } from './dom.js';
import { renderSinglePage } from './reader.js';
import { findOccurrences } from './search-core.js';

let results = [];
let pos = -1;

function currentQuery() { return $('#reader-search-input').value.trim(); }

function setProgress(done, total) {
  const p = $('#search-progress');
  if (done >= total) { p.hidden = true; return; }
  p.hidden = false;
  p.textContent = 'Indexing ' + done + '/' + total + '…';
}

export async function buildSearchIndex() {
  const { pdfDoc } = state.reader;
  if (!pdfDoc) return;
  const total = pdfDoc.numPages;
  for (let n = 1; n <= total; n++) {
    if (!state.reader.textIndex.has(n)) {
      try {
        const page = await pdfDoc.getPage(n);
        const tc = await page.getTextContent();
        state.reader.textIndex.set(n, tc.items.map((i) => i.str).join(' '));
      } catch (e) { /* ignore */ }
    }
    if (state.reader.pdfDoc !== pdfDoc) return;
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
```

The scroll logic stays local (same as the old `jumpToSearchMatch`) rather than using `goToPage`, to preserve existing behaviour. In `js/reader.js` `closeReader()`, replace `$('#reader-search-bar').hidden = true;` with `resetSearchUI();` (import from `./reader-search.js`). Note that choosing a result does **not** close the list (user can tap through results); `goToPage` closes the side panel only.

- [ ] **Step 5: CSS** (`css/reader-extras.css`; use the reader's surface/text tokens from `styles.css`):

```css
.search-progress { font-size: 12px; opacity: 0.7; padding: 4px 14px; }
.search-progress[hidden], .search-results[hidden] { display: none; }
.search-results {
  max-height: 40vh; overflow-y: auto; display: flex; flex-direction: column;
  border-bottom: 1px solid rgba(127, 127, 127, 0.25);
}
.search-result {
  display: flex; gap: 10px; align-items: baseline; text-align: left;
  padding: 8px 14px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
}
.search-result--active { background: rgba(127, 127, 127, 0.15); }
.search-result__page { font-size: 12px; opacity: 0.65; white-space: nowrap; min-width: 40px; }
.search-result__text { font-size: 14px; line-height: 1.35; }
.search-result__text mark { background: #f5d76e; color: #111; border-radius: 3px; padding: 0 2px; }
```

- [ ] **Step 6: Run all tests** (`node --test tests/unit/ && npx playwright test`) — PASS. Update the Phase-1 smoke search test only if it fails because of the new count format (it asserts "not empty / not 'no results'", so it should pass).

- [ ] **Step 7: Commit** `git commit -m "feat: search results list with context and indexing progress"`

---

### Task C3: Speech module + selection popover actions

**Files:**
- Create: `js/speech.js`, `tests/e2e/c-popover.spec.mjs`
- Modify: `js/reader-selection.js`, `index.html` (`#selection-popover` buttons), `css/reader-extras.css`

**Interfaces:**
- Produces (`js/speech.js`): `export const speechSupported: boolean`; `export function speak(text: string, { onend } = {}): void` (cancels anything playing, uses `navigator.language`); `export function stopSpeaking(): void`; `export function isSpeaking(): boolean`.
- Produces (DOM): buttons inside `#selection-popover` with ids `#sel-copy-btn`, `#sel-define-btn`, `#sel-translate-btn`, `#sel-speak-btn` (in addition to existing `#save-highlight-btn`). `#sel-speak-btn` hidden when `!speechSupported`.
- URLs: Define → `https://en.wiktionary.org/wiki/Special:Search?search=<enc>`; Translate → `https://translate.google.com/?sl=auto&tl=<navigator.language first 2 letters>&text=<enc>&op=translate`; both `window.open(url, '_blank', 'noopener')`.

- [ ] **Step 1: Failing e2e** — `tests/e2e/c-popover.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

async function selectWord(page, word) {
  await page.evaluate((w) => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes(w));
    const node = span.firstChild;
    const i = node.textContent.indexOf(w);
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + w.length);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, word);
  await expect(page.locator('#selection-popover')).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    window.__spoken = [];
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 10); };
    }
  });
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
});

test('copy puts the selection on the clipboard', async ({ page }) => {
  await selectWord(page, 'brown');
  await page.click('#sel-copy-btn');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('brown');
});

test('define and translate open the right URLs', async ({ page }) => {
  await selectWord(page, 'brown');
  await page.click('#sel-define-btn');
  await selectWord(page, 'brown');
  await page.click('#sel-translate-btn');
  const opened = await page.evaluate(() => window.__opened);
  expect(opened[0]).toBe('https://en.wiktionary.org/wiki/Special:Search?search=brown');
  expect(opened[1]).toMatch(/^https:\/\/translate\.google\.com\/\?sl=auto&tl=[a-z]{2}&text=brown&op=translate$/);
});

test('speak reads the selection', async ({ page }) => {
  await selectWord(page, 'brown');
  await page.click('#sel-speak-btn');
  expect(await page.evaluate(() => window.__spoken)).toEqual(['brown']);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: `js/speech.js`**

```js
export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance === 'function';

let speaking = false;

export function speak(text, { onend } = {}) {
  if (!speechSupported || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = navigator.language || 'en-US';
  speaking = true;
  u.onend = () => { speaking = false; if (onend) onend(); };
  u.onerror = () => { speaking = false; };
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  speaking = false;
  if (speechSupported) window.speechSynthesis.cancel();
}

export function isSpeaking() { return speaking; }
```

Note: `stopSpeaking()` sets `speaking=false` *before* `cancel()` so an `onend` fired by cancel does not trigger read-aloud continuation (C4 checks its own flag too).

- [ ] **Step 4: Popover buttons.** Read `index.html` `#selection-popover`; keep `#save-highlight-btn` first and append, matching its markup/classes:

```html
<button type="button" id="sel-copy-btn" class="selection-popover__btn">Copy</button>
<button type="button" id="sel-define-btn" class="selection-popover__btn">Define</button>
<button type="button" id="sel-translate-btn" class="selection-popover__btn">Translate</button>
<button type="button" id="sel-speak-btn" class="selection-popover__btn">Speak</button>
```

(If the existing button uses a different class, use that class instead of `selection-popover__btn`.)

In `js/reader-selection.js` `initReaderSelection()`:

```js
import { speak, speechSupported } from './speech.js';

function popoverText() { return $('#selection-popover').dataset.text || ''; }
function dismissSelection() {
  $('#selection-popover').hidden = true;
  window.getSelection().removeAllRanges();
  clearLiveSelection();
}

// inside initReaderSelection():
$('#sel-speak-btn').hidden = !speechSupported;
$('#sel-copy-btn').addEventListener('click', async () => {
  const t = popoverText();
  try { await navigator.clipboard.writeText(t); showToast('Copied'); }
  catch (e) { showToast("Couldn't copy"); }
  dismissSelection();
});
$('#sel-define-btn').addEventListener('click', () => {
  window.open('https://en.wiktionary.org/wiki/Special:Search?search=' + encodeURIComponent(popoverText()), '_blank', 'noopener');
  dismissSelection();
});
$('#sel-translate-btn').addEventListener('click', () => {
  const tl = (navigator.language || 'en').slice(0, 2).toLowerCase();
  window.open('https://translate.google.com/?sl=auto&tl=' + tl + '&text=' + encodeURIComponent(popoverText()) + '&op=translate', '_blank', 'noopener');
  dismissSelection();
});
$('#sel-speak-btn').addEventListener('click', () => {
  speak(popoverText());
  dismissSelection();
});
```

Important: the popover position is computed from `offsetWidth` (fallback 180). With 5 buttons it is wider; verify at a 390px viewport that it stays within the reader (it is clamped already). If the buttons overflow, add to `css/reader-extras.css`:

```css
#selection-popover { display: flex; flex-wrap: nowrap; gap: 2px; max-width: calc(100vw - 24px); overflow-x: auto; }
```

- [ ] **Step 5: Run all tests** — PASS. Take a screenshot at 390×844 with the popover open and check it visually (`page.screenshot`). **Step 6: Commit** `git commit -m "feat: copy, define, translate and speak actions on selected text"`

---

### Task C4: Read page aloud

**Files:**
- Create: `js/reader-tts.js`, `tests/e2e/c-tts.spec.mjs`
- Modify: `js/reader.js` (import + call `initReaderTts()` from `initReader()`, call `stopReadAloud()` in `closeReader()`), `index.html` (button in reader toolbar), `css/reader-extras.css`

**Interfaces:**
- Consumes: `speak`, `stopSpeaking`, `speechSupported` (C3); `state.reader`; `goToPage` from `reader.js`.
- Produces: `export function initReaderTts()`, `export function stopReadAloud()`, DOM `#read-aloud-btn` (toggles `aria-pressed`), hidden when `!speechSupported`.
- Behaviour: Play → speaks text of `state.reader.currentPage` (from `textIndex`, fetching via `pdfDoc.getPage(n).getTextContent()` if missing). On end, if still playing and `n < numPages`: `goToPage(n + 1)` and speak page `n + 1`. Pause/stop → `stopSpeaking()`. Empty page text → skip to next page.

- [ ] **Step 1: Failing e2e** — `tests/e2e/c-tts.spec.mjs`

```js
import { test, expect } from '@playwright/test';
import { freshApp, addBook, openFirstBook } from './helpers.mjs';
import { writeFixture, STANDARD_PAGES } from '../fixtures/make-pdf.mjs';

const fixture = writeFixture('standard.pdf', STANDARD_PAGES, { title: 'Fixture Book', author: 'Test Author' });

test('read aloud speaks pages in order and advances', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 50); };
    window.speechSynthesis.cancel = () => {};
  });
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect.poll(() => page.evaluate(() => window.__spoken.length), { timeout: 5000 }).toBe(3);
  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken[0]).toContain('quick brown fox');
  expect(spoken[1]).toContain('bird builds a nest');
  expect(spoken[2]).toContain('end of the nest story');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
});

test('pressing again stops', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); /* never ends */ };
    window.speechSynthesis.cancel = () => {};
  });
  await freshApp(page);
  await addBook(page, fixture);
  await openFirstBook(page);
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#read-aloud-btn');
  await expect(page.locator('#read-aloud-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__spoken.length)).toBe(1);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Button.** Read `index.html` reader toolbar (where `#bookmark-btn`, `#reader-search-btn` live) and add, matching neighbours' markup/classes:

```html
<button id="read-aloud-btn" class="icon-btn" aria-label="Read aloud" aria-pressed="false">
  <svg id="read-aloud-icon" viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
</button>
```

- [ ] **Step 4: `js/reader-tts.js`**

```js
import { state } from './state.js';
import { $ } from './dom.js';
import { goToPage } from './reader.js';
import { speak, stopSpeaking, speechSupported } from './speech.js';

const PLAY = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
const PAUSE = '<path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/>';
let playing = false;

function setPlaying(on) {
  playing = on;
  const btn = $('#read-aloud-btn');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#read-aloud-icon').innerHTML = on ? PAUSE : PLAY;
}

async function pageText(n) {
  const r = state.reader;
  if (r.textIndex.has(n)) return r.textIndex.get(n);
  const page = await r.pdfDoc.getPage(n);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join(' ');
  r.textIndex.set(n, text);
  return text;
}

async function readFrom(n) {
  const r = state.reader;
  if (!playing || !r.pdfDoc) return;
  if (n > r.pdfDoc.numPages) { setPlaying(false); return; }
  if (n !== r.currentPage) goToPage(n);
  const text = (await pageText(n)).trim();
  if (!playing) return;
  if (!text) { readFrom(n + 1); return; }
  speak(text, { onend: () => { if (playing) readFrom(n + 1); } });
}

export function stopReadAloud() {
  if (!playing) return;
  setPlaying(false);
  stopSpeaking();
}

export function initReaderTts() {
  const btn = $('#read-aloud-btn');
  if (!btn) return;
  btn.hidden = !speechSupported;
  btn.addEventListener('click', () => {
    if (playing) { stopReadAloud(); return; }
    setPlaying(true);
    readFrom(state.reader.currentPage);
  });
}
```

Note: when the last page ends, `readFrom(numPages + 1)` sets `playing=false` → `aria-pressed="false"` (asserted by the test). In `js/reader.js`: `import { initReaderTts, stopReadAloud } from './reader-tts.js';`, call `initReaderTts()` at the end of `initReader()`, and `stopReadAloud()` as the first line of `closeReader()`.

- [ ] **Step 5: CSS** (`css/reader-extras.css`):

```css
#read-aloud-btn[aria-pressed="true"] { color: var(--accent, #f5a623); }
```

(Use the real accent variable name from `styles.css` if different.)

- [ ] **Step 6: Run all tests** — PASS. **Step 7: Commit** `git commit -m "feat: read the current page aloud and continue to the next"`

---

# Phase 3 — Integrate (on `main`, after A and C finish)

### Task 5: Merge, SW asset list, docs, full verification

**Files:**
- Modify: `sw.js`, `README.md`

- [ ] **Step 1: Merge**

```bash
git checkout main
git merge --no-ff feat/data-safety -m "Merge feat/data-safety"
git merge --no-ff feat/reader -m "Merge feat/reader"
```

Expected conflicts: at most `index.html` (different regions) — resolve by keeping both sides.

- [ ] **Step 2: `sw.js`** — set `CACHE_NAME = 'booknest-v13'` and add to `APP_SHELL`: `./js/storage.js`, `./js/zip.js`, `./js/hash.js`, `./js/backup-format.js`, `./js/search-core.js`, `./js/speech.js`, `./js/reader-tts.js`.

- [ ] **Step 3: README "Come si usa"** (Italian, like the rest of the README) — add bullets: ⋮ on each cover for Modifica/Elimina with "Annulla"; "Seleziona" for deleting several; backup is now a `.zip` (old `.json` still importable); duplicates skipped; storage line in ⋮ menu; search shows every result with context; selected text: Copia / Definisci / Traduci / Leggi; ▶ reads pages aloud. Add a "Sviluppo" section: `npm install`, `npm test`.

- [ ] **Step 4: Full verification**

Run: `node --test tests/unit/ && npx playwright test`
Expected: all PASS. The "every module listed in sw.js exists" test also confirms the new paths. Then take screenshots at 390×844 and 1100×800 of: library with ⋮ menu open, select mode, search results, selection popover — and review them.

- [ ] **Step 5: Commit**

```bash
git add sw.js README.md
git commit -m "chore: cache new modules, document new features"
git worktree remove ../scaffale-app-A
git worktree remove ../scaffale-app-C
```

Do NOT push — the user decides when to publish.
