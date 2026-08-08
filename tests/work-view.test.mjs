import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkView,
  buildHistory,
  buildAttitudeTimeline,
  buildImpressions,
  buildStats,
  findWorkById,
  impressionKindLabel,
  indexEventsByRecord,
  summarizeWorksForShelf,
  filterShelfEntries,
  sortShelfEntries
} from "../src/work-view.js";

function makeWork(overrides = {}) {
  return {
    id: "work_1",
    title: "测试作品",
    work_type: "animation_film",
    merged_from: [],
    ...overrides
  };
}

function makeEvent(overrides = {}) {
  return {
    id: "ve_1",
    work_id: "work_1",
    record_id: null,
    location_type: "cinema",
    viewed_on: "2026-08-03",
    screening_at: "2026-08-03T19:20:00+09:00",
    duration_minutes: 120,
    viewing_relation: "first",
    watch_index: 1,
    ticket_price: { amount: 2000, currency: "JPY" },
    viewing_context: { cinema_name: "TOHO シネマズ 新宿", format: "IMAX", event_types: [], bonus_note: null },
    ...overrides
  };
}

function makeRecord(overrides = {}) {
  return {
    id: "record_1",
    work_id: "work_1",
    viewing_event_id: null,
    record_kind: "viewing",
    attitude: null,
    cards: [],
    createdAt: "2026-08-03T20:00:00+09:00",
    ...overrides
  };
}

test("一个 work + 2 个 event + 3 条 record（含 1 条 supplement）→ 履历 2 项、感想 3 项", () => {
  const events = [
    makeEvent({ id: "ve_1", viewed_on: "2026-08-03", screening_at: "2026-08-03T19:20:00+09:00", viewing_relation: "first", watch_index: 1 }),
    makeEvent({ id: "ve_2", viewed_on: "2026-11-20", screening_at: null, viewing_relation: "rewatch", watch_index: 2, location_type: "home", viewing_context: { cinema_name: null, format: null, event_types: [], bonus_note: null } })
  ];
  const records = [
    makeRecord({ id: "r1", viewing_event_id: "ve_1", createdAt: "2026-08-03T20:00:00+09:00" }),
    makeRecord({ id: "r2", viewing_event_id: "ve_2", createdAt: "2026-11-20T20:00:00+09:00" }),
    makeRecord({ id: "r3", viewing_event_id: null, record_kind: "supplement", createdAt: "2029-03-02T10:00:00+09:00" })
  ];
  const view = buildWorkView(makeWork(), records, events);
  assert.equal(view.history.length, 2);
  assert.equal(view.impressions.length, 3);
});

test("只有 1 条 record → attitudeTimeline 为空数组", () => {
  const records = [makeRecord({ id: "r1", attitude: "love" })];
  const view = buildWorkView(makeWork(), records, []);
  assert.deepEqual(view.attitudeTimeline, []);
});

test("在家 first + 影院 rewatch 的履历顺序与标注正确，不因影院而颠倒", () => {
  const events = [
    makeEvent({
      id: "ve_home_first",
      viewed_on: "2020-01-01",
      screening_at: null,
      location_type: "home",
      viewing_relation: "first",
      watch_index: 1,
      viewing_context: { cinema_name: null, format: null, event_types: [], bonus_note: null }
    }),
    makeEvent({
      id: "ve_cinema_rewatch",
      viewed_on: "2026-08-03",
      screening_at: "2026-08-03T19:20:00+09:00",
      location_type: "cinema",
      viewing_relation: "rewatch",
      watch_index: 2
    })
  ];
  const history = buildHistory(events);
  assert.equal(history[0].id, "ve_home_first");
  assert.equal(history[0].viewing_relation, "first");
  assert.equal(history[0].location_type, "home");
  assert.equal(history[1].id, "ve_cinema_rewatch");
  assert.equal(history[1].viewing_relation, "rewatch");
  assert.equal(history[1].location_type, "cinema");
});

test("7 个 event → 履历 7 项，watch_index 1..7 完整", () => {
  const events = Array.from({ length: 7 }, (_, i) => makeEvent({
    id: `ve_${i + 1}`,
    viewed_on: `2020-0${(i % 9) + 1}-01`,
    screening_at: `2020-0${(i % 9) + 1}-01T10:00:00+09:00`,
    watch_index: i + 1,
    viewing_relation: i === 0 ? "first" : "rewatch"
  }));
  const history = buildHistory(events);
  assert.equal(history.length, 7);
  assert.deepEqual(history.map((e) => e.watch_index), [1, 2, 3, 4, 5, 6, 7]);
});

test("relation_conflict: true 的事件被标出，供 UI 显示提示", () => {
  const events = [
    makeEvent({ id: "ve_1", relation_conflict: true }),
    makeEvent({ id: "ve_2", viewed_on: "2026-09-01", screening_at: "2026-09-01T10:00:00+09:00" })
  ];
  const history = buildHistory(events);
  assert.equal(history.find((e) => e.id === "ve_1").relation_conflict, true);
  assert.equal(history.find((e) => e.id === "ve_2").relation_conflict, undefined);
});

test("attitudeTimeline 节点用日期标注，supplement 记录也在链上且不带「重看」字样", () => {
  const events = [makeEvent({ id: "ve_1" })];
  const records = [
    makeRecord({ id: "r1", viewing_event_id: "ve_1", attitude: "like", createdAt: "2026-08-03T20:00:00+09:00" }),
    makeRecord({ id: "r2", viewing_event_id: null, record_kind: "supplement", attitude: "love", createdAt: "2029-03-02T10:00:00+09:00" })
  ];
  const eventsByRecordId = indexEventsByRecord(records, events);
  const timeline = buildAttitudeTimeline(records, eventsByRecordId);
  assert.equal(timeline.length, 2);
  for (const node of timeline) {
    assert.ok(node.date, "节点必须带日期");
    assert.ok(!/初看|重看/.test(JSON.stringify(node)), "节点不得出现初看/重看字样");
  }
  assert.equal(timeline[0].recordId, "r1");
  assert.equal(timeline[1].recordId, "r2");
});

test("态度为空的 record 不进 attitudeTimeline", () => {
  const records = [
    makeRecord({ id: "r1", attitude: "like" }),
    makeRecord({ id: "r2", attitude: null }),
    makeRecord({ id: "r3", attitude: "love" })
  ];
  const timeline = buildAttitudeTimeline(records, new Map());
  assert.equal(timeline.length, 2);
  assert.ok(timeline.every((node) => node.recordId !== "r2"));
});

test("stats.totalMinutes / stats.totalSpent 正确累加，缺值不计入且不产生 NaN", () => {
  const events = [
    makeEvent({ id: "ve_1", duration_minutes: 120, ticket_price: { amount: 2000, currency: "JPY" } }),
    makeEvent({ id: "ve_2", duration_minutes: null, ticket_price: null }),
    makeEvent({ id: "ve_3", duration_minutes: 90, ticket_price: { amount: 1500, currency: "JPY" } })
  ];
  const stats = buildStats(events);
  assert.equal(stats.totalMinutes, 210);
  assert.equal(stats.totalSpent, 3500);
  assert.equal(Number.isNaN(stats.totalMinutes), false);
  assert.equal(Number.isNaN(stats.totalSpent), false);
});

test("stats.eventTypeCounts：两场都有舞台挨拶 → {stage_greeting: 2}；无活动 → 空对象", () => {
  const withEvents = [
    makeEvent({ id: "ve_1", viewing_context: { cinema_name: null, format: null, event_types: ["stage_greeting"], bonus_note: null } }),
    makeEvent({ id: "ve_2", viewing_context: { cinema_name: null, format: null, event_types: ["stage_greeting"], bonus_note: null } })
  ];
  assert.deepEqual(buildStats(withEvents).eventTypeCounts, { stage_greeting: 2 });

  const withoutEvents = [makeEvent({ id: "ve_1", viewing_context: { cinema_name: null, format: null, event_types: [], bonus_note: null } })];
  assert.deepEqual(buildStats(withoutEvents).eventTypeCounts, {});
});

test("作品页显示全部活动徽章，不做首页的 2 个截断", () => {
  const event = makeEvent({
    id: "ve_1",
    viewing_context: { cinema_name: "TOHO", format: "IMAX", event_types: ["stage_greeting", "talk_show", "bonus_distribution", "advance_screening"], bonus_note: "第3週 色紙" }
  });
  const history = buildHistory([event]);
  assert.equal(history[0].viewing_context.event_types.length, 4);
});

test("supplement record 不产生 ViewingEvent：buildWorkView 对无关联事件的 supplement 正常工作", () => {
  const events = [makeEvent({ id: "ve_1" })];
  const records = [
    makeRecord({ id: "r1", viewing_event_id: "ve_1" }),
    makeRecord({ id: "r2", viewing_event_id: null, record_kind: "supplement" })
  ];
  const view = buildWorkView(makeWork(), records, events);
  assert.equal(view.history.length, 1); // supplement 记录没有对应事件，不计入履历
  assert.equal(view.impressions.length, 2);
  const supplementImpression = view.impressions.find((i) => i.recordId === "r2");
  assert.equal(supplementImpression.kind, "supplement");
  assert.equal(impressionKindLabel(records[1], null), "补充记录");
});

test("summarizeWorksForShelf：按作品聚合观看次数与是否有活动场次，含 merged_from 旧 id", () => {
  const works = [
    makeWork({ id: "work_a", merged_from: ["work_a_old"] }),
    makeWork({ id: "work_b", first_recorded_at: "2020-01-01T00:00:00+09:00" })
  ];
  const events = [
    makeEvent({ id: "ve_1", work_id: "work_a_old", viewed_on: "2020-01-01", screening_at: "2020-01-01T10:00:00+09:00" }),
    makeEvent({ id: "ve_2", work_id: "work_a", viewed_on: "2026-08-03", screening_at: "2026-08-03T19:20:00+09:00", viewing_context: { cinema_name: null, format: null, event_types: ["stage_greeting"], bonus_note: null } })
  ];
  const summary = summarizeWorksForShelf(works, events);
  const a = summary.find((s) => s.work.id === "work_a");
  const b = summary.find((s) => s.work.id === "work_b");
  assert.equal(a.watchCount, 2);
  assert.equal(a.lastWatchedAt, "2026-08-03T19:20:00+09:00");
  assert.equal(a.hasEvents, true);
  assert.equal(b.watchCount, 0);
  assert.equal(b.hasEvents, false);
  assert.equal(b.lastWatchedAt, "2020-01-01T00:00:00+09:00"); // 没有事件时退回 first_recorded_at
});

test("filterShelfEntries：work_type 筛选（含未分类）与有活动场次筛选", () => {
  const entries = [
    { work: makeWork({ id: "w1", work_type: "animation_film" }), hasEvents: true },
    { work: makeWork({ id: "w2", work_type: "unspecified" }), hasEvents: false },
    { work: makeWork({ id: "w3", work_type: "live_action_film" }), hasEvents: true },
    { work: makeWork({ id: "w4", work_type: "other" }), hasEvents: false }
  ];
  assert.deepEqual(filterShelfEntries(entries, { workType: "all" }).map((e) => e.work.id), ["w1", "w2", "w3", "w4"]);
  assert.deepEqual(filterShelfEntries(entries, { eventsOnly: true }).map((e) => e.work.id), ["w1", "w3"]);
  // 用户反馈：浏览筛选栏里"未分类"要同时吃掉 other 与 unspecified 两个 work_type
  // 取值——两者在筛选这一层是同一件事，不需要在书架 chip 上分成两格。
  assert.deepEqual(filterShelfEntries(entries, { workType: "unspecified" }).map((e) => e.work.id), ["w2", "w4"]);
  assert.deepEqual(filterShelfEntries(entries, { workType: "event" }).map((e) => e.work.id), []);
});

test("sortShelfEntries：最近观看（默认）/ 观看次数 / 首次记录时间", () => {
  const entries = [
    { work: makeWork({ id: "w1", first_recorded_at: "2022-01-01" }), watchCount: 1, lastWatchedAt: "2024-01-01" },
    { work: makeWork({ id: "w2", first_recorded_at: "2020-01-01" }), watchCount: 5, lastWatchedAt: "2026-01-01" }
  ];
  assert.deepEqual(sortShelfEntries(entries, "recent").map((e) => e.work.id), ["w2", "w1"]);
  assert.deepEqual(sortShelfEntries(entries, "count").map((e) => e.work.id), ["w2", "w1"]);
  assert.deepEqual(sortShelfEntries(entries, "first").map((e) => e.work.id), ["w2", "w1"]);
});

test("merged_from 里的旧 work id 也能查到该 work", () => {
  const works = [makeWork({ id: "work_bgm_123", merged_from: ["work_local_old-title"] })];
  assert.equal(findWorkById(works, "work_bgm_123")?.id, "work_bgm_123");
  assert.equal(findWorkById(works, "work_local_old-title")?.id, "work_bgm_123");
  assert.equal(findWorkById(works, "work_does_not_exist"), undefined);
});

// ─── R6：书架 = 全部 Work 总库，观看状态筛选 ──────────────────────────────────

const shelfWork = (id, extra = {}) => ({ id, title: id, work_type: "unspecified", merged_from: [], first_recorded_at: "2026-01-01T00:00:00.000Z", ...extra });

test("R6：summarizeWorksForShelf 派生 isWatched —— 有 Record 但没有 ViewingEvent 也算已看", () => {
  const works = [shelfWork("w_event"), shelfWork("w_record"), shelfWork("w_none")];
  const events = [{ id: "e1", work_id: "w_event", viewed_on: "2026-03-01" }];
  const records = [{ id: "r1", work_id: "w_record" }];

  const summaries = summarizeWorksForShelf(works, events, { records, collections: [] });
  const byId = Object.fromEntries(summaries.map((s) => [s.work.id, s]));

  assert.equal(byId.w_event.isWatched, true);
  // 补充记录不产生 ViewingEvent，只看 Event 会把确实看过的作品误判成没看过
  assert.equal(byId.w_record.isWatched, true, "有 Record 无 Event 也必须算已看");
  assert.equal(byId.w_none.isWatched, false);
});

test("R6：summarizeWorksForShelf 派生 inCollection，含 merged_from 回查", () => {
  const works = [shelfWork("w1"), shelfWork("w_merged", { merged_from: ["w_old"] }), shelfWork("w_free")];
  const collections = [
    { id: "c1", entries: [{ work_id: "w1" }, { work_id: "w_old" }] }
  ];
  const byId = Object.fromEntries(
    summarizeWorksForShelf(works, [], { records: [], collections }).map((s) => [s.work.id, s])
  );
  assert.equal(byId.w1.inCollection, true);
  assert.equal(byId.w_merged.inCollection, true, "片单里存的是合并前的旧 id，也要能认出来");
  assert.equal(byId.w_free.inCollection, false);
});

test("R6：三种观看状态的筛选定义", () => {
  const entries = [
    { work: shelfWork("watched"), watchCount: 1, hasEvents: false, isWatched: true, inCollection: false },
    { work: shelfWork("want"), watchCount: 0, hasEvents: false, isWatched: false, inCollection: true },
    { work: shelfWork("orphan"), watchCount: 0, hasEvents: false, isWatched: false, inCollection: false }
  ];
  const ids = (filter) => filterShelfEntries(entries, filter).map((e) => e.work.id);

  assert.deepEqual(ids({ watchStatus: "watched" }), ["watched"]);
  // 想看 = 没看过 且 至少在一个片单里；既没看过又不在任何片单里的只是孤立条目
  assert.deepEqual(ids({ watchStatus: "want" }), ["want"]);
  assert.deepEqual(ids({ watchStatus: "all" }), ["watched", "want", "orphan"]);
});

test("R6：观看状态与作品类型两个维度正交", () => {
  const entries = [
    { work: shelfWork("a", { work_type: "animation_film" }), watchCount: 0, hasEvents: false, isWatched: false, inCollection: true },
    { work: shelfWork("b", { work_type: "live_action_film" }), watchCount: 0, hasEvents: false, isWatched: false, inCollection: true },
    { work: shelfWork("c", { work_type: "animation_film" }), watchCount: 2, hasEvents: false, isWatched: true, inCollection: false }
  ];
  const got = filterShelfEntries(entries, { watchStatus: "want", workType: "animation_film" });
  assert.deepEqual(got.map((e) => e.work.id), ["a"]);
});

test("R6：想看状态下「特别场次」筛选被短路（没有观影事件就不可能有舞台挨拶）", () => {
  const entries = [
    { work: shelfWork("want"), watchCount: 0, hasEvents: false, isWatched: false, inCollection: true }
  ];
  assert.equal(filterShelfEntries(entries, { watchStatus: "want", eventsOnly: true }).length, 1);
  assert.equal(filterShelfEntries(entries, { watchStatus: "all", eventsOnly: true }).length, 0);
});

test("R6 §10：想看状态强制按「首次记录」排序，不发明新的排序体系", () => {
  const entries = [
    { work: shelfWork("late", { first_recorded_at: "2026-08-20T00:00:00.000Z" }), watchCount: 0, lastWatchedAt: "2026-08-20T00:00:00.000Z", isWatched: false, inCollection: true },
    { work: shelfWork("early", { first_recorded_at: "2026-08-08T00:00:00.000Z" }), watchCount: 0, lastWatchedAt: "2026-08-08T00:00:00.000Z", isWatched: false, inCollection: true }
  ];
  // 即便调用方传的是「最近观看」，想看状态也应落到首次记录顺序
  const sorted = sortShelfEntries(entries, "recent", { watchStatus: "want" });
  assert.deepEqual(sorted.map((e) => e.work.id), ["early", "late"]);

  // 已看状态下排序行为不变
  const watched = sortShelfEntries(entries, "recent", { watchStatus: "watched" });
  assert.deepEqual(watched.map((e) => e.work.id), ["late", "early"]);
});

test("R6 §14：看完之后作品自动从「想看」转到「已看」，不产生第二个 Work", () => {
  const birdman = shelfWork("work_birdman", { first_recorded_at: "2026-08-08T00:00:00.000Z" });
  const collections = [{ id: "c1", entries: [{ work_id: "work_birdman", reason: "因为 Michael Keaton" }] }];

  const before = summarizeWorksForShelf([birdman], [], { records: [], collections });
  assert.deepEqual(filterShelfEntries(before, { watchStatus: "want" }).map((e) => e.work.id), ["work_birdman"]);
  assert.deepEqual(filterShelfEntries(before, { watchStatus: "watched" }), []);

  // 9/5 真的看了：新增一条 ViewingEvent，Work 本身没变
  const after = summarizeWorksForShelf([birdman], [
    { id: "e1", work_id: "work_birdman", viewed_on: "2026-09-05" }
  ], { records: [{ id: "r1", work_id: "work_birdman" }], collections });

  assert.deepEqual(filterShelfEntries(after, { watchStatus: "watched" }).map((e) => e.work.id), ["work_birdman"]);
  assert.deepEqual(filterShelfEntries(after, { watchStatus: "want" }), [], "看完后应从想看里消失");
  // 片单条目与 first_recorded_at 都不受影响
  assert.equal(collections[0].entries[0].reason, "因为 Michael Keaton");
  assert.equal(after[0].work.first_recorded_at, "2026-08-08T00:00:00.000Z", "首次记录时间不因为后来看了而改变");
});
