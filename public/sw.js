// src/sw/sw.ts
var CACHE_VERSION = "v1";
var CACHE_NAME = `frame-extractor-${CACHE_VERSION}`;
var PRECACHE_URLS = [
  "./",
  "./index.html"
  // Vite-built assets will be hashed; we cache them via runtime fetch below
];
self.addEventListener("install", (event) => {
  const e = event;
  e.waitUntil(
    caches.open(CACHE_NAME).then(
      (cache) => cache.addAll(PRECACHE_URLS).catch(
        (err) => console.warn("[SW] Precache failed for some URLs:", err)
      )
    ).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) => {
  const e = event;
  e.waitUntil(
    caches.keys().then(
      (keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const e = event;
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request).then((r) => r ?? new Response("Offline", { status: 503 })))
    );
    return;
  }
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
