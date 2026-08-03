import test from "node:test";
import assert from "node:assert/strict";
import { describeAiError } from "../src/ai-providers.js";

// 用户反馈：密钥明明配置对了，整理还是一直失败，但客户端看到的永远是同一句兜底文案
// "整理暂时没有完成"——真正的上游错误（模型名不存在/配额用尽/密钥无效等）在
// fetchJson() 里已经捕获到 error.upstreamMessage / error.status，只是从来没有传回客户端。
// describeAiError() 把这些诊断信息拼接进最终展示给用户的文案里。

test("有上游状态码与错误信息 → 拼接成「兜底文案（HTTP 状态码：上游信息）」", () => {
  const error = new Error("ai_upstream_400");
  error.status = 400;
  error.upstreamMessage = "API key not valid. Please pass a valid API key.";
  const message = describeAiError(error, "整理暂时没有完成，原文已经保留");
  assert.match(message, /整理暂时没有完成，原文已经保留/);
  assert.match(message, /HTTP 400/);
  assert.match(message, /API key not valid/);
});

test("只有状态码、没有上游错误文本 → 至少展示状态码", () => {
  const error = new Error("ai_upstream_429");
  error.status = 429;
  error.upstreamMessage = "";
  const message = describeAiError(error, "整理暂时没有完成");
  assert.match(message, /HTTP 429/);
});

test("网络层错误（没有 status/upstreamMessage）→ 展示原始 error.message", () => {
  const error = new Error("fetch failed: getaddrinfo ENOTFOUND");
  const message = describeAiError(error, "整理暂时没有完成");
  assert.match(message, /fetch failed/);
});

test("内部占位符错误码（ai_upstream_500 这种）不会被当成有信息量的诊断文本重复展示", () => {
  const error = new Error("ai_upstream_500");
  const message = describeAiError(error, "整理暂时没有完成");
  assert.equal(message, "整理暂时没有完成");
});

test("完全没有诊断信息时，原样返回兜底文案", () => {
  const message = describeAiError(null, "整理暂时没有完成");
  assert.equal(message, "整理暂时没有完成");
});
