import { addReleaseDate, buildTagline, normalizeReleaseDates, taglineFromSummary } from "./library.js";

// ─── Work 标题归一化与 ID ────────────────────────────────────────────────────

/**
 * 归一化作品标题，用于查重比较（不用于展示）。
 * 规则：去首尾空格、连续空格归一、全角英数字转半角、去掉【制式】前缀。
 * 不做繁简转换（明确不实现）。
 * 版本后缀（如「デジタルリマスター版」）暂不处理，留空实现。
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  if (!title) return "";
  let value = String(title).trim();
  // 去掉开头的【制式】/【活动】前缀（可能连续多个）
  value = value.replace(/^[\s　]*(?:【[^】]*】[\s　]*)+/u, "");
  // 全角英数字与常见全角符号 → 半角
  value = value.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  // 全角空格 → 半角空格
  value = value.replace(/　/g, " ");
  // 连续空格归一
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

function slugifyTitle(value) {
  const base = String(value || "").trim();
  if (!base) return `untitled_${Date.now().toString(36)}`;
  const encoded = encodeURIComponent(base)
    .replace(/%/g, "")
    .replace(/[!'()*]/g, "")
    .toLowerCase();
  return encoded.slice(0, 80) || `untitled_${Date.now().toString(36)}`;
}

/**
 * 计算 Work 的稳定 ID。
 * @param {{ subjectId?: string|number|null, title?: string }} params
 * @returns {string}
 */
export function workIdFor({ subjectId, title } = {}) {
  if (subjectId !== undefined && subjectId !== null && subjectId !== "") {
    return `work_bgm_${subjectId}`;
  }
  return `work_local_${slugifyTitle(normalizeTitle(title))}`;
}

// ─── Work 实体 ────────────────────────────────────────────────────────────────

export function createLocalWork(record) {
  const inputHints = record.inputHints || {};
  const aliases = [record.title, inputHints.workTitle]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const workId = record.workId || `work_${record.id}`;
  const firstRecordedAt = record.createdAt || record.first_recorded_at || new Date().toISOString();

  return {
    id: workId,
    work_id: workId,
    title: inputHints.workTitle || record.title,
    original_title: null,
    work_type: "unspecified",
    aliases,
    release_year: null,
    // R5：上映日改成"日期 + 地区"的条目数组，不再预设日本/中国两个固定槽位。
    // jp/cn/other 三个旧字段保留成空值，只为兼容还没迁移的历史数据。
    release_dates: { jp: null, cn: null, other: [], entries: [] },
    external_refs: [],
    // R5：Bangumi 关联条目锚点（只存 id，不猜关系类型，关系标签由用户手动连线）
    related_refs: [],
    tagline: null,
    identity_status: "local_only",
    poster_subject_id: null,
    merged_from: [],
    first_recorded_at: firstRecordedAt,
    match: {
      status: "idle",
      query: null,
      candidates: [],
      message: null
    }
  };
}

/**
 * 按 RESTRUCTURE_PLAN §3.1 的查重顺序解析／创建 Work。
 * 1. subjectId 命中 external_refs 或 id
 * 2. aliases 精确匹配（双向）
 * 3. normalizeTitle(title) 与已有 work 的 normalizeTitle(title) 或 normalizeTitle(alias) 相等
 * 4. 都不命中 → 新建
 * @param {object[]} works
 * @param {{ title: string, subjectId?: string|number|null, aliases?: string[] }} params
 * @returns {{ work: object, isNew: boolean }}
 */
export function resolveWork(works, { title, subjectId, aliases = [] } = {}) {
  const list = Array.isArray(works) ? works : [];
  const sid = subjectId !== undefined && subjectId !== null && subjectId !== "" ? String(subjectId) : null;

  if (sid) {
    const byId = list.find((work) =>
      work.id === `work_bgm_${sid}` ||
      (work.external_refs || []).some((ref) => ref.source === "bangumi" && String(ref.id) === sid)
    );
    if (byId) return { work: byId, isNew: false };
  }

  const candidateNames = [title, ...aliases].filter(Boolean);
  if (candidateNames.length) {
    const byAlias = list.find((work) => {
      const workNames = [work.title, ...(work.aliases || [])].filter(Boolean);
      return candidateNames.some((name) => workNames.includes(name));
    });
    if (byAlias) return { work: byAlias, isNew: false };
  }

  const normalized = normalizeTitle(title);
  if (normalized) {
    const byTitle = list.find((work) => {
      const workNames = [work.title, ...(work.aliases || [])].filter(Boolean);
      return workNames.some((name) => normalizeTitle(name) === normalized);
    });
    if (byTitle) return { work: byTitle, isNew: false };
  }

  const id = workIdFor({ subjectId: sid, title });
  const work = createLocalWork({ id, workId: id, title, inputHints: { workTitle: title } });
  work.aliases = [...new Set([title, ...aliases, ...work.aliases].filter(Boolean))];
  if (sid) {
    work.identity_status = "matched";
    work.external_refs = [{ source: "bangumi", id: sid, url: `https://bangumi.tv/subject/${sid}` }];
    work.poster_subject_id = Number(sid) || null;
  }
  return { work, isNew: true };
}

/**
 * local work 匹配到 Bangumi 后升格为已匹配 work。
 * @param {object} work
 * @param {string|number} subjectId
 * @param {{ title?: string, originalTitle?: string|null, type?: string, releaseDate?: string|null }} bangumiData
 */
export function promoteWorkToMatched(work, subjectId, bangumiData = {}) {
  const sid = String(subjectId);
  const newId = `work_bgm_${sid}`;
  const aliases = [...new Set([
    ...(work.aliases || []),
    work.title,
    bangumiData.title,
    bangumiData.originalTitle
  ].filter(Boolean))];

  // R5 用户反馈：这里原本把 Bangumi 的 subject.date 直接当作"日本上映日"写进
  // release_dates.jp。但 Bangumi 的 date 字段不带地区语义——《蜘蛛侠：崭新之日》
  // 上面标的其实是中国上映日，于是被系统错标成日本上映。现在统一以
  // region: "unknown"（未标注地区）落库，由用户在作品页认领是哪个地区。
  const scrapedDate = typeof bangumiData.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bangumiData.releaseDate)
    ? bangumiData.releaseDate
    : null;
  const releaseDates = scrapedDate
    ? addReleaseDate(work.release_dates, { region: "unknown", date: scrapedDate, source: "bangumi" })
    : normalizeReleaseDates(work.release_dates);
  const releaseYear = releaseDates.entries.length
    ? Number(releaseDates.entries[0].date.slice(0, 4))
    : (work.release_year ?? null);

  const workType = bangumiData.type === "anime"
    ? "animation_film"
    : bangumiData.type === "real"
      ? "live_action_film"
      : (work.work_type || "unspecified");

  const mergedFrom = [...new Set([
    ...(work.merged_from || []),
    ...(work.id !== newId ? [work.id] : [])
  ])];

  return {
    ...work,
    id: newId,
    work_id: newId,
    title: bangumiData.title || work.title,
    original_title: bangumiData.originalTitle ?? work.original_title ?? null,
    work_type: workType,
    aliases,
    release_year: releaseYear,
    release_dates: releaseDates,
    // 抓取只留锚点：关联条目的 id + 标题，具体是前作/续作/外传由用户手动标注
    related_refs: Array.isArray(bangumiData.relatedRefs) && bangumiData.relatedRefs.length
      ? bangumiData.relatedRefs
      : (work.related_refs || []),
    // 完整简介原文留着——「一句话简介」的 AI 概括要拿它当输入，
    // 抽首句抽不出来时也能在面板里给用户看原文。
    summary: bangumiData.summary || work.summary || null,
    tagline: work.tagline
      || (bangumiData.summary ? buildTagline(taglineFromSummary(bangumiData.summary), "bangumi") : null),
    poster_subject_id: Number(subjectId) || work.poster_subject_id || null,
    external_refs: [{ source: "bangumi", id: sid, url: `https://bangumi.tv/subject/${sid}` }],
    identity_status: "matched",
    merged_from: mergedFrom,
    match: {
      status: "confirmed",
      query: work.match?.query || null,
      candidates: [],
      message: null,
      confirmedSubjectId: Number(subjectId)
    }
  };
}

/**
 * 合并重复 Work。优先保留已匹配 Bangumi 的一方；别名并集去重；
 * first_recorded_at 取最早；release_dates 各字段取非空值，冲突时以已匹配方为准。
 * @param {object} primary
 * @param {object[]} duplicates
 * @returns {object}
 */
export function mergeWorks(primary, duplicates = []) {
  const dupList = (Array.isArray(duplicates) ? duplicates : [duplicates]).filter(Boolean);
  const allSources = [primary, ...dupList].filter(Boolean);
  const matchedSource = allSources.find((work) => work.identity_status === "matched");
  const base = matchedSource || primary;

  const aliases = [...new Set(allSources.flatMap((work) => [work.title, ...(work.aliases || [])]).filter(Boolean))];

  const mergedFrom = [...new Set([
    ...(base.merged_from || []),
    ...allSources.flatMap((work) => [work.id, ...(work.merged_from || [])])
  ])].filter((id) => id && id !== base.id);

  const firstRecordedAt = allSources
    .map((work) => work.first_recorded_at)
    .filter(Boolean)
    .sort()[0] || base.first_recorded_at || null;

  // R5：上映日改成条目数组后，合并就是"各方条目取并集"——normalizeReleaseDates
  // 内部按「地区_日期」去重，同一条不会因为来自两个副本而重复。
  let releaseDates = normalizeReleaseDates(base.release_dates);
  for (const work of allSources) {
    for (const entry of normalizeReleaseDates(work.release_dates).entries) {
      releaseDates = addReleaseDate(releaseDates, entry);
    }
  }

  return {
    ...base,
    aliases,
    merged_from: mergedFrom,
    first_recorded_at: firstRecordedAt,
    release_dates: releaseDates,
    // 一句话简介与关联锚点：以主体（已匹配方）为准，主体没有才从其余副本里捡一个
    tagline: base.tagline || allSources.map((work) => work.tagline).find(Boolean) || null,
    related_refs: base.related_refs?.length
      ? base.related_refs
      : (allSources.map((work) => work.related_refs).find((refs) => refs?.length) || []),
    release_year: base.release_year ?? allSources.map((work) => work.release_year).find((year) => year != null) ?? null
  };
}

/**
 * R5 补丁 6：首页时间线按**观影日期**倒序（近 → 远），不是按记录创建时间。
 *
 * 补录很常见：今天补记三年前看的一场，按 createdAt 排它会插到最前面，
 * 和卡片右下角显示的观影日期对不上。这里统一以卡片上显示的那个日期为准，
 * 拿不到场次日期（补充记录、草稿）时才回落到 createdAt。
 *
 * @param {object[]} records
 * @param {Map<string, object>} eventByRecordId  record.id → ViewingEvent
 * @returns {object[]} 新数组，不修改入参
 */
export function sortRecordsByViewingDate(records, eventByRecordId) {
  const keyOf = (record) => {
    const event = eventByRecordId?.get?.(record.id);
    return event?.screening_at || event?.viewed_on || record?.createdAt || "";
  };
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    return kb.localeCompare(ka);
  });
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

// ─── ViewingEvent：初看／重看推定 ─────────────────────────────────────────────

/**
 * 按时间顺序为同一 work_id 下的全部 ViewingEvent 推定 viewing_relation 与 watch_index。
 * 纯函数，不修改入参，返回新数组。AI 不参与这个推定。
 *
 * 重要：只按时间排序，绝不读取 location_type —— 初看／重看与观看地点完全正交。
 *
 * @param {object[]} events
 * @returns {object[]}
 */
export function assignViewingRelations(events) {
  const list = Array.isArray(events) ? events : [];
  const sortKey = (event) => event.screening_at || event.viewed_on || event.createdAt || "";

  const sorted = list
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const ka = sortKey(a.event);
      const kb = sortKey(b.event);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.index - b.index;
    })
    .map(({ event }) => event);

  return sorted.map((event, i) => {
    const watchIndex = i + 1;
    const timeRelation = watchIndex === 1 ? "first" : "rewatch";
    const locked = event.relation_locked === true && !!event.viewing_relation;
    const finalRelation = locked ? event.viewing_relation : timeRelation;
    const conflict = locked && event.viewing_relation !== timeRelation;

    const next = { ...event, watch_index: watchIndex, viewing_relation: finalRelation };
    if (conflict) next.relation_conflict = true;
    else delete next.relation_conflict;
    return next;
  });
}

// ─── 标签与草稿解析 ────────────────────────────────────────────────────────────

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
