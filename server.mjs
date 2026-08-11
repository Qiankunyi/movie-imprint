import { createReadStream, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import {
  buildBangumiImageRequest,
  buildBangumiSearchRequest,
  isAllowedBangumiImageUrl,
  normalizeBangumiDirectors,
  normalizeBangumiSubjects
} from "./src/bangumi.js";
import {
  buildTmdbDetailRequest,
  buildTmdbImageUrl,
  buildTmdbSearchRequest,
  isAllowedTmdbImageUrl,
  normalizeTmdbDetail,
  normalizeTmdbMovies
} from "./src/tmdb.js";
import { describeAiError, listAiProviders, requestAiAnalysis, requestAiRecommendation, requestAiTagline } from "./src/ai-providers.js";

const port = Number(process.env.PORT || process.argv[2] || 4173);
const host = process.env.HOST?.trim() || "127.0.0.1";
const root = process.cwd();
const bangumiSearchCache = new Map();
const bangumiImageCache = new Map();
const bangumiSubjectCache = new Map();
const bangumiPersonsCache = new Map();
const BANGUMI_CACHE_TTL = 24 * 60 * 60 * 1000;
const BANGUMI_IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_AI_REQUEST_BYTES = 64 * 1024;
const DEFAULT_BANGUMI_USER_AGENT = "qiankunyi/movie-imprint/0.1";
// R6：TMDB 三个端点的本地开发实现。生产环境走 functions/api/tmdb/*.js
// （Cloudflare Pages Functions），这里只是让 `npm run dev` 也能跑通同样的接口，
// 逻辑保持一致——尤其是海报代理的 host 白名单与体积/类型校验，不能只在生产有。
const tmdbSearchCache = new Map();
const tmdbDetailCache = new Map();
const tmdbImageCache = new Map();
const TMDB_CACHE_TTL = 24 * 60 * 60 * 1000;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function respondJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function respondImage(response, image, cacheState, source = "Bangumi") {
  response.writeHead(200, {
    "content-type": image.contentType,
    "content-length": String(image.data.byteLength),
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "x-image-source": source,
    "x-image-cache": cacheState
  });
  response.end(image.data);
}

function readJsonBody(request, maxBytes = MAX_AI_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        reject(new Error("request_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

async function handleAiAnalysis(request, response) {
  try {
    const body = await readJsonBody(request);
    const rawText = typeof body.rawText === "string" ? body.rawText : "";
    const sources = body.sources && typeof body.sources === "object" ? body.sources : null;
    const result = await requestAiAnalysis({
      provider: typeof body.provider === "string" ? body.provider : null,
      modelMode: typeof body.model_mode === "string" ? body.model_mode : null,
      title: typeof body.title === "string" ? body.title.slice(0, 160) : "",
      rawText,
      sources
    });
    const sourceSnapshot = sources ? JSON.stringify(sources) : rawText;
    respondJson(response, 200, {
      ...result,
      metadata: {
        ...result.metadata,
        input_hash: createHash("sha256").update(sourceSnapshot, "utf8").digest("hex")
      }
    });
  } catch (error) {
    const invalid = ["invalid_json", "request_too_large", "invalid_ai_input", "unsupported_ai_provider", "unsupported_ai_model_mode"].includes(error.message);
    const notConfigured = error.message === "ai_provider_not_configured";
    respondJson(response, invalid ? 400 : notConfigured ? 503 : 502, {
      error: invalid ? error.message : notConfigured ? "ai_not_configured" : "ai_analysis_failed",
      message: invalid
        ? (["invalid_ai_input", "request_too_large"].includes(error.message)
          ? "原始资料过长或为空，当前模型无法完整整理；已保存的资料不会丢失"
          : "这条记录暂时无法整理")
        : notConfigured
          ? "所选整理服务尚未配置"
          : "整理暂时没有完成，原文已经保留"
    });
  }
}

/**
 * R6 补漏：/api/bangumi/subject 与 /api/ai/tagline 此前只有生产实现
 * （functions/api/…），本地开发服务器一直没接——于是 `npm run dev` 下作品页的
 * 「一句话简介」整块功能是坏的：拉不到完整简介，也没法让 AI 概括。
 * 这两个 handler 与对应的 Pages Function 行为保持一致，包括错误码与文案。
 */
async function handleBangumiSubject(requestUrl, response) {
  const id = Number(requestUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    respondJson(response, 400, { error: "invalid_subject_id", message: "条目 id 不合法" });
    return;
  }

  const cached = bangumiSubjectCache.get(id);
  if (cached && Date.now() - cached.savedAt < BANGUMI_CACHE_TTL) {
    respondJson(response, 200, { ...cached.data, source: "cache" });
    return;
  }

  const headers = {
    accept: "application/json",
    "user-agent": process.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_BANGUMI_USER_AGENT
  };
  const token = process.env.BANGUMI_ACCESS_TOKEN?.trim();
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
    bangumiSubjectCache.set(id, { data, savedAt: Date.now() });
    respondJson(response, 200, { ...data, source: "bangumi" });
  } catch {
    respondJson(response, 502, { error: "bangumi_unavailable", message: "暂时拿不到这部作品的简介" });
  }
}

async function handleBangumiPersons(requestUrl, response) {
  const subjectId = Number(requestUrl.searchParams.get("subjectId"));
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    respondJson(response, 400, { error: "invalid_subject_id", message: "条目 id 不合法" });
    return;
  }
  const cached = bangumiPersonsCache.get(subjectId);
  if (cached && Date.now() - cached.savedAt < BANGUMI_CACHE_TTL) {
    respondJson(response, 200, { subjectId, directors: cached.directors, source: "cache" });
    return;
  }
  const headers = {
    accept: "application/json",
    "user-agent": process.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_BANGUMI_USER_AGENT
  };
  const token = process.env.BANGUMI_ACCESS_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const upstream = await fetch(`https://api.bgm.tv/v0/subjects/${subjectId}/persons`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (!upstream.ok) throw new Error(`Bangumi ${upstream.status}`);
    const directors = normalizeBangumiDirectors(await upstream.json());
    bangumiPersonsCache.set(subjectId, { directors, savedAt: Date.now() });
    respondJson(response, 200, { subjectId, directors, source: "bangumi" });
  } catch {
    respondJson(response, 502, { error: "bangumi_unavailable", message: "暂时拿不到导演信息" });
  }
}

async function handleAiTagline(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = await requestAiTagline({
      provider: typeof body.provider === "string" ? body.provider : null,
      title: typeof body.title === "string" ? body.title.slice(0, 160) : "",
      originalTitle: typeof body.originalTitle === "string" ? body.originalTitle.slice(0, 160) : null,
      year: Number.isInteger(body.year) ? body.year : null,
      summary: typeof body.summary === "string" ? body.summary.slice(0, 4000) : ""
    });
    respondJson(response, 200, result);
  } catch (error) {
    const missingSummary = error.message === "missing_summary";
    const invalid = ["invalid_json", "request_too_large", "invalid_ai_input", "invalid_ai_output", "unsupported_ai_provider"].includes(error.message);
    const notConfigured = error.message === "ai_provider_not_configured";
    respondJson(response, missingSummary || invalid ? 400 : notConfigured ? 503 : 502, {
      error: missingSummary ? "missing_summary" : invalid ? error.message : notConfigured ? "ai_not_configured" : "ai_tagline_failed",
      message: missingSummary
        ? "没有拿到这部作品的简介原文，无法概括——可以自己写一句"
        : invalid
          ? "这部作品的信息不足以生成简介"
          : notConfigured
            ? "所选整理服务尚未配置"
            : describeAiError(error, "这次没能生成一句话简介")
    });
  }
}

async function handleAiRecommendation(request, response) {
  try {
    const body = await readJsonBody(request);
    const rawText = typeof body.rawText === "string" ? body.rawText : "";
    const result = await requestAiRecommendation({
      provider: typeof body.provider === "string" ? body.provider : null,
      title: typeof body.title === "string" ? body.title.slice(0, 160) : "",
      rawText,
      recommendation: body.recommendation,
      presets: Array.isArray(body.presets) ? body.presets.filter((value) => typeof value === "string") : []
    });
    respondJson(response, 200, {
      ...result,
      metadata: {
        ...result.metadata,
        input_hash: createHash("sha256").update(rawText, "utf8").digest("hex")
      }
    });
  } catch (error) {
    const invalid = ["invalid_json", "request_too_large", "invalid_ai_input", "unsupported_ai_provider", "invalid_recommendation_choice"].includes(error.message);
    const notConfigured = error.message === "ai_provider_not_configured";
    respondJson(response, invalid ? 400 : notConfigured ? 503 : 502, {
      error: invalid ? error.message : notConfigured ? "ai_not_configured" : "ai_recommendation_failed",
      message: invalid ? "当前推荐条件无法整理" : notConfigured ? "所选整理服务尚未配置" : "推荐条件暂时没有整理完成"
    });
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
  const data = Buffer.from(await upstream.arrayBuffer());
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  return { contentType, data };
}

function tmdbAuth() {
  const token = process.env.TMDB_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  return { token, apiKey, configured: !!(token || apiKey) };
}

function tmdbLanguage() {
  return process.env.TMDB_LANGUAGE?.trim() || "zh-CN";
}

/** 把鉴权拼进请求：优先 v4 bearer token，否则退回 v3 api_key 查询参数。 */
function tmdbRequest(baseUrl) {
  const { token, apiKey } = tmdbAuth();
  const headers = { accept: "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    return { url: baseUrl, headers };
  }
  return { url: `${baseUrl}&api_key=${encodeURIComponent(apiKey)}`, headers };
}

/** R6 补丁 4：TMDB 配置诊断（本地版，与 functions/api/tmdb/status.js 行为一致）。 */
async function handleTmdbStatus(requestUrl, response) {
  const { token, apiKey } = tmdbAuth();
  const variable = token ? "TMDB_ACCESS_TOKEN" : apiKey ? "TMDB_API_KEY" : null;
  const body = {
    configured: !!variable,
    variable,
    language: tmdbLanguage(),
    runtime: {
      functions_deployed: true,
      access_password_enabled: !!process.env.ACCESS_PASSWORD?.trim(),
      // 本地开发没有 D1（server.mjs 从来没实现过 /api/sync/*），如实报 false
      d1_bound: false
    },
    probe: { checked: false }
  };

  if (!body.configured || requestUrl.searchParams.get("probe") !== "1") {
    respondJson(response, 200, body);
    return;
  }

  try {
    const { url, headers } = tmdbRequest(buildTmdbSearchRequest("Birdman", { language: body.language }).url);
    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    let resultCount = null;
    if (upstream.ok) {
      const payload = await upstream.json().catch(() => null);
      resultCount = Array.isArray(payload?.results) ? payload.results.length : null;
    }
    body.probe = {
      checked: true,
      ok: upstream.ok,
      status: upstream.status,
      resultCount,
      hint: upstream.status === 401
        ? "TMDB 拒绝了这个凭据：v4 token 要填 TMDB_ACCESS_TOKEN，v3 key 要填 TMDB_API_KEY，别互相填错"
        : upstream.ok ? null : `TMDB 返回 ${upstream.status}`
    };
  } catch (error) {
    body.probe = { checked: true, ok: false, status: null, resultCount: null, hint: `请求异常：${error.message}` };
  }
  respondJson(response, 200, body);
}

async function handleTmdbSearch(requestUrl, response) {
  const query = requestUrl.searchParams.get("q")?.trim() || "";
  if (!query || query.length > 80) {
    respondJson(response, 400, { error: "invalid_query", message: "作品名需为 1—80 个字符" });
    return;
  }

  // 没配密钥不算错误——用户可能只想用 Bangumi。返回空候选，让统一搜索面板
  // 照常展示另一个源的结果，而不是整个搜索报错。
  if (!tmdbAuth().configured) {
    respondJson(response, 200, { query, candidates: [], source: "tmdb", configured: false });
    return;
  }

  const language = tmdbLanguage();
  const cacheKey = `${language}::${query}`;
  const cached = tmdbSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < TMDB_CACHE_TTL) {
    respondJson(response, 200, { query, candidates: cached.candidates, source: "cache", configured: true });
    return;
  }

  try {
    const { url, headers } = tmdbRequest(buildTmdbSearchRequest(query, { language }).url);
    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) throw new Error(`TMDB ${upstream.status}`);
    const candidates = normalizeTmdbMovies(await upstream.json());
    tmdbSearchCache.set(cacheKey, { candidates, savedAt: Date.now() });
    respondJson(response, 200, { query, candidates, source: "tmdb", configured: true });
  } catch {
    respondJson(response, 502, {
      error: "tmdb_unavailable",
      message: "暂时无法从 TMDB 搜索，其他来源的结果不受影响"
    });
  }
}

async function handleTmdbMovie(requestUrl, response) {
  const id = Number(requestUrl.searchParams.get("id"));
  const request = buildTmdbDetailRequest(id, { language: tmdbLanguage() });
  if (!request) {
    respondJson(response, 400, { error: "invalid_movie_id", message: "电影 id 不合法" });
    return;
  }
  if (!tmdbAuth().configured) {
    respondJson(response, 200, { configured: false, detail: null });
    return;
  }

  const cached = tmdbDetailCache.get(id);
  if (cached && Date.now() - cached.savedAt < TMDB_CACHE_TTL) {
    respondJson(response, 200, { detail: cached.detail, source: "cache", configured: true });
    return;
  }

  try {
    const { url, headers } = tmdbRequest(request.url);
    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) throw new Error(`TMDB ${upstream.status}`);
    const detail = normalizeTmdbDetail(await upstream.json());
    if (!detail) throw new Error("tmdb_bad_payload");
    tmdbDetailCache.set(id, { detail, savedAt: Date.now() });
    respondJson(response, 200, { detail, source: "tmdb", configured: true });
  } catch {
    respondJson(response, 502, { error: "tmdb_unavailable", message: "暂时拿不到这部电影的详细信息" });
  }
}

async function handleTmdbImage(requestUrl, response) {
  const path = requestUrl.searchParams.get("path") || "";
  const size = requestUrl.searchParams.get("size") || "w500";
  const upstreamUrl = buildTmdbImageUrl(path, size);
  if (!upstreamUrl) {
    respondJson(response, 400, { error: "invalid_poster_path", message: "无效的海报路径" });
    return;
  }

  const cached = tmdbImageCache.get(upstreamUrl);
  if (cached && Date.now() - cached.savedAt < TMDB_CACHE_TTL) {
    respondImage(response, cached.image, "hit", "TMDB");
    return;
  }

  try {
    const upstream = await fetch(upstreamUrl, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (upstream.status === 404) throw new Error("image_not_found");
    // 跟随重定向后仍要校验落点主机——不能只信最初那个 URL
    if (!upstream.ok || !isAllowedTmdbImageUrl(upstream.url)) throw new Error("image_unavailable");

    const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("invalid_image_type");

    const data = Buffer.from(await upstream.arrayBuffer());
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");

    const image = { contentType, data };
    tmdbImageCache.set(upstreamUrl, { image, savedAt: Date.now() });
    respondImage(response, image, "miss", "TMDB");
  } catch (error) {
    respondJson(response, error.message === "image_not_found" ? 404 : 502, {
      error: error.message === "image_not_found" ? "image_not_found" : "image_unavailable",
      message: "作品图片暂不可用"
    });
  }
}


async function handleBangumiImage(requestUrl, response) {
  const subjectId = Number(requestUrl.searchParams.get("subjectId"));
  const upstreamUrl = buildBangumiImageRequest(subjectId);
  if (!upstreamUrl) {
    respondJson(response, 400, { error: "invalid_subject_id", message: "无效的作品 ID" });
    return;
  }
  const cacheKey = String(subjectId);
  const cached = bangumiImageCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < BANGUMI_IMAGE_CACHE_TTL) {
    respondImage(response, cached.image, "hit");
    return;
  }
  if (cached) bangumiImageCache.delete(cacheKey);
  try {
    const image = await fetchBangumiImage(upstreamUrl, { "user-agent": process.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_BANGUMI_USER_AGENT });
    bangumiImageCache.set(cacheKey, { image, savedAt: Date.now() });
    if (bangumiImageCache.size > 12) bangumiImageCache.delete(bangumiImageCache.keys().next().value);
    respondImage(response, image, "miss");
  } catch (error) {
    respondJson(response, error.message === "image_not_found" ? 404 : 502, {
      error: error.message === "image_not_found" ? "image_not_found" : "image_unavailable",
      message: "作品图片暂不可用"
    });
  }
}

async function handleBangumiSearch(requestUrl, response) {
  const query = requestUrl.searchParams.get("q")?.trim() || "";
  if (!query || query.length > 80) {
    respondJson(response, 400, { error: "invalid_query", message: "作品名需为 1—80 个字符" });
    return;
  }

  const cached = bangumiSearchCache.get(query);
  if (cached && Date.now() - cached.savedAt < BANGUMI_CACHE_TTL) {
    respondJson(response, 200, { query, candidates: cached.candidates, source: "cache" });
    return;
  }

  const userAgent = process.env.BANGUMI_USER_AGENT?.trim() || DEFAULT_BANGUMI_USER_AGENT;

  try {
    const { url, body } = buildBangumiSearchRequest(query);
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": userAgent
    };
    const token = process.env.BANGUMI_ACCESS_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000)
    });
    if (!upstream.ok) throw new Error(`Bangumi ${upstream.status}`);
    const candidates = normalizeBangumiSubjects(await upstream.json());
    bangumiSearchCache.set(query, { candidates, savedAt: Date.now() });
    if (bangumiSearchCache.size > 100) bangumiSearchCache.delete(bangumiSearchCache.keys().next().value);
    respondJson(response, 200, { query, candidates, source: "bangumi" });
  } catch {
    respondJson(response, 502, {
      error: "bangumi_unavailable",
      message: "暂时无法匹配作品，本地记录已经保留"
    });
  }
}

createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const requestPath = decodeURIComponent(requestUrl.pathname);
  if (request.method === "GET" && requestPath === "/api/bangumi/search") {
    handleBangumiSearch(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/bangumi/image") {
    handleBangumiImage(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/bangumi/subject") {
    void handleBangumiSubject(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/bangumi/persons") {
    void handleBangumiPersons(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/tmdb/status") {
    void handleTmdbStatus(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/tmdb/search") {
    void handleTmdbSearch(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/tmdb/movie") {
    void handleTmdbMovie(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/tmdb/image") {
    void handleTmdbImage(requestUrl, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/ai/providers") {
    respondJson(response, 200, listAiProviders());
    return;
  }
  if (request.method === "POST" && requestPath === "/api/ai/analyze") {
    void handleAiAnalysis(request, response);
    return;
  }
  if (request.method === "POST" && requestPath === "/api/ai/tagline") {
    void handleAiTagline(request, response);
    return;
  }
  if (request.method === "POST" && requestPath === "/api/ai/recommendation") {
    void handleAiRecommendation(request, response);
    return;
  }
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = normalize(join(root, relativePath));

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(filePath);
  const revalidate = extension === ".html" || extension === ".js" || extension === ".css";
  response.writeHead(200, {
    "content-type": types[extension] || "application/octet-stream",
    "cache-control": revalidate ? "no-cache" : "public, max-age=300"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "本机局域网地址" : host;
  console.log(`电影印记已启动：http://${displayHost}:${port}`);
});
