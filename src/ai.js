import { CARD_TYPES, createId } from "./domain.js";

export const AI_SCHEMA_VERSION = "0.2";
export const AI_PROMPT_VERSION = "movie-imprint-c3-v2";
export const AI_ATTITUDES = ["dislike", "neutral", "like", "love", "mixed", "none"];
export const AI_EVIDENCE_BASIS = ["explicit", "inferred"];
export const AI_EVIDENCE_VOICES = ["user", "quoted_other", "source_metadata"];
export const AI_CLAIM_MODES = ["direct_feeling", "observation", "interpretation", "reported_statement"];
export const AI_RECOMMENDATION_FIELDS = ["audiences", "reasons", "cautions", "noReasons", "issueTypes", "positives"];

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    excerpt: { type: "string", description: "必须逐字出现在本次原始感想中的短片段" },
    basis: { type: "string", enum: AI_EVIDENCE_BASIS },
    voice: { type: "string", enum: AI_EVIDENCE_VOICES },
    claim_mode: { type: "string", enum: AI_CLAIM_MODES },
    explanation: { type: "string", description: "简短说明这段原文为何支持建议，不补充外部事实" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["excerpt", "basis", "voice", "claim_mode", "explanation", "confidence"]
};

export const AI_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    attitude: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggested: { type: "string", enum: AI_ATTITUDES },
        alternative: { type: "string", enum: AI_ATTITUDES },
        evidence: { type: "array", maxItems: 3, items: evidenceSchema },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["suggested", "alternative", "evidence", "confidence"]
    },
    emotions: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          evidence: { type: "array", minItems: 1, maxItems: 2, items: evidenceSchema },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["label", "evidence", "confidence"]
      }
    },
    memory_cards: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: CARD_TYPES },
          title: { type: "string" },
          content: { type: "string" },
          why_it_matters: { type: "string" },
          is_core_suggestion: { type: "boolean" },
          evidence: { type: "array", minItems: 1, maxItems: 3, items: evidenceSchema },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["type", "title", "content", "why_it_matters", "is_core_suggestion", "evidence", "confidence"]
      }
    },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["attitude", "emotions", "memory_cards", "warnings"]
};

export const AI_RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: AI_RECOMMENDATION_FIELDS },
          value: { type: "string", description: "只整理原文明确支持的推荐条件，不评价或改变用户选择" },
          evidence: { type: "array", minItems: 1, maxItems: 2, items: evidenceSchema },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["field", "value", "evidence", "confidence"]
      }
    },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["suggestions", "warnings"]
};

export const AI_SYSTEM_PROMPT = `你是私人电影感想记录工具的保守结构整理器。只分析用户本次提供的原始感想，不上网，不补充剧情、影史、主创或公共评价，不润色或覆盖原文。

硬规则：
1. 每个态度、情绪和记忆卡片建议都必须附带逐字存在于原文的短证据；没有依据就不生成。
2. 区分用户自己的感受、用户的解释推测、引用或转述的他人说法。不要把转述当作已核实事实。
3. 态度只能建议，不能替用户确认；推荐“会／看对象／不会”完全不在本次输出中推断。
4. 一张记忆卡片只整理一个独立记忆点；不要把多个点压成综合影评，也不要添加原文没有的意义。
5. 原文没有总体态度时 suggested 使用 none；没有备选时 alternative 使用 none；why_it_matters 没有依据时使用空字符串。
6. 态度标准：dislike 是总体排斥；neutral 是没有明显喜欢或排斥；like 是总体愿意记作喜欢；love 是被强烈击中或想长期保留；mixed 只用于喜欢与不喜欢真正彼此交织、前四项都不能概括的情况。
7. 局部遗憾、不满或缺点不会自动把 like／love 降为 mixed。若原文明说“最喜欢”“特别喜欢”“想记很久”等强烈态度，应优先忠实保留；除非原文同时明确否定自己的总体喜欢。
8. 输出必须是符合所给 JSON Schema 的 JSON。`;

export const AI_RECOMMENDATION_PROMPT = `你只负责在用户已经亲自作出推荐选择后，从本次原始感想中整理对应的条件。你绝不能评价、推断、改变或重新输出用户选择的“会／看对象／不会”。

规则：
1. 每条建议必须有逐字存在于原文的短证据；没有依据就不生成。
2. “会”只使用 audiences、reasons、cautions；“看对象”只使用 audiences、reasons、cautions；“不会”只使用 noReasons、issueTypes、positives。
3. value 优先使用输入中给出的常用预设；预设无法忠实表达时才写简短的自定义文字。
4. 不上网，不补充作品事实，不把喜欢等同于推荐，也不把个人不适合说成作品客观有问题。
5. 输出必须符合所给 JSON Schema。`;

function assertString(value, name, maxLength = 500) {
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`invalid_${name}`);
}

function validateEvidence(rawText, evidence, name) {
  if (!Array.isArray(evidence)) throw new Error(`invalid_${name}_evidence`);
  return evidence.map((item, index) => {
    assertString(item?.excerpt, `${name}_excerpt`, 240);
    if (!item.excerpt.trim() || !rawText.includes(item.excerpt)) throw new Error(`evidence_not_in_source:${name}:${index}`);
    if (!AI_EVIDENCE_BASIS.includes(item.basis)) throw new Error(`invalid_${name}_basis`);
    if (!AI_EVIDENCE_VOICES.includes(item.voice)) throw new Error(`invalid_${name}_voice`);
    if (!AI_CLAIM_MODES.includes(item.claim_mode)) throw new Error(`invalid_${name}_claim_mode`);
    assertString(item.explanation, `${name}_explanation`, 240);
    const confidence = Number(item.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_${name}_confidence`);
    return { ...item, confidence };
  });
}

export function parseProviderJson(value) {
  if (typeof value === "object" && value) return value;
  if (typeof value !== "string") throw new Error("empty_ai_response");
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!trimmed) throw new Error("empty_ai_response");
  return JSON.parse(trimmed);
}

export function validateAiAnalysis(rawText, value) {
  const output = parseProviderJson(value);
  if (!output || typeof output !== "object") throw new Error("invalid_ai_output");
  const attitude = output.attitude || {};
  if (!AI_ATTITUDES.includes(attitude.suggested) || !AI_ATTITUDES.includes(attitude.alternative)) throw new Error("invalid_attitude");
  const attitudeEvidence = validateEvidence(rawText, attitude.evidence || [], "attitude");
  if (attitude.suggested !== "none" && !attitudeEvidence.length) throw new Error("attitude_without_evidence");

  if (!Array.isArray(output.emotions) || output.emotions.length > 7) throw new Error("invalid_emotions");
  const emotions = output.emotions.map((emotion, index) => {
    assertString(emotion?.label, `emotion_${index}_label`, 40);
    if (!emotion.label.trim()) throw new Error("empty_emotion_label");
    return {
      label: emotion.label.trim(),
      evidence: validateEvidence(rawText, emotion.evidence, `emotion_${index}`),
      confidence: Number(emotion.confidence)
    };
  });

  if (!Array.isArray(output.memory_cards) || output.memory_cards.length > 7) throw new Error("invalid_memory_cards");
  const cards = output.memory_cards.map((card, index) => {
    if (!CARD_TYPES.includes(card?.type)) throw new Error(`invalid_card_type:${index}`);
    assertString(card.title, `card_${index}_title`, 80);
    assertString(card.content, `card_${index}_content`, 600);
    assertString(card.why_it_matters, `card_${index}_why`, 300);
    if (!card.content.trim()) throw new Error(`empty_card:${index}`);
    return {
      card_id: createId("card"),
      type: card.type,
      title: card.title.trim(),
      content: card.content.trim(),
      why_it_matters: card.why_it_matters.trim() || null,
      is_core: Boolean(card.is_core_suggestion),
      order: index,
      evidence: validateEvidence(rawText, card.evidence, `card_${index}`),
      confidence: Number(card.confidence),
      provenance: "ai_suggested"
    };
  });

  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_warnings");
  const warnings = output.warnings.map((warning, index) => {
    assertString(warning, `warning_${index}`, 160);
    return warning.trim();
  }).filter(Boolean);

  return {
    schema_version: AI_SCHEMA_VERSION,
    attitude: {
      suggested: attitude.suggested === "none" ? null : attitude.suggested,
      alternative: attitude.alternative === "none" ? null : attitude.alternative,
      evidence: attitudeEvidence,
      confidence: Number(attitude.confidence)
    },
    emotions,
    memory_cards: cards,
    warnings
  };
}

export function validateAiRecommendation(rawText, recommendation, value) {
  const output = parseProviderJson(value);
  const allowedByChoice = recommendation === "no"
    ? new Set(["noReasons", "issueTypes", "positives"])
    : new Set(["audiences", "reasons", "cautions"]);
  if (!new Set(["yes", "depends", "no"]).has(recommendation)) throw new Error("invalid_recommendation_choice");
  if (!Array.isArray(output?.suggestions) || output.suggestions.length > 12) throw new Error("invalid_recommendation_suggestions");
  const seen = new Set();
  const suggestions = output.suggestions.map((suggestion, index) => {
    if (!AI_RECOMMENDATION_FIELDS.includes(suggestion?.field) || !allowedByChoice.has(suggestion.field)) {
      throw new Error(`invalid_recommendation_field:${index}`);
    }
    assertString(suggestion.value, `recommendation_${index}_value`, 100);
    const normalizedValue = suggestion.value.trim();
    if (!normalizedValue) throw new Error(`empty_recommendation_value:${index}`);
    const key = `${suggestion.field}:${normalizedValue}`;
    if (seen.has(key)) throw new Error(`duplicate_recommendation_value:${index}`);
    seen.add(key);
    const confidence = Number(suggestion.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_recommendation_confidence:${index}`);
    return {
      suggestion_id: createId("recommendation"),
      field: suggestion.field,
      value: normalizedValue,
      evidence: validateEvidence(rawText, suggestion.evidence, `recommendation_${index}`),
      confidence,
      status: "pending",
      provenance: "ai_suggested"
    };
  });
  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_recommendation_warnings");
  return {
    suggestions,
    warnings: output.warnings.map((warning, index) => {
      assertString(warning, `recommendation_warning_${index}`, 160);
      return warning.trim();
    }).filter(Boolean)
  };
}
