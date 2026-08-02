export const ATTITUDES = [
  ["dislike", "不喜欢"],
  ["neutral", "无感"],
  ["like", "喜欢"],
  ["love", "超喜欢"],
  ["mixed", "不好说"]
];

export const ATTITUDE_DESCRIPTIONS = {
  dislike: "整体不适合自己，或存在足以影响观看体验的明确反感与排斥。个别亮点仍然可以单独保留。",
  neutral: "没有明显喜欢，也没有明显排斥；看完后留下的情绪和记忆都比较有限。",
  like: "存在足以认可这次体验的内容。即使有遗憾或不满，整体仍然愿意把它记作喜欢。",
  love: "被作品强烈击中，对自己有明显或可能长期保留的意义；不要求作品每一处都完美。",
  mixed: "喜欢与不喜欢彼此交织，或理解作品的表达却在感受上难以接受，前四项都不足以概括。"
};

export const RECOMMENDATIONS = [
  ["yes", "会"],
  ["depends", "看对象"],
  ["no", "不会"]
];

export function allowedRecommendationsForAttitude(attitude) {
  if (attitude === "like" || attitude === "love") return ["yes", "depends", "no"];
  if (attitude === "dislike" || attitude === "neutral" || attitude === "mixed") return ["no"];
  return [];
}

export function isRecommendationAllowed(attitude, recommendation) {
  return allowedRecommendationsForAttitude(attitude).includes(recommendation);
}

export const RECOMMENDATION_PRESETS = {
  yes: [
    { key: "reasons", label: "推荐理由", options: ["主题表达打动人", "角色或关系有魅力", "视听体验突出", "有独特记忆点", "适合在影院看", "值得一起讨论"] },
    { key: "cautions", label: "注意事项", options: ["节奏偏慢", "情绪较沉重", "含令人不适的内容", "需要系列背景", "特定表达有门槛", "建议选择合适制式"] },
    { key: "audiences", label: "推荐给谁（可选）", options: ["普遍都可以", "喜欢同类题材的人", "系列观众", "重视角色关系的人", "重视视听体验的人", "能接受慢节奏的人"] }
  ],
  depends: [
    { key: "audiences", label: "适合推荐给谁", options: ["喜欢同类题材的人", "系列观众", "重视角色关系的人", "重视视听体验的人", "喜欢作者／主创的人", "能接受慢节奏的人"] },
    { key: "reasons", label: "推荐理由", options: ["主题表达打动人", "角色或关系有魅力", "视听体验突出", "有独特记忆点", "适合在影院看", "值得一起讨论"] },
    { key: "cautions", label: "注意事项", options: ["节奏偏慢", "情绪较沉重", "含令人不适的内容", "需要系列背景", "特定表达有门槛", "建议选择合适制式"] }
  ],
  no: [
    { key: "noReasons", label: "不推荐原因", options: ["叙事或节奏问题", "表达方式令人不适", "完成效果低于预期", "观看体验很差", "受众范围太窄", "没有足够推荐理由"] },
    { key: "issueTypes", label: "更接近哪种情况", options: ["主要是作品本身的问题", "主要是个人不适合", "两方面都有"] },
    { key: "positives", label: "仍值得肯定的部分", options: ["个别场景有亮点", "角色或表演不错", "美术或画面不错", "音乐或声音不错", "主题仍有价值", "影院体验有亮点"] }
  ]
};

export function emptyRecommendationDetails() {
  return { audiences: [], reasons: [], cautions: [], noReasons: [], issueTypes: [], positives: [] };
}

export const CARD_TYPES = [
  "场景", "台词", "主题", "角色", "人物关系", "配音", "镜头／摄影", "作画／动画表现",
  "配乐", "歌曲", "被击中的瞬间", "可爱／有趣的点", "遗憾／不满", "个人经历联想", "影厅效果", "自定义"
];

export function createId(prefix, now = Date.now()) {
  return `${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createLocalWork(record) {
  const inputHints = record.inputHints || {};
  const aliases = [record.title, inputHints.workTitle]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const workId = record.workId || `work_${record.id}`;

  return {
    id: workId,
    work_id: workId,
    title: inputHints.workTitle || record.title,
    original_title: null,
    work_type: "unspecified",
    aliases,
    release_year: null,
    external_refs: [],
    identity_status: "local_only",
    match: {
      status: "idle",
      query: null,
      candidates: [],
      message: null
    }
  };
}

export function reconcileLocalWorkTitle(work, record) {
  const workTitleHint = record.inputHints?.workTitle?.trim();
  if (!workTitleHint || work.identity_status === "matched" || work.title === workTitleHint) return work;
  return {
    ...work,
    title: workTitleHint,
    aliases: [...(work.aliases || []), work.title, workTitleHint]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
  };
}

export function extractHashtags(text) {
  return [...text.matchAll(/(^|\s)#([^#\s，。！？、；：,.!?;:]+)/gu)].map((match) => match[2]);
}

export function parseWorkTag(tag = "") {
  const segments = String(tag)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const hasSeriesHint = segments.length > 1;

  return {
    raw: tag,
    seriesPath: hasSeriesHint ? segments.slice(0, -1) : [],
    workTitleHint: hasSeriesHint ? segments.at(-1) : null
  };
}

export function parseDraft(text) {
  const tags = extractHashtags(text);
  const metaTags = new Set(["电影院", "影院", "家中", "重看", "二刷"]);
  const title = tags.find((tag) => !metaTags.has(tag)) || "未命名的电影";
  const { seriesPath, workTitleHint } = parseWorkTag(title);
  return { title, tags, seriesPath, workTitleHint };
}

export function deterministicAnalysis(text) {
  const { title, tags, seriesPath, workTitleHint } = parseDraft(text);
  const attitudeSuggestion = /超喜欢|年度电影|太喜欢/.test(text)
    ? "love"
    : /不喜欢|反感|失望|无聊/.test(text)
      ? "dislike"
      : /喜欢|击中|感动|很好/.test(text)
        ? "like"
        : null;
  const sentences = text
    .replace(/(^|\s)#[^#\s，。！？、；：,.!?;:]+/gu, " ")
    .split(/(?<=[。！？!?])|\n+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 6);
  const highlights = sentences.slice(0, 3);
  const cards = (highlights.length ? highlights : [`关于《${title}》的这一刻，还想再记久一点。`]).map((content, index) => ({
    card_id: createId("card"),
    type: index === 0 ? "被击中的瞬间" : "场景",
    title: index === 0 ? "看完后最先留下的瞬间" : `留下来的片段 ${index + 1}`,
    content,
    is_core: index === 0,
    order: index,
    provenance: "local_deterministic"
  }));

  return {
    title,
    tags,
    inputHints: {
      seriesPath,
      workTitle: workTitleHint
    },
    attitudeSuggestion,
    attitude: null,
    recommendation: null,
    recommendationNote: "",
    cards
  };
}

export function createRawOnlyRecord(text, now = new Date().toISOString()) {
  const { title, tags, seriesPath, workTitleHint } = parseDraft(text);
  return {
    id: createId("record"),
    schema_version: "0.1-local",
    title,
    rawText: text,
    tags,
    inputHints: { seriesPath, workTitle: workTitleHint },
    createdAt: now,
    updatedAt: now,
    status: "raw_only_confirmed",
    analysis_status: "pending",
    attitudeSuggestion: null,
    attitude: null,
    recommendation: null,
    recommendationNote: "",
    recommendationDetails: emptyRecommendationDetails(),
    cards: []
  };
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(iso));
}

export function attitudeLabel(value) {
  return ATTITUDES.find(([key]) => key === value)?.[1] || "尚未选择";
}

export function recommendationLabel(value) {
  return RECOMMENDATIONS.find(([key]) => key === value)?.[1] || "还没有判断";
}
