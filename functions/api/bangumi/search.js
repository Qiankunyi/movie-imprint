import { buildBangumiSearchRequest, normalizeBangumiSubjects } from "../../../src/bangumi.js";

const DEFAULT_USER_AGENT = "qiankunyi/movie-imprint/0.1";

// 内存缓存（Worker 实例级别，跨请求共享）
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const query = url.searchParams.get("q")?.trim() || "";

  if (!query || query.length > 80) {
    return jsonResponse(400, { error: "invalid_query", message: "作品名需为 1—80 个字符" });
  }

  const cached = cache.get(query);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return jsonResponse(200, { query, candidates: cached.candidates, source: "cache" });
  }

  const userAgent = context.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_USER_AGENT;

  try {
    const { url: apiUrl, body } = buildBangumiSearchRequest(query);
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": userAgent
    };
    const token = context.env.BANGUMI_ACCESS_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;

    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000)
    });
    if (!upstream.ok) throw new Error(`Bangumi ${upstream.status}`);

    const candidates = normalizeBangumiSubjects(await upstream.json());
    cache.set(query, { candidates, savedAt: Date.now() });
    if (cache.size > 100) cache.delete(cache.keys().next().value);

    return jsonResponse(200, { query, candidates, source: "bangumi" });
  } catch {
    return jsonResponse(502, {
      error: "bangumi_unavailable",
      message: "暂时无法匹配作品，本地记录已经保留"
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
