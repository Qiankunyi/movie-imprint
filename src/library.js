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
 *    可以属于多个片单，**也可以属于多个系列**。
 *
 *    最后这半句是后来修正的。R5 最初写的是"只属于一个系列"，实现上靠
 *    `assignWorkToSeries` 归入新系列前先移出旧系列来保证。用户反馈这不成立：
 *    《蜘蛛侠：英雄归来》既在「蜘蛛侠（MCU）」里，也在「蜘蛛侠」这个大系列里。
 *    大系列套子系列、重启、跨制片方共用角色——一部电影同时处在多条系列谱系里
 *    是常态，不是例外。系列归属因此是多选，不是单选。
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
  // 关键：旧的 jp/cn/other 一旦搬进 entries 就必须清空。
  // 之前这里原样保留了它们，导致 removeReleaseDate 删掉 entries 里的条目后，
  // 下一次 normalizeReleaseDates 又从 jp/cn 把它"复活"回来——表现就是用户点删除
  // 完全没反应，而且同一个日期会同时出现"日本"和"中国大陆"两条。
  return { jp: null, cn: null, other: [], entries };
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
  // 手动内容就是用户自己的正式档案正文，不需要再贴一个“手动填写”的编辑态标签。
  return { bangumi: "来自 Bangumi", ai: "AI 概括", manual: "" }[source] || "";
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
    member_details: {},
    relations: [],
    created_at: now,
    updated_at: now
  };
}

/** 把作品加进系列末尾（已在其中则原样返回）。顺序即 member_ids 的数组顺序。 */
export function addWorkToSeries(series, workId, now = new Date().toISOString()) {
  if (!series || !workId) return series;
  if ((series.member_ids || []).includes(workId)) return series;
  const memberIds = [...(series.member_ids || []), workId];
  const nextOrder = (series.member_ids || []).filter((id) => seriesMemberDetails(series, id).relation === "core").length + 1;
  return {
    ...series,
    member_ids: memberIds,
    member_details: {
      ...(series.member_details || {}),
      [workId]: { relation: "core", series_order: nextOrder, relation_note: null }
    },
    updated_at: now
  };
}

export function removeWorkFromSeries(series, workId, now = new Date().toISOString()) {
  if (!series) return series;
  const memberDetails = { ...(series.member_details || {}) };
  delete memberDetails[workId];
  return {
    ...series,
    member_ids: (series.member_ids || []).filter((id) => id !== workId),
    member_details: memberDetails,
    // 该作品参与的关系连线一并清掉，避免留下指向已移除成员的悬空关系
    relations: (series.relations || []).filter((rel) => rel.from_work_id !== workId && rel.to_work_id !== workId),
    updated_at: now
  };
}

/**
 * 读取作品在某个系列中的成员身份。旧 Series 没有 member_details，按 core 解释；
 * core 的旧数据编号沿用 member_ids 里 core 成员的相对次序。
 */
export function seriesMemberDetails(series, workId) {
  const raw = series?.member_details?.[workId] || {};
  const relation = raw.relation === "crossover" ? "crossover" : "core";
  const memberIds = series?.member_ids || [];
  const fallbackOrder = memberIds
    .slice(0, Math.max(0, memberIds.indexOf(workId)) + 1)
    .filter((id) => (series?.member_details?.[id]?.relation || "core") !== "crossover")
    .length;
  const numericOrder = Number(raw.series_order);
  return {
    relation,
    seriesOrder: relation === "core" && Number.isInteger(numericOrder) && numericOrder > 0
      ? numericOrder
      : relation === "core" ? Math.max(1, fallbackOrder) : null,
    relationNote: relation === "crossover" ? String(raw.relation_note || "").trim() : ""
  };
}

/** 更新 Series—Work 关系，而不是修改 Work 自身。 */
export function updateSeriesMember(series, workId, { relation, seriesOrder, relationNote } = {}, now = new Date().toISOString()) {
  if (!series || !(series.member_ids || []).includes(workId)) return series;
  const previous = seriesMemberDetails(series, workId);
  const nextRelation = relation === "crossover" ? "crossover" : "core";
  const parsedOrder = Number(seriesOrder);
  const nextOrder = nextRelation === "core"
    ? (Number.isInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : previous.seriesOrder)
    : null;
  const nextNote = nextRelation === "crossover" ? String(relationNote || "").trim().slice(0, 120) : null;
  return {
    ...series,
    member_details: {
      ...(series.member_details || {}),
      [workId]: { relation: nextRelation, series_order: nextOrder, relation_note: nextNote }
    },
    updated_at: now
  };
}

/** 详情页统一作品轴：精确上映日优先，同日/未知日期沿用 member_ids 手动顺序。 */
export function seriesTimelineEntries(series, works) {
  const manualIndex = new Map((series?.member_ids || []).map((id, index) => [id, index]));
  return orderedSeriesMembers(series, works)
    .map((work) => {
      const details = seriesMemberDetails(series, work.id);
      const releaseDate = normalizeReleaseDates(work.release_dates).entries[0]?.date || null;
      const year = releaseDate ? Number(releaseDate.slice(0, 4)) : (work.release_year ?? null);
      return { work, ...details, releaseDate, year, manualIndex: manualIndex.get(work.id) ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => {
      const aKey = a.releaseDate || (a.year ? `${a.year}-12-31` : "9999-12-31");
      const bKey = b.releaseDate || (b.year ? `${b.year}-12-31` : "9999-12-31");
      return aKey.localeCompare(bKey) || a.manualIndex - b.manualIndex;
    });
}

export function seriesMemberCounts(series) {
  return (series?.member_ids || []).reduce((counts, workId) => {
    counts[seriesMemberDetails(series, workId).relation] += 1;
    return counts;
  }, { core: 0, crossover: 0 });
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

/**
 * 一部作品所属的**全部**系列，按系列标题排序，保证 UI 上的顺序稳定。
 *
 * 为什么是多个（用户反馈）：《蜘蛛侠：英雄归来》既属于「蜘蛛侠（MCU）」，也属于
 * 「蜘蛛侠」这个大系列——同一部电影同时处在若干个真实存在的系列谱系里是常态，
 * 重启、跨制片方、大系列套子系列都会这样。原来的实现把它当单选题：
 * `assignWorkToSeries` 每次归入前先把作品从旧系列里移出去，于是"加入第二个系列"
 * 实际表现为"换了一个系列"。
 *
 * 数据结构本来就支持多归属（成员关系存在 series.member_ids 上，作品身上没有
 * series_id 字段），限制只存在于查询与写入这两处代码里。
 *
 * @param {object[]} seriesList
 * @param {string} workId
 * @returns {object[]}
 */
export function findAllSeriesForWork(seriesList, workId) {
  return (Array.isArray(seriesList) ? seriesList : [])
    .filter((series) => (series.member_ids || []).includes(workId))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"));
}

/**
 * 兼容旧调用：返回所属系列中的第一个。
 * @deprecated 一部作品可以属于多个系列，新代码一律用 findAllSeriesForWork。
 */
export function findSeriesForWork(seriesList, workId) {
  return findAllSeriesForWork(seriesList, workId)[0] || null;
}

// ─── 片单 ─────────────────────────────────────────────────────────────────────

export function collectionIdFor(title, now = Date.now()) {
  return `collection_${slugify(title)}_${now.toString(36)}`;
}

/**
 * 片单标题允许重复（"2026 年度私选"这种名字用户可能真的会建两个），所以 id 里带
 * 时间戳，不像系列那样按标题去重。
 *
 * R6：片单条目从「一串 work_id」升级为 entries 对象数组。
 *
 * 原因（R6 §4）：片单不只是「一堆电影 ID」，它同时承担「我当时为什么想看这部电影」
 * 的备忘录功能。而 reason 属于 **Watchlist Entry 而不是 Work** —— 同一部《鸟人》
 * 出现在「Michael Keaton 补片」和「2010 年代补片」两个片单里，理由完全不同。
 *
 * entries 是唯一权威数据，**没有 work_ids 镜像**：双写会让此后所有增删排序都要
 * 维护两份数据，是确定的技术债。
 *
 * entry 结构：
 *   work_id         指向 Work（Work 可能还没有任何 ViewingEvent）
 *   added_at        加入这个片单的时间（不是 Work 首次进入数据库的时间）
 *   reason          为什么想看（可空）
 *   source_work_id  从哪部作品发现的（R6 §17 Discovery Context 预留，本阶段只存不展示）
 */
export function createCollection({ title, description = "" } = {}, now = new Date().toISOString()) {
  return {
    id: collectionIdFor(title, new Date(now).getTime() || Date.now()),
    title: String(title || "").trim(),
    description: String(description || "").trim(),
    entries: [],
    created_at: now,
    updated_at: now
  };
}

/** 片单条目工厂。 */
export function createCollectionEntry({ workId, reason = "", sourceWorkId = null } = {}, now = new Date().toISOString()) {
  return {
    work_id: workId,
    added_at: now,
    reason: String(reason || "").trim(),
    source_work_id: sourceWorkId || null
  };
}

export function collectionEntries(collection) {
  return Array.isArray(collection?.entries) ? collection.entries : [];
}

export function findCollectionEntry(collection, workId) {
  return collectionEntries(collection).find((entry) => entry.work_id === workId) || null;
}

export function collectionHasWork(collection, workId) {
  return collectionEntries(collection).some((entry) => entry.work_id === workId);
}

/**
 * 加入片单。已经在里面则原样返回（幂等），但如果这次带了 reason 而原条目没有，
 * 补写 reason —— 用户在「加入片单」面板里补一句理由不应该被静默丢弃。
 */
export function addWorkToCollection(collection, workId, { reason = "", sourceWorkId = null } = {}, now = new Date().toISOString()) {
  if (!collection || !workId) return collection;
  const entries = collectionEntries(collection);
  const existing = entries.find((entry) => entry.work_id === workId);
  if (existing) {
    const nextReason = String(reason || "").trim();
    if (!nextReason || existing.reason) return collection;
    return {
      ...collection,
      entries: entries.map((entry) => (entry.work_id === workId ? { ...entry, reason: nextReason } : entry)),
      updated_at: now
    };
  }
  return {
    ...collection,
    entries: [...entries, createCollectionEntry({ workId, reason, sourceWorkId }, now)],
    updated_at: now
  };
}

export function removeWorkFromCollection(collection, workId, now = new Date().toISOString()) {
  if (!collection) return collection;
  return {
    ...collection,
    entries: collectionEntries(collection).filter((entry) => entry.work_id !== workId),
    updated_at: now
  };
}

/**
 * 改写某个条目的 reason。
 * R6 §5 红线：条目里**不存**「是否已看」，看完电影也不删除条目——片单本身是
 * 用户过去兴趣与发现过程的记录。所以这里能改的只有 reason，没有 watched 之类的字段。
 */
export function updateCollectionEntryReason(collection, workId, reason, now = new Date().toISOString()) {
  if (!collection) return collection;
  return {
    ...collection,
    entries: collectionEntries(collection).map((entry) =>
      entry.work_id === workId ? { ...entry, reason: String(reason || "").trim() } : entry
    ),
    updated_at: now
  };
}

/** 调整条目顺序（照搬系列成员的 moveWorkInSeries 语义：越界即原样返回）。 */
export function moveCollectionEntry(collection, workId, targetIndex, now = new Date().toISOString()) {
  const entries = collectionEntries(collection);
  const index = entries.findIndex((entry) => entry.work_id === workId);
  if (index === -1 || targetIndex < 0 || targetIndex >= entries.length || targetIndex === index) return collection;
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return { ...collection, entries: next, updated_at: now };
}

export function collectionsForWork(collections, workId) {
  return (Array.isArray(collections) ? collections : []).filter((item) => collectionHasWork(item, workId));
}

/**
 * 片单里的作品，按加入顺序取出（查不到的跳过），每条附带自己的 entry。
 *
 * 用 findWorkById 而不是裸 Map 查表：如果两个跨源重复的 Work 后来被用户确认合并，
 * 片单 entry 里存的可能是被合并掉的那个旧 id，findWorkById 会通过 merged_from
 * 回查到合并后的主体，条目不会凭空消失。
 *
 * @param {object} collection
 * @param {object[]} works
 * @returns {{ work: object, entry: object }[]}
 */
export function collectionWorkEntries(collection, works) {
  const list = Array.isArray(works) ? works : [];
  return collectionEntries(collection)
    .map((entry) => {
      const work = list.find((item) => item.id === entry.work_id)
        || list.find((item) => (item.merged_from || []).includes(entry.work_id));
      return work ? { work, entry } : null;
    })
    .filter(Boolean);
}

/** 只要作品、不要 entry 的便捷写法。 */
export function collectionWorks(collection, works) {
  return collectionWorkEntries(collection, works).map(({ work }) => work);
}
