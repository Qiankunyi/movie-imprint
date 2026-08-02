import { buildBangumiImageRequest, isAllowedBangumiImageUrl } from "../../../src/bangumi.js";

const DEFAULT_USER_AGENT = "qiankunyi/movie-imprint/0.1";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const CACHE_TTL = 24 * 60 * 60 * 1000;

// 内存缓存（Worker 实例级别）
const cache = new Map();

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const subjectId = Number(url.searchParams.get("subjectId"));
  const upstreamUrl = buildBangumiImageRequest(subjectId);

  if (!upstreamUrl) {
    return jsonResponse(400, { error: "invalid_subject_id", message: "无效的作品 ID" });
  }

  const cacheKey = String(subjectId);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return imageResponse(cached.image, "hit");
  }
  if (cached) cache.delete(cacheKey);

  const userAgent = context.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_USER_AGENT;

  try {
    const image = await fetchBangumiImage(upstreamUrl, { "user-agent": userAgent });
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

async function fetchBangumiImage(url, headers, redirects = 0) {
  if (redirects > 3) throw new Error("too_many_redirects");

  const upstream = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(8000)
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = new URL(upstream.headers.get("location"), url).href;
    if (!isAllowedBangumiImageUrl(location)) throw new Error("invalid_image_host");
    if (new URL(location).pathname === "/img/no_icon_subject.png") throw new Error("image_not_found");
    return fetchBangumiImage(location, headers, redirects + 1);
  }

  if (!upstream.ok || !isAllowedBangumiImageUrl(upstream.url)) throw new Error("image_unavailable");

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
      "x-image-source": "Bangumi",
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
