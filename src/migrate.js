/**
 * R1 存量迁移：Work 去重 + 三层数据模型收敛
 *
 * 依据 docs/RESTRUCTURE_PLAN_R1-R5.md §3.4，九步：
 *   1. 迁移前自动导出完整 JSON 备份，备份失败则终止迁移
 *   2. 扫描全部 works，按查重顺序分组
 *   3. 每组选主：优先已匹配 Bangumi 的、其次 first_recorded_at 最早的
 *   4. 被合并的 work → id 写入主 work 的 merged_from，aliases 并集去重
 *   5. 全部 records 的 workId → 重写为 work_id 指向主 work，补 record_kind: "viewing"
 *   6. 无 ViewingEvent 的旧 record → 补建 location_type:"online"、source:"none"、
 *      needs_review:true 的 Event
 *   7. 按 assignViewingRelations 规则回填全部 viewing_relation 与 watch_index
 *   8. 写 meta.migration_version = "r1-work-dedup"，幂等
 *   9. 迁移失败 → 完全回滚（不写库），保留原数据，返回 { ok:false, error }
 *
 * 设计说明：本模块只依赖一个满足 { get, getAll, put } 接口的 db 对象（与
 * src/db.js 导出的 db 完全兼容），不直接触碰 IndexedDB/fetch，方便在 Node
 * 环境下用内存 mock 单测。备份通过依赖注入的 exportBackup(payload, filename)
 * 回调交付——生产环境接到 export.js 已有的下载能力，测试里可注入会失败的
 * mock 来验证"备份失败则终止迁移"。
 */

import { assignViewingRelations, mergeWorks, normalizeTitle } from "./domain.js";
import { normalizeReleaseDates } from "./library.js";
import { normalizeV21Record } from "./imprint-v2.js";

// r1-work-dedup-2：R4 补丁里发现 src/app.js 的 confirmWorkMatch()（local work 实时匹配
// 到 Bangumi 升格时）漏了一步物理删除旧 work 文档——只把旧 id 从内存 state.works 里
// 过滤掉，数据库里的旧记录一直留着，下次加载又读回来，变成书架上的"幽灵重复条目"
// （有海报有记录的正常条目 + 一个只剩标题、没海报没记录的空壳条目）。那个 bug 已经在
// app.js 里修了，但这里的版本号也要跟着提一次——本地/云端已经攒下的历史幽灵条目
// 不会因为修了实时匹配的代码就自动消失，得让这次迁移的去重+物理删除逻辑再跑一遍
// 才能把已经产生的重复清掉。buildMigratedDataset 本身是幂等的（对本来就没问题的
// 数据重跑一遍不会产生任何变化），所以这里只是借用同一套逻辑做一次性收尾清理。
// r5-library：R5 又提了一次，因为 ensureWorkFields 现在还要把旧的
// release_dates.{jp,cn,other} 归一化成"日期 + 地区"的 entries 数组，并补上
// related_refs / tagline 两个新字段。同样是幂等的，干净数据重跑没有任何变化。
const MIGRATION_VERSION = "v2.1-self-interview-analysis-lifecycle";
const MIGRATION_META_ID = "migration-status";

function bangumiRefId(work) {
  const ref = (work.external_refs || []).find((item) => item.source === "bangumi");
  return ref ? String(ref.id) : null;
}

function sameWork(a, b) {
  const aSid = bangumiRefId(a);
  const bSid = bangumiRefId(b);
  if (aSid && bSid) return aSid === bSid;

  const aNames = [a.title, ...(a.aliases || [])].filter(Boolean);
  const bNames = [b.title, ...(b.aliases || [])].filter(Boolean);
  if (aNames.some((name) => bNames.includes(name))) return true;

  const aNorm = aNames.map(normalizeTitle).filter(Boolean);
  const bNorm = bNames.map(normalizeTitle).filter(Boolean);
  return aNorm.some((name) => bNorm.includes(name));
}

/** 贪心分组：同组内只要有一个成员匹配就并入 */
function groupWorks(works) {
  const groups = [];
  for (const work of works) {
    const target = groups.find((group) => group.some((existing) => sameWork(existing, work)));
    if (target) target.push(work);
    else groups.push([work]);
  }
  return groups;
}

function pickPrimary(group) {
  const matched = group.filter((work) => work.identity_status === "matched");
  const pool = matched.length ? matched : group;
  return pool.slice().sort((a, b) => {
    const ta = a.first_recorded_at || "";
    const tb = b.first_recorded_at || "";
    if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if (ta) return -1;
    if (tb) return 1;
    return 0;
  })[0];
}

/** 为迁移前的旧数据补齐 R1/R5 新增字段，避免 undefined 泄漏到下游 */
function ensureWorkFields(work) {
  return {
    ...work,
    work_type: work.work_type || "unspecified",
    // R5：上映日归一化成"日期 + 地区"的条目数组，旧的 jp/cn/other 会被搬进 entries
    release_dates: normalizeReleaseDates(work.release_dates),
    related_refs: work.related_refs || [],
    tagline: work.tagline ?? null,
    poster: work.poster ?? null,
    stills: Array.isArray(work.stills) ? work.stills.slice(0, 4) : [],
    primary_source: work.primary_source ?? null,
    runtime_minutes: work.runtime_minutes ?? null,
    genres: work.genres || [],
    merged_from: work.merged_from || [],
    first_recorded_at: work.first_recorded_at || new Date(0).toISOString()
  };
}

function emptyScreenedContent() {
  return { kind: "full_movie", episode_start: null, episode_end: null, display_label: null };
}

function emptyViewingContext() {
  return { cinema_name: null, city: null, format: null, seats: [], seat_count: 0, ticket_provider: null, event_types: [], bonus_note: null };
}

/**
 * 在内存中构建迁移后的完整数据集，不做任何写库操作。
 * @returns {{ works: object[], records: object[], viewingEvents: object[] }}
 */
export function buildMigratedDataset({ records = [], works = [], viewingEvents = [] }) {
  const groups = groupWorks(works);
  const primaryByOldId = new Map();
  const newWorks = [];

  for (const group of groups) {
    const primary = pickPrimary(group);
    const duplicates = group.filter((work) => work !== primary);
    const merged = duplicates.length ? mergeWorks(primary, duplicates) : primary;
    const finalWork = ensureWorkFields(merged);
    newWorks.push(finalWork);
    for (const work of group) primaryByOldId.set(work.id, finalWork);
  }

  const newRecords = records.map((record) => {
    const oldWorkId = record.work_id || record.workId;
    const canonical = (oldWorkId && primaryByOldId.get(oldWorkId)) || null;
    const workId = canonical?.id || oldWorkId || null;
    return normalizeV21Record({
      ...record,
      work_id: workId,
      workId: workId, // 兼容期保留
      record_kind: record.record_kind || "viewing"
    });
  });

  let newEvents = viewingEvents.map((event) => {
    const canonical = primaryByOldId.get(event.work_id);
    return canonical ? { ...event, work_id: canonical.id } : { ...event };
  });

  // 无 ViewingEvent 的旧 record → 补建一个 online/none/needs_review 的 Event
  const recordIdsWithEvent = new Set(newEvents.filter((event) => event.record_id).map((event) => event.record_id));
  for (const record of newRecords) {
    if (recordIdsWithEvent.has(record.id) || !record.work_id) continue;
    const syntheticId = `ve_migrated_${record.id}`;
    newEvents.push({
      id: syntheticId,
      viewing_id: syntheticId,
      work_id: record.work_id,
      record_id: record.id,
      viewed_on: null,
      screening_at: null,
      screening_ends_at: null,
      duration_minutes: null,
      viewing_relation: null,
      watch_index: null,
      location_type: "online",
      ticket_price: null,
      screened_content: emptyScreenedContent(),
      viewing_context: emptyViewingContext(),
      source: "none",
      needs_review: true,
      confirmed_at: record.createdAt || null,
      status: "confirmed"
    });
    record.viewing_event_id = syntheticId;
  }

  // 记录与既有场次的关联（record.viewing_event_id 缺失时补上）
  for (const record of newRecords) {
    if (record.viewing_event_id) continue;
    const match = newEvents.find((event) => event.record_id === record.id);
    if (match) record.viewing_event_id = match.id;
  }

  // 按 work 分组重算 viewing_relation / watch_index
  const eventsByWork = new Map();
  const orphanEvents = [];
  for (const event of newEvents) {
    if (!event.work_id) { orphanEvents.push(event); continue; }
    if (!eventsByWork.has(event.work_id)) eventsByWork.set(event.work_id, []);
    eventsByWork.get(event.work_id).push(event);
  }
  const finalEvents = [];
  for (const group of eventsByWork.values()) finalEvents.push(...assignViewingRelations(group));

  return { works: newWorks, records: newRecords, viewingEvents: [...finalEvents, ...orphanEvents] };
}

function buildBackupPayload({ records, works, viewingEvents }) {
  return {
    schema_version: "movie-imprint-pre-r1-backup-0.1",
    exported_at: new Date().toISOString(),
    counts: { records: records.length, works: works.length, viewingEvents: viewingEvents.length },
    records,
    works,
    viewingEvents
  };
}

function backupFilename(now = new Date()) {
  return `movie-imprint-backup-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

/**
 * 执行一次性迁移（幂等）。
 * @param {{ get: Function, getAll: Function, put: Function, delete: Function }} db
 * @param {{ exportBackup: (payload: object, filename: string) => Promise<void> }} deps
 * @returns {Promise<{ ok: true, skipped: boolean, stats?: object } | { ok: false, error: string }>}
 */
export async function runMigrationIfNeeded(db, { exportBackup } = {}) {
  try {
    const meta = await db.get("meta", MIGRATION_META_ID);
    if (meta?.migration_version === MIGRATION_VERSION) {
      return { ok: true, skipped: true };
    }

    const [records, works, viewingEvents] = await Promise.all([
      db.getAll("records"),
      db.getAll("works"),
      db.getAll("viewingEvents")
    ]);

    // 第一步：先备份，备份失败则终止迁移，不写库
    if (typeof exportBackup !== "function") {
      return { ok: false, error: "备份函数未提供，迁移已终止" };
    }
    const backupPayload = buildBackupPayload({ records, works, viewingEvents });
    try {
      await exportBackup(backupPayload, backupFilename());
    } catch (error) {
      return { ok: false, error: `备份失败，迁移已终止：${error.message}` };
    }

    // 第二～七步：全部在内存中完成，校验通过后才批量写库
    const migrated = buildMigratedDataset({ records, works, viewingEvents });

    // 被合并掉的旧 work 行必须物理删除，否则会在 works store 里留下"幽灵重复条目"——
    // 它们已经不被任何 record/viewingEvent 引用（都改指到 merged_from 收敛后的主 work），
    // 但如果不删除，store 里仍会同时存在新旧两条，破坏"同一部电影只有一个 Work"这条红线。
    const finalWorkIds = new Set(migrated.works.map((work) => work.id));
    const staleWorkIds = works.map((work) => work.id).filter((id) => !finalWorkIds.has(id));

    await Promise.all(migrated.works.map((work) => db.put("works", work)));
    await Promise.all(staleWorkIds.map((id) => db.delete("works", id)));
    await Promise.all(migrated.viewingEvents.map((event) => db.put("viewingEvents", event)));
    await Promise.all(migrated.records.map((record) => db.put("records", record)));

    const migrationMeta = {
      id: MIGRATION_META_ID,
      migration_version: MIGRATION_VERSION,
      migration_ran_at: new Date().toISOString()
    };
    await db.put("meta", migrationMeta);

    return {
      ok: true,
      skipped: false,
      stats: {
        worksBefore: works.length,
        worksAfter: migrated.works.length,
        recordsMigrated: migrated.records.length,
        viewingEventsAfter: migrated.viewingEvents.length
      }
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
