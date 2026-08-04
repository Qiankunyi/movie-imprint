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
  return event?.viewed_on || event?.screening_at || record?.createdAt || record?.updatedAt || "";
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
    attitudeTimeline: buildAttitudeTimeline(recs, eventsByRecordId),
    impressions: buildImpressions(recs, eventsByRecordId),
    stats: buildStats(events)
  };
}

// ─── 作品书架：按作品聚合观看次数 / 最近观看 / 是否有活动场次 ────────────────────

/**
 * 把全量 ViewingEvent 按作品聚合成书架每格需要的摘要。同一部作品可能横跨
 * canonical id 与若干个 merged_from 里的旧 id，这里一并合并计入。
 * @param {object[]} works
 * @param {object[]} viewingEvents
 * @returns {{ work: object, watchCount: number, lastWatchedAt: string|null, hasEvents: boolean }[]}
 */
export function summarizeWorksForShelf(works, viewingEvents) {
  const list = Array.isArray(works) ? works : [];
  const events = Array.isArray(viewingEvents) ? viewingEvents : [];
  const eventsByWork = new Map();
  for (const event of events) {
    if (!event?.work_id) continue;
    if (!eventsByWork.has(event.work_id)) eventsByWork.set(event.work_id, []);
    eventsByWork.get(event.work_id).push(event);
  }
  return list.map((work) => {
    const ids = [work.id, ...(work.merged_from || [])];
    const ownEvents = ids.flatMap((id) => eventsByWork.get(id) || []);
    const dates = ownEvents.map((event) => event.screening_at || event.viewed_on).filter(Boolean).sort();
    const lastWatchedAt = dates.length ? dates[dates.length - 1] : (work.first_recorded_at || null);
    const hasEvents = ownEvents.some((event) => (event.viewing_context?.event_types || []).length > 0);
    return { work, watchCount: ownEvents.length, lastWatchedAt, hasEvents };
  });
}

/**
 * 书架筛选：按 work_type（含"未分类"）与"特别场次"（原"有活动场次"）。
 *
 * 用户反馈后的调整：在浏览筛选栏这一层，"未分类"同时匹配 `unspecified` 与 `other`——
 * 目前系统里没有任何路径能把 work_type 自动判成 "other"，只有作品页新增的手动
 * 选类型入口才能让用户主动选 "其他"；从浏览的角度，"用户手动确认是其他类型"和
 * "还没确定类型"这两种情况混在一个"未分类" chip 里更符合直觉，不需要在筛选栏
 * 区分成两个几乎总是重叠的格子。work_type 本身仍保留 R1 冻结的五个取值，
 * 没有丢失信息，只是筛选 UI 把两者合并显示。
 * @param {{ work: object, hasEvents: boolean }[]} entries
 * @param {{ workType?: string, eventsOnly?: boolean }} [filter]
 */
export function filterShelfEntries(entries, { workType = "all", eventsOnly = false } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((entry) => {
    if (eventsOnly && !entry.hasEvents) return false;
    if (workType === "all") return true;
    const type = entry.work.work_type || "unspecified";
    if (workType === "unspecified") return type === "unspecified" || type === "other";
    return type === workType;
  });
}

/**
 * 书架排序：最近观看（默认）/ 观看次数 / 首次记录时间。
 * @param {{ work: object, watchCount: number, lastWatchedAt: string|null }[]} entries
 * @param {"recent"|"count"|"first"} [sort]
 */
export function sortShelfEntries(entries, sort = "recent") {
  const list = [...(Array.isArray(entries) ? entries : [])];
  if (sort === "count") return list.sort((a, b) => b.watchCount - a.watchCount);
  if (sort === "first") return list.sort((a, b) => (a.work.first_recorded_at || "").localeCompare(b.work.first_recorded_at || ""));
  return list.sort((a, b) => (b.lastWatchedAt || "").localeCompare(a.lastWatchedAt || ""));
}
