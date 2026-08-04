/**
 * R5 补丁：按 subjectId 取条目详情，目前只为了拿完整 summary。
 *
 * 搜索接口（/v0/search/subjects）返回的 summary 有时是截断的，而且历史上已经匹配过的
 * 作品当时根本没有存 summary。「一句话简介」要先拿到**完整简介**才谈得上让 AI 概括，
 * 所以单独开这个端点按需拉一次。
 */
const DEFAULT_USER_AGENT = "qiankunyi/movie-imprint/0.1";

const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse(400, { error: "invalid_subject_id", message: "条目 id 不合法" });
  }

  const cached = cache.get(id);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
    return jsonResponse(200, { ...cached.data, source: "cache" });
  }

  const headers = {
    accept: "application/json",
    "user-agent": context.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_USER_AGENT
  };
  const token = context.env.BANGUMI_ACCESS_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const upstream = await fetch(`https://api.bgm.tv/v0/subjects/${id}`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (!upstream.ok) throw new Error(`Bangumi ${upstream.status}`);
    const subject = await upstream.json();
    const data = {
      subjectId: id,
      title: String(subject?.name_cn || subject?.name || "").trim(),
      originalTitle: String(subject?.name || "").trim() || null,
      date: subject?.date || null,
      summary: typeof subject?.summary === "string" ? subject.summary.trim() : ""
    };
    cache.set(id, { data, savedAt: Date.now() });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return jsonResponse(200, { ...data, source: "bangumi" });
  } catch {
    return jsonResponse(502, { error: "bangumi_unavailable", message: "暂时拿不到这部作品的简介" });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
