/**
 * R6 · TMDB 电影详情代理。
 *
 * 用途：用户从搜索结果里选中一部片、准备建 Work 时拉一次，补上搜索接口没有的
 * runtime、完整 genres 与 external_ids（imdb / wikidata）。
 *
 * 和 functions/api/bangumi/subject.js 是同一个角色——搜索结果只够展示，
 * 落库前再补一次详情，之后作品页/片单页/观影记录全部读自己的 Work，
 * 不再依赖外部 API 在线响应（R6 §13）。
 */
import { buildTmdbDetailRequest, normalizeTmdbDetail } from "../../../src/tmdb.js";

const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get("id"));
  const request = buildTmdbDetailRequest(id, { language: context.env.TMDB_LANGUAGE?.trim() || "zh-CN" });
  if (!request) {
    return jsonResponse(400, { error: "invalid_movie_id", message: "电影 id 不合法" });
  }

  const token = context.env.TMDB_ACCESS_TOKEN?.trim();
  const apiKey = context.env.TMDB_API_KEY?.trim();
  if (!token && !apiKey) {
    return jsonResponse(200, { configured: false, detail: null });
  }

  const cached = cache.get(id);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return jsonResponse(200, { ...cached.data, source: "cache", configured: true });
  }

  try {
    const headers = { accept: "application/json" };
    let requestUrl = request.url;
    if (token) headers.authorization = `Bearer ${token}`;
    else requestUrl = `${request.url}&api_key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(requestUrl, { headers, signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) throw new Error(`TMDB ${upstream.status}`);

    const detail = normalizeTmdbDetail(await upstream.json());
    if (!detail) throw new Error("tmdb_bad_payload");

    cache.set(id, { data: { detail }, savedAt: Date.now() });
    if (cache.size > 100) cache.delete(cache.keys().next().value);

    return jsonResponse(200, { detail, source: "tmdb", configured: true });
  } catch {
    return jsonResponse(502, { error: "tmdb_unavailable", message: "暂时拿不到这部电影的详细信息" });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
