// service-worker.js — offline app shell for Project Vision.
//
// Precaches every file the app needs (HTML, all ES modules, vendored libs,
// icons, manifest) so the whole thing runs with no network. Strategy is
// cache-first with a network fallback; navigations fall back to the cached
// index.html so the installed PWA opens offline. Bump CACHE_VERSION whenever
// any precached file changes to force clients onto the new bundle.

const CACHE_VERSION = 'v3';
const CACHE_NAME = `project-vision-${CACHE_VERSION}`;

// Paths are relative to this script's location (the app root), so they work
// unchanged under a GitHub Pages project sub-path.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/main.js',
  'src/sender.js',
  'src/receiver.js',
  'src/fountain.js',
  'src/protocol.js',
  'src/qr.js',
  'src/transport.js',
  'src/selftest.js',
  'vendor/qrcode-generator.js',
  'vendor/jsQR.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // App navigations: serve the cached shell when the network is unavailable.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: cache-first, fall back to network and populate the cache.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Only cache same-origin, successful, basic responses.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
