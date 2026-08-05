// service-worker.js — offline app shell for Project Vision.
//
// Precaches every file the app needs (HTML, all ES modules, vendored libs,
// icons, manifest) so the whole thing runs with no network. Strategy is
// NETWORK-FIRST with a cache fallback, so a device with any connectivity always
// runs current code while the cache still makes the app work fully offline.
// Bump CACHE_VERSION whenever any precached file changes.

const CACHE_VERSION = 'v6';
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

  // App navigations: prefer the network (so a deploy is picked up immediately),
  // fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: NETWORK-FIRST with a cache fallback.
  //
  // Deliberately not cache-first. Cache-first means an installed client keeps
  // running whatever JS it cached until CACHE_VERSION changes — which silently
  // serves stale app code after a deploy and makes "am I on the latest build?"
  // impossible to answer. Network-first guarantees a device that has any
  // connectivity always runs current code, while the cache still makes the app
  // work fully offline (which is the actual point of this app: load once, then
  // transfer with no network).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
