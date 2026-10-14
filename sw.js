/* Snart Pong service worker — offline app shell.
 *
 * The whole game is a handful of same-origin files plus a manifest and its
 * icons, so everything is precached and served cache-first: opening the app
 * never waits on the network, and it plays with no connection at all.
 *
 * Bump VERSION on any asset change. `activate` deletes every cache whose name
 * differs, which is how devices that already installed an older build get the
 * stale one purged.
 *
 * All URLs are relative to this file, so the worker also works when the game
 * is served from a subpath (snart.com/pong/) rather than a domain root.
 */
'use strict';

const VERSION = 'v1';
const CACHE = `snartpong-${VERSION}`;

// Keep this list in step with what index.html actually loads — test/pwa.js
// diffs the two, because one 404 in a precache list is how a worker installs
// fine and then serves nothing.
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'game.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // allSettled, not addAll: addAll is atomic, so a single bad URL would leave
    // the cache empty, the install successful, and the app silently offline-less.
    const done = await Promise.allSettled(
      PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    done.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.warn('[snartpong/sw] precache failed for', PRECACHE[i], result.reason);
      }
    });
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    );
    // Take over the open page immediately; skipWaiting is deliberately not used,
    // so a new build never swaps the worker out from under a game in progress.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone

  event.respondWith(respond(event, request, request.mode === 'navigate'));
});

async function respond(event, request, isNavigation) {
  const cache = await caches.open(CACHE);
  const cached =
    (await cache.match(request, { ignoreSearch: true })) ||
    (isNavigation ? await cache.match('index.html') : undefined);

  const refresh = revalidate(request, cache);
  if (!cached) return refresh;      // nothing stored yet: the network is the only source

  // Serve the cached copy now and revalidate in the background.
  event.waitUntil(refresh.catch(() => {}));
  return cached;
}

async function revalidate(request, cache) {
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}
