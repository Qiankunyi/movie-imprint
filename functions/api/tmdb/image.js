/**
 * R6 · TMDB 海报代理。
 *
 * 安全逻辑**照抄 functions/api/bangumi/image.js**，不发明新写法：
 * 手动处理重定向（≤3 跳）并对每一跳重新做 host 白名单校验、content-type 白名单、
 * 体积上限、nosniff + same-origin CORP。前端永远不直接连外部图床。
 *
 * TMDB 特有的一点：上游 URL 是由 poster_path 拼出来的，所以 path 必须先过
 * isValidTmdbPosterPath 的严格校验（只允许「斜杠 + base62 文件名 + 扩展名」），
 * 否则 "/../.." 之类的输入能把请求引到 image.tmdb.org 上的任意路径。
 */
import { buildTmdbImageUrl, isAllowedTmdbImageUrl } from "../../../src/tmdb.js";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const CACHE_TTL = 24 * 60 * 60 * 1000;

const cache = new Map();

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path") || "";
  const size = url.searchParams.get("size") || "w500";
  const upstreamUrl = buildTmdbImageUrl(path, size);

  if (!upstreamUrl) {
    return jsonResponse(400, { error: "invalid_poster_path", message: "无效的海报路径" });
  }

  const cacheKey = upstreamUrl;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return imageResponse(cached.image, "hit");
  }
  if (cached) cache.delete(cacheKey);

  try {
    const image = await fetchTmdbImage(upstreamUrl);
    cache.set(cacheKey, { image, savedAt: Date.now() });
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return imageResponse(image, "miss");
  } catch (error) {
    return jsonResponse(
      error.message === "image_not_found" ? 404 : 502,
      {
        error: error.message === "image_not_found" ? "image_not_found" : "image_unavailable",
        message: "作品图片暂不可用"
      }
    );
  }
}

async function fetchTmdbImage(url, redirects = 0) {
  if (redirects > 3) throw new Error("too_many_redirects");

  const upstream = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8000)
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = new URL(upstream.headers.get("location"), url).href;
    if (!isAllowedTmdbImageUrl(location)) throw new Error("invalid_image_host");
    return fetchTmdbImage(location, redirects + 1);
  }

  if (upstream.status === 404) throw new Error("image_not_found");
  if (!upstream.ok || !isAllowedTmdbImageUrl(upstream.url)) throw new Error("image_unavailable");

  const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) throw new Error("invalid_image_type");

  const declaredLength = Number(upstream.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");

  const data = await upstream.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");

  return { contentType, data };
}

function imageResponse(image, cacheState) {
  return new Response(image.data, {
    status: 200,
    headers: {
      "content-type": image.contentType,
      "content-length": String(image.data.byteLength),
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "x-image-source": "TMDB",
      "x-image-cache": cacheState
    }
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
