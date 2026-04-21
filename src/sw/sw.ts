/**
 * sw.ts — Service Worker
 * App-shell caching for offline use.
 * Using vanilla Cache API (no Workbox build needed for GitHub Pages deploy).
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `frame-extractor-${CACHE_VERSION}`;

// Assets to precache (app shell)
const PRECACHE_URLS: string[] = [
  './',
  './index.html',
  // Vite-built assets will be hashed; we cache them via runtime fetch below
];

self.addEventListener('install', (event: Event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((err) =>
        console.warn('[SW] Precache failed for some URLs:', err)
      )
    ).then(() => (self as ServiceWorkerGlobalScope).skipWaiting())
  );
});

self.addEventListener('activate', (event: Event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => (self as ServiceWorkerGlobalScope).clients.claim())
  );
});

self.addEventListener('fetch', (event: Event) => {
  const e = event as FetchEvent;
  const url = new URL(e.request.url);

  // Only cache same-origin GET requests; skip cross-origin (fonts, etc.)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first for navigation requests (always get fresh HTML)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r ?? new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Cache-first for all other assets (JS, CSS, fonts, icons)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

// TypeScript needs these to exist on self for SW context
declare const self: ServiceWorkerGlobalScope;
