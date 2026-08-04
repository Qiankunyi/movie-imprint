/**
 * R5 · 作品资料层：上映日（多地区）、系列实体、片单、一句话简介。
 *
 * 纯函数模块，不接触 DOM／数据库／网络——src/app.js 负责读写库，这里只做结构
 * 构造、归一化与校验，方便在 Node 里直接单测。
 *
 * 三条设计约束（来自用户本轮反馈）：
 *
 * 1. 上映日不再预设地区。原实现把 Bangumi 抓到的 `subject.date` 直接写进
 *    `release_dates.jp`，等于假设"抓到的就是日本上映日"。实测《蜘蛛侠：崭新之日》
 *    在 Bangumi 上标的是中国上映日，于是被错标成日本上映。Bangumi 的 `date`
 *    字段本身不带地区语义，所以这里改成"日期 + 地区"的条目数组，抓取写入时
 *    地区一律记 `unknown`（未标注地区），由用户自己认领是哪个地区。
 *
 * 2. 系列是独立实体，不是作品上的一个字符串。抓取只负责把 Bangumi 的关联条目
 *    ID 当作"锚点"存下来（relatedRefs），前作/续作/外传这类关系标签交给用户手动
 *    连线——Bangumi 的关系树结构复杂且易变，爬虫强行解析容易报错，锚点 + 手动
 *    标注是稳的做法。
 *
 * 3. 片单是用户自定义的主题列表（参考豆瓣），与系列正交：系列描述"作品客观上
 *    属于哪个系列"，片单描述"我出于自己的用途把哪些作品归在一起"。同一部作品
 *    可以属于多个片单，但只属于一个系列。
 */

// ─── 上映日：地区 + 日期 ──────────────────────────────────────────────────────

export const RELEASE_REGIONS = [
  ["jp", "日本"],
  ["cn", "中国大陆"],
  ["hk", "中国香港"],
  ["tw", "中国台湾"],
  ["us", "美国"],
  ["other", "其他地区"],
  ["unknown", "未标注地区"]
];

export function releaseRegionLabel(region) {
  return RELEASE_REGIONS.find(([key]) => key === region)?.[1] || "未标注地区";
}

function isValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 条目 id 用「地区_日期」拼，天然幂等：同地区同日期不会重复插入。 */
export function releaseEntryId(region, date) {
  return `${region || "unknown"}_${date}`;
}

/**
 * 把作品的 release_dates 归一化成 { entries: [...] } 结构。
 * 兼容 R1 的旧格式：已有的 jp / cn / other 会被搬进 entries（source 记 "legacy"），
 * 旧字段本身保留不动，避免任何依赖它们的老代码在过渡期直接崩掉。
 * @param {object} releaseDates
 * @returns {{ jp: string|null, cn: string|null, other: string[], entries: object[] }}
 */
export function normalizeReleaseDates(releaseDates = {}) {
  const source = releaseDates || {};
  const entries = [];
  const seen = new Set();

  const push = (region, date, entrySource) => {
    if (!isValidDate(date)) return;
    const id = releaseEntryId(region, date);
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({ id, region, date, source: entrySource });
  };

  for (const entry of Array.isArray(source.entries) ? source.entries : []) {
    push(entry?.region || "unknown", entry?.date, entry?.source || "manual");
  }
  push("jp", source.jp, "legacy");
  push("cn", source.cn, "legacy");
  for (const value of Array.isArray(source.other) ? source.other : []) {
    if (typeof value === "string") push("other", value, "legacy");
    else push(value?.region || "other", value?.date, "legacy");
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  return {
    jp: source.jp ?? null,
    cn: source.cn ?? null,
    other: Array.isArray(source.other) ? source.other : [],
    entries
  };
}

/** 新增一条上映日。同地区同日期视为同一条，不会重复添加。 */
export function addReleaseDate(releaseDates, { region = "unknown", date, source = "manual" } = {}) {
  const normalized = normalizeReleaseDates(releaseDates);
  if (!isValidDate(date)) return normalized;
  const id = releaseEntryId(region, date);
  if (normalized.entries.some((entry) => entry.id === id)) return normalized;
  const entries = [...normalized.entries, { id, region, date, source }]
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ...normalized, entries };
}

export function removeReleaseDate(releaseDates, entryId) {
  const normalized = normalizeReleaseDates(releaseDates);
  return { ...normalized, entries: normalized.entries.filter((entry) => entry.id !== entryId) };
}

/** 修改某条上映日的地区（"认领"抓取回来的 unknown 条目时用）。 */
export function setReleaseDateRegion(releaseDates, entryId, region) {
  const normalized = normalizeReleaseDates(releaseDates);
  const target = normalized.entries.find((entry) => entry.id === entryId);
  if (!target) return normalized;
  const rest = normalized.entries.filter((entry) => entry.id !== entryId);
  return addReleaseDate({ ...normalized, entries: rest }, { region, date: target.date, source: target.source });
}

/**
 * 作品页/书架上显示的上映年份：取最早的一条上映日。
 * 没有任何上映日时回落到 release_year。
 */
export function releaseYearOf(work) {
  const { entries } = normalizeReleaseDates(work?.release_dates);
  if (entries.length) return Number(entries[0].date.slice(0, 4));
  return work?.release_year ?? null;
}

// ─── 一句话简介 ───────────────────────────────────────────────────────────────

/** 超过这个长度就不算"一句话"，交给 AI 概括或用户手写。 */
export const TAGLINE_MAX_LENGTH = 48;

/**
 * 从 Bangumi 的 summary 里抽第一句当一句话简介。
 * 抽不出、或第一句本身太长（超过 TAGLINE_MAX_LENGTH）→ 返回 null，
 * 由调用方决定是提示用户手写还是走 AI 概括，不在这里硬截断——
 * 截断出来的半句话比没有更糟。
 * @param {string} summary
 * @returns {string|null}
 */
export function taglineFromSummary(summary) {
  if (typeof summary !== "string") return null;
  const cleaned = summary
    .replace(/\r/g, "")
    .replace(/^\s*(?:（|\()[^）)]*(?:）|\))\s*/, "") // 去掉开头的「（原作：…）」这类括注
    .trim();
  if (!cleaned) return null;
  const firstLine = cleaned.split("\n").map((line) => line.trim()).find(Boolean);
  if (!firstLine) return null;
  const sentence = firstLine.split(/(?<=[。！？!?])/)[0].trim().replace(/[。\s]+$/, "");
  if (!sentence) return null;
  return sentence.length <= TAGLINE_MAX_LENGTH ? sentence : null;
}

/**
 * 一句话简介统一存成 { text, source, updated_at }，这样 UI 能明确区分
 * "抓来的"/"AI 概括的"/"我自己写的"，用户才知道该不该信任它。
 * @param {string} text
 * @param {"bangumi"|"ai"|"manual"} source
 */
export function buildTagline(text, source, now = new Date().toISOString()) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  return { text: value, source, updated_at: now };
}

export function taglineSourceLabel(source) {
  return { bangumi: "来自 Bangumi", ai: "AI 概括", manual: "手动填写" }[source] || "";
}

// ─── 系列实体 ─────────────────────────────────────────────────────────────────

/**
 * 作品之间的关系标签。全部由用户手动指定——抓取只提供"这两部有关联"的锚点，
 * 不猜具体是什么关系（见文件头说明 3）。
 */
export const SERIES_RELATION_TYPES = [
  ["prequel", "前作"],
  ["sequel", "续作"],
  ["side_story", "番外"],
  ["spinoff", "外传"],
  ["alternate", "平行世界 / 另一版本"],
  ["summary", "总集篇"],
  ["remake", "重制"],
  ["other", "其他关系"]
];

export function seriesRelationLabel(type) {
  return SERIES_RELATION_TYPES.find(([key]) => key === type)?.[1] || "其他关系";
}

function slugify(value) {
  const base = String(value || "").trim();
  if (!base) return `untitled_${Date.now().toString(36)}`;
  return encodeURIComponent(base).replace(/%/g, "").replace(/[!'()*]/g, "").toLowerCase().slice(0, 80);
}

export function seriesIdFor(title) {
  return `series_${slugify(title)}`;
}

/**
 * @param {{ title: string, aliases?: string[], externalRefs?: object[] }} params
 */
export function createSeries({ title, aliases = [], externalRefs = [] } = {}, now = new Date().toISOString()) {
  const id = seriesIdFor(title);
  return {
    id,
    title: String(title || "").trim(),
    aliases: [...new Set(aliases.filter(Boolean))],
    external_refs: externalRefs,
    member_ids: [],
    relations: [],
    created_at: now,
    updated_at: now
  };
}

/** 把作品加进系列末尾（已在其中则原样返回）。顺序即 member_ids 的数组顺序。 */
export function addWorkToSeries(series, workId, now = new Date().toISOString()) {
  if (!series || !workId) return series;
  if ((series.member_ids || []).includes(workId)) return series;
  return { ...series, member_ids: [...(series.member_ids || []), workId], updated_at: now };
}

export function removeWorkFromSeries(series, workId, now = new Date().toISOString()) {
  if (!series) return series;
  return {
    ...series,
    member_ids: (series.member_ids || []).filter((id) => id !== workId),
    // 该作品参与的关系连线一并清掉，避免留下指向已移除成员的悬空关系
    relations: (series.relations || []).filter((rel) => rel.from_work_id !== workId && rel.to_work_id !== workId),
    updated_at: now
  };
}

/** 在系列内把某部作品move到指定位置（用于手动排系列顺序）。 */
export function moveWorkInSeries(series, workId, targetIndex, now = new Date().toISOString()) {
  if (!series) return series;
  const members = [...(series.member_ids || [])];
  const from = members.indexOf(workId);
  if (from === -1) return series;
  const to = Math.min(Math.max(0, targetIndex), members.length - 1);
  if (from === to) return series;
  members.splice(from, 1);
  members.splice(to, 0, workId);
  return { ...series, member_ids: members, updated_at: now };
}

/**
 * 设定/更新两部作品之间的关系。同一对 (from, to) 只保留一条，重复设定即覆盖。
 * 不自动写反向关系——"A 的续作是 B" 不等于用户想同时声明 "B 的前作是 A"，
 * 让用户自己决定要不要两边都连（和 Bangumi 的做法一致）。
 */
export function setSeriesRelation(series, { fromWorkId, toWorkId, type, note = null } = {}, now = new Date().toISOString()) {
  if (!series || !fromWorkId || !toWorkId || fromWorkId === toWorkId) return series;
  const rest = (series.relations || []).filter(
    (rel) => !(rel.from_work_id === fromWorkId && rel.to_work_id === toWorkId)
  );
  return {
    ...series,
    relations: [...rest, { from_work_id: fromWorkId, to_work_id: toWorkId, type, note }],
    updated_at: now
  };
}

export function removeSeriesRelation(series, fromWorkId, toWorkId, now = new Date().toISOString()) {
  if (!series) return series;
  return {
    ...series,
    relations: (series.relations || []).filter(
      (rel) => !(rel.from_work_id === fromWorkId && rel.to_work_id === toWorkId)
    ),
    updated_at: now
  };
}

/**
 * 按 member_ids 的顺序取出系列成员作品（查不到的 id 直接跳过，不产生空洞）。
 * @param {object} series
 * @param {object[]} works
 */
export function orderedSeriesMembers(series, works) {
  const byId = new Map((Array.isArray(works) ? works : []).map((work) => [work.id, work]));
  return (series?.member_ids || []).map((id) => byId.get(id)).filter(Boolean);
}

export function findSeriesForWork(seriesList, workId) {
  return (Array.isArray(seriesList) ? seriesList : []).find((series) => (series.member_ids || []).includes(workId)) || null;
}

// ─── 片单 ─────────────────────────────────────────────────────────────────────

export function collectionIdFor(title, now = Date.now()) {
  return `collection_${slugify(title)}_${now.toString(36)}`;
}

/**
 * 片单标题允许重复（"2026 年度私选"这种名字用户可能真的会建两个），所以 id 里带
 * 时间戳，不像系列那样按标题去重。
 */
export function createCollection({ title, description = "" } = {}, now = new Date().toISOString()) {
  return {
    id: collectionIdFor(title, new Date(now).getTime() || Date.now()),
    title: String(title || "").trim(),
    description: String(description || "").trim(),
    work_ids: [],
    created_at: now,
    updated_at: now
  };
}

export function addWorkToCollection(collection, workId, now = new Date().toISOString()) {
  if (!collection || !workId) return collection;
  if ((collection.work_ids || []).includes(workId)) return collection;
  return { ...collection, work_ids: [...(collection.work_ids || []), workId], updated_at: now };
}

export function removeWorkFromCollection(collection, workId, now = new Date().toISOString()) {
  if (!collection) return collection;
  return { ...collection, work_ids: (collection.work_ids || []).filter((id) => id !== workId), updated_at: now };
}

export function collectionsForWork(collections, workId) {
  return (Array.isArray(collections) ? collections : []).filter((item) => (item.work_ids || []).includes(workId));
}

/** 片单里的作品，按加入顺序取出（查不到的跳过）。 */
export function collectionWorks(collection, works) {
  const byId = new Map((Array.isArray(works) ? works : []).map((work) => [work.id, work]));
  return (collection?.work_ids || []).map((id) => byId.get(id)).filter(Boolean);
}
