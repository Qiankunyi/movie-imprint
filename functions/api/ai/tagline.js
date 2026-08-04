import { requestAiTagline, describeAiError } from "../../../src/ai-providers.js";

const MAX_REQUEST_BYTES = 8 * 1024;

/**
 * R5：一句话简介的 AI 兜底。只接收作品的公开信息（标题/原名/年份），
 * 不接收用户的感想原文——这里要的是作品客观介绍，把私人记录发出去没必要。
 */
export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed", message: "仅支持 POST" });
  }

  let body;
  try {
    body = await readJsonBody(context.request, MAX_REQUEST_BYTES);
  } catch (error) {
    return jsonResponse(400, { error: error.message, message: "请求格式错误" });
  }

  try {
    const result = await requestAiTagline({
      provider: typeof body.provider === "string" ? body.provider : null,
      title: typeof body.title === "string" ? body.title.slice(0, 160) : "",
      originalTitle: typeof body.originalTitle === "string" ? body.originalTitle.slice(0, 160) : null,
      year: Number.isInteger(body.year) ? body.year : null,
      // 完整简介原文——这是"概括"的输入，缺了它就没有可概括的东西
      summary: typeof body.summary === "string" ? body.summary.slice(0, 4000) : "",
      env: context.env
    });
    return jsonResponse(200, result);
  } catch (error) {
    const missingSummary = error.message === "missing_summary";
    const invalid = ["invalid_json", "request_too_large", "invalid_ai_input", "invalid_ai_output", "unsupported_ai_provider"].includes(error.message);
    const notConfigured = error.message === "ai_provider_not_configured";
    return jsonResponse(
      missingSummary || invalid ? 400 : notConfigured ? 503 : 502,
      {
        error: missingSummary ? "missing_summary" : invalid ? error.message : notConfigured ? "ai_not_configured" : "ai_tagline_failed",
        message: missingSummary
          ? "没有拿到这部作品的简介原文，无法概括——可以自己写一句"
          : invalid
            ? "这部作品的信息不足以生成简介"
            : notConfigured
              ? "所选整理服务尚未配置"
              : describeAiError(error, "这次没能生成一句话简介")
      }
    );
  }
}

async function readJsonBody(request, maxBytes) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("request_too_large");
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error("request_too_large");
  try {
    return JSON.parse(new TextDecoder().decode(buffer) || "{}");
  } catch {
    throw new Error("invalid_json");
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
