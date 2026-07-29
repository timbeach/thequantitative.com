// @ts-nocheck
// Service worker. Classic script — importScripts is unavailable in module
// workers, and classic worker support is the more uniform of the two.
//
// The CACHE_VERSION line below is rewritten by tools/build_sw.py on every
// deploy. That matters: the browser detects a service worker update by
// byte-comparing this file, so if only sw-manifest.js changed, an unmodified
// sw.js would never trigger one and the fix would never reach anybody.
const CACHE_VERSION = '9f4c1e7708ff'; // build_sw.py rewrites this line

const CACHE = `tq-${CACHE_VERSION}`;

importScripts('./sw-manifest.js');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Deliberately NOT cache.addAll(): it fetches through the browser's HTTP
      // cache, so a genuinely new worker would precache STALE bytes and appear
      // to install an update that changed nothing. `cache: 'reload'` forces a
      // network fetch per asset. Promise.all still rejects on any failure, so
      // install remains all-or-nothing exactly as addAll was.
      Promise.all(self.PRECACHE.map((entry) =>
        fetch(new Request(entry.url, { cache: 'reload' })).then((response) => {
          if (!response.ok) throw new Error('precache failed: ' + entry.url);
          return cache.put(entry.url, response);
        })
      ))
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

  // Navigations resolve from the shell directly. "/" is not in the precache
  // list (the manifest emits /index.html), so without this an online launch
  // costs a round trip and a captive portal can be cached under "/".
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('/index.html').then((hit) => hit || fetch(request)));
    return;
  }

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
