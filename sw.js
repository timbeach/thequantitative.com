// @ts-nocheck
// Service worker. Classic script — importScripts is unavailable in module
// workers, and classic worker support is the more uniform of the two.
//
// The CACHE_VERSION line below is rewritten by tools/build_sw.py on every
// deploy. That matters: the browser detects a service worker update by
// byte-comparing this file, so if only sw-manifest.js changed, an unmodified
// sw.js would never trigger one and the fix would never reach anybody.
const CACHE_VERSION = 'b545cdb6f2e9'; // build_sw.py rewrites this line

const CACHE = `tq-${CACHE_VERSION}`;

importScripts('./sw-manifest.js');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(self.PRECACHE.map((entry) => entry.url))
    )
  );
  // Deliberately no skipWaiting() here — the new worker waits until the user
  // taps the update pill. A silent takeover mid-measurement is a betrayal.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('tq-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first. Everything is precached and the site makes no network calls,
  // so a cache miss means a genuinely new asset; falling through to the network
  // and storing the result keeps a partially-updated cache self-healing.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
