const CACHE_NAME = "quy12a6-shell-v3.0";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./js/config.js",
  "./js/utils.js",
  "./js/crypto-vault.js",
  "./js/sync.js",
  "./js/render.js",
  "./js/actions.js",
  "./js/app.js",
  "./assets/icon.svg",
  "./assets/icon-maskable.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache live data, vault, or API calls
  if (
    url.pathname.endsWith("/data.json") ||
    url.pathname.endsWith("/vault.json") ||
    url.hostname === "api.github.com" ||
    url.hostname === "raw.githubusercontent.com" ||
    url.hostname.endsWith(".workers.dev")
  ) {
    return;
  }

  // Network-first for HTML & local code so updates land immediately; fallback to cache offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
