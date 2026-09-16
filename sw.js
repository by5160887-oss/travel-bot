// Travel Bot service worker — offline APP SHELL only.
//
// Hard rule: AI traffic is never cached. Any request whose path contains
// /api/ bypasses the cache entirely and goes straight to the network, so no
// question, answer, or header is ever stored by this worker. The API key
// lives server-side and never appears here.
const CACHE = "travel-bot-shell-v1";
const SHELL = [
  "./1-index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept non-GET

  const url = new URL(req.url);
  if (url.pathname.includes("/api/")) return; // AI traffic: straight to network, never cached

  // App shell: cache-first, then network (and refresh the cache copy).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const fromNetwork = fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
      return hit || fromNetwork;
    })
  );
});
