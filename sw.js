const CACHE = "movie-imprint-shell-v20";
const WALLPAPER_CACHE = "movie-imprint-wallpapers-v1";
const WALLPAPER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const WALLPAPER_CACHED_AT = "x-movie-imprint-cached-at";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/public/icon.svg",
  "/public/icon-192.png",
  "/public/icon-512.png",
  "/public/icon-maskable-512.png",
  "/docs/design/tokens-v2.css?v=14",
  "/styles/app.css?v=17",
  "/src/app.js?v=18",
  "/src/editor.js?v=8",
  "/src/db.js?v=7",
  "/src/domain.js?v=11",
  "/src/bangumi.js?v=10",
  "/docs/design/mockups/assets/cinema-memory-hero-v1.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== WALLPAPER_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  if (path === "/api/bangumi/image") {
    event.respondWith(caches.open(WALLPAPER_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const cachedAt = Number(cached?.headers.get(WALLPAPER_CACHED_AT) || 0);
      if (cached && Date.now() - cachedAt < WALLPAPER_MAX_AGE) return cached;
      let response;
      try {
        response = await fetch(event.request);
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
      if (response.ok && response.headers.get("content-type")?.startsWith("image/")) {
        const headers = new Headers(response.headers);
        headers.set(WALLPAPER_CACHED_AT, String(Date.now()));
        const stored = new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers });
        await cache.put(event.request, stored);
        const keys = await cache.keys();
        const expired = await Promise.all(keys.map(async (key) => {
          const item = await cache.match(key);
          const savedAt = Number(item?.headers.get(WALLPAPER_CACHED_AT) || 0);
          return Date.now() - savedAt >= WALLPAPER_MAX_AGE ? key : null;
        }));
        await Promise.all(expired.filter(Boolean).map((key) => cache.delete(key)));
        const freshKeys = await cache.keys();
        await Promise.all(freshKeys.slice(0, Math.max(0, freshKeys.length - 12)).map((key) => cache.delete(key)));
      }
      return response.ok || !cached ? response : cached;
    }));
    return;
  }
  if (path === "/" || path.endsWith(".html") || path.endsWith(".js") || path.endsWith(".css")) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(path === "/" ? "/" : event.request)));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      if (!path.startsWith("/api/")) {
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
