import { CARD_TYPES, EMOTION_TAGS, createId } from "./domain.js";

export const AI_SCHEMA_VERSION = "2.1";
export const AI_PROMPT_VERSION = "movie-imprint-v2.1-p0.2";
export const AI_ATTITUDES = ["dislike", "neutral", "like", "love", "mixed", "none"];
export const AI_EVIDENCE_BASIS = ["explicit", "inferred"];
export const AI_EVIDENCE_VOICES = ["user", "quoted_other", "source_metadata"];
export const AI_CLAIM_MODES = ["direct_feeling", "observation", "interpretation", "reported_statement"];
export const AI_RECOMMENDATION_FIELDS = ["audiences", "reasons", "cautions", "noReasons", "issueTypes", "positives"];

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    source_type: { type: "string", enum: ["free_reflection", "self_interview"] },
    source_id: { type: "string" },
    source_revision_id: { type: "string" },
    question_id: { type: "string", description: "采访证据填写 question_id；自由感想证据使用空字符串" },
    excerpt: { type: "string", description: "必须逐字出现在本次原始感想中的短片段" },
    basis: { type: "string", enum: AI_EVIDENCE_BASIS },
    voice: { type: "string", enum: AI_EVIDENCE_VOICES },
    claim_mode: { type: "string", enum: AI_CLAIM_MODES },
    explanation: { type: "string", description: "简短说明这段原文为何支持建议，不补充外部事实" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["source_type", "source_id", "source_revision_id", "question_id", "excerpt", "basis", "voice", "claim_mode", "explanation", "confidence"]
};

const recommendationEvidenceSchema = {
  ...evidenceSchema,
  properties: Object.fromEntries(Object.entries(evidenceSchema.properties)
    .filter(([key]) => !["source_type", "source_id", "source_revision_id", "question_id"].includes(key))),
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
          label: { type: "string", enum: EMOTION_TAGS },
          evidence: { type: "array", minItems: 1, maxItems: 2, items: evidenceSchema },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["label", "evidence", "confidence"]
      }
    },
    memory_cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          temporary_id: { type: "string" },
          memory_cluster_id: { type: "string" },
          type: { type: "string", enum: CARD_TYPES },
          title: { type: "string" },
          content: { type: "string" },
          why_it_matters: { type: "string" },
          related_emotion_tag_ids: { type: "array", items: { type: "string", enum: EMOTION_TAGS } },
          is_core_suggestion: { type: "boolean" },
          evidence: { type: "array", minItems: 1, maxItems: 3, items: evidenceSchema },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["temporary_id", "memory_cluster_id", "type", "title", "content", "why_it_matters", "related_emotion_tag_ids", "is_core_suggestion", "evidence", "confidence"]
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
          evidence: { type: "array", minItems: 1, maxItems: 2, items: recommendationEvidenceSchema },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["field", "value", "evidence", "confidence"]
      }
    },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["suggestions", "warnings"]
};

export const AI_SYSTEM_PROMPT = `你是私人电影记忆的保守整理器。只分析输入中的“自由感想”和“自我采访回答”，不上网，不补充剧情、影史、主创或公共评价，不润色或覆盖用户原话。采访问题只是语义上下文，不是用户说过的 Evidence。

硬规则：
1. 先分别完整阅读自由感想与自我采访回答，再提取真正值得长期留下的候选记忆，并跨来源聚类；判断同一记忆应合并还是独立维度应拆分；达到卡片化门槛后才选择最合适类型并生成。自由感想与自我采访是并列的用户原始输入；自我采访只是补充来源，不具有高于自由感想的默认优先级。不得因为采访问题更结构化、回答更短或更易引用，就忽略自由感想中的独立有效记忆。绝不能遍历类型来凑内容，也不能一问生成一张卡。
2. 卡片化至少需要一种强信号：用户明确强调、跨来源重复、明显情绪、解释了为什么在意，或明显个人性／人生联想／现场记忆。普通剧情复述、公共元数据、未认同的他人观点和单纯低信息情绪不得为了数量卡片化。允许 memory_cards 为空数组。
3. 每个态度、情绪和记忆卡片建议都必须附带逐字存在于对应来源文本的短证据，并准确填写 source_type/source_id/source_revision_id/question_id；自由感想的 question_id 用空字符串。不得把采访问题拼进 excerpt。Evidence 只选择真正支持当前建议的来源：一项建议可以只引用一个来源，也可以引用多个来源；同一记忆在两处均有实质支持时应保留跨来源证据，但不得为了形式平衡强制每张卡同时引用两个来源。
4. 区分用户自己的感受、用户的解释推测、引用或转述的他人说法；保留“好像／可能／我记得”等不确定性，不得升级成确定事实。凡是由“朋友说／有人认为／评论说／他或她觉得”等主体引出的内容，即使逐字出现在用户输入中，Evidence 也必须标记 voice=quoted_other、claim_mode=reported_statement；不得因为 source_type 是 free_reflection 或 self_interview 就误标成 user。若卡片不需要这段他人说法，宁可不引用。
5. 态度只能建议，不能替用户确认；推荐“会／看对象／不会”完全不在本次输出中推断。情绪必须映射到给定的46项枚举。
6. 一张卡片只整理一个独立记忆点。同一对象和同一原因、同一因果链或跨来源重复表达优先合并；表演与配乐、方向不同且各有证据的情绪、作品内容与个人联想等独立长期记忆应拆分。
7. 先发现记忆再分类。类型选择回答“用户究竟为什么记住它”，不根据表面关键词机械选择。
8. 卡片文字应像更有条理的用户本人，避免“极具张力、命运的齿轮、深刻探讨、展现了复杂而细腻”等模板化影评腔。
9. 原始资料没有总体态度时 suggested 使用 none；没有备选时 alternative 使用 none；why_it_matters 没有充分依据时使用空字符串。最多建议一张核心记忆，也可以不建议核心。
10. 态度标准：dislike 是总体排斥；neutral 是没有明显喜欢或排斥；like 是总体愿意记作喜欢；love 是被强烈击中或想长期保留；mixed 只用于喜欢与不喜欢真正彼此交织、前四项都不能概括的情况。局部遗憾不会自动把 like／love 降为 mixed。
11. 输出必须是符合所给 JSON Schema 的 JSON，不输出推理过程。`;

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

function normalizeAnalysisSources(value) {
  if (typeof value === "string") {
    return {
      strict: false,
      sources: [{
        source_type: "free_reflection",
        source_id: "legacy_free_reflection",
        source_revision_id: "legacy_revision",
        question_id: "",
        text: value
      }]
    };
  }
  const free = value?.free_reflection;
  const answers = Array.isArray(value?.self_interview?.answers) ? value.self_interview.answers : [];
  const sources = [];
  if (free && typeof free.text === "string") {
    sources.push({
      source_type: "free_reflection",
      source_id: String(free.source_id || ""),
      source_revision_id: String(free.source_revision_id || ""),
      question_id: "",
      text: free.text
    });
  }
  for (const answer of answers) {
    if (typeof answer?.text !== "string" || !answer.text.trim()) continue;
    sources.push({
      source_type: "self_interview",
      source_id: String(answer.source_id || ""),
      source_revision_id: String(answer.source_revision_id || ""),
      question_id: String(answer.question_id || ""),
      text: answer.text
    });
  }
  return { strict: true, sources };
}

function locateEvidenceSource(sourceContext, item, excerpt) {
  if (sourceContext.strict) {
    if (!new Set(["free_reflection", "self_interview"]).has(item?.source_type)) return null;
    if (typeof item.source_id !== "string" || !item.source_id) return null;
    if (typeof item.source_revision_id !== "string" || !item.source_revision_id) return null;
    if (typeof item.question_id !== "string") return null;
    return sourceContext.sources.find((source) => source.source_type === item.source_type
      && source.source_id === item.source_id
      && source.source_revision_id === item.source_revision_id
      && source.question_id === item.question_id
      && source.text.includes(excerpt)) || null;
  }
  return sourceContext.sources.find((source) => source.text.includes(excerpt)) || null;
}

function validateEvidence(sourceContext, evidence, name) {
  if (!Array.isArray(evidence)) throw new Error(`invalid_${name}_evidence`);
  return evidence.map((item, index) => {
    assertString(item?.excerpt, `${name}_excerpt`, 240);
    const source = item.excerpt.trim() ? locateEvidenceSource(sourceContext, item, item.excerpt) : null;
    if (!source) throw new Error(`evidence_not_in_source:${name}:${index}`);
    if (!AI_EVIDENCE_BASIS.includes(item.basis)) throw new Error(`invalid_${name}_basis`);
    if (!AI_EVIDENCE_VOICES.includes(item.voice)) throw new Error(`invalid_${name}_voice`);
    if (!AI_CLAIM_MODES.includes(item.claim_mode)) throw new Error(`invalid_${name}_claim_mode`);
    assertString(item.explanation, `${name}_explanation`, 240);
    const confidence = Number(item.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_${name}_confidence`);
    return {
      ...item,
      source_type: source.source_type,
      source_id: source.source_id,
      source_revision_id: source.source_revision_id,
      question_id: source.question_id,
      confidence
    };
  });
}

export function parseProviderJson(value) {
  if (typeof value === "object" && value) return value;
  if (typeof value !== "string") throw new Error("empty_ai_response");
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!trimmed) throw new Error("empty_ai_response");
  return JSON.parse(trimmed);
}

export function validateAiAnalysis(sourceInput, value) {
  const sourceContext = normalizeAnalysisSources(sourceInput);
  if (!sourceContext.sources.some((source) => source.text.trim())) throw new Error("invalid_ai_input");
  const output = parseProviderJson(value);
  if (!output || typeof output !== "object") throw new Error("invalid_ai_output");
  const attitude = output.attitude || {};
  if (!AI_ATTITUDES.includes(attitude.suggested) || !AI_ATTITUDES.includes(attitude.alternative)) throw new Error("invalid_attitude");
  const attitudeEvidence = validateEvidence(sourceContext, attitude.evidence || [], "attitude");
  if (attitude.suggested !== "none" && !attitudeEvidence.length) throw new Error("attitude_without_evidence");

  if (!Array.isArray(output.emotions) || output.emotions.length > 7) throw new Error("invalid_emotions");
  const emotions = output.emotions.map((emotion, index) => {
    assertString(emotion?.label, `emotion_${index}_label`, 40);
    if (!EMOTION_TAGS.includes(emotion.label.trim())) throw new Error(`invalid_emotion_label:${index}`);
    const confidence = Number(emotion.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_emotion_confidence:${index}`);
    return {
      label: emotion.label.trim(),
      evidence: validateEvidence(sourceContext, emotion.evidence, `emotion_${index}`),
      confidence
    };
  });

  if (!Array.isArray(output.memory_cards)) throw new Error("invalid_memory_cards");
  let coreSuggestionCount = 0;
  const cards = output.memory_cards.map((card, index) => {
    if (!CARD_TYPES.includes(card?.type)) throw new Error(`invalid_card_type:${index}`);
    assertString(card.title, `card_${index}_title`, 80);
    assertString(card.content, `card_${index}_content`, 600);
    assertString(card.why_it_matters, `card_${index}_why`, 300);
    if (!card.content.trim()) throw new Error(`empty_card:${index}`);
    const temporaryId = sourceContext.strict ? card.temporary_id : (card.temporary_id || `memory_${index + 1}`);
    const clusterId = sourceContext.strict ? card.memory_cluster_id : (card.memory_cluster_id || `cluster_${index + 1}`);
    assertString(temporaryId, `card_${index}_temporary_id`, 100);
    assertString(clusterId, `card_${index}_cluster_id`, 100);
    if (!temporaryId.trim() || !clusterId.trim()) throw new Error(`invalid_card_identity:${index}`);
    const relatedEmotions = Array.isArray(card.related_emotion_tag_ids) ? card.related_emotion_tag_ids : [];
    if (relatedEmotions.some((label) => !EMOTION_TAGS.includes(label))) throw new Error(`invalid_card_emotions:${index}`);
    const confidence = Number(card.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_card_confidence:${index}`);
    if (card.is_core_suggestion) coreSuggestionCount += 1;
    return {
      temporary_id: temporaryId.trim(),
      memory_cluster_id: clusterId.trim(),
      card_id: temporaryId.trim(),
      type: card.type,
      title: card.title.trim(),
      content: card.content.trim(),
      why_it_matters: card.why_it_matters.trim() || null,
      related_emotions: relatedEmotions,
      is_core: Boolean(card.is_core_suggestion),
      order: index,
      evidence: validateEvidence(sourceContext, card.evidence, `card_${index}`),
      confidence,
      provenance: "ai_suggested",
      origin: "ai_generated",
      status: "draft",
      user_modified: false,
      revision_history: []
    };
  });
  if (coreSuggestionCount > 1) throw new Error("multiple_core_suggestions");

  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_warnings");
  const warnings = output.warnings.map((warning, index) => {
    assertString(warning, `warning_${index}`, 160);
    return warning.trim();
  }).filter(Boolean);

  return {
    analysis_id: createId("analysis"),
    schema_version: AI_SCHEMA_VERSION,
    prompt_version: AI_PROMPT_VERSION,
    source_revision_ids: sourceContext.sources.map((source) => source.source_revision_id),
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
  const sourceContext = normalizeAnalysisSources(rawText);
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
      evidence: validateEvidence(sourceContext, suggestion.evidence, `recommendation_${index}`),
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
