/**
 * R4 · 作品页数据聚合。
 *
 * 纯函数模块，不接触 DOM／数据库／网络——src/app.js 负责查库拿到 work / records /
 * viewingEvents 后传进来，这里只做整理与排序，输出便于渲染的结构。
 *
 * 红线：
 * - 初看／重看／watch_index 由 R1 的 assignViewingRelations 在写入时算好，
 *   这里只读取、排序、原样呈现，不重新推断，也不读取 location_type。
 * - 评价变迁（attitudeTimeline）只呈现事实，节点用日期标注，不用「初看／重看」——
 *   补充记录（supplement）没有对应的 ViewingEvent，标"重看"是错的。
 */

function eventSortKey(event) {
  return event?.screening_at || event?.viewed_on || event?.createdAt || "";
}

function recordSortKey(record, event) {
  return event?.screening_at || event?.viewed_on || record?.createdAt || record?.updatedAt || "";
}

function ascending(keyFn) {
  return (a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  };
}

/**
 * 按 id 查 work，命中不到时再从 merged_from 里找——保证旧引用（合并前的 work id）
 * 不失效。R1 的 db.getWorkById 是这条逻辑的数据库版本，这里是纯数组版本，便于测试。
 * @param {object[]} works
 * @param {string} workId
 * @returns {object|undefined}
 */
export function findWorkById(works, workId) {
  const list = Array.isArray(works) ? works : [];
  return (
    list.find((work) => work.id === workId) ||
    list.find((work) => (work.merged_from || []).includes(workId))
  );
}

/**
 * 观影履历：按时间升序排列全部 ViewingEvent，原样透传 viewing_relation / watch_index /
 * relation_conflict / needs_review 等字段，不做任何推断。
 * @param {object[]} viewingEvents
 * @returns {object[]}
 */
export function buildHistory(viewingEvents) {
  const list = Array.isArray(viewingEvents) ? viewingEvents : [];
  return [...list].sort(ascending(eventSortKey));
}

/**
 * 每条 record 关联的 ViewingEvent（通过 viewing_event_id 查表），supplement 记录没有。
 * @param {object[]} records
 * @param {object[]} viewingEvents
 * @returns {Map<string, object>} record.id → event
 */
export function indexEventsByRecord(records, viewingEvents) {
  const eventsById = new Map((Array.isArray(viewingEvents) ? viewingEvents : []).map((event) => [event.id, event]));
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const eventId = record.viewing_event_id;
    if (eventId && eventsById.has(eventId)) map.set(record.id, eventsById.get(eventId));
  }
  return map;
}

/**
 * 评价变迁：同一作品下按时间排列各条 Record 的 attitude。
 * - 只有一条记录（或不足两条有态度的记录）→ 空数组，UI 据此不显示这个区块
 * - 态度为空的记录跳过
 * - 节点只标日期，不标初看／重看——supplement 记录没有 ViewingEvent，也在这条链上
 * @param {object[]} records
 * @param {Map<string, object>} eventsByRecordId
 * @returns {{ recordId: string, attitude: string, date: string|null }[]}
 */
export function buildAttitudeTimeline(records, eventsByRecordId) {
  const list = Array.isArray(records) ? records : [];
  const withAttitude = list.filter((record) => record.attitude);
  if (withAttitude.length < 2) return [];
  return withAttitude
    .map((record) => ({
      recordId: record.id,
      attitude: record.attitude,
      date: recordSortKey(record, eventsByRecordId?.get(record.id)) || null
    }))
    .sort(ascending((node) => node.date || ""));
}

/**
 * 作品页海报旁只显示最近一次有效观影记录的态度。补充记录没有独立 ViewingEvent，
 * 不代表一次新的观看，不能覆盖真正重看后留下的态度。
 */
export function latestViewingAttitude(records, eventsByRecordId) {
  const candidates = (Array.isArray(records) ? records : [])
    .filter((record) => record.record_kind !== "supplement" && record.attitude)
    .map((record) => ({
      attitude: record.attitude,
      date: recordSortKey(record, eventsByRecordId?.get(record.id))
    }))
    .filter((item) => item.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0]?.attitude || null;
}

/**
 * 感想列表一行的类型标签。补充记录固定"补充记录"；有关联场次的记录按
 * 初看／重看 + 地点给一个描述性文案（这不是履历区块的 first/rewatch 判定本身，
 * 只是感想列表的展示文案，不影响 §3.1 的"初看／重看只反映时间顺序"红线）。
 * @param {object} record
 * @param {object|null} event
 * @returns {string}
 */
export function impressionKindLabel(record, event) {
  if (record.record_kind === "supplement") return "补充记录";
  if (!event) return "感想";
  if (event.viewing_relation === "first") return event.location_type === "cinema" ? "影院观看后" : "观看后";
  return "重看";
}

/**
 * 感想列表：每条记录一行，日期升序排列。
 * @param {object[]} records
 * @param {Map<string, object>} eventsByRecordId
 * @returns {{ recordId: string, date: string|null, kind: string, kindLabel: string, cardCount: number }[]}
 */
export function buildImpressions(records, eventsByRecordId) {
  const list = Array.isArray(records) ? records : [];
  return list
    .map((record) => {
      const event = eventsByRecordId?.get(record.id) || null;
      return {
        recordId: record.id,
        date: recordSortKey(record, event) || null,
        kind: record.record_kind === "supplement" ? "supplement" : (event?.viewing_relation || "viewing"),
        kindLabel: impressionKindLabel(record, event),
        cardCount: Array.isArray(record.cards) ? record.cards.length : 0
      };
    })
    .sort(ascending((node) => node.date || ""));
}

/**
 * 统计面板——为 W11 年度报告预留：观看次数、影院场次数、时长与花费合计、活动次数分布。
 * 缺值（null/undefined/非数字）不计入合计，也不产生 NaN。
 * @param {object[]} viewingEvents
 * @returns {{ watchCount: number, cinemaCount: number, totalMinutes: number, totalSpent: number,
 *   eventCount: number, eventTypeCounts: Record<string, number> }}
 */
export function buildStats(viewingEvents) {
  const events = Array.isArray(viewingEvents) ? viewingEvents : [];
  const watchCount = events.length;
  const cinemaCount = events.filter((event) => event.location_type === "cinema").length;

  const totalMinutes = events.reduce((sum, event) => {
    const minutes = event.duration_minutes;
    return sum + (typeof minutes === "number" && Number.isFinite(minutes) ? minutes : 0);
  }, 0);

  const totalSpent = events.reduce((sum, event) => {
    const amount = event.ticket_price?.amount;
    return sum + (typeof amount === "number" && Number.isFinite(amount) ? amount : 0);
  }, 0);

  const eventTypeCounts = {};
  let eventCount = 0;
  for (const event of events) {
    const types = Array.isArray(event.viewing_context?.event_types) ? event.viewing_context.event_types : [];
    if (types.length) eventCount += 1;
    for (const key of types) eventTypeCounts[key] = (eventTypeCounts[key] || 0) + 1;
  }

  return { watchCount, cinemaCount, totalMinutes, totalSpent, eventCount, eventTypeCounts };
}

/**
 * 作品页主入口：把 work + 该 work 全部 records + 全部 viewingEvents 聚合成渲染所需的结构。
 * @param {object} work
 * @param {object[]} records
 * @param {object[]} viewingEvents
 * @returns {{ work: object, history: object[], attitudeTimeline: object[],
 *   impressions: object[], stats: object }}
 */
export function buildWorkView(work, records, viewingEvents) {
  const recs = Array.isArray(records) ? records : [];
  const events = Array.isArray(viewingEvents) ? viewingEvents : [];
  const eventsByRecordId = indexEventsByRecord(recs, events);

  return {
    work,
    history: buildHistory(events),
    latestAttitude: latestViewingAttitude(recs, eventsByRecordId),
    attitudeTimeline: buildAttitudeTimeline(recs, eventsByRecordId),
    impressions: buildImpressions(recs, eventsByRecordId),
    stats: buildStats(events)
  };
}

// ─── 作品书架：按作品聚合观看次数 / 最近观看 / 是否有活动场次 ────────────────────

/**
 * 把全量 ViewingEvent 按作品聚合成书架每格需要的摘要。同一部作品可能横跨
 * canonical id 与若干个 merged_from 里的旧 id，这里一并合并计入。
 *
 * R6：书架的定位从「已观看作品列表」改成 **App 中所有 Work 的统一总库**。
 * Work 现在有两条产生路径——观影后写感想建卡，以及观影前从片单搜索建卡——
 * 两种都属于书架，区别只体现在观看状态筛选上。因此这里多派生两个字段：
 *
 * - `isWatched`：存在 ViewingEvent **或** 存在 Record。两者取或而不是只看 Event，
 *   是因为「补充记录」这类 record 本来就不产生 ViewingEvent，只看 Event 会把
 *   确实看过的作品误判成没看过。
 * - `inCollection`：至少属于一个片单。「想看」= 没看过 **且** 在某个片单里。
 *
 * R6 §10：`lastWatchedAt` 在没有观影事件时回落到 `first_recorded_at`，但
 * `first_recorded_at` 的语义是「作品第一次进入我的记忆系统的时间」，**不是首次
 * 观看时间** —— 片单加入建的 Work 也有它。所以「最近观看」排序只在已看状态下
 * 有意义，调用方需要在「想看」状态下改用 `first` 排序（见 sortShelfEntries）。
 *
 * @param {object[]} works
 * @param {object[]} viewingEvents
 * @param {{ records?: object[], collections?: object[] }} [context]
 * @returns {{ work: object, watchCount: number, lastWatchedAt: string|null, hasEvents: boolean,
 *   isWatched: boolean, inCollection: boolean }[]}
 */
export function summarizeWorksForShelf(works, viewingEvents, { records = [], collections = [] } = {}) {
  const list = Array.isArray(works) ? works : [];
  const events = Array.isArray(viewingEvents) ? viewingEvents : [];

  const eventsByWork = new Map();
  for (const event of events) {
    if (!event?.work_id) continue;
    if (!eventsByWork.has(event.work_id)) eventsByWork.set(event.work_id, []);
    eventsByWork.get(event.work_id).push(event);
  }

  const recordCountByWork = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = record?.work_id || record?.workId;
    if (!id) continue;
    recordCountByWork.set(id, (recordCountByWork.get(id) || 0) + 1);
  }

  const collectedWorkIds = new Set();
  for (const collection of Array.isArray(collections) ? collections : []) {
    for (const entry of collection?.entries || []) {
      if (entry?.work_id) collectedWorkIds.add(entry.work_id);
    }
  }

  return list.map((work) => {
    const ids = [work.id, ...(work.merged_from || [])];
    const ownEvents = ids.flatMap((id) => eventsByWork.get(id) || []);
    const dates = ownEvents.map((event) => event.screening_at || event.viewed_on).filter(Boolean).sort();
    const lastWatchedAt = dates.length ? dates[dates.length - 1] : (work.first_recorded_at || null);
    const hasEvents = ownEvents.some((event) => (event.viewing_context?.event_types || []).length > 0);
    const recordCount = ids.reduce((sum, id) => sum + (recordCountByWork.get(id) || 0), 0);
    return {
      work,
      watchCount: ownEvents.length,
      lastWatchedAt,
      hasEvents,
      isWatched: ownEvents.length > 0 || recordCount > 0,
      inCollection: ids.some((id) => collectedWorkIds.has(id))
    };
  });
}

/**
 * R6：观看状态筛选的三个取值。默认「已看」——书架虽然是总库，但日常使用时
 * 用户想看到的仍然是自己的观影收藏。
 */
export const SHELF_WATCH_STATUSES = ["watched", "want", "all"];

/**
 * 书架筛选：按 work_type（含"未分类"）与"特别场次"（原"有活动场次"）。
 *
 * 用户反馈后的调整：在浏览筛选栏这一层，"未分类"同时匹配 `unspecified` 与 `other`——
 * 目前系统里没有任何路径能把 work_type 自动判成 "other"，只有作品页新增的手动
 * 选类型入口才能让用户主动选 "其他"；从浏览的角度，"用户手动确认是其他类型"和
 * "还没确定类型"这两种情况混在一个"未分类" chip 里更符合直觉，不需要在筛选栏
 * 区分成两个几乎总是重叠的格子。work_type 本身仍保留 R1 冻结的五个取值，
 * 没有丢失信息，只是筛选 UI 把两者合并显示。
 * R6 新增 `watchStatus` 维度（与 workType 正交）：
 * - `watched`（默认）：有观影记录的作品
 * - `want`：没有观影记录，且至少在一个片单里 —— 这就是「补片清单」的总览
 * - `all`：全部 Work
 *
 * 注意 `want` 要求 `inCollection`：一个既没看过、又不在任何片单里的 Work 不属于
 * 「想看」，它只是数据库里的一条孤立记录（例如匹配过程中的中间产物），只在
 * 「全部」里出现。
 *
 * `eventsOnly`（特别场次）在 `want` 状态下必然筛不出任何东西——没有观影事件就
 * 不可能有舞台挨拶/应援上映。调用方应在该状态下隐藏这个按钮，这里也直接短路。
 *
 * @param {{ work: object, hasEvents: boolean, isWatched: boolean, inCollection: boolean }[]} entries
 * @param {{ workType?: string, eventsOnly?: boolean, watchStatus?: "watched"|"want"|"all" }} [filter]
 */
export function filterShelfEntries(entries, { workType = "all", eventsOnly = false, watchStatus = "all" } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((entry) => {
    if (watchStatus === "watched" && !entry.isWatched) return false;
    if (watchStatus === "want" && (entry.isWatched || !entry.inCollection)) return false;
    if (eventsOnly && watchStatus !== "want" && !entry.hasEvents) return false;
    if (workType === "all") return true;
    const type = entry.work.work_type || "unspecified";
    if (workType === "unspecified") return type === "unspecified" || type === "other";
    return type === workType;
  });
}

/**
 * 书架排序：最近观看（默认）/ 观看次数 / 首次记录时间。
 *
 * R6 §9/§10：「想看」状态下**不发明新的排序体系**（最近加入、标题排序之类目前
 * 没有实际使用价值——真正有意义的是「为什么想看」，那由片单和 entry.reason
 * 承担，不是书架的职责）。最近观看／最多观看在没有观影记录时全都退化成同一个
 * 顺序，唯一仍然成立的是「首次记录」：它表示**作品第一次进入我的记忆系统的
 * 时间**，因片单加入而建卡同样是一次首次记录。所以这里对 `want` 状态直接强制
 * 用 `first`，调用方不需要（也不应该）另外维护一套排序状态。
 *
 * @param {{ work: object, watchCount: number, lastWatchedAt: string|null }[]} entries
 * @param {"recent"|"count"|"first"} [sort]
 * @param {{ watchStatus?: string }} [options]
 */
export function sortShelfEntries(entries, sort = "recent", { watchStatus = "all" } = {}) {
  const list = [...(Array.isArray(entries) ? entries : [])];
  const effective = watchStatus === "want" ? "first" : sort;
  if (effective === "count") return list.sort((a, b) => b.watchCount - a.watchCount);
  if (effective === "first") return list.sort((a, b) => (a.work.first_recorded_at || "").localeCompare(b.work.first_recorded_at || ""));
  return list.sort((a, b) => (b.lastWatchedAt || "").localeCompare(a.lastWatchedAt || ""));
}
