import { addReleaseDate, buildTagline, normalizeReleaseDates, taglineFromSummary } from "./library.js";
import { createSelfInterview } from "./self-interview.js";
import { RECORD_SCHEMA_VERSION } from "./imprint-v2.js";

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

/**
 * R6：生成 Work 的**永久内部 ID**。
 *
 * 红线（R6 §8）：internal Work ID ≠ Bangumi ID ≠ TMDB ID。
 * 外部数据源的标识一律只进 external_refs，绝不进主键——否则「匹配到某个源」
 * 就会变成「主键变更」，进而必须级联重写 records / viewingEvents / collections
 * 并物理删除旧行。R1～R5 期间这条链路已经出过两次线上 bug（书架幽灵重复条目），
 * 加入 TMDB 后组合数还会翻倍，所以 R6 直接把这个可能性从根上去掉。
 *
 * Work 一旦创建，id 在任何情况下都不再变更：本地创建、匹配 Bangumi、再关联
 * TMDB、再加别的源，全部只改 external_refs。
 *
 * @returns {string}
 */
export function workIdFor() {
  return createId("work");
}

// ─── R6：外部标识（external_refs） ────────────────────────────────────────────

export const EXTERNAL_SOURCES = ["bangumi", "tmdb", "imdb", "wikidata"];

const EXTERNAL_URL_BUILDERS = {
  bangumi: (id) => `https://bangumi.tv/subject/${id}`,
  tmdb: (id) => `https://www.themoviedb.org/movie/${id}`,
  imdb: (id) => `https://www.imdb.com/title/${id}/`,
  wikidata: (id) => `https://www.wikidata.org/wiki/${id}`
};

/**
 * 按 source 增量写入外部标识，**绝不整体覆盖**。
 *
 * R1～R5 的 promoteWorkToMatched 是 `external_refs: [{...}]` 直接赋值的，
 * 一个 Work 同时有 bangumi 和 tmdb 引用时，后写的会把先写的静默抹掉。
 * R6 起统一走这个 upsert。
 *
 * @param {object[]} refs 现有 external_refs
 * @param {{ source: string, id: string|number, url?: string }} ref
 * @returns {object[]} 新数组，不修改入参
 */
export function upsertExternalRef(refs, { source, id, url } = {}) {
  const list = Array.isArray(refs) ? refs : [];
  if (!source || id === undefined || id === null || id === "") return [...list];
  const value = String(id);
  const next = {
    source,
    id: value,
    url: url || EXTERNAL_URL_BUILDERS[source]?.(value) || null
  };
  const rest = list.filter((item) => item && item.source !== source);
  return [...rest, next];
}

/**
 * 取这部作品的海报引用。R6 之前海报只认 Bangumi（work.poster_subject_id），
 * 现在统一走 work.poster，由调用方按 source 决定用哪个图片代理端点。
 * @param {object} work
 * @returns {{ source: string, subject_id?: number, path?: string }|null}
 */
export function workPosterRef(work) {
  const poster = work?.poster;
  if (!poster || !poster.source) return null;
  if (poster.source === "bangumi") return poster.subject_id ? poster : null;
  if (poster.source === "tmdb") return poster.path ? poster : null;
  return null;
}

/** 取某个源的外部 id（没有则 null）。 */
export function externalRefId(work, source) {
  const ref = (work?.external_refs || []).find((item) => item?.source === source);
  return ref ? String(ref.id) : null;
}

/**
 * 按「源 + 外部 id」查已有 Work。这是 R6 去重的第一道闸：相同 bangumi_id 或相同
 * tmdb_id 绝不允许产生第二个 Work（R6 §9）。
 * @param {object[]} works
 * @param {string} source
 * @param {string|number} id
 * @returns {object|undefined}
 */
export function findWorkByExternalRef(works, source, id) {
  if (!source || id === undefined || id === null || id === "") return undefined;
  const value = String(id);
  return (Array.isArray(works) ? works : []).find(
    (work) => externalRefId(work, source) === value
  );
}

// ─── Work 实体 ────────────────────────────────────────────────────────────────

export function createLocalWork(record) {
  const inputHints = record.inputHints || {};
  const aliases = [record.title, inputHints.workTitle]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const workId = record.workId || record.id || workIdFor();
  const firstRecordedAt = record.createdAt || record.first_recorded_at || new Date().toISOString();

  return {
    id: workId,
    title: inputHints.workTitle || record.title,
    original_title: null,
    work_type: "unspecified",
    aliases,
    release_year: null,
    // R5：上映日改成"日期 + 地区"的条目数组，不再预设日本/中国两个固定槽位。
    // jp/cn/other 三个旧字段保留成空值，只为兼容还没迁移的历史数据。
    release_dates: { jp: null, cn: null, other: [], entries: [] },
    external_refs: [],
    // R6：preferred source（哪个源的数据更适合这部作品），不是作品身份
    primary_source: null,
    // R6：海报引用。取代 R5 的 poster_subject_id（只认 Bangumi），支持多源
    poster: null,
    // 用户主动保存的横向剧照；数组顺序即展示顺序，首张为主图，最多 4 张。
    stills: [],
    runtime_minutes: null,
    genres: [],
    // R5：Bangumi 关联条目锚点（只存 id，不猜关系类型，关系标签由用户手动连线）
    related_refs: [],
    tagline: null,
    identity_status: "local_only",
    merged_from: [],
    // R6 §10：这是「作品第一次进入我的记忆系统的时间」，**不是首次观看时间**。
    // 观影后建卡与观影前从片单建卡都写它；后续加入别的片单、后续真正观看都不改它。
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
 * 解析／创建 Work（R6：查重扩展到多数据源）。
 *
 * 查重顺序：
 * 1. **任一外部标识命中**（bangumi / tmdb / imdb / wikidata）——同一个外部 id
 *    绝不允许产生第二个 Work（R6 §9）
 * 2. aliases 精确匹配（双向）
 * 3. normalizeTitle(title) 与已有 work 的 normalizeTitle(title) 或 normalizeTitle(alias) 相等
 * 4. 都不命中 → 新建（永久内部 ID）
 *
 * `externalRefs` 是 R6 新增的入参，取代原来只能传 Bangumi 的 `subjectId`；
 * `subjectId` 作为便捷写法保留（等价于 `{ bangumi: subjectId }`），因为捕获流程
 * 的 captureContext 里存的就是它。
 *
 * @param {object[]} works
 * @param {{ title: string, subjectId?: string|number|null, aliases?: string[],
 *          externalRefs?: Record<string, string|number|null> }} params
 * @returns {{ work: object, isNew: boolean }}
 */
export function resolveWork(works, { title, subjectId, aliases = [], externalRefs = {} } = {}) {
  const list = Array.isArray(works) ? works : [];

  const refs = { ...externalRefs };
  if (subjectId !== undefined && subjectId !== null && subjectId !== "") refs.bangumi = subjectId;

  for (const source of EXTERNAL_SOURCES) {
    const hit = findWorkByExternalRef(list, source, refs[source]);
    if (hit) return { work: hit, isNew: false };
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

  const id = workIdFor();
  const work = createLocalWork({ id, workId: id, title, inputHints: { workTitle: title } });
  work.aliases = [...new Set([title, ...aliases, ...work.aliases].filter(Boolean))];

  for (const source of EXTERNAL_SOURCES) {
    const value = refs[source];
    if (value === undefined || value === null || value === "") continue;
    work.external_refs = upsertExternalRef(work.external_refs, { source, id: value });
    work.identity_status = "matched";
    work.primary_source ||= source;
  }
  if (refs.bangumi) work.poster = { source: "bangumi", subject_id: Number(refs.bangumi) || null };

  return { work, isNew: true };
}

/**
 * local work 匹配到 Bangumi 后升格为已匹配 work。
 *
 * R6 的关键变化：**不再改变 work.id，也不再写 merged_from**。
 * 匹配一个外部源只是给这个 Work 增加一条 external_ref，作品身份自始至终没变过，
 * 所以既不需要新 id，也不存在「旧 id 需要被 merged_from 记住」这回事。
 * 由此，R1～R5 里那条「升格 → id 变更 → 级联重写 records/viewingEvents → 删旧行」
 * 的高危链路在 R6 彻底消失（app.js confirmWorkMatch 的合并逻辑改由
 * 「external ref 撞上另一个 Work」触发，那才是真正的重复作品）。
 *
 * @param {object} work
 * @param {string|number} subjectId
 * @param {{ title?: string, originalTitle?: string|null, type?: string,
 *          releaseDate?: string|null, summary?: string|null, relatedRefs?: object[] }} bangumiData
 */
export function promoteWorkToMatched(work, subjectId, bangumiData = {}) {
  const sid = String(subjectId);
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

  return {
    ...work,
    // id 不变 —— 这是 R6 的红线
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
    // R6：海报走多源引用。已经有 TMDB 海报时不覆盖——Bangumi 的封面是竖版小图，
    // 已经拿到 TMDB 海报的作品没必要降级。
    poster: work.poster?.source === "tmdb"
      ? work.poster
      : { source: "bangumi", subject_id: Number(subjectId) || null },
    // R6：增量 upsert，不整体覆盖——否则已经存在的 tmdb / imdb 引用会被抹掉
    external_refs: upsertExternalRef(work.external_refs, { source: "bangumi", id: sid }),
    primary_source: work.primary_source || "bangumi",
    identity_status: "matched",
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
 * 把一条**统一搜索候选**应用到已有 Work 上（source-agnostic）。
 *
 * R6 补丁 10：原来只有 `promoteWorkToMatched()`，签名是 `(work, subjectId, bangumiData)`
 * ——写死了 Bangumi。于是「记录一部库里还没有的新片」时，无论捕获流程还是详情页的
 * 待确认面板，都只能拿 Bangumi 的候选；看真人电影时 Bangumi 常常根本没有条目，
 * 用户就卡在"匹配不到"。
 *
 * 这个函数接受统一候选（local / bangumi / tmdb 同形），做的事只有两件：
 *   1. 把候选携带的**全部** external id upsert 进去（绝不整体覆盖）
 *   2. 用候选的元数据补全 Work 上还空着的字段
 *
 * **不改 work.id**——作品身份从头到尾没变过，这是 R6 的红线。
 *
 * @param {object} work
 * @param {object} candidate 统一候选（见 work-search.js 顶部的形状说明）
 * @param {{ overwritePoster?: boolean }} [options]
 *   overwritePoster —— 「刷新作品资料」时为 true。平时匹配一个新源不该顶掉已有海报
 *   （用户可能已经挑过、或先前的源画质更好），但刷新的目的就是拿新规则重挑一张。
 */
export function applyCandidateToWork(work, candidate = {}, { overwritePoster = false } = {}) {
  const aliases = [...new Set([
    ...(work.aliases || []),
    work.title,
    candidate.title,
    candidate.originalTitle
  ].filter(Boolean))];

  // 上映日：候选给的日期不带地区语义（Bangumi 的 date 是这样，TMDB 的
  // release_date 也随 language 变），所以一律按 region: "unknown" 落库，
  // 由用户在作品页认领——这是 R5 就定下的规矩。
  const scrapedDate = typeof candidate.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.releaseDate)
    ? candidate.releaseDate
    : null;
  const releaseDates = scrapedDate
    ? addReleaseDate(work.release_dates, { region: "unknown", date: scrapedDate, source: candidate.source || "external" })
    : normalizeReleaseDates(work.release_dates);

  const releaseYear = candidate.year
    ?? (releaseDates.entries.length ? Number(releaseDates.entries[0].date.slice(0, 4)) : null)
    ?? work.release_year
    ?? null;

  const ids = { ...(candidate.externalIds || {}) };
  if (candidate.source && candidate.source !== "local" && candidate.sourceId) {
    ids[candidate.source] = candidate.sourceId;
  }
  let externalRefs = work.external_refs || [];
  for (const source of EXTERNAL_SOURCES) {
    const value = ids[source];
    if (value === undefined || value === null || value === "") continue;
    externalRefs = upsertExternalRef(externalRefs, { source, id: value });
  }

  return {
    ...work,
    // id 不变
    title: candidate.title || work.title,
    original_title: candidate.originalTitle ?? work.original_title ?? null,
    // 类型的两条保护：
    // 1. 候选判断不出类型时保留 Work 原有的，绝不倒退成 unspecified
    // 2. "活动" 与 "其他" 只可能来自用户手动认领（没有任何自动推断会产出这两个值），
    //    所以外部候选永远不许覆盖它们——否则刷新一次资料就把用户的判断抹掉了
    work_type: (work.work_type === "event" || work.work_type === "other")
      ? work.work_type
      : (candidate.workType && candidate.workType !== "unspecified")
        ? candidate.workType
        : (work.work_type || "unspecified"),
    aliases,
    release_year: releaseYear,
    release_dates: releaseDates,
    summary: candidate.summary || work.summary || null,
    tagline: work.tagline
      || (candidate.summary ? buildTagline(taglineFromSummary(candidate.summary), candidate.source || "external") : null),
    // 平时不覆盖已有海报；「刷新作品资料」时才允许用新规则重挑的那张顶上
    poster: overwritePoster ? (candidate.posterRef || work.poster || null) : (work.poster || candidate.posterRef || null),
    // 刷新外部资料永远不替用户改动个人剧照收藏。
    stills: work.stills || [],
    runtime_minutes: work.runtime_minutes ?? candidate.runtimeMinutes ?? null,
    genres: work.genres?.length ? work.genres : (candidate.genres || []),
    external_refs: externalRefs,
    primary_source: work.primary_source || (candidate.source !== "local" ? candidate.source : null) || null,
    identity_status: externalRefs.length ? "matched" : work.identity_status,
    match: {
      status: "confirmed",
      query: work.match?.query || null,
      candidates: [],
      message: null,
      confirmedSource: candidate.source || null,
      confirmedSourceId: candidate.sourceId ? String(candidate.sourceId) : null
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

  // R6：外部标识取并集。合并的前提就是「这几条其实是同一部作品」，所以两边各自
  // 持有的 bangumi / tmdb / imdb 引用都应该保留在合并结果里——这正是跨源重复
  // （先 Bangumi 导入、后 TMDB 搜到）被用户确认后应该达到的状态。
  // 同一个 source 冲突时以 base（已匹配方）为准：upsert 按顺序覆盖，base 最后写。
  let externalRefs = [];
  for (const work of [...allSources.filter((item) => item !== base), base]) {
    for (const ref of work.external_refs || []) {
      externalRefs = upsertExternalRef(externalRefs, ref);
    }
  }

  return {
    ...base,
    aliases,
    merged_from: mergedFrom,
    first_recorded_at: firstRecordedAt,
    release_dates: releaseDates,
    external_refs: externalRefs,
    // 海报优先用 base 的；base 没有才从其余副本里捡一个
    poster: base.poster || allSources.map((work) => work.poster).find(Boolean) || null,
    // 合并时以主体的个人排序为先，再补其余副本里的剧照；UI/迁移层会限制为 4 张。
    stills: base.stills?.length ? base.stills : (allSources.map((work) => work.stills).find((list) => list?.length) || []),
    primary_source: base.primary_source || allSources.map((work) => work.primary_source).find(Boolean) || null,
    runtime_minutes: base.runtime_minutes ?? allSources.map((work) => work.runtime_minutes).find((value) => value != null) ?? null,
    genres: base.genres?.length ? base.genres : (allSources.map((work) => work.genres).find((list) => list?.length) || []),
    // 一句话简介与关联锚点：以主体（已匹配方）为准，主体没有才从其余副本里捡一个
    tagline: base.tagline || allSources.map((work) => work.tagline).find(Boolean) || null,
    related_refs: base.related_refs?.length
      ? base.related_refs
      : (allSources.map((work) => work.related_refs).find((refs) => refs?.length) || []),
    release_year: base.release_year ?? allSources.map((work) => work.release_year).find((year) => year != null) ?? null
  };
}

// ─── R6：从统一搜索候选创建 Work（观影前路径） ────────────────────────────────

/**
 * 从一条外部搜索候选直接创建 Work，**不产生任何 Record / ViewingEvent**。
 *
 * 这是 R6 打通「观影前 → 观影后」的关键新入口：在此之前，全项目唯一的 Work
 * 落库函数是 db.putRecordWithWork(record, work)，Work 与 Record 在同一个事务里
 * 强绑定写入，因此「App 里的作品」等价于「已经看过的作品」。有了这个函数，
 * 片单可以先建 Work、日后再补 ViewingEvent，而 Work.id 全程不变。
 *
 * @param {{ source: string, sourceId: string|number, title: string, originalTitle?: string|null,
 *          year?: number|null, workType?: string|null, posterRef?: object|null,
 *          summary?: string|null, externalIds?: Record<string, string|number|null>,
 *          runtimeMinutes?: number|null, genres?: string[], aliases?: string[] }} candidate
 * @param {string} [now] ISO 时间戳，同时作为 first_recorded_at
 * @returns {object}
 */
export function createWorkFromCandidate(candidate = {}, now = new Date().toISOString()) {
  const id = workIdFor();
  const title = candidate.title || "未命名作品";
  const work = createLocalWork({
    id,
    workId: id,
    title,
    createdAt: now,
    inputHints: { workTitle: title }
  });

  work.aliases = [...new Set([
    title,
    candidate.originalTitle,
    ...(candidate.aliases || [])
  ].filter(Boolean))];
  work.original_title = candidate.originalTitle || null;
  work.release_year = candidate.year ?? null;
  work.summary = candidate.summary || null;
  work.runtime_minutes = candidate.runtimeMinutes ?? null;
  work.genres = Array.isArray(candidate.genres) ? candidate.genres : [];
  // R6 §12：类型判断不了就留 unspecified，由用户在作品页认领。
  // 绝不因为 TMDB 的 media_type === "movie" 就判成真人电影。
  work.work_type = candidate.workType || "unspecified";

  const ids = { ...(candidate.externalIds || {}) };
  if (candidate.source && candidate.sourceId) ids[candidate.source] = candidate.sourceId;
  for (const source of EXTERNAL_SOURCES) {
    const value = ids[source];
    if (value === undefined || value === null || value === "") continue;
    work.external_refs = upsertExternalRef(work.external_refs, { source, id: value });
  }
  if (work.external_refs.length) work.identity_status = "matched";

  work.primary_source = candidate.source || work.external_refs[0]?.source || null;
  work.poster = candidate.posterRef || null;
  work.first_recorded_at = now;

  return work;
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
  "场景", "台词", "剧情转折", "结局", "主题", "观点／表达", "设定／世界观", "改编处理",
  "角色", "人物关系", "真人表演", "配音",
  "作画／动画表现", "镜头／摄影", "演出／调度", "美术／场景设计", "色彩／光影", "剪辑／节奏", "视效／特效",
  "配乐", "歌曲", "音效", "声音演出",
  "被击中的瞬间", "可爱／有趣的点", "不适／反感", "遗憾／不满", "疑问／困惑", "惊喜／意外", "个人感悟", "最想长期记住",
  "观看契机", "系列联系", "其他作品联想", "个人经历联想", "现实／时代联想", "创作者／幕后",
  "影厅效果", "观众反应", "舞台挨拶／映前映后谈", "特典／场刊", "现场事件", "特别放映内容",
  "用户自定义类型"
];

export const EMOTION_TAGS = [
  "开心", "有趣", "可爱", "浪漫", "温暖", "心动", "满足", "爽快", "治愈",
  "感动", "震撼", "兴奋", "热血", "落泪", "共鸣", "敬佩",
  "悲伤", "压抑", "愤怒", "恐惧", "不适", "恶心", "失望", "遗憾", "无聊", "反感",
  "意外", "困惑", "受到启发", "开拓视野", "想深入思考",
  "怀念", "向往", "意犹未尽", "空虚", "后劲很大", "久久不能释怀",
  "紧张", "代入", "沉浸", "着迷", "忘记时间",
  "想讨论", "想推荐", "想吐槽", "想找同好"
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
  const id = createId("record");
  const rawRevisionId = `${id}_rawrev_1`;
  return {
    id,
    schema_version: RECORD_SCHEMA_VERSION,
    title,
    rawText: text,
    raw_revision_id: rawRevisionId,
    raw_revision_number: 1,
    raw_saved_at: now,
    raw_revisions: [],
    self_interview: createSelfInterview(id, now),
    activeAnalysisDraft: null,
    analysis_history: [],
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
