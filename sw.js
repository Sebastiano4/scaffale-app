/* Bump CACHE_NAME on every release, and list every file the app loads in APP_SHELL. */
const CACHE_NAME = 'booknest-v19';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './css/library-extras.css',
  './css/reader-extras.css',
  './css/selection.css',
  './css/immersive.css',
  './css/tts.css',
  './css/shelf.css',
  './css/dictionary.css',
  './css/sync.css',
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
  './js/storage.js',
  './js/zip.js',
  './js/hash.js',
  './js/backup-format.js',
  './js/search-core.js',
  './js/speech.js',
  './js/reader-tts.js',
  './js/reader-touch-select.js',
  './js/word-geometry.js',
  './js/immersive.js',
  './js/tts-text.js',
  './js/tts-voices.js',
  './js/dictionary-core.js',
  './js/dictionary-lookup.js',
  './js/dictionary-view.js',
  './js/rating.js',
  './js/sync-merge.js',
  './js/sync-state.js',
  './js/sync-config.js',
  './js/drive-auth.js',
  './js/drive-api.js',
  './js/sync.js',
  './js/sync-view.js',
  './manifest.json',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        // cache: 'reload' bypasses the HTTP cache (GitHub Pages: max-age=600) so a release never mixes old/new files
        APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // only the app's own files: Google sign-in and Drive responses are never cached
  if (new URL(req.url).origin !== self.location.origin) return;

  // Navigations: try network first, fall back to cached shell (offline support)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  const url = new URL(req.url);
  // Large, immutable assets (pdf.js + icons): cache-first for speed & offline
  const isStatic = url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');

  if (isStatic) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // App code (html/css/js/json): network-first so updates apply immediately,
  // falling back to cache when offline. 'no-cache' revalidates with the server, so the
  // HTTP cache can't serve a stale module next to fresh ones right after a deploy.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })
  );
});
