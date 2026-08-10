/**
 * 回归测试：把记录改挂到另一部作品（detachRecordsToWork）
 * 与「候选其实是另一部电影」的识别（candidateIdentityConflict）。
 *
 * 复盘的线上 bug：
 *   用户在 1989《魔女宅急便》动画版条目下新记了一条 2014 真人版的感想，
 *   然后从详情页「作品条目 · 点击修改」选了真人版候选。
 *   当时全项目没有任何一条代码路径能把**单条记录**改挂到另一部作品，
 *   那个入口做的是就地改写整个 Work，于是同条目下的**全部**动画版感想
 *   跟着一起变成了真人版。
 *
 * 因此这里的核心断言只有一句话：**原作品必须一个字段都没被动过。**
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detachRecordsToWork, candidateIdentityConflict, assignViewingRelations } from "../src/domain.js";

// ── 构造与截图一致的现场 ────────────────────────────────────────────────────
function scene() {
  const animeWork = {
    id: "work_anime",
    title: "魔女宅急便",
    work_type: "animation_film",
    release_year: 1989,
    aliases: ["魔女宅急便", "魔女の宅急便"],
    external_refs: [{ source: "bangumi", id: "1000" }],
    poster: { source: "bangumi", subject_id: 1000 },
    identity_status: "matched",
    merged_from: []
  };
  const liveWork = {
    id: "work_live",
    title: "魔女宅急便 真人版",
    work_type: "unspecified",
    release_year: null,
    aliases: ["魔女宅急便 真人版"],
    external_refs: [],
    poster: null,
    identity_status: "local_only",
    merged_from: []
  };
  // 四条感想全挂在动画版条目下，其中 r_live（6/21）其实是真人版的
  const records = [
    { id: "r1", work_id: "work_anime", workId: "work_anime", viewing_event_id: "e1", rawText: "第一次" },
    { id: "r_live", work_id: "work_anime", workId: "work_anime", viewing_event_id: "e_live", rawText: "真人版" },
    { id: "r3", work_id: "work_anime", workId: "work_anime", viewing_event_id: "e3", rawText: "Dolby" },
    { id: "r4", work_id: "work_anime", workId: "work_anime", viewing_event_id: "e4", rawText: "第四次" }
  ];
  const events = [
    { id: "e1", work_id: "work_anime", record_id: "r1", viewed_on: "2025-01-05" },
    { id: "e_live", work_id: "work_anime", record_id: "r_live", viewed_on: "2026-06-21" },
    { id: "e3", work_id: "work_anime", record_id: "r3", viewed_on: "2026-07-08" },
    { id: "e4", work_id: "work_anime", record_id: "r4", viewed_on: "2026-07-10" }
  ];
  return { animeWork, liveWork, records, events };
}

test("拆分记录后，原作品条目对象一个字段都没被改动", () => {
  const { animeWork, liveWork, records, events } = scene();
  const before = JSON.stringify(animeWork);

  detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events, recordIds: ["r_live"]
  });

  assert.equal(JSON.stringify(animeWork), before, "fromWork 被修改了——这正是那个 bug");
});

test("只有被勾选的那条记录改指，其余记录纹丝不动", () => {
  const { animeWork, liveWork, records, events } = scene();
  const { movedRecords } = detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events, recordIds: ["r_live"]
  });

  assert.equal(movedRecords.length, 1);
  assert.equal(movedRecords[0].id, "r_live");
  assert.equal(movedRecords[0].work_id, "work_live");
  assert.equal(movedRecords[0].workId, "work_live", "兼容字段 workId 也必须一起改");

  // 入参数组里的其他记录不能被就地改写
  for (const id of ["r1", "r3", "r4"]) {
    assert.equal(records.find((r) => r.id === id).work_id, "work_anime");
  }
});

test("场次跟着记录走，两侧的初看/重看编号各自重排", () => {
  const { animeWork, liveWork, records, events } = scene();
  const { stayingEvents, movedEvents } = detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events, recordIds: ["r_live"]
  });

  assert.equal(stayingEvents.length, 3);
  assert.equal(movedEvents.length, 1);

  // 留下的三场：1/5、7/8、7/10 → 初看、重看2、重看3（原本 6/21 占着第 2 位）
  const stay = stayingEvents.slice().sort((a, b) => a.watch_index - b.watch_index);
  assert.deepEqual(stay.map((e) => e.id), ["e1", "e3", "e4"]);
  assert.deepEqual(stay.map((e) => e.watch_index), [1, 2, 3]);
  assert.equal(stay[0].viewing_relation, "first");
  assert.equal(stay[1].viewing_relation, "rewatch");

  // 搬走的那场在新作品下是第一次看
  assert.equal(movedEvents[0].id, "e_live");
  assert.equal(movedEvents[0].work_id, "work_live");
  assert.equal(movedEvents[0].watch_index, 1);
  assert.equal(movedEvents[0].viewing_relation, "first");
});

test("目标作品已有场次时，搬过去的一场并入它一起重排", () => {
  const { animeWork, liveWork, records, events } = scene();
  const withExisting = [
    ...events,
    { id: "e_prior", work_id: "work_live", record_id: "r_prior", viewed_on: "2026-05-01" }
  ];

  const { movedEvents } = detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events: withExisting, recordIds: ["r_live"]
  });

  assert.equal(movedEvents.length, 2);
  const sorted = movedEvents.slice().sort((a, b) => a.watch_index - b.watch_index);
  assert.deepEqual(sorted.map((e) => e.id), ["e_prior", "e_live"]);
  assert.deepEqual(sorted.map((e) => e.watch_index), [1, 2]);
  assert.ok(movedEvents.every((e) => e.work_id === "work_live"));
});

test("只有 ViewingEvent.record_id 反向关联的旧记录，场次同样会被搬走", () => {
  const { animeWork, liveWork } = scene();
  // 旧数据没有回填 record.viewing_event_id
  const records = [{ id: "r_old", work_id: "work_anime", workId: "work_anime" }];
  const events = [{ id: "e_old", work_id: "work_anime", record_id: "r_old", viewed_on: "2026-06-21" }];

  const { movedEvents, stayingEvents } = detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events, recordIds: ["r_old"]
  });

  assert.equal(movedEvents.length, 1, "反向关联的场次漏搬了");
  assert.equal(movedEvents[0].id, "e_old");
  assert.equal(stayingEvents.length, 0);
});

test("merged_from 里的旧 id 下挂着的记录与场次同样算作 fromWork 的", () => {
  const { liveWork } = scene();
  const animeWork = {
    id: "work_anime", title: "魔女宅急便", merged_from: ["work_old"], release_year: 1989
  };
  const records = [{ id: "r_x", work_id: "work_old", workId: "work_old", viewing_event_id: "e_x" }];
  const events = [{ id: "e_x", work_id: "work_old", record_id: "r_x", viewed_on: "2026-06-21" }];

  const { movedRecords, movedEvents } = detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events, recordIds: ["r_x"]
  });

  assert.equal(movedRecords.length, 1);
  assert.equal(movedEvents.length, 1);
});

test("from 与 to 是同一个作品时，什么都不做", () => {
  const { animeWork, records, events } = scene();
  const result = detachRecordsToWork({
    fromWork: animeWork, toWork: animeWork, records, events, recordIds: ["r_live"]
  });
  assert.deepEqual(result, { movedRecords: [], stayingEvents: [], movedEvents: [] });
});

test("没勾选任何记录时，原作品的场次编号保持不变", () => {
  const { animeWork, liveWork, records, events } = scene();
  const { movedRecords, stayingEvents } = detachRecordsToWork({
    fromWork: animeWork, toWork: liveWork, records, events, recordIds: []
  });

  assert.equal(movedRecords.length, 0);
  const expected = assignViewingRelations(events);
  assert.deepEqual(
    stayingEvents.map((e) => [e.id, e.watch_index]).sort(),
    expected.map((e) => [e.id, e.watch_index]).sort()
  );
});

// ── 冲突识别 ────────────────────────────────────────────────────────────────

test("年份相差两年以上判定为不同作品", () => {
  const work = { title: "魔女宅急便", release_year: 1989, work_type: "animation_film" };
  const result = candidateIdentityConflict(work, { title: "魔女宅急便", year: 2014, workType: "live_action_film" });
  assert.equal(result.conflict, true);
  assert.match(result.reason, /1989/);
  assert.match(result.reason, /2014/);
});

test("动画与真人判定为不同作品，即使年份缺失", () => {
  const work = { title: "魔女宅急便", release_year: null, work_type: "animation_film" };
  const result = candidateIdentityConflict(work, { title: "魔女宅急便", year: null, workType: "live_action_film" });
  assert.equal(result.conflict, true);
  assert.match(result.reason, /类型/);
});

test("同一部电影的正常匹配不被误判（这条误报会把匹配流程堵死）", () => {
  const work = { title: "魔女宅急便", release_year: 1989, work_type: "animation_film" };
  // 同年、同类型
  assert.equal(candidateIdentityConflict(work, { year: 1989, workType: "animation_film" }).conflict, false);
  // 年份差 1 年（不同地区上映日导致，很常见）
  assert.equal(candidateIdentityConflict(work, { year: 1990, workType: "animation_film" }).conflict, false);
  // 候选没给年份和类型
  assert.equal(candidateIdentityConflict(work, { title: "Kiki's Delivery Service" }).conflict, false);
  // 当前 Work 还没认领类型
  assert.equal(
    candidateIdentityConflict({ release_year: null, work_type: "unspecified" }, { year: 2014, workType: "live_action_film" }).conflict,
    false
  );
});

test("译名差异极大也不算冲突——标题相似度故意不参与判断", () => {
  const work = { title: "魔女宅急便", release_year: 1989, work_type: "animation_film" };
  const result = candidateIdentityConflict(work, {
    title: "Kiki's Delivery Service", year: 1989, workType: "animation_film"
  });
  assert.equal(result.conflict, false);
});
