// LP-Collection's service worker. It makes the app installable and lets it open without a connection:
// pages come from the network first and fall back to the app shell; built assets, fonts and icons never change
// once published (their names carry a hash or are fixed), so they come from the cache first.
// Nothing under /api is cached: Copies, Values and logins always come from the server.
const version = "lp-collection-v1";
const shell = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(version).then((cache) => cache.add(shell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== version).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

const cachedFirst = (path) => path.startsWith("/assets/") || path.startsWith("/fonts/") || path.startsWith("/icons/");

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/internal/") || url.pathname.startsWith("/fake-discogs/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(version).then((cache) => cache.put(shell, copy));
          }
          return response;
        })
        .catch(() => caches.match(shell).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (cachedFirst(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(version).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
