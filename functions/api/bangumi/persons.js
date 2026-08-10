import { normalizeBangumiDirectors } from "../../../src/bangumi.js";

const DEFAULT_USER_AGENT = "qiankunyi/movie-imprint/0.1";
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const subjectId = Number(url.searchParams.get("subjectId"));
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return jsonResponse(400, { error: "invalid_subject_id", message: "条目 id 不合法" });
  }
  const cached = cache.get(subjectId);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return jsonResponse(200, { subjectId, directors: cached.directors, source: "cache" });
  }
  const headers = {
    accept: "application/json",
    "user-agent": context.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_USER_AGENT
  };
  const token = context.env.BANGUMI_ACCESS_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const upstream = await fetch(`https://api.bgm.tv/v0/subjects/${subjectId}/persons`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (!upstream.ok) throw new Error(`Bangumi ${upstream.status}`);
    const directors = normalizeBangumiDirectors(await upstream.json());
    cache.set(subjectId, { directors, savedAt: Date.now() });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return jsonResponse(200, { subjectId, directors, source: "bangumi" });
  } catch {
    return jsonResponse(502, { error: "bangumi_unavailable", message: "暂时拿不到导演信息" });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

