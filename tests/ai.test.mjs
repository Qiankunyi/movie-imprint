import test from "node:test";
import assert from "node:assert/strict";
import { validateAiAnalysis, validateAiRecommendation } from "../src/ai.js";
import { listAiProviders, requestAiAnalysis, requestAiRecommendation } from "../src/ai-providers.js";

const rawText = "#测试电影\n我很喜欢雨中的车站，也被最后的告别感动。";
const providerOutput = {
  attitude: {
    suggested: "like",
    alternative: "none",
    evidence: [{
      excerpt: "我很喜欢雨中的车站",
      basis: "explicit",
      voice: "user",
      claim_mode: "direct_feeling",
      explanation: "用户直接表达喜欢",
      confidence: 0.95
    }],
    confidence: 0.95
  },
  emotions: [{
    label: "感动",
    evidence: [{
      excerpt: "被最后的告别感动",
      basis: "explicit",
      voice: "user",
      claim_mode: "direct_feeling",
      explanation: "用户直接说被感动",
      confidence: 0.96
    }],
    confidence: 0.96
  }],
  memory_cards: [{
    type: "场景",
    title: "雨中的车站",
    content: "雨中的车站和最后的告别留了下来。",
    why_it_matters: "这两个片段触发了明确的喜欢与感动。",
    is_core_suggestion: true,
    evidence: [{
      excerpt: "雨中的车站",
      basis: "explicit",
      voice: "user",
      claim_mode: "observation",
      explanation: "原文明确记下这个场景",
      confidence: 0.9
    }],
    confidence: 0.9
  }],
  warnings: []
};

test("统一 AI 结构只接受原文中真实存在的证据", () => {
  const analysis = validateAiAnalysis(rawText, providerOutput);
  assert.equal(analysis.attitude.suggested, "like");
  assert.equal(analysis.memory_cards[0].provenance, "ai_suggested");
  assert.equal(analysis.emotions[0].label, "感动");
});

test("统一 AI 结构拒绝模型补造的证据片段", () => {
  const invalid = structuredClone(providerOutput);
  invalid.memory_cards[0].evidence[0].excerpt = "原文从来没有出现的剧情";
  assert.throws(() => validateAiAnalysis(rawText, invalid), /evidence_not_in_source/);
});

test("供应商列表只暴露配置状态而不暴露密钥", () => {
  const result = listAiProviders({ GEMINI_API_KEY: "secret", AI_PROVIDER: "gemini" });
  assert.equal(result.active, "gemini");
  assert.equal(result.providers.find((item) => item.id === "gemini").configured, true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("Gemini 适配器把结果转换为统一结构", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(providerOutput) }] } }],
      usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 234 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await requestAiAnalysis({
    provider: "gemini",
    title: "测试电影",
    rawText,
    env: { GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-test" },
    fetchImpl
  });
  assert.match(request.url, /gemini-test:generateContent$/);
  assert.equal(request.options.headers["x-goog-api-key"], "secret");
  assert.equal(result.metadata.provider, "gemini");
  assert.equal(result.analysis.memory_cards.length, 1);
});

test("推荐条件只接受用户已选推荐值对应的字段", () => {
  const output = {
    suggestions: [{
      field: "audiences",
      value: "喜欢安静青春片的人",
      evidence: [{
        excerpt: "我很喜欢雨中的车站",
        basis: "explicit",
        voice: "user",
        claim_mode: "direct_feeling",
        explanation: "原文直接表达偏好",
        confidence: 0.86
      }],
      confidence: 0.86
    }],
    warnings: []
  };
  const result = validateAiRecommendation(rawText, "depends", output);
  assert.equal(result.suggestions[0].field, "audiences");
  assert.equal(result.suggestions[0].status, "pending");
  output.suggestions[0].field = "noReasons";
  assert.throws(() => validateAiRecommendation(rawText, "depends", output), /invalid_recommendation_field/);
});

test("推荐条件 Gemini 请求不让模型重新选择推荐值", async () => {
  let sentBody;
  const output = {
    suggestions: [{
      field: "reasons",
      value: "角色或关系有魅力",
      evidence: [{
        excerpt: "被最后的告别感动",
        basis: "explicit",
        voice: "user",
        claim_mode: "direct_feeling",
        explanation: "告别触发了明确感受",
        confidence: 0.8
      }],
      confidence: 0.8
    }],
    warnings: []
  };
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const result = await requestAiRecommendation({
    provider: "gemini",
    title: "测试电影",
    rawText,
    recommendation: "yes",
    presets: ["角色或关系有魅力"],
    env: { GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-test" },
    fetchImpl
  });
  const input = JSON.parse(sentBody.contents[0].parts[0].text);
  assert.equal(input.user_confirmed_recommendation, "yes");
  assert.equal(result.recommendation.suggestions[0].field, "reasons");
  assert.equal("suggested" in result.recommendation, false);
});

test("AI 上游限流会明确失败，不产生半份结构", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "rate limited" } }), {
    status: 429,
    headers: { "content-type": "application/json" }
  });
  await assert.rejects(
    requestAiAnalysis({ provider: "gemini", title: "测试电影", rawText, env: { GEMINI_API_KEY: "secret" }, fetchImpl }),
    /ai_upstream_429/
  );
});

test("AI 空响应和截断 JSON 都会被拒绝", async () => {
  const emptyFetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  const truncatedFetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"attitude":' }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  await assert.rejects(
    requestAiAnalysis({ provider: "gemini", title: "测试电影", rawText, env: { GEMINI_API_KEY: "secret" }, fetchImpl: emptyFetch }),
    /empty_ai_response/
  );
  await assert.rejects(
    requestAiAnalysis({ provider: "gemini", title: "测试电影", rawText, env: { GEMINI_API_KEY: "secret" }, fetchImpl: truncatedFetch }),
    SyntaxError
  );
});

test("AI 网络超时会原样进入失败降级", async () => {
  const fetchImpl = async () => { throw new DOMException("timed out", "TimeoutError"); };
  await assert.rejects(
    requestAiAnalysis({ provider: "gemini", title: "测试电影", rawText, env: { GEMINI_API_KEY: "secret" }, fetchImpl }),
    (error) => error.name === "TimeoutError"
  );
});

for (const adapter of [
  {
    provider: "openai",
    env: { OPENAI_API_KEY: "secret", OPENAI_MODEL: "openai-test" },
    expectedUrl: "https://api.openai.com/v1/responses",
    response: { output_text: JSON.stringify(providerOutput), usage: { input_tokens: 1, output_tokens: 2 } },
    assertBody: (body) => assert.equal(body.text.format.type, "json_schema")
  },
  {
    provider: "anthropic",
    env: { ANTHROPIC_API_KEY: "secret", ANTHROPIC_MODEL: "claude-test" },
    expectedUrl: "https://api.anthropic.com/v1/messages",
    response: { content: [{ type: "text", text: JSON.stringify(providerOutput) }], usage: { input_tokens: 1, output_tokens: 2 } },
    assertBody: (body) => assert.equal(body.output_config.format.type, "json_schema")
  },
  {
    provider: "deepseek",
    env: { DEEPSEEK_API_KEY: "secret", DEEPSEEK_MODEL: "deepseek-test" },
    expectedUrl: "https://api.deepseek.com/chat/completions",
    response: { choices: [{ message: { content: JSON.stringify(providerOutput) } }], usage: { prompt_tokens: 1, completion_tokens: 2 } },
    assertBody: (body) => assert.equal(body.response_format.type, "json_object")
  },
  {
    provider: "kimi",
    env: { MOONSHOT_API_KEY: "secret", MOONSHOT_MODEL: "kimi-test" },
    expectedUrl: "https://api.moonshot.cn/v1/chat/completions",
    response: { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(providerOutput) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 2 } },
    assertBody: (body) => {
      assert.equal(body.tools[0].function.strict, true);
      assert.equal(body.tool_choice.function.name, "submit_analysis");
    }
  }
]) {
  test(`${adapter.provider} 适配器遵守统一结构契约`, async () => {
    let requestUrl;
    let requestBody;
    const fetchImpl = async (url, options) => {
      requestUrl = url;
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify(adapter.response), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await requestAiAnalysis({ provider: adapter.provider, title: "测试电影", rawText, env: adapter.env, fetchImpl });
    assert.equal(requestUrl, adapter.expectedUrl);
    adapter.assertBody(requestBody);
    assert.equal(result.analysis.memory_cards[0].provenance, "ai_suggested");
  });
}
