/**
 * R6 · 统一作品搜索（纯函数层）
 *
 * 用户不需要理解 Bangumi 和 TMDB 的区别，也不需要选「从哪里添加」——只有一个
 * 「搜索作品」（R6 §10）。这个模块负责把两个数据源各自的归一化结果、以及本地
 * 已有的 Work，一起折叠成一份统一候选列表。
 *
 * 不接触 DOM / 数据库 / 网络：搜索请求由 src/app.js 发起，这里只做纯粹的
 * 结构转换、去重与排序，可以在 Node 里直接单测。
 *
 * 三条设计约束：
 *
 * 1. **相同 external id 必须去重**。候选如果命中本地某个 Work 的 external_refs，
 *    就把它折叠成那条本地结果——绝不让用户在"本地已有"和"从数据库找到"两组里
 *    看到同一部电影的两张卡，更不能因此建出第二个 Work。
 *
 * 2. **跨源疑似同一作品只提示、不自动合并**（R6 §9）。Bangumi 的候选和 TMDB 的
 *    候选看起来是同一部片时，两条都照常展示，只在其中打一个 `possibleDuplicateOf`
 *    标记让 UI 提示一句。同名不同片、重制版与原版、剧场版与 TV 版都会踩中标题+
 *    年份这类启发式，自动合并的误判代价（两部不同的电影被并成一个 Work，且要靠
 *    用户自己发现）远大于让用户多点一次。
 *
 * 3. **不为「该搜哪个源」设计启发式**。两个源都发请求，差异只体现在排序权重上。
 *    猜主源一旦猜错，用户遇到的是"搜不到"这种最糟的结果。
 */

import { normalizeTitle } from "./domain.js";

/**
 * 统一候选模型。三个来源（local / bangumi / tmdb）都转成这个形状：
 *
 *   source          "local" | "bangumi" | "tmdb"
 *   sourceId        该来源内的 id（local 时就是 Work.id）
 *   workId          仅 local 有值，指向已存在的 Work
 *   title           展示标题
 *   originalTitle   原产地标题（可空）；它会进 Work.aliases，是日后跨语言命中的关键
 *   year            上映年份（可空）
 *   workType        能可靠判断时才给，否则 "unspecified"（R6 §12）
 *   posterRef       { source, subject_id } | { source, path } | null
 *   summary         简介（可空）
 *   externalIds     { bangumi?, tmdb?, imdb?, wikidata? }
 */

export function localWorkToCandidate(work, { inThisCollection = false } = {}) {
  const externalIds = {};
  for (const ref of work.external_refs || []) {
    if (ref?.source && ref?.id) externalIds[ref.source] = String(ref.id);
  }
  return {
    source: "local",
    sourceId: work.id,
    workId: work.id,
    title: work.title,
    originalTitle: work.original_title || null,
    releaseDate: null,
    year: work.release_year ?? null,
    workType: work.work_type || "unspecified",
    posterRef: work.poster || null,
    summary: work.summary || null,
    externalIds,
    inThisCollection
  };
}

export function bangumiCandidateToUnified(candidate) {
  return {
    source: "bangumi",
    sourceId: String(candidate.subjectId),
    workId: null,
    title: candidate.title,
    originalTitle: candidate.originalTitle || null,
    releaseDate: candidate.releaseDate || null,
    year: /^\d{4}/.test(candidate.releaseDate || "") ? Number(String(candidate.releaseDate).slice(0, 4)) : null,
    // Bangumi 的 type 只有 anime / real 两种有意义的取值，映射是可靠的
    workType: candidate.type === "anime"
      ? "animation_film"
      : candidate.type === "real"
        ? "live_action_film"
        : "unspecified",
    posterRef: { source: "bangumi", subject_id: Number(candidate.subjectId) || null },
    summary: candidate.summary || null,
    externalIds: { bangumi: String(candidate.subjectId) }
  };
}

export function tmdbCandidateToUnified(candidate) {
  return {
    source: "tmdb",
    sourceId: String(candidate.tmdbId),
    workId: null,
    title: candidate.title,
    originalTitle: candidate.originalTitle || null,
    releaseDate: candidate.releaseDate || null,
    year: candidate.year ?? null,
    workType: candidate.workType || "unspecified",
    posterRef: candidate.posterPath ? { source: "tmdb", path: candidate.posterPath } : null,
    summary: candidate.summary || null,
    externalIds: { tmdb: String(candidate.tmdbId) }
  };
}

/**
 * 本地搜索：在内存里的 works 上过滤，零延迟、不等网络。
 * 匹配标题或**任一别名**——别名里存着各语言标题变体，所以搜「Birdman」也能找到
 * 标题是「鸟人」的那个 Work。这正是 §14「看完后必须命中原 Work」的同一套依据。
 *
 * @param {object[]} works
 * @param {string} query
 * @param {{ limit?: number, isInCollection?: (workId: string) => boolean }} [options]
 */
export function searchLocalWorks(works, query, { limit = 8, isInCollection } = {}) {
  const q = normalizeTitle(query).toLowerCase();
  if (!q) return [];
  return (Array.isArray(works) ? works : [])
    .filter((work) => [work.title, ...(work.aliases || [])]
      .filter(Boolean)
      .some((name) => normalizeTitle(name).toLowerCase().includes(q)))
    .slice(0, limit)
    .map((work) => localWorkToCandidate(work, { inThisCollection: !!isInCollection?.(work.id) }));
}

/** 候选携带的全部外部标识，展开成 [source, id] 对。 */
function externalPairs(candidate) {
  return Object.entries(candidate.externalIds || {}).filter(([, id]) => id);
}

/**
 * 折叠掉「其实已经在本地库里」的外部候选。
 *
 * 判定只看 external id 精确相等——这是唯一零误判的依据。标题相同不作数
 * （同名电影太多），那属于下面的疑似重复提示。
 *
 * @param {object[]} externalCandidates
 * @param {object[]} localCandidates
 * @returns {object[]} 过滤后的外部候选
 */
export function foldIntoLocal(externalCandidates, localCandidates) {
  const localIndex = new Set();
  for (const local of localCandidates) {
    for (const [source, id] of externalPairs(local)) localIndex.add(`${source}:${id}`);
  }
  return (externalCandidates || []).filter(
    (candidate) => !externalPairs(candidate).some(([source, id]) => localIndex.has(`${source}:${id}`))
  );
}

/**
 * 跨源疑似同一作品的检测。**只打标记，绝不自动合并。**
 *
 * 依据：归一化后的原产地标题（拿不到就用展示标题）相同，且年份差 ≤ 1
 * （不同地区上映年份常常差一年）。任一方没有年份时不判定——只靠标题相同就
 * 认作同一部，同名电影会被大量误判。
 *
 * @param {object[]} candidates 已折叠过本地的外部候选
 * @returns {object[]} 新数组，可能带 possibleDuplicateOf 字段
 */
export function markCrossSourceDuplicates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const keyOf = (c) => normalizeTitle(c.originalTitle || c.title || "").toLowerCase();

  return list.map((candidate, index) => {
    const key = keyOf(candidate);
    if (!key || candidate.year == null) return candidate;
    const twin = list.find((other, otherIndex) =>
      otherIndex !== index
      && other.source !== candidate.source
      && other.year != null
      && Math.abs(other.year - candidate.year) <= 1
      && keyOf(other) === key
    );
    if (!twin) return candidate;
    return {
      ...candidate,
      possibleDuplicateOf: { source: twin.source, sourceId: twin.sourceId, title: twin.title }
    };
  });
}

/**
 * 外部候选排序。
 *
 * 不猜「该用哪个源」，只在权重上体现差异：
 * 1. 标题完全等于查询词的排最前（用户多半就是在找它）
 * 2. 标题以查询词开头的次之
 * 3. 查询词含假名/汉字假名混排等日文特征时，Bangumi 结果优先；
 *    含拉丁字母时 TMDB 优先——这只是排序偏好，两个源的结果都在列表里，
 *    猜错了也只是顺序不同，不会导致"搜不到"
 * 4. 最后按年份新→旧
 */
export function sortExternalCandidates(candidates, query) {
  const q = normalizeTitle(query || "").toLowerCase();
  // 平假名 / 片假名 → 日文特征明显，Bangumi 的数据更好
  const looksJapanese = /[぀-ゟ゠-ヿ]/.test(query || "");
  const looksLatin = /^[\x20-\x7e]+$/.test((query || "").trim());

  const score = (c) => {
    const title = normalizeTitle(c.title || "").toLowerCase();
    const original = normalizeTitle(c.originalTitle || "").toLowerCase();
    let s = 0;
    if (title === q || original === q) s += 100;
    else if (title.startsWith(q) || original.startsWith(q)) s += 50;
    if (looksJapanese && c.source === "bangumi") s += 10;
    if (looksLatin && c.source === "tmdb") s += 10;
    return s;
  };

  return [...(candidates || [])].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return (b.year ?? 0) - (a.year ?? 0);
  });
}

/**
 * 搜索结果的完整装配：折叠本地 → 同源去重 → 标记跨源疑似 → 排序。
 *
 * @param {{ local: object[], bangumi: object[], tmdb: object[], query: string }} input
 * @returns {{ local: object[], external: object[] }}
 */
export function buildSearchResults({ local = [], bangumi = [], tmdb = [], query = "" } = {}) {
  const externalRaw = [
    ...bangumi.map(bangumiCandidateToUnified),
    ...tmdb.map(tmdbCandidateToUnified)
  ];

  // 同一个源内部也可能返回重复条目（缓存拼接、分页边界），按 source+id 去重
  const seen = new Set();
  const deduped = externalRaw.filter((candidate) => {
    const key = `${candidate.source}:${candidate.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const external = sortExternalCandidates(markCrossSourceDuplicates(foldIntoLocal(deduped, local)), query);
  return { local, external };
}

// ─── R6 补丁 3：每个数据源各自的状态 ─────────────────────────────────────────

export const SOURCE_LABELS = { bangumi: "Bangumi", tmdb: "TMDB" };

/**
 * 把每个外部数据源这次的结果整理成可展示的状态。
 *
 * 起因：实测搜索「鸟人」只出 Bangumi 的结果，看不出 TMDB 到底是**没配密钥**、
 * **请求失败**、还是**确实一条都没搜到**——三种情况在界面上长得一模一样。
 *
 * 根因有两层，都必须堵：
 *
 * 1. 后端把"没配密钥"设计成 HTTP 200 + `configured:false`（当时的想法是"没配
 *    TMDB 不该让整个搜索报错"）。这个判断本身没错，但它让前端的
 *    `Promise.allSettled` 看到的是 fulfilled，于是既不算失败、也没有任何提示。
 * 2. 前端原本只有一个笼统的 `message`，且只在**有源失败时**才设值。
 *
 * 现在改成：每个源都有明确状态，并且**无论成功失败都展示**。搜索结果缺失时，
 * 用户一眼能分清"数据源故障"和"确实搜不到"。
 *
 * @param {Record<string, { state: "ok"|"unconfigured"|"failed", count?: number, error?: string }>} sources
 * @returns {{ source: string, label: string, state: string, text: string, tone: "normal"|"warn"|"error" }[]}
 */
export function summarizeSearchSources(sources = {}) {
  return Object.entries(sources).map(([source, info]) => {
    const label = SOURCE_LABELS[source] || source;
    const state = info?.state || "ok";
    if (state === "unconfigured") {
      return { source, label, state, tone: "warn", text: `${label} 未配置密钥，本次没有参与搜索` };
    }
    if (state === "failed") {
      return { source, label, state, tone: "error", text: `${label} 暂时不可用${info?.error ? `（${info.error}）` : ""}` };
    }
    const count = info?.count ?? 0;
    return { source, label, state: "ok", tone: "normal", text: `${label} ${count} 条` };
  });
}

/**
 * 整体是否值得给一句额外提示：有源没能正常参与搜索时为 true。
 * UI 据此决定这行状态是普通灰字还是带警示色。
 */
export function hasDegradedSource(sources = {}) {
  return Object.values(sources).some((info) => info?.state === "unconfigured" || info?.state === "failed");
}

/**
 * 查询词是否是 CJK。TMDB 的 `language` 参数只决定**返回字段用哪种语言**，
 * 不决定**用哪种语言去匹配**——它对中文片名的收录本来就有限，所以中文查询
 * 在 TMDB 上搜不到是常态，不是故障。空结果时据此给一句可操作的提示，
 * 而不是让用户以为坏了。
 */
export function looksCJK(query) {
  return /[぀-ヿ㐀-䶿一-鿿豈-﫿]/.test(String(query || ""));
}

/**
 * 按数据源过滤外部候选。
 *
 * 起因：搜「魔女宅急便」出来 Bangumi 10 条 + TMDB 2 条混在一起，同名条目一大串
 * （1989 动画版、2014 真人版、各种关联条目），光看标题分不清哪条来自哪个库，
 * 也就没法判断该选哪个。
 *
 * 这不违背「用户不需要选数据源」那条原则——搜索**入口**仍然只有一个，两个源仍然
 * 都会被搜；来源只是结果上的一条**可见信息 + 可选筛选**，不是搜索前必须做的选择。
 *
 * @param {object[]} candidates
 * @param {string|null} source null / "all" 表示不过滤
 */
export function filterCandidatesBySource(candidates, source) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!source || source === "all") return list;
  return list.filter((candidate) => candidate.source === source);
}

/** 某个源在当前结果里有没有条目——没有的话对应的筛选 chip 应该禁用。 */
export function countBySource(candidates) {
  const counts = {};
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    counts[candidate.source] = (counts[candidate.source] || 0) + 1;
  }
  return counts;
}

/**
 * 海报编辑器的「关联 Bangumi」可以在结果毫无歧义时一步完成：标题或别名精确命中，
 * 且已知年份不冲突。只要出现两个同样可信的结果就返回 null，交给用户亲自确认。
 */
export function uniqueBangumiLinkCandidate(work, candidates) {
  if (!work) return null;
  const workNames = new Set([work.title, work.original_title, ...(work.aliases || [])]
    .filter(Boolean)
    .map((value) => normalizeTitle(value).toLowerCase()));
  const workYear = Number(work.release_year) || null;
  const matches = (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
    const names = [candidate?.title, candidate?.originalTitle]
      .filter(Boolean)
      .map((value) => normalizeTitle(value).toLowerCase());
    if (!names.some((name) => workNames.has(name))) return false;
    const candidateYear = /^\d{4}/.test(candidate?.releaseDate || "")
      ? Number(String(candidate.releaseDate).slice(0, 4))
      : null;
    return !workYear || !candidateYear || workYear === candidateYear;
  });
  return matches.length === 1 ? matches[0] : null;
}
