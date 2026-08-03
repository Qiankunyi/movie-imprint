import {
  AI_ANALYSIS_SCHEMA,
  AI_PROMPT_VERSION,
  AI_RECOMMENDATION_PROMPT,
  AI_RECOMMENDATION_SCHEMA,
  AI_SYSTEM_PROMPT,
  validateAiAnalysis,
  validateAiRecommendation
} from "./ai.js";

export const AI_PROVIDERS = {
  gemini: { label: "Gemini", keyName: "GEMINI_API_KEY", modelName: "GEMINI_MODEL", defaultModel: "gemini-2.0-flash-lite" },
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

function userPayload({ title, rawText }) {
  return JSON.stringify({ work_title: title || "未命名的电影", raw_impression: rawText });
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
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
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
      max_tokens: 4096,
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
    max_tokens: 4096,
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

export async function requestAiAnalysis({ provider, title, rawText, env = process.env, fetchImpl = fetch }) {
  if (typeof rawText !== "string" || !rawText.trim() || rawText.length > 20000) throw new Error("invalid_ai_input");
  const selected = provider || listAiProviders(env).active;
  const config = providerConfig(selected, env);
  const startedAt = Date.now();
  const result = selected === "gemini"
    ? await callGemini(config, { title, rawText }, fetchImpl)
    : selected === "openai"
      ? await callOpenAi(config, { title, rawText }, fetchImpl)
      : selected === "anthropic"
        ? await callAnthropic(config, { title, rawText }, fetchImpl)
        : await callOpenAiCompatible(config, { title, rawText }, fetchImpl, selected);
  const analysis = validateAiAnalysis(rawText, result.text);
  return {
    analysis,
    metadata: {
      provider: selected,
      model: config.model,
      prompt_version: AI_PROMPT_VERSION,
      schema_version: analysis.schema_version,
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
