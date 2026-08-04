import test from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_REGIONS,
  TAGLINE_MAX_LENGTH,
  addReleaseDate,
  addWorkToCollection,
  addWorkToSeries,
  buildTagline,
  collectionWorks,
  collectionsForWork,
  createCollection,
  createSeries,
  findSeriesForWork,
  moveWorkInSeries,
  normalizeReleaseDates,
  orderedSeriesMembers,
  releaseYearOf,
  removeReleaseDate,
  removeSeriesRelation,
  removeWorkFromCollection,
  removeWorkFromSeries,
  seriesIdFor,
  seriesRelationLabel,
  setReleaseDateRegion,
  setSeriesRelation,
  taglineFromSummary
} from "../src/library.js";

const NOW = "2026-08-04T00:00:00.000Z";

// ─── 上映日：多地区 ───────────────────────────────────────────────────────────

test("normalizeReleaseDates：R1 旧格式的 jp/cn/other 被搬进 entries 且按日期升序", () => {
  const result = normalizeReleaseDates({ jp: "2012-10-06", cn: "2013-01-01", other: ["2012-12-01"] });
  assert.deepEqual(result.entries.map((entry) => [entry.region, entry.date]), [
    ["jp", "2012-10-06"],
    ["other", "2012-12-01"],
    ["cn", "2013-01-01"]
  ]);
  assert.ok(result.entries.every((entry) => entry.source === "legacy"));
});

test("normalizeReleaseDates：旧的 jp/cn 搬进 entries 后必须清空，否则删除会被复活", () => {
  const normalized = normalizeReleaseDates({ jp: "2012-10-06", cn: "2013-01-01", other: [] });
  assert.equal(normalized.jp, null);
  assert.equal(normalized.cn, null);
  assert.deepEqual(normalized.other, []);
  // 真正的回归点：删掉一条之后再归一化一次，不能又冒出来
  const afterDelete = removeReleaseDate(normalized, "jp_2012-10-06");
  assert.deepEqual(normalizeReleaseDates(afterDelete).entries.map((e) => e.id), ["cn_2013-01-01"]);
});

test("normalizeReleaseDates：非法日期被丢弃，空输入不炸", () => {
  assert.deepEqual(normalizeReleaseDates().entries, []);
  assert.deepEqual(normalizeReleaseDates(null).entries, []);
  assert.deepEqual(normalizeReleaseDates({ jp: "2012", cn: "不是日期" }).entries, []);
});

test("addReleaseDate：同地区同日期幂等，不会重复插入", () => {
  let dates = addReleaseDate({}, { region: "cn", date: "2026-07-29", source: "bangumi" });
  dates = addReleaseDate(dates, { region: "cn", date: "2026-07-29", source: "manual" });
  assert.equal(dates.entries.length, 1);
  // 同一天但不同地区是两条独立信息，必须都留下
  dates = addReleaseDate(dates, { region: "jp", date: "2026-07-29" });
  assert.equal(dates.entries.length, 2);
});

test("setReleaseDateRegion：认领抓取回来的 unknown 条目", () => {
  const dates = addReleaseDate({}, { region: "unknown", date: "2026-07-29", source: "bangumi" });
  const claimed = setReleaseDateRegion(dates, "unknown_2026-07-29", "cn");
  assert.deepEqual(claimed.entries, [
    { id: "cn_2026-07-29", region: "cn", date: "2026-07-29", source: "bangumi" }
  ]);
});

test("removeReleaseDate 按条目 id 删除", () => {
  const dates = addReleaseDate(addReleaseDate({}, { region: "jp", date: "2020-01-01" }), { region: "cn", date: "2021-01-01" });
  assert.deepEqual(removeReleaseDate(dates, "jp_2020-01-01").entries.map((e) => e.region), ["cn"]);
});

test("releaseYearOf：取最早一条上映日；没有条目时回落 release_year", () => {
  assert.equal(releaseYearOf({ release_dates: { jp: "2013-01-01", cn: "2012-10-06" } }), 2012);
  assert.equal(releaseYearOf({ release_dates: {}, release_year: 1999 }), 1999);
  assert.equal(releaseYearOf({}), null);
});

test("RELEASE_REGIONS 含未标注地区，作为抓取默认值", () => {
  assert.ok(RELEASE_REGIONS.some(([key]) => key === "unknown"));
});

// ─── 一句话简介 ───────────────────────────────────────────────────────────────

test("taglineFromSummary：抽第一句，去掉句末标点", () => {
  assert.equal(
    taglineFromSummary("少女们签下契约，换取一个愿望。代价是什么，没有人告诉过她们。"),
    "少女们签下契约，换取一个愿望"
  );
});

test("taglineFromSummary：第一句过长 → 返回 null，交给 AI 或用户，不硬截断", () => {
  const long = `${"很".repeat(TAGLINE_MAX_LENGTH + 5)}。后面还有。`;
  assert.equal(taglineFromSummary(long), null);
});

test("taglineFromSummary：去掉开头的括注，空输入返回 null", () => {
  assert.equal(taglineFromSummary("（原作：某某）这是正文第一句。"), "这是正文第一句");
  assert.equal(taglineFromSummary(""), null);
  assert.equal(taglineFromSummary(null), null);
});

test("buildTagline：记录来源与时间；空文本返回 null", () => {
  assert.deepEqual(buildTagline("  一句话  ", "ai", NOW), { text: "一句话", source: "ai", updated_at: NOW });
  assert.equal(buildTagline("   ", "manual", NOW), null);
  assert.equal(buildTagline(null, "bangumi", NOW), null);
});

// ─── 系列实体 ─────────────────────────────────────────────────────────────────

test("createSeries + addWorkToSeries：成员按加入顺序排列且不重复", () => {
  let series = createSeries({ title: "蜘蛛侠" }, NOW);
  assert.equal(series.id, seriesIdFor("蜘蛛侠"));
  series = addWorkToSeries(series, "work_a", NOW);
  series = addWorkToSeries(series, "work_b", NOW);
  series = addWorkToSeries(series, "work_a", NOW); // 重复加入应无效
  assert.deepEqual(series.member_ids, ["work_a", "work_b"]);
});

test("moveWorkInSeries：手动调整系列内顺序", () => {
  let series = createSeries({ title: "小圆" }, NOW);
  for (const id of ["a", "b", "c"]) series = addWorkToSeries(series, id, NOW);
  assert.deepEqual(moveWorkInSeries(series, "c", 0, NOW).member_ids, ["c", "a", "b"]);
  assert.deepEqual(moveWorkInSeries(series, "a", 99, NOW).member_ids, ["b", "c", "a"], "越界索引应被夹到末尾");
  assert.deepEqual(moveWorkInSeries(series, "不存在", 0, NOW).member_ids, ["a", "b", "c"]);
});

test("setSeriesRelation：同一对作品只保留一条关系，重复设定即覆盖", () => {
  let series = createSeries({ title: "系列" }, NOW);
  series = setSeriesRelation(series, { fromWorkId: "a", toWorkId: "b", type: "sequel" }, NOW);
  series = setSeriesRelation(series, { fromWorkId: "a", toWorkId: "b", type: "spinoff" }, NOW);
  assert.equal(series.relations.length, 1);
  assert.equal(series.relations[0].type, "spinoff");
});

test("setSeriesRelation：不自动写反向关系，也拒绝自己指向自己", () => {
  let series = createSeries({ title: "系列" }, NOW);
  series = setSeriesRelation(series, { fromWorkId: "a", toWorkId: "b", type: "sequel" }, NOW);
  assert.equal(series.relations.some((rel) => rel.from_work_id === "b"), false, "反向关系应由用户自己决定要不要连");
  series = setSeriesRelation(series, { fromWorkId: "a", toWorkId: "a", type: "sequel" }, NOW);
  assert.equal(series.relations.length, 1);
});

test("removeWorkFromSeries：连带清掉该作品参与的所有关系，不留悬空连线", () => {
  let series = createSeries({ title: "系列" }, NOW);
  for (const id of ["a", "b", "c"]) series = addWorkToSeries(series, id, NOW);
  series = setSeriesRelation(series, { fromWorkId: "a", toWorkId: "b", type: "sequel" }, NOW);
  series = setSeriesRelation(series, { fromWorkId: "b", toWorkId: "c", type: "spinoff" }, NOW);
  const after = removeWorkFromSeries(series, "b", NOW);
  assert.deepEqual(after.member_ids, ["a", "c"]);
  assert.deepEqual(after.relations, [], "两条关系都涉及 b，应一并清除");
});

test("removeSeriesRelation 只删指定方向的那一条", () => {
  let series = createSeries({ title: "系列" }, NOW);
  series = setSeriesRelation(series, { fromWorkId: "a", toWorkId: "b", type: "sequel" }, NOW);
  series = setSeriesRelation(series, { fromWorkId: "b", toWorkId: "a", type: "prequel" }, NOW);
  const after = removeSeriesRelation(series, "a", "b", NOW);
  assert.deepEqual(after.relations.map((rel) => [rel.from_work_id, rel.to_work_id]), [["b", "a"]]);
});

test("orderedSeriesMembers：按 member_ids 顺序取作品，查不到的跳过不留空洞", () => {
  let series = createSeries({ title: "系列" }, NOW);
  for (const id of ["w2", "missing", "w1"]) series = addWorkToSeries(series, id, NOW);
  const works = [{ id: "w1", title: "一" }, { id: "w2", title: "二" }];
  assert.deepEqual(orderedSeriesMembers(series, works).map((w) => w.title), ["二", "一"]);
});

test("findSeriesForWork：按成员反查所属系列", () => {
  const a = addWorkToSeries(createSeries({ title: "甲" }, NOW), "w1", NOW);
  const b = addWorkToSeries(createSeries({ title: "乙" }, NOW), "w2", NOW);
  assert.equal(findSeriesForWork([a, b], "w2")?.title, "乙");
  assert.equal(findSeriesForWork([a, b], "w9"), null);
});

test("seriesRelationLabel 覆盖未知取值", () => {
  assert.equal(seriesRelationLabel("prequel"), "前作");
  assert.equal(seriesRelationLabel("不存在的类型"), "其他关系");
});

// ─── 片单 ─────────────────────────────────────────────────────────────────────

test("createCollection：同名片单允许共存（id 带时间戳）", () => {
  const a = createCollection({ title: "年度私选" }, "2026-01-01T00:00:00.000Z");
  const b = createCollection({ title: "年度私选" }, "2026-06-01T00:00:00.000Z");
  assert.notEqual(a.id, b.id, "片单标题可以重复，id 不能撞");
});

test("片单增删：同一部作品可属于多个片单，重复加入无效", () => {
  let a = addWorkToCollection(createCollection({ title: "甲" }, NOW), "w1", NOW);
  a = addWorkToCollection(a, "w1", NOW);
  const b = addWorkToCollection(createCollection({ title: "乙" }, NOW), "w1", NOW);
  assert.deepEqual(a.work_ids, ["w1"]);
  assert.deepEqual(collectionsForWork([a, b], "w1").map((c) => c.title), ["甲", "乙"]);
  assert.deepEqual(removeWorkFromCollection(a, "w1", NOW).work_ids, []);
});

test("collectionWorks：按加入顺序返回，查不到的跳过", () => {
  let collection = createCollection({ title: "甲" }, NOW);
  for (const id of ["w2", "gone", "w1"]) collection = addWorkToCollection(collection, id, NOW);
  const works = [{ id: "w1", title: "一" }, { id: "w2", title: "二" }];
  assert.deepEqual(collectionWorks(collection, works).map((w) => w.title), ["二", "一"]);
});
