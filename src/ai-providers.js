import {
  AI_ANALYSIS_SCHEMA,
  AI_COVERED_ANALYSIS_SCHEMA,
  AI_COVERED_SYSTEM_PROMPT,
  AI_CARD_QUALITY_PROMPT,
  AI_CARD_QUALITY_SCHEMA,
  AI_MEMORY_DISCOVERY_PROMPT,
  AI_MEMORY_DISCOVERY_SCHEMA,
  AI_MEMORY_CLUSTER_PROMPT,
  AI_MEMORY_CLUSTER_SCHEMA,
  AI_PROMPT_VERSION,
  AI_RECOMMENDATION_PROMPT,
  AI_RECOMMENDATION_SCHEMA,
  AI_SYSTEM_PROMPT,
  parseProviderJson,
  validateAiAnalysis,
  validateMemoryDiscovery,
  validateAiRecommendation
} from "./ai.js";
import { SELF_INTERVIEW_QUESTIONS } from "./self-interview.js";
import {
  GEMINI_ANALYSIS_MODES,
  isRichAnalysisInput,
  resolveAnalysisModel,
  splitAnalysisTextIntoUnits
} from "./ai-model-policy.js";

export const AI_PROVIDERS = {
  // gemini-2.0-flash-lite 已被 Google 下线（2026-08 实测报错 HTTP 404 "no longer available"）。
  // 高密度真实记录的回归证明 flash-lite 会在候选发现与全局聚类时显著漏召回。
  // 电影印记把整理质量置于延迟与最低成本之上，因此默认使用完整 Flash 档；部署环境
  // 仍可通过 GEMINI_MODEL 显式覆盖。请求契约继续使用稳定的 generateContent 结构化输出。
  gemini: { label: "Gemini", keyName: "GEMINI_API_KEY", modelName: "GEMINI_MODEL", defaultModel: "gemini-3.6-flash" },
  openai: { label: "ChatGPT / OpenAI", keyName: "OPENAI_API_KEY", modelName: "OPENAI_MODEL", defaultModel: "gpt-5.6-sol" },
  anthropic: { label: "Claude", keyName: "ANTHROPIC_API_KEY", modelName: "ANTHROPIC_MODEL", defaultModel: "claude-sonnet-4-6" },
  deepseek: { label: "DeepSeek", keyName: "DEEPSEEK_API_KEY", modelName: "DEEPSEEK_MODEL", defaultModel: "deepseek-v4-flash" },
  kimi: { label: "Kimi", keyName: "MOONSHOT_API_KEY", modelName: "MOONSHOT_MODEL", defaultModel: "kimi-k3" }
};

function providerConfig(provider, env, modelOverride = null) {
  const definition = AI_PROVIDERS[provider];
  if (!definition) throw new Error("unsupported_ai_provider");
  const apiKey = env[definition.keyName]?.trim();
  if (!apiKey) throw new Error("ai_provider_not_configured");
  return { ...definition, apiKey, model: modelOverride || env[definition.modelName]?.trim() || definition.defaultModel };
}

export function listAiProviders(env = process.env) {
  const preferred = env.AI_PROVIDER?.trim().toLowerCase();
  const providers = Object.entries(AI_PROVIDERS).map(([id, definition]) => ({
    id,
    label: definition.label,
    configured: Boolean(env[definition.keyName]?.trim()),
    model: env[definition.modelName]?.trim() || definition.defaultModel,
    model_modes: id === "gemini" ? GEMINI_ANALYSIS_MODES.map((mode) => ({ ...mode })) : []
  }));
  const active = providers.some((item) => item.id === preferred && item.configured)
    ? preferred
    : providers.find((item) => item.configured)?.id || null;
  return { active, providers };
}

function userPayload({ title, rawText, sources }) {
  if (!sources) return JSON.stringify({ work_title: title || "未命名的电影", raw_impression: rawText });
  const questionText = new Map(SELF_INTERVIEW_QUESTIONS.map((question) => [question.id, question.question]));
  return JSON.stringify({
    work_title: title || "未命名的电影",
    free_reflection: sources.free_reflection,
    self_interview_answers: (sources.self_interview?.answers || []).map((answer) => ({
      ...answer,
      question_text: questionText.get(answer.question_id) || answer.question_id
    }))
  });
}

const MEMORY_DISCOVERY_BATCH_UNITS = 24;
const MEMORY_DISCOVERY_BATCH_CHARS = 3500;

export function buildMemorySourceUnits(sources) {
  const questionText = new Map(SELF_INTERVIEW_QUESTIONS.map((question) => [question.id, question.question]));
  const result = [];
  const append = (source, text, questionId = "") => {
    for (const fragment of splitAnalysisTextIntoUnits(text)) {
      result.push({
        unit_id: `unit_${result.length + 1}`,
        source_type: source.source_type,
        source_id: source.source_id,
        source_revision_id: source.source_revision_id,
        question_id: questionId,
        question_text: questionId ? (questionText.get(questionId) || questionId) : "",
        text: fragment
      });
    }
  };
  if (sources?.free_reflection?.text?.trim()) append(sources.free_reflection, sources.free_reflection.text, "");
  for (const answer of sources?.self_interview?.answers || []) {
    if (answer?.text?.trim()) append(answer, answer.text, answer.question_id || "");
  }
  return result;
}

function memoryDiscoveryBatches(units) {
  const batches = [];
  let current = [];
  let currentCharacters = 0;
  for (const unit of units) {
    if (current.length && (current.length >= MEMORY_DISCOVERY_BATCH_UNITS
      || currentCharacters + unit.text.length > MEMORY_DISCOVERY_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(unit);
    currentCharacters += unit.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function shouldUseCoveredAnalysis(sourceCounts, units, env) {
  const mode = String(env.AI_MEMORY_COVERAGE_MODE || "auto").trim().toLowerCase();
  if (mode === "off") return false;
  if (mode === "always") return true;
  return isRichAnalysisInput({ totalCharacters: sourceCounts.total, sourceUnitCount: units.length });
}

function sourceCharacterCounts(sources) {
  const freeReflection = typeof sources?.free_reflection?.text === "string"
    ? sources.free_reflection.text.length
    : 0;
  const interviewAnswers = (sources?.self_interview?.answers || [])
    .filter((answer) => typeof answer?.text === "string");
  const selfInterview = interviewAnswers.reduce((sum, answer) => sum + answer.text.length, 0);
  return {
    free_reflection: freeReflection,
    self_interview: selfInterview,
    self_interview_answers: interviewAnswers.length,
    total: freeReflection + selfInterview
  };
}

function evidenceSourceCounts(analysis) {
  const allEvidence = [
    ...(analysis?.attitude?.evidence || []),
    ...(analysis?.emotions || []).flatMap((emotion) => emotion.evidence || []),
    ...(analysis?.memory_cards || []).flatMap((card) => card.evidence || [])
  ];
  const cardEvidence = (analysis?.memory_cards || []).flatMap((card) => card.evidence || []);
  const count = (items, sourceType) => items.filter((item) => item.source_type === sourceType).length;
  const cards = analysis?.memory_cards || [];
  return {
    all: {
      free_reflection: count(allEvidence, "free_reflection"),
      self_interview: count(allEvidence, "self_interview"),
      total: allEvidence.length
    },
    memory_cards: {
      free_reflection: count(cardEvidence, "free_reflection"),
      self_interview: count(cardEvidence, "self_interview"),
      total: cardEvidence.length
    },
    cards_with_source: {
      free_reflection: cards.filter((card) => card.evidence?.some((item) => item.source_type === "free_reflection")).length,
      self_interview: cards.filter((card) => card.evidence?.some((item) => item.source_type === "self_interview")).length,
      cross_source: cards.filter((card) => new Set((card.evidence || []).map((item) => item.source_type)).size > 1).length
    }
  };
}

function contractOptions(options = {}) {
  return {
    systemPrompt: options.systemPrompt || AI_SYSTEM_PROMPT,
    schema: options.schema || AI_ANALYSIS_SCHEMA,
    schemaName: options.schemaName || "movie_imprint_analysis",
    toolName: options.toolName || "submit_analysis",
    toolDescription: options.toolDescription || "提交结构化电影感想建议",
    inputText: options.inputText
  };
}

function geminiSchema(value, isPropertiesMap = false) {
  if (Array.isArray(value)) return value.map((item) => geminiSchema(item));
  if (!value || typeof value !== "object") return value;
  if (isPropertiesMap) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, geminiSchema(child)]));
  const supported = new Set(["type", "properties", "required", "items", "enum", "description", "title"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => supported.has(key))
    .map(([key, child]) => [key, geminiSchema(child, key === "properties")]));
}

async function fetchJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(45000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`ai_upstream_${response.status}`);
    error.status = response.status;
    error.upstreamCode = payload.error?.status || payload.error?.code || null;
    error.upstreamMessage = String(payload.error?.message || "").slice(0, 500);
    throw error;
  }
  return payload;
}

async function callGemini(config, input, fetchImpl, options) {
  const contract = contractOptions(options);
  const payload = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: contract.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: contract.inputText || userPayload(input) }] }],
        // 不依赖 temperature/top-K/top-P 控制质量：不同 Gemini 世代对这些参数的支持并不一致，
        // 结构与保守边界由分阶段 Prompt、JSON Schema 和 Evidence 校验共同保证。
        generationConfig: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: geminiSchema(contract.schema)
        }
      })
    },
    fetchImpl
  );
  return {
    text: payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join(""),
    usage: {
      input_tokens: payload.usageMetadata?.promptTokenCount || null,
      output_tokens: payload.usageMetadata?.candidatesTokenCount || null
    }
  };
}

async function callOpenAi(config, input, fetchImpl, options) {
  const contract = contractOptions(options);
  const payload = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      store: false,
      input: [
        { role: "developer", content: contract.systemPrompt },
        { role: "user", content: contract.inputText || userPayload(input) }
      ],
      text: { format: { type: "json_schema", name: contract.schemaName, strict: true, schema: contract.schema } }
    })
  }, fetchImpl);
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return { text, usage: { input_tokens: payload.usage?.input_tokens || null, output_tokens: payload.usage?.output_tokens || null } };
}

async function callAnthropic(config, input, fetchImpl, options) {
  const contract = contractOptions(options);
  const payload = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 8192,
      system: contract.systemPrompt,
      messages: [{ role: "user", content: contract.inputText || userPayload(input) }],
      output_config: { format: { type: "json_schema", schema: contract.schema } }
    })
  }, fetchImpl);
  return { text: payload.content?.find((item) => item.type === "text")?.text, usage: { input_tokens: payload.usage?.input_tokens || null, output_tokens: payload.usage?.output_tokens || null } };
}

async function callOpenAiCompatible(config, input, fetchImpl, provider, options) {
  const contract = contractOptions(options);
  const isKimi = provider === "kimi";
  const url = isKimi ? "https://api.moonshot.cn/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: `${contract.systemPrompt}\n输出字段结构：${JSON.stringify(contract.schema)}` },
      { role: "user", content: contract.inputText || userPayload(input) }
    ],
    max_tokens: 8192,
    temperature: 0.1
  };
  if (isKimi) {
    body.tools = [{ type: "function", function: { name: contract.toolName, description: contract.toolDescription, strict: true, parameters: contract.schema } }];
    body.tool_choice = { type: "function", function: { name: contract.toolName } };
  } else {
    body.response_format = { type: "json_object" };
  }
  const payload = await fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body)
  }, fetchImpl);
  const message = payload.choices?.[0]?.message;
  const text = isKimi ? message?.tool_calls?.[0]?.function?.arguments : message?.content;
  return { text, usage: { input_tokens: payload.usage?.prompt_tokens || null, output_tokens: payload.usage?.completion_tokens || null } };
}

function callStructuredProvider(provider, config, input, fetchImpl, options) {
  if (provider === "gemini") return callGemini(config, input, fetchImpl, options);
  if (provider === "openai") return callOpenAi(config, input, fetchImpl, options);
  if (provider === "anthropic") return callAnthropic(config, input, fetchImpl, options);
  return callOpenAiCompatible(config, input, fetchImpl, provider, options);
}

function addUsage(...items) {
  const sum = (field) => {
    const values = items.map((item) => Number(item?.[field])).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return { input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens") };
}

/**
 * 用户反馈：AI 密钥明明配置对了（Settings → AI 偏好 里也确认显示了具体模型名），
 * 但整理一直不成功，而客户端看到的错误信息永远是"整理暂时没有完成"这句固定文案——
 * 真正的上游错误（Google/OpenAI/... 接口返回的具体原因，比如密钥格式不对、模型名不存在、
 * 配额用尽、schema 不被支持等）在 fetchJson() 里其实已经被捕获到 error.upstreamMessage /
 * error.status 上了，只是从来没有从 functions/api/ai/*.js 传回给客户端——等于诊断信息
 * 一直在，只是没人把它读出来。这里统一拼接成一句可读的诊断文案，不泄露密钥本身
 * （密钥不会出现在任何上游错误信息里），只是把"上游到底说了什么"如实转述出来。
 * @param {Error & {status?: number, upstreamMessage?: string}} error
 * @param {string} fallbackMessage
 */
export function describeAiError(error, fallbackMessage) {
  const detail = error?.upstreamMessage
    ? `${error.status ? `HTTP ${error.status}：` : ""}${error.upstreamMessage}`
    : typeof error?.status === "number"
      ? `HTTP ${error.status}`
      // 上游都没走到（网络错误、超时等），error.message 本身通常已经有诊断价值，
      // 但排除掉我们自己在 fetchJson 里生成的占位符（"ai_upstream_400" 这种），避免
      // 重复展示一句没有信息量的内部错误码。
      : error?.message && !/^ai_upstream_\d+$/.test(error.message)
        ? error.message.slice(0, 200)
        : "";
  return detail ? `${fallbackMessage}（${detail}）` : fallbackMessage;
}

function explicitMemorySignalUnits(units) {
  const signal = /(最|特别|一直|记得|记住|喜欢|爱|讨厌|难过|伤感|感动|心疼|泪目|遗憾|可惜|复杂|共鸣|希望|我也|让我|想起|觉得|在意|安慰|牺牲|善良)/;
  return units.filter((unit) => signal.test(unit.text)).length;
}

function discardedPersonalSignalUnits(units, discovery) {
  const coverageByUnit = new Map(discovery.coverage.map((entry) => [entry.unit_id, entry]));
  const personalSignal = /(我(?:很|真的|也|觉得|希望|想|会|更|只是)|让我|对.+(?:感同身受|心疼)|谁都希望|第一次看.+(?:这回|现在)|泪目|情怀拉满|心情复杂|安慰的感觉|牺牲自己)/;
  return units.filter((unit) => coverageByUnit.get(unit.unit_id)?.outcome === "discarded" && personalSignal.test(unit.text));
}

function mergeMemoryDiscoveries(base, addition) {
  const idMap = new Map();
  const appendedCandidates = addition.candidates.map((candidate, index) => {
    const candidateId = `candidate_${base.candidates.length + index + 1}`;
    idMap.set(candidate.candidate_id, candidateId);
    return { ...candidate, candidate_id: candidateId };
  });
  const replacementCoverage = new Map(addition.coverage.map((entry) => [entry.unit_id, {
    ...entry,
    candidate_ids: entry.candidate_ids.map((id) => idMap.get(id))
  }]));
  return {
    candidates: [...base.candidates, ...appendedCandidates],
    coverage: base.coverage.map((entry) => replacementCoverage.get(entry.unit_id) || entry),
    warnings: [...base.warnings, ...addition.warnings],
    responses: [...base.responses, ...addition.responses]
  };
}

function validateMemoryClusterPlan(candidateMemories, value) {
  const output = parseProviderJson(value);
  if (!Array.isArray(output?.memory_clusters) || !Array.isArray(output.discarded_candidates)) {
    throw new Error("invalid_memory_cluster_plan");
  }
  const expected = new Set(candidateMemories.map((candidate) => candidate.candidate_id));
  const accounted = new Set();
  const clusterIds = new Set();
  const memoryClusters = output.memory_clusters.map((cluster, index) => {
    const clusterId = String(cluster?.memory_cluster_id || "").trim();
    if (!clusterId || clusterIds.has(clusterId)) throw new Error(`invalid_memory_cluster_identity:${index}`);
    clusterIds.add(clusterId);
    if (!Array.isArray(cluster.candidate_ids) || !cluster.candidate_ids.length) throw new Error(`empty_memory_cluster:${index}`);
    const candidateIds = [...new Set(cluster.candidate_ids.map((id) => String(id).trim()).filter(Boolean))];
    for (const id of candidateIds) {
      if (!expected.has(id)) throw new Error(`unknown_cluster_candidate:${id}`);
      if (accounted.has(id)) throw new Error(`duplicate_cluster_candidate:${id}`);
      accounted.add(id);
    }
    const organizingSummary = String(cluster.organizing_summary || "").trim();
    const cardFocus = String(cluster.card_focus || "").trim();
    const whyItMatters = String(cluster.why_it_matters || "").trim();
    if (!organizingSummary || organizingSummary.length > 600 || !cardFocus || cardFocus.length > 300 || whyItMatters.length > 300) {
      throw new Error(`invalid_memory_cluster_text:${index}`);
    }
    const confidence = Number(cluster.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_memory_cluster_confidence:${index}`);
    return {
      memory_cluster_id: clusterId,
      candidate_ids: candidateIds,
      organizing_summary: organizingSummary,
      card_focus: cardFocus,
      why_it_matters: whyItMatters,
      confidence
    };
  });
  const discardedCandidates = output.discarded_candidates.map((discarded, index) => {
    const candidateId = String(discarded?.candidate_id || "").trim();
    const reason = String(discarded?.reason || "").trim();
    if (!expected.has(candidateId) || accounted.has(candidateId) || !reason || reason.length > 240) {
      throw new Error(`invalid_discarded_candidate:${index}`);
    }
    accounted.add(candidateId);
    return { candidate_id: candidateId, reason };
  });
  const missing = [...expected].filter((id) => !accounted.has(id));
  if (missing.length) throw new Error(`incomplete_memory_cluster_plan:${missing.slice(0, 5).join(",")}`);
  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_memory_cluster_warnings");
  return {
    memory_clusters: memoryClusters,
    discarded_candidates: discardedCandidates,
    warnings: output.warnings.map((warning) => String(warning).trim()).filter(Boolean)
  };
}

async function runMemoryDiscovery({ selected, config, input, normalizedSources, units, fetchImpl, repair = false }) {
  const candidates = [];
  const coverage = [];
  const warnings = [];
  const responses = [];
  for (const [batchIndex, batch] of memoryDiscoveryBatches(units).entries()) {
    let discovered;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const options = {
        systemPrompt: `${AI_MEMORY_DISCOVERY_PROMPT}${repair ? "\n\n召回修复：上一轮候选异常偏少。请重新逐条审计，尤其不要漏掉带明确情绪、个人联想、价值判断或重看变化的独立记忆；仍然不得为数量制造卡片。" : ""}${attempt ? "\n\n结构修复：上一轮候选清单被截断或没有完整覆盖本批 unit_id。请重新输出完整、闭合的 JSON，并确保本批每个 unit_id 恰好登记一次。" : ""}`,
        schema: AI_MEMORY_DISCOVERY_SCHEMA,
        schemaName: "movie_imprint_memory_discovery",
        toolName: "submit_memory_discovery",
        toolDescription: "提交逐片段覆盖的候选电影记忆",
        inputText: JSON.stringify({
          work_title: input.title || "未命名的电影",
          batch: batchIndex + 1,
          source_units: batch
        })
      };
      const response = await callStructuredProvider(selected, config, input, fetchImpl, options);
      responses.push(response);
      try {
        discovered = validateMemoryDiscovery(normalizedSources, batch, response.text);
        break;
      } catch (error) {
        if (attempt) throw error;
      }
    }
    const idMap = new Map();
    for (const candidate of discovered.candidate_memories) {
      const normalizedId = `candidate_${candidates.length + 1}`;
      idMap.set(candidate.candidate_id, normalizedId);
      candidates.push({ ...candidate, candidate_id: normalizedId });
    }
    for (const entry of discovered.unit_coverage) {
      coverage.push({ ...entry, candidate_ids: entry.candidate_ids.map((id) => idMap.get(id)) });
    }
    warnings.push(...discovered.warnings);
  }
  return { candidates, coverage, warnings, responses };
}

async function runMemoryClustering({ selected, config, input, discovery, fetchImpl, repairReason = "" }) {
  const options = {
    systemPrompt: `${AI_MEMORY_CLUSTER_PROMPT}${repairReason ? `\n\n结构修复：上一轮聚类未通过完整性校验（${repairReason}）。请重新全局规整并确保每个 candidate_id 恰好归属一次。` : ""}`,
    schema: AI_MEMORY_CLUSTER_SCHEMA,
    schemaName: "movie_imprint_memory_clusters",
    toolName: "submit_memory_clusters",
    toolDescription: "提交完整覆盖候选记忆的全局聚类方案",
    inputText: JSON.stringify({
      ...JSON.parse(userPayload(input)),
      candidate_memories: discovery.candidates
    })
  };
  const response = await callStructuredProvider(selected, config, input, fetchImpl, options);
  return { response, plan: validateMemoryClusterPlan(discovery.candidates, response.text) };
}

function validateCoveredAnalysis(sourceInput, candidateMemories, clusterPlan, value) {
  const output = parseProviderJson(value);
  if (!Array.isArray(output?.memory_cards)) throw new Error("invalid_memory_cards");
  const expectedClusters = new Map(clusterPlan.memory_clusters.map((cluster) => [cluster.memory_cluster_id, cluster]));
  const expected = new Set(clusterPlan.memory_clusters.flatMap((cluster) => cluster.candidate_ids));
  const candidateById = new Map(candidateMemories.map((candidate) => [candidate.candidate_id, candidate]));
  const covered = new Set();
  const coveredClusters = new Set();
  const candidateIdsByCard = new Map();
  const temporaryIds = new Set();
  for (const [index, card] of output.memory_cards.entries()) {
    const expectedCluster = expectedClusters.get(String(card?.memory_cluster_id || "").trim());
    if (!expectedCluster || coveredClusters.has(expectedCluster.memory_cluster_id)) throw new Error(`invalid_card_cluster:${index}`);
    coveredClusters.add(expectedCluster.memory_cluster_id);
    if (!Array.isArray(card?.candidate_ids) || !card.candidate_ids.length) throw new Error(`missing_card_candidate_ids:${index}`);
    if (temporaryIds.has(card.temporary_id)) throw new Error(`duplicate_card_identity:${index}`);
    temporaryIds.add(card.temporary_id);
    const ids = [...new Set(card.candidate_ids.map((id) => String(id).trim()).filter(Boolean))];
    if (ids.length !== expectedCluster.candidate_ids.length
      || ids.some((id) => !expectedCluster.candidate_ids.includes(id))) throw new Error(`changed_card_cluster:${index}`);
    for (const id of ids) {
      if (!expected.has(id)) throw new Error(`unknown_card_candidate:${id}`);
      if (covered.has(id)) throw new Error(`duplicate_card_candidate:${id}`);
      covered.add(id);
    }
    // 第一阶段 Evidence 已经逐字定位并通过来源校验。第三阶段只负责写卡，
    // 不应因为再次抄引文时多了空格或换行而损失整张卡；优先复用可信 Evidence，
    // 再补充模型本轮提供的引用，仍保持每张最多三条。
    const trustedEvidence = ids.flatMap((id) => candidateById.get(id)?.evidence || []);
    const evidenceSeen = new Set();
    card.evidence = [...trustedEvidence, ...(Array.isArray(card.evidence) ? card.evidence : [])]
      .filter((item) => {
        const key = `${item.source_type}|${item.source_id}|${item.question_id}|${item.excerpt}`;
        if (evidenceSeen.has(key)) return false;
        evidenceSeen.add(key);
        return true;
      })
      .slice(0, 3);
    candidateIdsByCard.set(card.temporary_id, ids);
  }
  const missing = [...expected].filter((id) => !covered.has(id));
  const missingClusters = [...expectedClusters.keys()].filter((id) => !coveredClusters.has(id));
  if (missing.length || missingClusters.length || (!expected.size && output.memory_cards.length)) {
    throw new Error(`incomplete_candidate_coverage:${missing.slice(0, 5).join(",") || "unexpected_cards"}`);
  }

  const analysis = validateAiAnalysis(sourceInput, output);
  const survivingCandidateIds = new Set(analysis.memory_cards.flatMap((card) => candidateIdsByCard.get(card.temporary_id) || []));
  const lost = [...expected].filter((id) => !survivingCandidateIds.has(id));
  if (lost.length) throw new Error(`candidate_coverage_lost_after_validation:${lost.slice(0, 5).join(",")}`);
  return analysis;
}

async function runCoveredAnalysis({ selected, config, input, normalizedSources, discovery, clusterPlan, fetchImpl, repairReason = "" }) {
  const options = {
    systemPrompt: `${AI_COVERED_SYSTEM_PROMPT}${repairReason ? `\n\n覆盖修复：上一轮结果未通过完整性检查（${repairReason}）。请重新输出完整结果，确保每个 memory_cluster_id 恰好生成一张卡。` : ""}`,
    schema: AI_COVERED_ANALYSIS_SCHEMA,
    schemaName: "movie_imprint_covered_analysis",
    toolName: "submit_covered_analysis",
    toolDescription: "提交完整覆盖候选记忆的电影印记分析",
    inputText: JSON.stringify({
      ...JSON.parse(userPayload(input)),
      approved_memory_clusters: clusterPlan.memory_clusters.map((cluster) => ({
        ...cluster,
        candidates: cluster.candidate_ids.map((id) => discovery.candidates.find((candidate) => candidate.candidate_id === id))
      }))
    })
  };
  const response = await callStructuredProvider(selected, config, input, fetchImpl, options);
  return { response, analysis: validateCoveredAnalysis(normalizedSources, discovery.candidates, clusterPlan, response.text) };
}

async function runCardQualityReview({ selected, config, input, normalizedSources, discovery, clusterPlan, draftResponse, fetchImpl, repairReason = "" }) {
  const draftOutput = parseProviderJson(draftResponse.text);
  const options = {
    systemPrompt: `${AI_CARD_QUALITY_PROMPT}${repairReason ? `\n\n校对修复：上一轮质量稿未通过结构或 Evidence 校验（${repairReason}）。请保持全部 cluster 不变并重新输出。` : ""}`,
    schema: AI_CARD_QUALITY_SCHEMA,
    schemaName: "movie_imprint_card_quality",
    toolName: "submit_card_quality",
    toolDescription: "提交经过逐句来源校对的电影记忆卡片",
    inputText: JSON.stringify({
      ...JSON.parse(userPayload(input)),
      approved_memory_clusters: clusterPlan.memory_clusters.map((cluster) => ({
        ...cluster,
        candidates: cluster.candidate_ids.map((id) => discovery.candidates.find((candidate) => candidate.candidate_id === id))
      })),
      draft_memory_cards: draftOutput.memory_cards
    })
  };
  const response = await callStructuredProvider(selected, config, input, fetchImpl, options);
  const reviewed = parseProviderJson(response.text);
  const combined = {
    ...draftOutput,
    memory_cards: reviewed.memory_cards,
    warnings: [...new Set([...(draftOutput.warnings || []), ...(reviewed.warnings || [])])].slice(0, 5)
  };
  return { response, analysis: validateCoveredAnalysis(normalizedSources, discovery.candidates, clusterPlan, combined) };
}

export async function requestAiAnalysis({ provider, modelMode, title, rawText, sources, env = process.env, fetchImpl = fetch }) {
  const normalizedSources = sources || {
    free_reflection: {
      source_type: "free_reflection",
      source_id: "legacy_free_reflection",
      source_revision_id: "legacy_revision",
      text: rawText
    },
    self_interview: { interview_id: null, answers: [] }
  };
  const sourceCounts = sourceCharacterCounts(normalizedSources);
  const sourceTexts = [normalizedSources.free_reflection?.text, ...(normalizedSources.self_interview?.answers || []).map((answer) => answer?.text)]
    .filter((text) => typeof text === "string");
  const totalCharacters = sourceTexts.reduce((sum, text) => sum + text.length, 0);
  if (!sourceTexts.some((text) => text.trim()) || totalCharacters > 20000) throw new Error("invalid_ai_input");
  const selected = provider || listAiProviders(env).active;
  const sourceUnits = buildMemorySourceUnits(normalizedSources);
  const configuredModel = selected && AI_PROVIDERS[selected]
    ? env[AI_PROVIDERS[selected].modelName]?.trim() || AI_PROVIDERS[selected].defaultModel
    : null;
  const modelSelection = resolveAnalysisModel({
    provider: selected,
    requestedMode: modelMode,
    totalCharacters: sourceCounts.total,
    sourceUnitCount: sourceUnits.length,
    configuredModel
  });
  const config = providerConfig(selected, env, modelSelection.model);
  const startedAt = Date.now();
  const input = { title, sources: normalizedSources };
  const validationSources = sources ? normalizedSources : rawText;
  const coveredStrategy = shouldUseCoveredAnalysis(sourceCounts, sourceUnits, env);
  let analysis;
  let result;
  let discovery = null;
  let discoveryResponses = [];
  let clusterPlan = null;
  let clusterResponses = [];
  let clusterRepairCount = 0;
  let qualityResponses = [];
  let qualityRepairCount = 0;
  let coveredRepairCount = 0;

  if (coveredStrategy) {
    discovery = await runMemoryDiscovery({ selected, config, input, normalizedSources, units: sourceUnits, fetchImpl });
    discoveryResponses = discovery.responses;
    const signalUnits = explicitMemorySignalUnits(sourceUnits);
    if (discovery.candidates.length < 2 && signalUnits >= 4) {
      const repairedDiscovery = await runMemoryDiscovery({
        selected, config, input, normalizedSources, units: sourceUnits, fetchImpl, repair: true
      });
      discoveryResponses.push(...repairedDiscovery.responses);
      if (repairedDiscovery.candidates.length > discovery.candidates.length) discovery = repairedDiscovery;
    }
    const personalSignalUnits = discardedPersonalSignalUnits(sourceUnits, discovery);
    if (personalSignalUnits.length) {
      const personalSignalAudit = await runMemoryDiscovery({
        selected, config, input, normalizedSources, units: personalSignalUnits, fetchImpl, repair: true
      });
      discoveryResponses.push(...personalSignalAudit.responses);
      if (personalSignalAudit.candidates.length) discovery = mergeMemoryDiscoveries(discovery, personalSignalAudit);
    }
    try {
      const clustered = await runMemoryClustering({ selected, config, input, discovery, fetchImpl });
      clusterResponses.push(clustered.response);
      clusterPlan = clustered.plan;
    } catch (error) {
      if (!/(cluster|candidate|memory)/.test(String(error?.message || ""))) throw error;
      clusterRepairCount = 1;
      const clustered = await runMemoryClustering({
        selected, config, input, discovery, fetchImpl, repairReason: String(error.message).slice(0, 160)
      });
      clusterResponses.push(clustered.response);
      clusterPlan = clustered.plan;
    }
    try {
      const covered = await runCoveredAnalysis({ selected, config, input, normalizedSources, discovery, clusterPlan, fetchImpl });
      result = covered.response;
      analysis = covered.analysis;
    } catch (error) {
      if (!/(candidate_|candidate_ids|card_|evidence_|memory_cards|multiple_core)/.test(String(error?.message || ""))) throw error;
      coveredRepairCount = 1;
      const covered = await runCoveredAnalysis({
        selected, config, input, normalizedSources, discovery, clusterPlan, fetchImpl, repairReason: String(error.message).slice(0, 160)
      });
      result = covered.response;
      analysis = covered.analysis;
    }
    try {
      const reviewed = await runCardQualityReview({
        selected, config, input, normalizedSources, discovery, clusterPlan, draftResponse: result, fetchImpl
      });
      qualityResponses.push(reviewed.response);
      analysis = reviewed.analysis;
    } catch (error) {
      if (!/(candidate_|candidate_ids|cluster|card_|evidence_|memory_cards|multiple_core)/.test(String(error?.message || ""))) throw error;
      qualityRepairCount = 1;
      const reviewed = await runCardQualityReview({
        selected,
        config,
        input,
        normalizedSources,
        discovery,
        clusterPlan,
        draftResponse: result,
        fetchImpl,
        repairReason: String(error.message).slice(0, 160)
      });
      qualityResponses.push(reviewed.response);
      analysis = reviewed.analysis;
    }
    analysis.warnings = [...new Set([...analysis.warnings, ...discovery.warnings, ...clusterPlan.warnings])].slice(0, 12);
  } else {
    result = await callStructuredProvider(selected, config, input, fetchImpl);
    analysis = validateAiAnalysis(validationSources, result.text);
  }

  const discoveryCharacters = discoveryResponses.reduce((sum, response) => sum + (typeof response.text === "string" ? response.text.length : 0), 0);
  const clusterCharacters = clusterResponses.reduce((sum, response) => sum + (typeof response.text === "string" ? response.text.length : 0), 0);
  const qualityCharacters = qualityResponses.reduce((sum, response) => sum + (typeof response.text === "string" ? response.text.length : 0), 0);
  return {
    analysis,
    metadata: {
      provider: selected,
      model: config.model,
      requested_model_mode: modelSelection.requestedMode,
      resolved_model_mode: modelSelection.resolvedMode,
      model_selection_reason: modelSelection.reason,
      prompt_version: AI_PROMPT_VERSION,
      schema_version: analysis.schema_version,
      duration_ms: Date.now() - startedAt,
      usage: addUsage(
        ...discoveryResponses.map((response) => response.usage),
        ...clusterResponses.map((response) => response.usage),
        result.usage,
        ...qualityResponses.map((response) => response.usage)
      ),
      source_character_counts: sourceCounts,
      evidence_source_counts: evidenceSourceCounts(analysis),
      model_response_characters: typeof result.text === "string" ? result.text.length : null,
      analysis_strategy: coveredStrategy ? "candidate_cluster_coverage" : "single_pass",
      source_unit_count: sourceUnits.length,
      candidate_memory_count: discovery?.candidates.length ?? null,
      discovery_pass_count: discoveryResponses.length,
      discovery_response_characters: coveredStrategy ? discoveryCharacters : null,
      memory_cluster_count: clusterPlan?.memory_clusters.length ?? null,
      discarded_candidate_count: clusterPlan?.discarded_candidates.length ?? null,
      cluster_response_characters: coveredStrategy ? clusterCharacters : null,
      cluster_repair_count: clusterRepairCount,
      quality_response_characters: coveredStrategy ? qualityCharacters : null,
      quality_repair_count: qualityRepairCount,
      coverage_repair_count: coveredRepairCount
    }
  };
}

// R5：一句话简介。这是全项目里唯一一处 AI 直接产出"介绍作品"的文字——和 App 的
// 核心红线（AI 先帮用户整理记忆素材，而不是替用户写影评）不冲突：它写的是客观作品
// 简介，不碰用户的感想，也永远不会自动落库，必须用户确认后手动保存。
const AI_TAGLINE_PROMPT = [
  "你在为一个私人观影记录 App 把一段电影简介**压缩成一句话**。",
  "用户会给你这部作品的完整简介原文（summary）。你的任务是概括它，不是自己另写一个。",
  "要求：",
  "1. 只输出一句话，不超过 40 个汉字。",
  "2. 内容必须来自给定的简介原文——不要引入原文里没有的设定、人物或情节。",
  "3. 写客观介绍（讲了什么 / 是什么样的作品），不写评价、不写推荐语、不剧透结局与关键转折。",
  "4. 不要复述片名，不要用「这部电影讲述了」这类套话开头。",
  "5. 如果没有提供简介原文，或原文信息不足以概括，把 tagline 留空字符串，不要凭印象编造。"
].join("\n");

const AI_TAGLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tagline"],
  properties: {
    tagline: { type: "string", description: "一句话简介；不确定这部作品时返回空字符串" }
  }
};

/**
 * 把作品的完整简介压缩成一句话。
 *
 * summary（抓回来的完整简介原文）是**必需**的——这个功能的定义就是"概括已有简介"，
 * 而不是让模型凭印象自己写一段作品介绍（那样很容易编造剧情）。拿不到简介时上层
 * 应该提示用户手写，而不是调用这里。
 *
 * 不接受用户的感想原文作为输入——这里要的是作品客观介绍，把私人记录发出去没必要。
 */
export async function requestAiTagline({ provider, title, originalTitle = null, year = null, summary = "", env = process.env, fetchImpl = fetch }) {
  if (typeof title !== "string" || !title.trim()) throw new Error("invalid_ai_input");
  if (typeof summary !== "string" || !summary.trim()) throw new Error("missing_summary");
  const selected = provider || listAiProviders(env).active;
  const config = providerConfig(selected, env);
  const startedAt = Date.now();
  const input = { title, rawText: summary };
  const options = {
    systemPrompt: AI_TAGLINE_PROMPT,
    schema: AI_TAGLINE_SCHEMA,
    schemaName: "movie_imprint_tagline",
    toolName: "submit_tagline",
    toolDescription: "把这部作品的完整简介压缩成一句话",
    inputText: JSON.stringify({
      title,
      original_title: originalTitle,
      release_year: year,
      summary: summary.slice(0, 4000)
    })
  };
  const result = selected === "gemini"
    ? await callGemini(config, input, fetchImpl, options)
    : selected === "openai"
      ? await callOpenAi(config, input, fetchImpl, options)
      : selected === "anthropic"
        ? await callAnthropic(config, input, fetchImpl, options)
        : await callOpenAiCompatible(config, input, fetchImpl, selected, options);

  let tagline = "";
  try {
    tagline = String(JSON.parse(result.text || "{}")?.tagline || "").trim();
  } catch {
    throw new Error("invalid_ai_output");
  }
  // 超长就当没拿到——宁可让用户自己写，也不给一句被截断的半截话
  if (tagline.length > 60) tagline = "";

  return {
    tagline,
    metadata: {
      provider: selected,
      model: config.model,
      prompt_version: AI_PROMPT_VERSION,
      schema_version: "0.1-tagline",
      duration_ms: Date.now() - startedAt,
      usage: result.usage
    }
  };
}

export async function requestAiRecommendation({ provider, title, rawText, recommendation, presets = [], env = process.env, fetchImpl = fetch }) {
  if (typeof rawText !== "string" || !rawText.trim() || rawText.length > 20000) throw new Error("invalid_ai_input");
  if (!new Set(["yes", "depends", "no"]).has(recommendation)) throw new Error("invalid_recommendation_choice");
  const selected = provider || listAiProviders(env).active;
  const config = providerConfig(selected, env);
  const startedAt = Date.now();
  const input = { title, rawText };
  const options = {
    systemPrompt: AI_RECOMMENDATION_PROMPT,
    schema: AI_RECOMMENDATION_SCHEMA,
    schemaName: "movie_imprint_recommendation_conditions",
    toolName: "submit_recommendation_conditions",
    toolDescription: "提交有原文依据的推荐条件建议",
    inputText: JSON.stringify({
      work_title: title || "未命名的电影",
      raw_impression: rawText,
      user_confirmed_recommendation: recommendation,
      common_presets: Array.isArray(presets) ? presets.slice(0, 30) : []
    })
  };
  const result = selected === "gemini"
    ? await callGemini(config, input, fetchImpl, options)
    : selected === "openai"
      ? await callOpenAi(config, input, fetchImpl, options)
      : selected === "anthropic"
        ? await callAnthropic(config, input, fetchImpl, options)
        : await callOpenAiCompatible(config, input, fetchImpl, selected, options);
  const recommendationDraft = validateAiRecommendation(rawText, recommendation, result.text);
  return {
    recommendation: recommendationDraft,
    metadata: {
      provider: selected,
      model: config.model,
      prompt_version: AI_PROMPT_VERSION,
      schema_version: "0.2-recommendation",
      duration_ms: Date.now() - startedAt,
      usage: result.usage
    }
  };
}
