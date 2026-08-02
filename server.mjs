import { createReadStream, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import {
  buildBangumiImageRequest,
  buildBangumiSearchRequest,
  isAllowedBangumiImageUrl,
  normalizeBangumiSubjects
} from "./src/bangumi.js";
import { listAiProviders, requestAiAnalysis, requestAiRecommendation } from "./src/ai-providers.js";

const port = Number(process.env.PORT || process.argv[2] || 4173);
const host = process.env.HOST?.trim() || "127.0.0.1";
const root = process.cwd();
const bangumiSearchCache = new Map();
const bangumiImageCache = new Map();
const BANGUMI_CACHE_TTL = 24 * 60 * 60 * 1000;
const BANGUMI_IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_AI_REQUEST_BYTES = 64 * 1024;
const DEFAULT_BANGUMI_USER_AGENT = "qiankunyi/movie-imprint/0.1";
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

function respondImage(response, image, cacheState) {
  response.writeHead(200, {
    "content-type": image.contentType,
    "content-length": String(image.data.byteLength),
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "x-image-source": "Bangumi",
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
    const result = await requestAiAnalysis({
      provider: typeof body.provider === "string" ? body.provider : null,
      title: typeof body.title === "string" ? body.title.slice(0, 160) : "",
      rawText
    });
    respondJson(response, 200, {
      ...result,
      metadata: {
        ...result.metadata,
        input_hash: createHash("sha256").update(rawText, "utf8").digest("hex")
      }
    });
  } catch (error) {
    const invalid = ["invalid_json", "request_too_large", "invalid_ai_input", "unsupported_ai_provider"].includes(error.message);
    const notConfigured = error.message === "ai_provider_not_configured";
    respondJson(response, invalid ? 400 : notConfigured ? 503 : 502, {
      error: invalid ? error.message : notConfigured ? "ai_not_configured" : "ai_analysis_failed",
      message: invalid
        ? "这条记录暂时无法整理"
        : notConfigured
          ? "所选整理服务尚未配置"
          : "整理暂时没有完成，原文已经保留"
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
  if (request.method === "GET" && requestPath === "/api/ai/providers") {
    respondJson(response, 200, listAiProviders());
    return;
  }
  if (request.method === "POST" && requestPath === "/api/ai/analyze") {
    void handleAiAnalysis(request, response);
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
