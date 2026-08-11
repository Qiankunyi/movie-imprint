import { CARD_TYPES, EMOTION_TAGS, createId } from "./domain.js";

export const AI_SCHEMA_VERSION = "2.1";
export const AI_PROMPT_VERSION = "movie-imprint-v2.1-p0.3";
export const AI_ATTITUDES = ["dislike", "neutral", "like", "love", "mixed", "none"];
export const AI_EVIDENCE_BASIS = ["explicit", "inferred"];
export const AI_EVIDENCE_VOICES = ["user", "quoted_other", "source_metadata"];
export const AI_CLAIM_MODES = ["direct_feeling", "observation", "interpretation", "reported_statement"];
export const AI_RECOMMENDATION_FIELDS = ["audiences", "reasons", "cautions", "noReasons", "issueTypes", "positives"];

export const AI_EVIDENCE_SCHEMA = {
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
  ...AI_EVIDENCE_SCHEMA,
  properties: Object.fromEntries(Object.entries(AI_EVIDENCE_SCHEMA.properties)
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
        evidence: { type: "array", maxItems: 3, items: AI_EVIDENCE_SCHEMA },
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
          evidence: { type: "array", minItems: 1, maxItems: 2, items: AI_EVIDENCE_SCHEMA },
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
          evidence: { type: "array", minItems: 1, maxItems: 3, items: AI_EVIDENCE_SCHEMA },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["temporary_id", "memory_cluster_id", "type", "title", "content", "why_it_matters", "related_emotion_tag_ids", "is_core_suggestion", "evidence", "confidence"]
      }
    },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["attitude", "emotions", "memory_cards", "warnings"]
};

// 高密度输入先做一次“候选发现”。这不是给用户看的推理过程，只是一份可验证的
// 覆盖清单：每个输入片段必须明确进入候选，或明确标记为未达到卡片化门槛。
export const AI_MEMORY_DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidate_memories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidate_id: { type: "string" },
          summary: { type: "string" },
          why_it_matters: { type: "string" },
          evidence: { type: "array", minItems: 1, maxItems: 3, items: AI_EVIDENCE_SCHEMA },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["candidate_id", "summary", "why_it_matters", "evidence", "confidence"]
      }
    },
    unit_coverage: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          unit_id: { type: "string" },
          outcome: { type: "string", enum: ["candidate", "discarded"] },
          candidate_ids: { type: "array", items: { type: "string" } },
          reason: { type: "string" }
        },
        required: ["unit_id", "outcome", "candidate_ids", "reason"]
      }
    },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["candidate_memories", "unit_coverage", "warnings"]
};

export const AI_MEMORY_CLUSTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memory_clusters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          memory_cluster_id: { type: "string" },
          candidate_ids: { type: "array", minItems: 1, items: { type: "string" } },
          organizing_summary: { type: "string" },
          card_focus: { type: "string" },
          why_it_matters: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["memory_cluster_id", "candidate_ids", "organizing_summary", "card_focus", "why_it_matters", "confidence"]
      }
    },
    discarded_candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidate_id: { type: "string" },
          reason: { type: "string" }
        },
        required: ["candidate_id", "reason"]
      }
    },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["memory_clusters", "discarded_candidates", "warnings"]
};

const coveredCardSchema = {
  ...AI_ANALYSIS_SCHEMA.properties.memory_cards.items,
  properties: {
    ...AI_ANALYSIS_SCHEMA.properties.memory_cards.items.properties,
    candidate_ids: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
      description: "这张卡片覆盖的候选记忆 ID；每个候选必须且只能出现在一张卡片中"
    }
  },
  required: [...AI_ANALYSIS_SCHEMA.properties.memory_cards.items.required, "candidate_ids"]
};

export const AI_COVERED_ANALYSIS_SCHEMA = {
  ...AI_ANALYSIS_SCHEMA,
  properties: {
    ...AI_ANALYSIS_SCHEMA.properties,
    memory_cards: { type: "array", items: coveredCardSchema }
  }
};

export const AI_CARD_QUALITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memory_cards: { type: "array", items: coveredCardSchema },
    warnings: { type: "array", maxItems: 5, items: { type: "string" } }
  },
  required: ["memory_cards", "warnings"]
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

export const AI_MEMORY_DISCOVERY_PROMPT = `你负责私人电影记忆整理的第一阶段：完整发现候选记忆。输入已经被无损拆成带 unit_id 的原始片段；片段文字仍然是用户原话。

硬规则：
1. 必须逐一检查每个 source_unit，并让每个 unit_id 在 unit_coverage 中恰好出现一次。不得因为片段很多就只处理最显眼的前几条，也不得只处理输入开头或结尾。
2. 先发现“用户为什么会长期记住它”，再建立候选。至少有一种强信号才进入 candidate_memories：明确强调、明显情绪、解释为什么在意、个人联想／人生联想／现场记忆，或多个片段共同支持同一记忆。
3. 普通剧情复述、公共元数据、低信息量感叹、用户未认同的他人观点可以 discarded。reason 只写简短的产品判断，不输出思维过程。
4. 相同对象与相同原因、同一因果链、重复表达优先合并成一个候选；同一场景中的独立维度、方向不同的情绪、作品内容与个人联想应拆成独立候选。一个 unit 可以支持多个候选，多个 unit 也可以支持同一候选。
5. 不为数量制造候选，也不因为候选已经很多就提高门槛。候选数量只由独立且达到门槛的真实内容决定。
6. candidate_id 使用本批次内唯一的 candidate_1、candidate_2……；summary 像更有条理的用户本人，不写影评腔，不补充外部事实；why_it_matters 无原文依据时使用空字符串。
7. 每个候选必须有逐字存在于原始片段的 Evidence。source_type/source_id/source_revision_id/question_id 从输入原样复制；excerpt 不得改写、跨行拼接或混入采访问题。
8. unit_coverage 的 outcome=candidate 时 candidate_ids 至少一个且都真实存在；outcome=discarded 时 candidate_ids 必须为空数组并给出简短 reason。
9. 只输出符合 JSON Schema 的结构化结果，不输出私有推理过程。`;

export const AI_MEMORY_CLUSTER_PROMPT = `你负责私人电影记忆整理的第二阶段：把已经完整打捞出的候选内容进行全局规整。目标不是把每条碎片变成卡片，而是像把散落物品归位一样，让用户清楚看见自己的记忆脉络。

硬规则：
1. 必须全局比较每个 candidate。每个 candidate_id 必须且只能出现一次：要么进入一个 memory_cluster，要么进入 discarded_candidates 并给出明确的卡片化门槛理由；不得静默遗漏。
2. 围绕“用户为什么记住它”聚类，而不是按人物名、关键词或卡片类型机械分组。同一对象与同一原因、同一情感弧、前后构成补偿／转变／因果链、同一段关系带来的多次表达，应合并成一条更完整清晰的记忆。
3. 不要把仅仅同属某人物或同属搞笑片段、情怀片段的无关内容装进宽泛大杂烩。作品内容与个人联想、同场景中的表演与配乐、方向不同且各有依据的情绪，应保持独立。
3a. 每个 cluster 必须能用一个主要记忆原因和一个清晰 card_focus 说完。仅仅都围绕同一主角，不足以合并：亲人离世带来的重看变化、爱情／友情上的牺牲、用户对自己现实关系的渴望、观影后的元反思，通常是不同记忆。若 organizing_summary 需要不断使用“以及／同时／不仅……也……”串联不同意义，应拆分。
3b. 聚类后逐簇检查 Evidence 是否能在最多三条短引用内支持卡片的主要内容与 why_it_matters；若需要更多互不相干的引用才能解释，说明聚类过宽，应拆分。多条候选确实构成同一连续情感弧时不机械拆开。
4. 本阶段正式执行卡片化门槛。普通剧情复述、公共元数据、孤立且低信息量的笑点或台词可以丢弃；但明确情绪、重看后的变化、价值判断、关系意义、个人经历／渴望／人生联想不得因为候选很多而被忽略。
5. organizing_summary 说明整理后这一簇完整留下了什么；card_focus 说明应以什么角度写成一张卡。文字像更有条理的用户本人，不使用模板化影评腔，不补充外部事实。
6. why_it_matters 只依据候选和原始资料；没有充分依据时用空字符串。memory_cluster_id 使用 cluster_1、cluster_2……且唯一。
7. 数量没有上限也没有下限。既不能一条候选一张卡，也不能为了简洁只留最重要的几条。完整性、独立性和真实门槛同时优先。
8. 只输出符合 JSON Schema 的结构化结果，不输出私有推理过程。`;

export const AI_COVERED_SYSTEM_PROMPT = `${AI_SYSTEM_PROMPT}

本次输入额外包含已经逐片段审计并完成全局规整的 approved_memory_clusters。请完成第三阶段：为每个已批准记忆簇选择类型并写成高质量卡片。

覆盖规则：
1. approved_memory_clusters 中每个 memory_cluster_id 必须生成且只生成一张 memory_card；memory_card 的 memory_cluster_id 与 candidate_ids 必须逐字复制对应簇，不得静默遗漏、拆开或重新聚类。
2. 第二阶段已经完成合并／拆分与门槛判断。这里专注于把 organizing_summary、card_focus、原始 sources 和候选 Evidence 写成清晰、有条理、读完能产生新整理感的卡片，不要退回逐条摘抄。
3. 不得因为记忆簇很多、输出较长或只想保留“最重要的几张”而再次淘汰。卡片没有产品级数量上限。
4. temporary_id 在本次输出中必须唯一；memory_cluster_id 使用对应簇的原值。
5. 卡片的事实、感受和意义必须由原始 sources 与候选 Evidence 支持。organizing_summary 只是整理线索，不是新的用户原话；Evidence 仍必须逐字引用原始 sources。
6. 若 approved_memory_clusters 为空，memory_cards 必须为空；不得制造卡片。
7. 输出前自检每个 cluster 是否恰好生成一张卡、candidate_ids 是否与簇完全一致，但不要输出检查过程。`;

export const AI_CARD_QUALITY_PROMPT = `你是私人电影记忆卡片的最终质量编辑。输入包含用户原始 sources、已批准的 memory_clusters 和上一阶段 draft_memory_cards。你只负责校对并重写卡片，不新增、删除、合并或拆分记忆簇。

质量规则：
1. 每个 memory_cluster_id 必须且只能保留一张卡；candidate_ids、memory_cluster_id 必须与对应 approved cluster 完全一致。
2. 逐句核对 title、content、why_it_matters。只保留原始 sources 或候选 Evidence 能支持的事实、感受、关系和意义；删除来源没有出现的地点、动作背景、剧情因果、角色经历与公共知识。不得用模型记忆补全电影。
3. 卡片应让碎片变得清晰：围绕 cluster 的一个 card_focus，把相关片段整理成一条有开头、变化或落点的完整记忆；不要只是罗列引用，也不要写成概括整部电影的宽泛总结。
4. 忠实保留用户的主观强度、口语个性、重看变化和不确定性。避免“崇高、宿命、命运、深层、极大、经典悲剧、自我救赎、情感内核”等原文没有的影评腔或价值升级。
5. 作品内容与用户个人联想只能在 cluster 已明确把它们视为同一因果记忆时连接；不得擅自把多个独立感受写成一个宏大人生结论。
6. why_it_matters 没有明确依据时使用空字符串；有依据时写用户为什么在意，不写作品客观价值判断。
7. Evidence 逐字引用原始 sources，最多三条；最多一张卡 is_core_suggestion=true，也可以没有。
8. 只输出符合 JSON Schema 的 memory_cards 与 warnings，不输出校对过程。`;

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

export function validateMemoryDiscovery(sourceInput, sourceUnits, value) {
  const sourceContext = normalizeAnalysisSources(sourceInput);
  const output = parseProviderJson(value);
  if (!output || typeof output !== "object") throw new Error("invalid_memory_discovery");
  if (!Array.isArray(sourceUnits) || !sourceUnits.length) throw new Error("invalid_memory_discovery_units");
  if (!Array.isArray(output.candidate_memories)) throw new Error("invalid_memory_candidates");

  const candidateIds = new Set();
  const candidateMemories = output.candidate_memories.map((candidate, index) => {
    assertString(candidate?.candidate_id, `candidate_${index}_id`, 100);
    assertString(candidate?.summary, `candidate_${index}_summary`, 240);
    assertString(candidate?.why_it_matters, `candidate_${index}_why`, 300);
    const candidateId = candidate.candidate_id.trim();
    if (!candidateId || candidateIds.has(candidateId)) throw new Error(`invalid_candidate_identity:${index}`);
    if (!candidate.summary.trim()) throw new Error(`empty_memory_candidate:${index}`);
    candidateIds.add(candidateId);
    const confidence = Number(candidate.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`invalid_candidate_confidence:${index}`);
    const evidenceResult = validateEvidence(sourceContext, candidate.evidence, `candidate_${index}`);
    if (!evidenceResult.kept.length) throw new Error(`candidate_without_evidence:${candidateId}`);
    return {
      candidate_id: candidateId,
      summary: candidate.summary.trim(),
      why_it_matters: candidate.why_it_matters.trim(),
      evidence: evidenceResult.kept,
      confidence
    };
  });

  if (!Array.isArray(output.unit_coverage)) throw new Error("invalid_memory_unit_coverage");
  const expectedUnitIds = new Set(sourceUnits.map((unit) => unit.unit_id));
  const seenUnitIds = new Set();
  const referencedCandidateIds = new Set();
  const unitCoverage = output.unit_coverage.map((entry, index) => {
    assertString(entry?.unit_id, `coverage_${index}_unit_id`, 100);
    assertString(entry?.reason, `coverage_${index}_reason`, 240);
    const unitId = entry.unit_id.trim();
    if (!expectedUnitIds.has(unitId) || seenUnitIds.has(unitId)) throw new Error(`invalid_memory_unit_coverage:${unitId}`);
    seenUnitIds.add(unitId);
    if (!new Set(["candidate", "discarded"]).has(entry.outcome) || !Array.isArray(entry.candidate_ids)) {
      throw new Error(`invalid_memory_unit_outcome:${unitId}`);
    }
    const ids = [...new Set(entry.candidate_ids.map((id) => String(id).trim()).filter(Boolean))];
    if (ids.some((id) => !candidateIds.has(id))) throw new Error(`unknown_memory_candidate:${unitId}`);
    if (entry.outcome === "candidate" && !ids.length) throw new Error(`unmapped_memory_unit:${unitId}`);
    if (entry.outcome === "discarded" && (ids.length || !entry.reason.trim())) throw new Error(`invalid_discarded_memory_unit:${unitId}`);
    for (const id of ids) referencedCandidateIds.add(id);
    return { unit_id: unitId, outcome: entry.outcome, candidate_ids: ids, reason: entry.reason.trim() };
  });
  if (seenUnitIds.size !== expectedUnitIds.size) throw new Error("incomplete_memory_unit_coverage");
  if ([...candidateIds].some((id) => !referencedCandidateIds.has(id))) throw new Error("unreferenced_memory_candidate");

  if (!Array.isArray(output.warnings) || output.warnings.length > 5) throw new Error("invalid_memory_discovery_warnings");
  const warnings = output.warnings.map((warning, index) => {
    assertString(warning, `memory_discovery_warning_${index}`, 160);
    return warning.trim();
  }).filter(Boolean);
  return { candidate_memories: candidateMemories, unit_coverage: unitCoverage, warnings };
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
