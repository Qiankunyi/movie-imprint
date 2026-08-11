import test from "node:test";
import assert from "node:assert/strict";
import { AI_SYSTEM_PROMPT, validateAiAnalysis, validateAiRecommendation } from "../src/ai.js";
import { buildMemorySourceUnits, listAiProviders, requestAiAnalysis, requestAiRecommendation } from "../src/ai-providers.js";
import { GEMINI_FAST_MODEL, GEMINI_QUALITY_MODEL, normalizeAnalysisModelMode } from "../src/ai-model-policy.js";

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
  // 行为变更（不是放宽）：不合格的那一条被丢弃，其余照常交付。
  // 要守住的性质没变——补造的内容绝不能出现在结果里。
  const invalid = structuredClone(providerOutput);
  invalid.memory_cards[0].evidence[0].excerpt = "原文从来没有出现的剧情";
  const result = validateAiAnalysis(rawText, invalid);

  const allEvidence = [
    ...result.attitude.evidence,
    ...result.emotions.flatMap((item) => item.evidence),
    ...result.memory_cards.flatMap((item) => item.evidence)
  ];
  assert.equal(
    allEvidence.some((item) => item.excerpt.includes("原文从来没有出现的剧情")),
    false,
    "补造的证据进入了结果"
  );
  assert.ok(result.warnings.some((line) => line.includes("引文不在原文里")));
});

test("整份证据全部不合格时仍然当作失败，不假装成功", () => {
  const invalid = structuredClone(providerOutput);
  const poison = (list) => (list || []).map((item) => ({ ...item, excerpt: "原文从来没有出现的剧情" }));
  invalid.attitude.evidence = poison(invalid.attitude.evidence);
  invalid.emotions = (invalid.emotions || []).map((item) => ({ ...item, evidence: poison(item.evidence) }));
  invalid.memory_cards = (invalid.memory_cards || []).map((item) => ({ ...item, evidence: poison(item.evidence) }));
  assert.throws(() => validateAiAnalysis(rawText, invalid), /evidence_all_rejected/);
});

test("供应商列表只暴露配置状态而不暴露密钥", () => {
  const result = listAiProviders({ GEMINI_API_KEY: "secret", AI_PROVIDER: "gemini" });
  assert.equal(result.active, "gemini");
  assert.equal(result.providers.find((item) => item.id === "gemini").configured, true);
  assert.equal(result.providers.find((item) => item.id === "gemini").model, GEMINI_QUALITY_MODEL);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(
    result.providers.find((item) => item.id === "gemini").model_modes.map((mode) => mode.id),
    ["auto", "fast", "quality"]
  );
});

test("Gemini 本次整理模型只接受白名单策略", () => {
  assert.equal(normalizeAnalysisModelMode("AUTO"), "auto");
  assert.equal(normalizeAnalysisModelMode(null), null);
  assert.throws(() => normalizeAnalysisModelMode("gemini-arbitrary-model"), /unsupported_ai_model_mode/);
});

test("Gemini 自动模式按输入密度选择 Lite 或 3.6 Flash，并记录实际模型", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(providerOutput) }] } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = { GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-operator-default", AI_MEMORY_COVERAGE_MODE: "off" };
  const short = await requestAiAnalysis({
    provider: "gemini",
    modelMode: "auto",
    title: "短感想",
    rawText,
    env,
    fetchImpl
  });
  const rich = await requestAiAnalysis({
    provider: "gemini",
    modelMode: "auto",
    title: "多碎片感想",
    rawText: `${rawText}\n片段二。\n片段三。\n片段四。\n片段五。\n片段六。`,
    env,
    fetchImpl
  });

  assert.match(requestedUrls[0], new RegExp(`${GEMINI_FAST_MODEL}:generateContent$`));
  assert.match(requestedUrls[1], new RegExp(`${GEMINI_QUALITY_MODEL}:generateContent$`));
  assert.equal(short.metadata.requested_model_mode, "auto");
  assert.equal(short.metadata.resolved_model_mode, "fast");
  assert.equal(short.metadata.model, GEMINI_FAST_MODEL);
  assert.equal(rich.metadata.resolved_model_mode, "quality");
  assert.equal(rich.metadata.model, GEMINI_QUALITY_MODEL);
});

test("Gemini 手动深度模式覆盖运维默认模型，但旧请求仍兼容 GEMINI_MODEL", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(providerOutput) }] } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = { GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-operator-default", AI_MEMORY_COVERAGE_MODE: "off" };
  const selected = await requestAiAnalysis({ provider: "gemini", modelMode: "quality", title: "测试电影", rawText, env, fetchImpl });
  const legacy = await requestAiAnalysis({ provider: "gemini", title: "测试电影", rawText, env, fetchImpl });

  assert.match(requestedUrls[0], new RegExp(`${GEMINI_QUALITY_MODEL}:generateContent$`));
  assert.match(requestedUrls[1], /gemini-operator-default:generateContent$/);
  assert.equal(selected.metadata.model_selection_reason, "user_selected");
  assert.equal(legacy.metadata.resolved_model_mode, "provider_default");
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

test("高密度碎片先逐条发现候选，再完整覆盖到最终卡片", async () => {
  const denseText = [
    "雨中站台的告别让我很感动。",
    "蓝色自动贩卖机让我想起自己没打出的那通电话。",
    "演员最后抬眼的表演让我一直记得。",
    "他们随后走进了车站。",
    "那段配乐让我第一次意识到自己真的舍不得。",
    "片尾字幕是白色的。",
    "我希望多年后还能记住那个拥抱。",
    "普通的转场之后故事继续发展。"
  ].join("\n");
  const evidence = (excerpt, explanation = "原文明确支持这个候选") => ({
    source_type: "free_reflection",
    source_id: "legacy_free_reflection",
    source_revision_id: "legacy_revision",
    question_id: "",
    excerpt,
    basis: "explicit",
    voice: "user",
    claim_mode: "direct_feeling",
    explanation,
    confidence: 0.9
  });
  const candidateOutput = {
    candidate_memories: [
      { candidate_id: "candidate_1", summary: "雨中站台的告别", why_it_matters: "让我很感动", evidence: [evidence("雨中站台的告别让我很感动。")], confidence: 0.9 },
      { candidate_id: "candidate_2", summary: "自动贩卖机带来的个人联想", why_it_matters: "想起没打出的电话", evidence: [evidence("蓝色自动贩卖机让我想起自己没打出的那通电话。")], confidence: 0.9 },
      { candidate_id: "candidate_3", summary: "表演与配乐留下的舍不得", why_it_matters: "表演和配乐分别留下来", evidence: [evidence("演员最后抬眼的表演让我一直记得。"), evidence("那段配乐让我第一次意识到自己真的舍不得。")], confidence: 0.9 },
      { candidate_id: "candidate_4", summary: "想长期记住那个拥抱", why_it_matters: "用户明确希望长期记住", evidence: [evidence("我希望多年后还能记住那个拥抱。")], confidence: 0.95 }
    ],
    unit_coverage: [
      { unit_id: "unit_1", outcome: "candidate", candidate_ids: ["candidate_1"], reason: "" },
      { unit_id: "unit_2", outcome: "candidate", candidate_ids: ["candidate_2"], reason: "" },
      { unit_id: "unit_3", outcome: "candidate", candidate_ids: ["candidate_3"], reason: "" },
      { unit_id: "unit_4", outcome: "discarded", candidate_ids: [], reason: "普通剧情复述" },
      { unit_id: "unit_5", outcome: "candidate", candidate_ids: ["candidate_3"], reason: "" },
      { unit_id: "unit_6", outcome: "discarded", candidate_ids: [], reason: "公共低信息细节" },
      { unit_id: "unit_7", outcome: "candidate", candidate_ids: ["candidate_4"], reason: "" },
      { unit_id: "unit_8", outcome: "discarded", candidate_ids: [], reason: "普通剧情复述" }
    ],
    warnings: []
  };
  const cards = candidateOutput.candidate_memories.map((candidate, index) => ({
    temporary_id: `memory_${index + 1}`,
    memory_cluster_id: `cluster_${index + 1}`,
    candidate_ids: [candidate.candidate_id],
    type: index === 2 ? "真人表演" : "场景",
    title: candidate.summary,
    content: candidate.summary,
    why_it_matters: candidate.why_it_matters,
    related_emotion_tag_ids: [],
    is_core_suggestion: index === 3,
    evidence: candidate.evidence,
    confidence: candidate.confidence
  }));
  const finalOutput = {
    attitude: { suggested: "like", alternative: "none", evidence: [evidence("我希望多年后还能记住那个拥抱。")], confidence: 0.9 },
    emotions: [],
    memory_cards: cards,
    warnings: []
  };
  const clusterOutput = {
    memory_clusters: candidateOutput.candidate_memories.map((candidate, index) => ({
      memory_cluster_id: `cluster_${index + 1}`,
      candidate_ids: [candidate.candidate_id],
      organizing_summary: candidate.summary,
      card_focus: candidate.summary,
      why_it_matters: candidate.why_it_matters,
      confidence: candidate.confidence
    })),
    discarded_candidates: [],
    warnings: []
  };
  const qualityOutput = { memory_cards: cards, warnings: [] };
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requestBodies.push(body);
    const output = requestBodies.length === 2
      ? candidateOutput
      : requestBodies.length === 3 || requestBodies.length === 4
        ? clusterOutput
        : requestBodies.length === 5
          ? finalOutput
          : qualityOutput;
    // 依次模拟：候选发现首轮截断、聚类首轮截断、质量校对连续两轮截断。
    // 前两者必须自动修复；质量校对是增强阶段，两次失败后应交付上一阶段已验证卡片。
    const truncated = [1, 3, 6, 7].includes(requestBodies.length);
    const responseText = truncated ? '{"memory_cards":[{"title":"未闭合' : JSON.stringify(output);
    return new Response(JSON.stringify({ candidates: [{ finishReason: truncated ? "MAX_TOKENS" : "STOP", content: { parts: [{ text: responseText }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const result = await requestAiAnalysis({
    provider: "gemini",
    title: "高密度碎片测试",
    rawText: denseText,
    env: { GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-test", AI_MEMORY_COVERAGE_MODE: "always" },
    fetchImpl
  });
  const discoveryInput = JSON.parse(requestBodies[0].contents[0].parts[0].text);
  const clusterInput = JSON.parse(requestBodies[3].contents[0].parts[0].text);
  const finalInput = JSON.parse(requestBodies[4].contents[0].parts[0].text);
  const qualityInput = JSON.parse(requestBodies[5].contents[0].parts[0].text);
  assert.equal(discoveryInput.source_units.length, 8);
  assert.equal(clusterInput.candidate_memories.length, 4);
  assert.equal(finalInput.approved_memory_clusters.length, 4);
  assert.equal(qualityInput.draft_memory_cards.length, 4);
  assert.ok(requestBodies.every((body) => body.generationConfig.maxOutputTokens === 16384));
  assert.equal(result.analysis.memory_cards.length, 4);
  assert.equal(result.metadata.analysis_strategy, "candidate_cluster_coverage");
  assert.equal(result.metadata.candidate_memory_count, 4);
  assert.equal(result.metadata.memory_cluster_count, 4);
  assert.equal(result.metadata.discovery_pass_count, 2);
  assert.equal(result.metadata.cluster_repair_count, 1);
  assert.equal(result.metadata.quality_repair_count, 1);
  assert.equal(result.metadata.quality_fallback_count, 1);
  assert.ok(result.analysis.warnings.some((warning) => warning.includes("已保留通过覆盖与 Evidence 校验")));
});

test("源片段拆分完整保留长文本，不做静默截断", () => {
  const text = `${"很长的一句感想。".repeat(100)}最后仍然保留。`;
  const units = buildMemorySourceUnits({
    free_reflection: { source_type: "free_reflection", source_id: "r", source_revision_id: "rev", text },
    self_interview: { answers: [] }
  });
  assert.equal(units.map((unit) => unit.text).join(""), text);
  assert.ok(units.length > 1);
  assert.ok(units.every((unit) => unit.text.length <= 600));
});

test("双源请求发送完整自由感想并记录输入与 Evidence 来源诊断", async () => {
  const reflectionEnding = "自由感想末尾独有的蓝色自动贩卖机";
  const reflectionText = `${"很长的自由感想。".repeat(530)}${reflectionEnding}`;
  const dualSources = {
    free_reflection: {
      source_type: "free_reflection",
      source_id: "record_dual",
      source_revision_id: "record_dual_rawrev_3",
      text: reflectionText
    },
    self_interview: {
      interview_id: "interview_dual",
      answers: [{
        source_type: "self_interview",
        source_id: "answer_dual_1",
        source_revision_id: "answer_dual_1_rev_1",
        question_id: "first_recall",
        text: "采访只提到河堤晚风"
      }]
    }
  };
  const dualOutput = {
    attitude: { suggested: "none", alternative: "none", evidence: [], confidence: 0.5 },
    emotions: [],
    memory_cards: [{
      temporary_id: "memory_dual_1",
      memory_cluster_id: "cluster_dual_1",
      type: "场景",
      title: "蓝色自动贩卖机",
      content: "自由感想末尾的独立记忆被保留下来。",
      why_it_matters: "",
      related_emotion_tag_ids: [],
      is_core_suggestion: false,
      evidence: [{
        source_type: "free_reflection",
        source_id: "record_dual",
        source_revision_id: "record_dual_rawrev_3",
        question_id: "",
        excerpt: reflectionEnding,
        basis: "explicit",
        voice: "user",
        claim_mode: "observation",
        explanation: "这是自由感想独有的具体场景",
        confidence: 0.9
      }],
      confidence: 0.9
    }],
    warnings: []
  };
  let sentBody;
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(dualOutput) }] } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await requestAiAnalysis({
    provider: "gemini",
    title: "双源测试电影",
    sources: dualSources,
    env: { GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-test", AI_MEMORY_COVERAGE_MODE: "off" },
    fetchImpl
  });
  const sentInput = JSON.parse(sentBody.contents[0].parts[0].text);
  assert.equal(sentInput.free_reflection.text, reflectionText);
  assert.equal(sentInput.free_reflection.source_revision_id, "record_dual_rawrev_3");
  assert.equal(sentInput.self_interview_answers[0].text, "采访只提到河堤晚风");
  assert.deepEqual(result.metadata.source_character_counts, {
    free_reflection: reflectionText.length,
    self_interview: "采访只提到河堤晚风".length,
    self_interview_answers: 1,
    total: reflectionText.length + "采访只提到河堤晚风".length
  });
  assert.equal(result.metadata.evidence_source_counts.memory_cards.free_reflection, 1);
  assert.equal(result.metadata.evidence_source_counts.memory_cards.self_interview, 0);
  assert.equal(result.metadata.evidence_source_counts.cards_with_source.cross_source, 0);
  assert.equal(result.metadata.model_response_characters, JSON.stringify(dualOutput).length);
});

test("双源 Prompt 明确来源并列但不机械要求每张卡双源", () => {
  assert.match(AI_SYSTEM_PROMPT, /自我采访只是补充来源，不具有高于自由感想的默认优先级/);
  assert.match(AI_SYSTEM_PROMPT, /不得因为采访问题更结构化.*忽略自由感想中的独立有效记忆/);
  assert.match(AI_SYSTEM_PROMPT, /不得为了形式平衡强制每张卡同时引用两个来源/);
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
