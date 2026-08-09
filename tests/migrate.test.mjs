import test from "node:test";
import assert from "node:assert/strict";
import { buildMigratedDataset, runMigrationIfNeeded } from "../src/migrate.js";

// ─── 内存 mock db：满足 { get, getAll, put } 接口，与 src/db.js 的真实实现兼容 ──

function createMockDb(seed = {}) {
  const stores = {
    records: [...(seed.records || [])],
    works: [...(seed.works || [])],
    viewingEvents: [...(seed.viewingEvents || [])],
    meta: [...(seed.meta || [])]
  };
  return {
    stores,
    async get(store, id) {
      return stores[store]?.find((item) => item.id === id);
    },
    async getAll(store) {
      return stores[store] ? [...stores[store]] : [];
    },
    async put(store, value) {
      const list = stores[store] || (stores[store] = []);
      const index = list.findIndex((item) => item.id === value.id);
      if (index === -1) list.push(value);
      else list[index] = value;
    },
    async delete(store, id) {
      const list = stores[store] || (stores[store] = []);
      const index = list.findIndex((item) => item.id === id);
      if (index !== -1) list.splice(index, 1);
    }
  };
}

function work(overrides = {}) {
  return {
    id: "work_local_a",
    title: "某部电影",
    aliases: [],
    external_refs: [],
    identity_status: "local_only",
    first_recorded_at: "2026-01-01T00:00:00.000Z",
    merged_from: [],
    ...overrides
  };
}

function record(overrides = {}) {
  return {
    id: "record_1",
    title: "某部电影",
    rawText: "占位测试文本",
    createdAt: "2026-01-01T00:00:00.000Z",
    work_id: "work_local_a",
    workId: "work_local_a",
    ...overrides
  };
}

const okBackup = async () => {};
const failingBackup = async () => { throw new Error("模拟磁盘写入失败"); };

// ─── buildMigratedDataset：核心去重与回填逻辑 ─────────────────────────────────

test("3 条 record 指向 3 个同名重复 work → 迁移后 1 个 work，3 条 record 全部指过去", () => {
  const works = [
    work({ id: "work_local_a", title: "同一部电影", first_recorded_at: "2026-01-03T00:00:00.000Z" }),
    work({ id: "work_local_b", title: "同一部电影", first_recorded_at: "2026-01-01T00:00:00.000Z" }),
    work({ id: "work_local_c", title: "同一部电影", first_recorded_at: "2026-01-02T00:00:00.000Z" })
  ];
  const records = [
    record({ id: "r1", work_id: "work_local_a", workId: "work_local_a" }),
    record({ id: "r2", work_id: "work_local_b", workId: "work_local_b" }),
    record({ id: "r3", work_id: "work_local_c", workId: "work_local_c" })
  ];

  const result = buildMigratedDataset({ records, works, viewingEvents: [] });

  assert.equal(result.works.length, 1, "3 个同名 work 应合并为 1 个");
  const canonicalId = result.works[0].id;
  assert.equal(canonicalId, "work_local_b", "应选 first_recorded_at 最早的一方为主");
  assert.ok(result.records.every((r) => r.work_id === canonicalId));
  assert.equal(result.records.length, 3, "记录条数不应丢失");
});

test("已匹配 Bangumi 的一方优先作为主 work", () => {
  const works = [
    work({ id: "work_local_a", title: "同一部电影", identity_status: "local_only", first_recorded_at: "2026-01-01T00:00:00.000Z" }),
    work({
      id: "work_bgm_99",
      title: "同一部电影",
      identity_status: "matched",
      external_refs: [{ source: "bangumi", id: "99" }],
      first_recorded_at: "2026-01-05T00:00:00.000Z"
    })
  ];
  const result = buildMigratedDataset({ records: [], works, viewingEvents: [] });
  assert.equal(result.works.length, 1);
  assert.equal(result.works[0].id, "work_bgm_99", "即便更晚记录，已匹配一方也应优先作为主体");
  assert.deepEqual(result.works[0].merged_from, ["work_local_a"]);
});

test("无 ViewingEvent 的旧 record 被补建 online + needs_review 的 Event", () => {
  const works = [work()];
  const records = [record()];
  const result = buildMigratedDataset({ records, works, viewingEvents: [] });

  assert.equal(result.viewingEvents.length, 1);
  const event = result.viewingEvents[0];
  assert.equal(event.location_type, "online");
  assert.equal(event.source, "none");
  assert.equal(event.needs_review, true);
  assert.equal(event.work_id, result.works[0].id);
  assert.equal(result.records[0].viewing_event_id, event.id);
});

test("viewing_relation 与 watch_index 正确回填", () => {
  const works = [work()];
  const records = [record({ id: "r1" }), record({ id: "r2" })];
  const viewingEvents = [
    { id: "ve1", work_id: "work_local_a", record_id: "r1", screening_at: "2026-03-01T00:00:00+09:00" },
    { id: "ve2", work_id: "work_local_a", record_id: "r2", screening_at: "2026-01-01T00:00:00+09:00" }
  ];
  const result = buildMigratedDataset({ records, works, viewingEvents });
  const byId = Object.fromEntries(result.viewingEvents.map((e) => [e.id, e]));
  assert.equal(byId.ve2.viewing_relation, "first");
  assert.equal(byId.ve2.watch_index, 1);
  assert.equal(byId.ve1.viewing_relation, "rewatch");
  assert.equal(byId.ve1.watch_index, 2);
});

test("幽灵重复条目：升格后残留的旧 local work（无记录、无海报）应被去重删除，只留匹配到 Bangumi 的一方", () => {
  // 复现用户反馈的真实场景：confirmWorkMatch() 升格 work 时曾经漏删旧的本地 work
  // 文档——旧文档的 title 会被并入新 work 的 aliases（promoteWorkToMatched 的行为），
  // 但旧文档自己既没有海报（poster 为空）也没有任何 record/viewingEvent
  // 指向它（升格时全部改指到新 id 了）。
  const ghost = work({
    id: "work_local_old-title",
    title: "旧标题",
    identity_status: "local_only",
    poster: null
  });
  const matched = work({
    id: "work_bgm_555",
    title: "新标题",
    identity_status: "matched",
    poster: { source: "bangumi", subject_id: 555 },
    external_refs: [{ source: "bangumi", id: "555" }],
    aliases: ["旧标题"], // 升格时并入的旧标题别名
    merged_from: ["work_local_old-title"]
  });
  const records = [record({ id: "r1", work_id: "work_bgm_555", workId: "work_bgm_555" })];

  const result = buildMigratedDataset({ records, works: [ghost, matched], viewingEvents: [] });

  assert.equal(result.works.length, 1, "幽灵条目应被合并删除，只剩已匹配的一方");
  assert.equal(result.works[0].id, "work_bgm_555");
  assert.deepEqual(result.works[0].poster, { source: "bangumi", subject_id: 555 });
  assert.ok(result.works[0].merged_from.includes("work_local_old-title"));
});

test("R5：旧的 release_dates.{jp,cn} 被归一化成带地区的 entries，并补齐 tagline/related_refs", () => {
  const works = [work({ id: "w1", title: "某片", release_dates: { jp: "2012-10-06", cn: "2013-02-01", other: [] } })];
  const [migrated] = buildMigratedDataset({ records: [], works, viewingEvents: [] }).works;
  assert.deepEqual(migrated.release_dates.entries.map((entry) => [entry.region, entry.date]), [
    ["jp", "2012-10-06"],
    ["cn", "2013-02-01"]
  ]);
  assert.deepEqual(migrated.related_refs, []);
  assert.equal(migrated.tagline, null);
});

// ─── runMigrationIfNeeded：备份、幂等、回滚 ───────────────────────────────────

test("迁移前先备份；备份失败则不写库，返回 ok:false", async () => {
  const db = createMockDb({ works: [work()], records: [record()] });
  const result = await runMigrationIfNeeded(db, { exportBackup: failingBackup });
  assert.equal(result.ok, false);
  assert.equal(db.stores.works.length, 1, "不应写入迁移后的数据");
  assert.equal(db.stores.works[0].id, "work_local_a", "原数据应保持不变");
  assert.equal(db.stores.meta.length, 0, "不应写入迁移标记");
});

test("未提供 exportBackup 时不写库，返回 ok:false", async () => {
  const db = createMockDb({ works: [work()], records: [record()] });
  const result = await runMigrationIfNeeded(db, {});
  assert.equal(result.ok, false);
  assert.equal(db.stores.meta.length, 0);
});

test("迁移成功：备份被调用、写入去重后的数据、写入 migration_version", async () => {
  let backupCalled = false;
  let backupPayload = null;
  const db = createMockDb({
    works: [
      work({ id: "work_local_a", title: "重复片", first_recorded_at: "2026-01-02T00:00:00.000Z" }),
      work({ id: "work_local_b", title: "重复片", first_recorded_at: "2026-01-01T00:00:00.000Z" })
    ],
    records: [
      record({ id: "r1", work_id: "work_local_a", workId: "work_local_a" }),
      record({ id: "r2", work_id: "work_local_b", workId: "work_local_b" })
    ]
  });
  const result = await runMigrationIfNeeded(db, {
    exportBackup: async (payload) => { backupCalled = true; backupPayload = payload; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(backupCalled, true, "应先导出备份");
  assert.equal(backupPayload.works.length, 2, "备份应包含迁移前的完整原始数据");
  assert.equal(db.stores.works.length, 1, "迁移后应只剩 1 个 work");
  assert.equal(db.stores.records.length, 2, "记录条数不应丢失");
  const meta = db.stores.meta.find((item) => item.id === "migration-status");
  assert.equal(meta.migration_version, "v2.1-self-interview-analysis-lifecycle");
  assert.ok(meta.migration_ran_at);
});

test("迁移幂等：连续跑两次结果一致，第二次直接跳过", async () => {
  const db = createMockDb({
    works: [work({ id: "work_local_a" }), work({ id: "work_local_b", title: "某部电影" })],
    records: [record({ id: "r1" }), record({ id: "r2", work_id: "work_local_b", workId: "work_local_b" })]
  });
  const first = await runMigrationIfNeeded(db, { exportBackup: okBackup });
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);

  const worksAfterFirst = JSON.stringify(db.stores.works);
  const recordsAfterFirst = JSON.stringify(db.stores.records);

  const second = await runMigrationIfNeeded(db, { exportBackup: okBackup });
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true, "第二次应直接跳过，不重复处理");
  assert.equal(JSON.stringify(db.stores.works), worksAfterFirst, "结果应保持一致");
  assert.equal(JSON.stringify(db.stores.records), recordsAfterFirst, "结果应保持一致");
});

test("中途抛错 → 原数据完好，不写库", async () => {
  const works = [work()];
  const records = [record()];
  const db = createMockDb({ works, records });
  // 让 getAll("viewingEvents") 抛错，模拟迁移中途失败——此时备份与写库都还没发生
  const originalGetAll = db.getAll.bind(db);
  db.getAll = async (store) => {
    if (store === "viewingEvents") throw new Error("模拟读取失败");
    return originalGetAll(store);
  };

  const result = await runMigrationIfNeeded(db, { exportBackup: okBackup });
  assert.equal(result.ok, false);
  assert.equal(db.stores.works.length, 1);
  assert.equal(db.stores.works[0].id, "work_local_a", "原数据应保持不变");
  assert.equal(db.stores.meta.length, 0);
});
