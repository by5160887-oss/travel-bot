// Travel Bot service worker: network-first HTML/navigation, offline shell fallback.
// API requests and chat content are never cached.
const CACHE = "travel-bot-shell-v6";
const SHELL = [
  "./1-index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()).then(() => self.clients.matchAll({ type: "window" })).then((clients) => clients.forEach((client) => client.postMessage({ type: "TRAVEL_BOT_UPDATED" }))));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const req = request;
  if (req.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) return;
  const isNavigationOrHtml = request.mode === "navigate" || request.destination === "document" || url.pathname.endsWith(".html") || url.pathname === "/";
  if (isNavigationOrHtml) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok && url.origin === self.location.origin) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("./1-index.html"))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && url.origin === self.location.origin) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});
