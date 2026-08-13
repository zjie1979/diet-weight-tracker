const RESOURCE_VERSION = "12";
const CACHE_NAME = `diet-weight-pwa-v${RESOURCE_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  `./styles.css?v=${RESOURCE_VERSION}`,
  `./app.js?v=${RESOURCE_VERSION}`,
  `./manifest.webmanifest?v=${RESOURCE_VERSION}`,
  `./icon-180.png?v=${RESOURCE_VERSION}`,
  `./icon-192.png?v=${RESOURCE_VERSION}`,
  `./icon-512.png?v=${RESOURCE_VERSION}`
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match("./index.html")))
  );
});
