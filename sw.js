const CACHE = "movie-imprint-shell-v53";
// R3：这个缓存原名 WALLPAPER_CACHE，是 C2 为「每日壁纸」建立的图片缓存策略。
// 壁纸功能已在 R3 移除，但同一个 /api/bangumi/image 端点现在被海报复用（R6 起
// 还包括 /api/tmdb/image），
// 缓存策略本身原样保留，只是改个名字反映它现在缓存的是海报。
const POSTER_CACHE = "movie-imprint-posters-v1";
const POSTER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const POSTER_CACHED_AT = "x-movie-imprint-cached-at";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/public/icon.svg",
  "/public/icon-192.png",
  "/public/icon-512.png",
  "/public/icon-maskable-512.png",
  "/public/icon-character-v2-flat.png",
  "/docs/design/mockups/assets/cinema-memory-hero-v1.png",
  "/docs/design/tokens-v2.css?v=17",
  "/styles/app.css?v=47",
  "/src/app.js?v=52",
  "/src/stills.js?v=1",
  "/src/editor.js?v=8",
  "/src/db.js?v=14",
  "/src/domain.js?v=18",
  "/src/self-interview.js?v=1",
  "/src/imprint-v2.js?v=1",
  "/src/bangumi.js?v=13"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== POSTER_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  // R6：海报现在有两个来源端点（Bangumi 与 TMDB），两者共用同一套离线缓存策略。
  // 缓存键是完整 Request（含查询参数），两个端点的参数形态不同（subjectId vs path），
  // 天然不会互相覆盖。
  if (path === "/api/bangumi/image" || path === "/api/tmdb/image") {
    event.respondWith(caches.open(POSTER_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const cachedAt = Number(cached?.headers.get(POSTER_CACHED_AT) || 0);
      if (cached && Date.now() - cachedAt < POSTER_MAX_AGE) return cached;
      let response;
      try {
        response = await fetch(event.request);
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
      if (response.ok && response.headers.get("content-type")?.startsWith("image/")) {
        const headers = new Headers(response.headers);
        headers.set(POSTER_CACHED_AT, String(Date.now()));
        const stored = new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers });
        await cache.put(event.request, stored);
        const keys = await cache.keys();
        const expired = await Promise.all(keys.map(async (key) => {
          const item = await cache.match(key);
          const savedAt = Number(item?.headers.get(POSTER_CACHED_AT) || 0);
          return Date.now() - savedAt >= POSTER_MAX_AGE ? key : null;
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
