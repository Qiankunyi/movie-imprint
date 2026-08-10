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
3. 每个态度、情绪和记忆卡片建议都必须附带逐字存在于对应来源文本的短证据，并准确填写 source_type/source_id/source_revision_id/question_id；自由感想的 question_id 用空字符串；source_id 与 source_revision_id 必须从输入里**原样复制**，一个字符都不要改写或缩短。excerpt 要**逐字照抄原文**：不要跨行拼接（原文换行的地方就在换行处截断，或把换行原样保留）、不要改动标点（六个半角点的省略号不要写成中文省略号）、不要增删空格、不要改写措辞。宁可引用一个更短但完全一致的片段。不得把采访问题拼进 excerpt。Evidence 只选择真正支持当前建议的来源：一项建议可以只引用一个来源，也可以引用多个来源；同一记忆在两处均有实质支持时应保留跨来源证据，但不得为了形式平衡强制每张卡同时引用两个来源。
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

/**
 * 证据定位的字符归一化。
 *
 * 为什么需要这一层（线上故障复盘）：
 * 校验要求 evidence.excerpt **逐字**出现在来源文本里，用的是 `text.includes(excerpt)`。
 * 但用户的原文常常是一句一行地写下来的，模型引用时会很自然地把两行接成一句；
 * 再加上 `......`（六个半角点）被规范化成 `……`、`4K 版 IMAX` 里的半角空格被吃掉，
 * 这些**纯格式差异**都会让 includes 失败，整份整理随之作废。
 *
 * 这里归一化的只有「同一段文字的不同书写形式」：
 *   - 各类空白（含换行、全角空格）→ 全部删除
 *   - 省略号 `……` `⋯` `...`（任意长度）→ 统一记号
 *   - 全角英数字与标点 → 半角
 * **不做**繁简转换、不做同义词替换、不做任何语义层面的宽松。
 *
 * 红线没有被动：模型编造的句子归一化之后照样匹配不上，`inventedEvidence` 那条
 * 测试就是守这个的。
 */
// 归一化规则。顺序即优先级，必须整段（run）匹配——按单个字符做替换是不行的：
// `......` 只有作为一个整体才能识别成省略号，逐字看永远只是一个孤立的点。
const NORMALIZE_RULE = /([…⋯]+|\.{2,}|。{3,})|([\s　​﻿]+)|([！-～])|([\s\S])/gu;

/**
 * 归一化，同时记录每个归一化字符对应回原文的区间。
 * @returns {{ normalized: string, starts: number[], ends: number[] }}
 */
function normalizeWithMap(value) {
  const source = String(value ?? "");
  let normalized = "";
  const starts = [];
  const ends = [];
  NORMALIZE_RULE.lastIndex = 0;
  let match;
  while ((match = NORMALIZE_RULE.exec(source)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    let out;
    if (match[1]) out = "…";                                                   // 各种省略号
    else if (match[2]) out = "";                                               // 空白整段删除
    else if (match[3]) out = String.fromCharCode(match[3].charCodeAt(0) - 0xFEE0).toLowerCase(); // 全角→半角
    else out = match[4].toLowerCase();
    for (let k = 0; k < out.length; k += 1) { starts.push(from); ends.push(to); }
    normalized += out;
  }
  return { normalized, starts, ends };
}

function normalizeForMatch(value) {
  return normalizeWithMap(value).normalized;
}

/**
 * 在原文里按归一化结果定位，并取回**原文中真正的那一段字**。
 *
 * 只判断"能不能匹配"是不够的：存进 evidence 的必须是原文里真实存在的文本，
 * 否则用户在记忆卡片里看到的引文会是模型改写过的版本——那等于让 AI 悄悄
 * 替用户重写了自己的话。所以这里靠上面那张区间映射表，命中后把原文的对应
 * 区间原样切出来。
 *
 * @returns {string|null} 原文中对应的实际片段；匹配不上返回 null
 */
function locateExcerptInText(text, excerpt) {
  const source = String(text ?? "");
  if (source.includes(excerpt)) return excerpt;   // 完全一致，直接用

  const { normalized, starts, ends } = normalizeWithMap(source);
  const target = normalizeForMatch(excerpt);
  if (!target) return null;

  const at = normalized.indexOf(target);
  if (at < 0) return null;

  const start = starts[at];
  const end = ends[at + target.length - 1];
  if (start === undefined || end === undefined) return null;
  return source.slice(start, end);
}

/**
 * 定位一条证据的来源。
 *
 * 三级回退，**每一级都要求引文真的存在于某个来源文本里**——这条不退让，
 * 它才是"AI 不许编造"的实际保障。退让的只是「模型自报的来源标识是否可信」：
 *
 *   1. 标识与文本全部对上 —— 最理想
 *   2. 标识对不上，但 source_type 对得上且文本能定位 —— 用文本定位到的来源为准
 *   3. 连 source_type 也对不上，但文本能在某个来源里定位 —— 同样以文本为准
 *
 * 为什么要有 2、3：模型必须原样抄回 `record_xxx_rawrev_2_1786…` 这种四十多字符
 * 的不透明 ID，抄漏一截整条证据就废掉。而这个 ID 本来就是**冗余**的——引文
 * 出自哪个来源，我们自己按文本查得到，而且比模型的自报更可靠。线上那次
 * `evidence_not_in_source` 里，有一半可能就是栽在抄 ID 上。
 *
 * @returns {{ source: object, actual: string, downgraded: boolean }|null}
 */
function locateEvidenceSource(sourceContext, item, excerpt) {
  const match = (source) => {
    const actual = locateExcerptInText(source.text, excerpt);
    return actual === null ? null : { source, actual };
  };

  if (!sourceContext.strict) {
    for (const source of sourceContext.sources) {
      const hit = match(source);
      if (hit) return { ...hit, downgraded: false };
    }
    return null;
  }

  // 1. 标识完全对上
  for (const source of sourceContext.sources) {
    if (source.source_type !== item?.source_type) continue;
    if (source.source_id !== item.source_id) continue;
    if (source.source_revision_id !== item.source_revision_id) continue;
    if (source.question_id !== item.question_id) continue;
    const hit = match(source);
    if (hit) return { ...hit, downgraded: false };
  }
  // 2. source_type 对得上，标识不对
  for (const source of sourceContext.sources) {
    if (source.source_type !== item?.source_type) continue;
    const hit = match(source);
    if (hit) return { ...hit, downgraded: true };
  }
  // 3. 只靠文本定位
  for (const source of sourceContext.sources) {
    const hit = match(source);
    if (hit) return { ...hit, downgraded: true };
  }
  return null;
}

/**
 * 校验一组证据。**不合格的丢掉，不再让整份整理陪葬。**
 *
 * 旧行为是任意一条证据不过关就 throw，于是一条引文多了个换行，整次 AI 整理
 * （态度、情绪、全部记忆卡片）就全部作废，用户点几次都是同一个失败。
 * 现在改成：丢掉有问题的那条，把原因记进 rejected，由调用方决定后果——
 * 卡片丢光证据才连卡片一起丢，态度丢光证据就降为 none。
 *
 * @returns {{ kept: object[], rejected: {index:number, reason:string, excerpt:string}[] }}
 */
function validateEvidence(sourceContext, evidence, name) {
  if (!Array.isArray(evidence)) throw new Error(`invalid_${name}_evidence`);
  const kept = [];
  const rejected = [];
  const downgraded = [];   // 标识没对上、靠文本兜回来的，仅用于统计
  const reject = (index, reason, excerpt = "") => rejected.push({ index, reason, excerpt: String(excerpt).slice(0, 60) });

  for (const [index, item] of evidence.entries()) {
    if (typeof item?.excerpt !== "string" || !item.excerpt.trim() || item.excerpt.length > 240) {
      reject(index, "excerpt 缺失或过长", item?.excerpt);
      continue;
    }
    // 走到这一步还定位不到，就只剩「这句话原文里根本没有」一种可能了——
    // 来源标识抄错已经在 locateEvidenceSource 里按文本兜住。
    const located = locateEvidenceSource(sourceContext, item, item.excerpt);
    if (!located) {
      reject(index, "引文不在原文里", item.excerpt);
      continue;
    }
    if (located.downgraded) downgraded.push(name);
    if (!AI_EVIDENCE_BASIS.includes(item.basis)) { reject(index, "basis 取值非法", item.excerpt); continue; }
    if (!AI_EVIDENCE_VOICES.includes(item.voice)) { reject(index, "voice 取值非法", item.excerpt); continue; }
    if (!AI_CLAIM_MODES.includes(item.claim_mode)) { reject(index, "claim_mode 取值非法", item.excerpt); continue; }
    if (typeof item.explanation !== "string" || item.explanation.length > 240) {
      reject(index, "explanation 缺失或过长", item.excerpt); continue;
    }
    const confidence = Number(item.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      reject(index, "confidence 非法", item.excerpt); continue;
    }
    kept.push({
      ...item,
      // 存回**原文里真实存在的那段字**，而不是模型改写过的版本
      excerpt: located.actual,
      source_type: located.source.source_type,
      source_id: located.source.source_id,
      source_revision_id: located.source.source_revision_id,
      question_id: located.source.question_id,
      confidence
    });
  }
  return { kept, rejected, downgraded };
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

  // 被丢弃的证据统一收在这里，最后并进 warnings 让用户看得见「这次少了什么、为什么」。
  const dropped = [];
  const noteDropped = (where, rejected) => {
    for (const item of rejected) dropped.push(`${where}的一条引用未采用：${item.reason}${item.excerpt ? `（「${item.excerpt}」）` : ""}`);
  };

  const attitudeResult = validateEvidence(sourceContext, attitude.evidence || [], "attitude");
  noteDropped("态度建议", attitudeResult.rejected);
  const attitudeEvidence = attitudeResult.kept;
  // 态度没有任何可用证据就不给建议——绝不保留一个没有出处的判断。
  const attitudeSuggested = attitudeEvidence.length ? attitude.suggested : "none";

  if (!Array.isArray(output.emotions) || output.emotions.length > 7) throw new Error("invalid_emotions");
  // 情绪标签丢光证据就整条丢掉——一个没有出处的情绪标签没有保留价值。
  const emotions = output.emotions.map((emotion, index) => {
    assertString(emotion?.label, `emotion_${index}_label`, 40);
    if (!EMOTION_TAGS.includes(emotion.label.trim())) throw new Error(`invalid_emotion_label:${index}`);
    const confidence = Number(emotion.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_emotion_confidence:${index}`);
    const result = validateEvidence(sourceContext, emotion.evidence, `emotion_${index}`);
    noteDropped(`情绪「${emotion.label.trim()}」`, result.rejected);
    return { label: emotion.label.trim(), evidence: result.kept, confidence };
  }).filter((emotion) => {
    if (emotion.evidence.length) return true;
    dropped.push(`情绪「${emotion.label}」因为没有可用引用被略过`);
    return false;
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
    const evidenceResult = validateEvidence(sourceContext, card.evidence, `card_${index}`);
    noteDropped(`记忆卡片「${card.title.trim()}」`, evidenceResult.rejected);
    if (card.is_core_suggestion && evidenceResult.kept.length) coreSuggestionCount += 1;
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
      evidence: evidenceResult.kept,
      confidence,
      provenance: "ai_suggested",
      origin: "ai_generated",
      status: "draft",
      user_modified: false,
      revision_history: []
    };
  });
  if (coreSuggestionCount > 1) throw new Error("multiple_core_suggestions");

  // 卡片丢光证据就连卡片一起丢：一张没有出处的记忆卡片，正是这个项目最不想要的东西。
  const keptCards = cards.filter((card) => {
    if (card.evidence.length) return true;
    dropped.push(`记忆卡片「${card.title}」因为没有可用引用被略过`);
    return false;
  }).map((card, order) => ({ ...card, order }));

  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_warnings");
  const warnings = output.warnings.map((warning, index) => {
    assertString(warning, `warning_${index}`, 160);
    return warning.trim();
  }).filter(Boolean);

  // 整份一条证据都没留下，说明这次输出根本没对上原文——这时不该假装成功。
  const totalEvidence = attitudeEvidence.length
    + emotions.reduce((sum, emotion) => sum + emotion.evidence.length, 0)
    + keptCards.reduce((sum, card) => sum + card.evidence.length, 0);
  if (!totalEvidence && dropped.length) {
    throw new Error(`evidence_all_rejected: ${dropped[0]}`);
  }

  return {
    analysis_id: createId("analysis"),
    schema_version: AI_SCHEMA_VERSION,
    prompt_version: AI_PROMPT_VERSION,
    source_revision_ids: sourceContext.sources.map((source) => source.source_revision_id),
    attitude: {
      suggested: attitudeSuggested === "none" ? null : attitudeSuggested,
      alternative: attitude.alternative === "none" ? null : attitude.alternative,
      evidence: attitudeEvidence,
      confidence: Number(attitude.confidence)
    },
    emotions,
    memory_cards: keptCards,
    // 被丢弃的引用如实写进 warnings——用户有权知道这次整理少了什么、为什么少
    warnings: [...warnings, ...dropped].slice(0, 12)
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
      evidence: validateEvidence(sourceContext, suggestion.evidence, `recommendation_${index}`).kept,
      confidence,
      status: "pending",
      provenance: "ai_suggested"
    };
  // 推荐理由同样要有出处：丢光证据的建议不保留。
  }).filter((suggestion) => suggestion.evidence.length);
  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_recommendation_warnings");
  return {
    suggestions,
    warnings: output.warnings.map((warning, index) => {
      assertString(warning, `recommendation_warning_${index}`, 160);
      return warning.trim();
    }).filter(Boolean)
  };
}
