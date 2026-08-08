/**
 * R6 · TMDB 电影搜索代理。
 *
 * 骨架与 functions/api/bangumi/search.js 一致（同样的 24h Worker 级内存缓存、
 * 同样的 6s 超时、同样的失败降级文案），差别只在上游和鉴权方式。
 *
 * 密钥绝不下发到前端：v4 read access token 走 Authorization 头，
 * v3 api_key 走查询参数，两者配一个即可。
 */
import { buildTmdbSearchRequest, normalizeTmdbMovies } from "../../../src/tmdb.js";

const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const query = url.searchParams.get("q")?.trim() || "";

  if (!query || query.length > 80) {
    return jsonResponse(400, { error: "invalid_query", message: "作品名需为 1—80 个字符" });
  }

  const token = context.env.TMDB_ACCESS_TOKEN?.trim();
  const apiKey = context.env.TMDB_API_KEY?.trim();
  if (!token && !apiKey) {
    // 没配密钥不是错误——用户可能只想用 Bangumi。返回空候选，让统一搜索照常
    // 展示另一个源的结果，而不是整个搜索面板报错。
    return jsonResponse(200, { query, candidates: [], source: "tmdb", configured: false });
  }

  const language = context.env.TMDB_LANGUAGE?.trim() || "zh-CN";
  const cacheKey = `${language}::${query}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return jsonResponse(200, { query, candidates: cached.candidates, source: "cache", configured: true });
  }

  try {
    const { url: apiUrl } = buildTmdbSearchRequest(query, { language });
    const headers = { accept: "application/json" };
    let requestUrl = apiUrl;
    if (token) headers.authorization = `Bearer ${token}`;
    else requestUrl = `${apiUrl}&api_key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(requestUrl, { headers, signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) throw new Error(`TMDB ${upstream.status}`);

    const candidates = normalizeTmdbMovies(await upstream.json());
    cache.set(cacheKey, { candidates, savedAt: Date.now() });
    if (cache.size > 100) cache.delete(cache.keys().next().value);

    return jsonResponse(200, { query, candidates, source: "tmdb", configured: true });
  } catch {
    return jsonResponse(502, {
      error: "tmdb_unavailable",
      message: "暂时无法从 TMDB 搜索，其他来源的结果不受影响"
    });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
