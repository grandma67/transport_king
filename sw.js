/*
 * Transport King service worker.
 *
 * The game shares its origin with other apps (user.github.io/<game>/), so:
 *  - it is registered with scope "./" and only handles requests under it;
 *  - its cache name is unique per app id + version + build, and cleanup
 *    only ever deletes this app's own old caches.
 * BUILD is stamped with the commit SHA by the deploy workflow.
 */
const APP_ID = 'transport-king';
const VERSION = '1.3.0';
const BUILD = 'dev';
const CACHE = `${APP_ID}-v${VERSION}-${BUILD}`;

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/levels.js',
  './js/sound.js',
  './js/game.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(APP_ID + '-') && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Cache first (the game is fully static), falling back to the network and
// caching what comes back. Navigations fall back to the cached page offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') return cache.match('./index.html');
        throw err;
      }
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source.postMessage({ appId: APP_ID, version: VERSION, build: BUILD, cache: CACHE });
});
