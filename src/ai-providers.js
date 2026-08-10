import {
  AI_ANALYSIS_SCHEMA,
  AI_PROMPT_VERSION,
  AI_RECOMMENDATION_PROMPT,
  AI_RECOMMENDATION_SCHEMA,
  AI_SYSTEM_PROMPT,
  validateAiAnalysis,
  validateAiRecommendation
} from "./ai.js";
import { SELF_INTERVIEW_QUESTIONS } from "./self-interview.js";

export const AI_PROVIDERS = {
  // gemini-2.0-flash-lite 已被 Google 下线（2026-08 实测报错 HTTP 404 "no longer available"）。
  // 换成同一档位（flash-lite，便宜/快，适合这种结构化整理任务）里目前仍在正常服务的
  // gemini-3.5-flash-lite。仍然走 generateContent 端点（该端点本身尚未下线，只是模型
  // 名字过期了），没有切到 Google 新推的 Interactions API——那是请求/响应结构完全不同的
  // 另一套契约，为了修一个模型名过期的问题去重写整个请求契约，风险和改动量不成比例。
  gemini: { label: "Gemini", keyName: "GEMINI_API_KEY", modelName: "GEMINI_MODEL", defaultModel: "gemini-3.5-flash-lite" },
  openai: { label: "ChatGPT / OpenAI", keyName: "OPENAI_API_KEY", modelName: "OPENAI_MODEL", defaultModel: "gpt-5.6-sol" },
  anthropic: { label: "Claude", keyName: "ANTHROPIC_API_KEY", modelName: "ANTHROPIC_MODEL", defaultModel: "claude-sonnet-4-6" },
  deepseek: { label: "DeepSeek", keyName: "DEEPSEEK_API_KEY", modelName: "DEEPSEEK_MODEL", defaultModel: "deepseek-v4-flash" },
  kimi: { label: "Kimi", keyName: "MOONSHOT_API_KEY", modelName: "MOONSHOT_MODEL", defaultModel: "kimi-k3" }
};

function providerConfig(provider, env) {
  const definition = AI_PROVIDERS[provider];
  if (!definition) throw new Error("unsupported_ai_provider");
  const apiKey = env[definition.keyName]?.trim();
  if (!apiKey) throw new Error("ai_provider_not_configured");
  return { ...definition, apiKey, model: env[definition.modelName]?.trim() || definition.defaultModel };
}

export function listAiProviders(env = process.env) {
  const preferred = env.AI_PROVIDER?.trim().toLowerCase();
  const providers = Object.entries(AI_PROVIDERS).map(([id, definition]) => ({
    id,
    label: definition.label,
    configured: Boolean(env[definition.keyName]?.trim()),
    model: env[definition.modelName]?.trim() || definition.defaultModel
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
        // gemini-3.5-flash-lite 不支持自定义 temperature/top-K/top-P：现在传了会被静默忽略，
        // 官方文档说未来的模型世代会直接报 400。索性不传——本来靠的也是 AI_SYSTEM_PROMPT
        // 里那组"硬规则"（逐字证据、态度判定标准等）来保证输出保守/一致，不依赖 temperature。
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

export async function requestAiAnalysis({ provider, title, rawText, sources, env = process.env, fetchImpl = fetch }) {
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
  const config = providerConfig(selected, env);
  const startedAt = Date.now();
  const input = { title, sources: normalizedSources };
  const result = selected === "gemini"
    ? await callGemini(config, input, fetchImpl)
    : selected === "openai"
      ? await callOpenAi(config, input, fetchImpl)
      : selected === "anthropic"
        ? await callAnthropic(config, input, fetchImpl)
        : await callOpenAiCompatible(config, input, fetchImpl, selected);
  const analysis = validateAiAnalysis(sources ? normalizedSources : rawText, result.text);
  return {
    analysis,
    metadata: {
      provider: selected,
      model: config.model,
      prompt_version: AI_PROMPT_VERSION,
      schema_version: analysis.schema_version,
      duration_ms: Date.now() - startedAt,
      usage: result.usage,
      source_character_counts: sourceCounts,
      evidence_source_counts: evidenceSourceCounts(analysis),
      model_response_characters: typeof result.text === "string" ? result.text.length : null
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
