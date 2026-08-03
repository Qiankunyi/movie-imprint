import { requestAiAnalysis, describeAiError } from "../../../src/ai-providers.js";

const MAX_REQUEST_BYTES = 64 * 1024;

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

  const rawText = typeof body.rawText === "string" ? body.rawText : "";

  try {
    const result = await requestAiAnalysis({
      provider: typeof body.provider === "string" ? body.provider : null,
      title: typeof body.title === "string" ? body.title.slice(0, 160) : "",
      rawText,
      env: context.env
    });

    return jsonResponse(200, {
      ...result,
      metadata: {
        ...result.metadata,
        input_hash: await sha256hex(rawText)
      }
    });
  } catch (error) {
    const invalid = ["invalid_json", "request_too_large", "invalid_ai_input", "unsupported_ai_provider"].includes(error.message);
    const notConfigured = error.message === "ai_provider_not_configured";
    return jsonResponse(
      invalid ? 400 : notConfigured ? 503 : 502,
      {
        error: invalid ? error.message : notConfigured ? "ai_not_configured" : "ai_analysis_failed",
        message: invalid
          ? "这条记录暂时无法整理"
          : notConfigured
            ? "所选整理服务尚未配置"
            // 密钥配置对了但一直失败时，真正的原因（模型名不存在/配额用尽/schema 被拒绝等）
            // 需要能传回客户端才诊断得出来，不能一直只显示这句兜底文案。
            : describeAiError(error, "整理暂时没有完成，原文已经保留")
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

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
