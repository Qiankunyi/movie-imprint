import test from "node:test";
import assert from "node:assert/strict";
import {
  createTag,
  deleteTag,
  displayTagName,
  ensureBangumiDirectorTag,
  ensureUserTag,
  findMatchingTag,
  mergeTags,
  searchTags,
  syncViewingTags,
  taggedWorkEntries,
  unlinkTag,
  upsertAssignment,
  upsertBangumiDirectorAssignments
} from "../src/tags.js";
import { normalizeBangumiDirectors } from "../src/bangumi.js";
import { normalizeTagLocale, tagT } from "../src/tag-i18n.js";

test("用户标签按规范化名称复用并保留原始表达", () => {
  const first = ensureUserTag([], "# 夏天", { locale: "zh-Hans" });
  const second = ensureUserTag(first.tags, "夏天");
  assert.equal(first.tag.default_name, "夏天");
  assert.equal(second.created, false);
  assert.equal(second.tags.length, 1);
});

test("Bangumi 导演以 person ID 去重，而不是按显示名", () => {
  const first = ensureBangumiDirectorTag([], {
    personId: 68,
    names: { "zh-Hans": "细田守", ja: "細田守", en: "Mamoru Hosoda" },
    aliases: ["細田守"]
  });
  const second = ensureBangumiDirectorTag(first.tags, {
    personId: "68",
    names: { "zh-Hant": "細田守" }
  });
  assert.equal(second.tags.length, 1);
  assert.equal(second.tag.id, first.tag.id);
  assert.equal(second.tag.names.en, "Mamoru Hosoda");
});

test("导演标签按 locale 显示且任一别名都能搜到", () => {
  const tag = createTag({
    name: "细田守",
    source: "metadata_bangumi",
    category: "director",
    names: { "zh-Hans": "细田守", "zh-Hant": "細田守", ja: "細田守", en: "Mamoru Hosoda" },
    aliases: ["Hosoda Mamoru"]
  });
  assert.equal(displayTagName(tag, "en"), "Mamoru Hosoda");
  assert.equal(displayTagName(tag, "zh-Hant"), "細田守");
  assert.equal(searchTags([tag], "Hosoda").length, 1);
  assert.equal(searchTags([tag], "細田").length, 1);
});

test("作品标签与 viewing 标签使用同一实体但保持关联隔离", () => {
  const { tags, tag } = ensureUserTag([], "夏天");
  let assignments = upsertAssignment([], { tagId: tag.id, targetType: "work", targetId: "work_1" }).assignments;
  assignments = upsertAssignment(assignments, { tagId: tag.id, targetType: "viewing", targetId: "record_1" }).assignments;
  const after = unlinkTag(assignments, { tagId: tag.id, targetType: "work", targetId: "work_1" });
  assert.equal(after.length, 1);
  assert.equal(after[0].target_type, "viewing");
  assert.equal(tags.length, 1);
});

test("感想 #tag 同步只创建 viewing 关联，编辑正文会移除旧关联", () => {
  const first = syncViewingTags([], [], { id: "record_1", tags: ["重看后改观", "京都"] });
  assert.equal(first.assignments.length, 2);
  assert.ok(first.assignments.every((item) => item.target_type === "viewing"));
  const second = syncViewingTags(first.tags, first.assignments, { id: "record_1", tags: ["京都"] });
  assert.equal(second.assignments.length, 1);
  assert.equal(findMatchingTag(second.tags, { name: "重看后改观" }), null);
});

test("删除标签会删除全部关联，取消关联只断开目标关系", () => {
  const { tags, tag } = ensureUserTag([], "童年回忆");
  let assignments = upsertAssignment([], { tagId: tag.id, targetType: "work", targetId: "a" }).assignments;
  assignments = upsertAssignment(assignments, { tagId: tag.id, targetType: "work", targetId: "b" }).assignments;
  assert.equal(unlinkTag(assignments, { tagId: tag.id, targetType: "work", targetId: "a" }).length, 1);
  const deleted = deleteTag(tags, assignments, tag.id);
  assert.deepEqual(deleted, { tags: [], assignments: [] });
});

test("手动合并标签迁移关联并去重", () => {
  const a = createTag({ name: "细田守" });
  const b = createTag({ name: "細田守", source: "metadata_bangumi", category: "director", externalRefs: { bangumi_person_id: "68" } });
  let assignments = upsertAssignment([], { tagId: a.id, targetType: "work", targetId: "w1" }).assignments;
  assignments = upsertAssignment(assignments, { tagId: b.id, targetType: "work", targetId: "w1" }).assignments;
  const result = mergeTags([a, b], assignments, { sourceTagId: a.id, targetTagId: b.id });
  assert.equal(result.tags.length, 1);
  assert.equal(result.assignments.length, 1);
  assert.ok(result.tags[0].aliases.includes("细田守"));
});

test("Bangumi 人物响应只规范化导演，并保留四语显示结构", () => {
  const directors = normalizeBangumiDirectors([
    { id: 68, name: "細田守", name_cn: "细田守", relation: "导演", aliases: ["Mamoru Hosoda"] },
    { id: 99, name: "某声优", relation: "主演" }
  ]);
  assert.equal(directors.length, 1);
  assert.equal(directors[0].personId, 68);
  assert.equal(directors[0].names["zh-Hans"], "细田守");
  assert.equal(directors[0].names.ja, "細田守");
  assert.equal(directors[0].names.en, "Mamoru Hosoda");
});

test("多部作品绑定同一导演只产生一个标签实体", () => {
  const person = { personId: 68, names: { "zh-Hans": "细田守", ja: "細田守" } };
  const first = upsertBangumiDirectorAssignments([], [], "w1", [person]);
  const second = upsertBangumiDirectorAssignments(first.tags, first.assignments, "w2", [person]);
  assert.equal(second.tags.length, 1);
  assert.equal(second.assignments.length, 2);
});

test("标签作品默认按态度分组，同组按最近观看；另支持最近观看和上映年代", () => {
  const tag = createTag({ name: "夏天" });
  let assignments = [];
  for (const workId of ["w1", "w2", "w3"]) assignments = upsertAssignment(assignments, { tagId: tag.id, targetType: "work", targetId: workId }).assignments;
  const works = [
    { id: "w1", release_year: 2006 },
    { id: "w2", release_year: 2020 },
    { id: "w3", release_year: 1999 }
  ];
  const records = [
    { id: "r1", work_id: "w1", attitude: "like", record_kind: "viewing" },
    { id: "r2", work_id: "w2", attitude: "love", record_kind: "viewing" },
    { id: "r3", work_id: "w3", attitude: "like", record_kind: "viewing" }
  ];
  const events = [
    { record_id: "r1", work_id: "w1", viewed_on: "2026-01-01", location_type: "home" },
    { record_id: "r2", work_id: "w2", viewed_on: "2024-01-01", location_type: "cinema" },
    { record_id: "r3", work_id: "w3", viewed_on: "2026-06-01", location_type: "home" }
  ];
  assert.deepEqual(taggedWorkEntries(tag.id, [tag], assignments, works, records, events).map((item) => item.work.id), ["w2", "w3", "w1"]);
  assert.deepEqual(taggedWorkEntries(tag.id, [tag], assignments, works, records, events, "recent").map((item) => item.work.id), ["w3", "w1", "w2"]);
  assert.deepEqual(taggedWorkEntries(tag.id, [tag], assignments, works, records, events, "release").map((item) => item.work.id), ["w2", "w1", "w3"]);
});

test("标签新增文案保留简中、繁中、英文、日文四语入口", () => {
  assert.equal(tagT("zh-CN", "index"), "标签索引");
  assert.equal(tagT("zh-TW", "index"), "標籤索引");
  assert.equal(tagT("en-US", "index"), "Tag index");
  assert.equal(tagT("ja-JP", "index"), "タグ索引");
  assert.equal(normalizeTagLocale("zh_Hant"), "zh-Hant");
});
