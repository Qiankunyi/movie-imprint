import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTITUDE_DESCRIPTIONS,
  RECOMMENDATION_PRESETS,
  allowedRecommendationsForAttitude,
  assignViewingRelations,
  createLocalWork,
  createRawOnlyRecord,
  deterministicAnalysis,
  extractHashtags,
  isRecommendationAllowed,
  mergeWorks,
  normalizeTitle,
  parseDraft,
  parseWorkTag,
  promoteWorkToMatched,
  reconcileLocalWorkTitle,
  recommendationLabel,
  resolveWork,
  workIdFor
} from "../src/domain.js";

test("五项态度都有可快速回忆的评判标准", () => {
  assert.deepEqual(Object.keys(ATTITUDE_DESCRIPTIONS).sort(), ["dislike", "like", "love", "mixed", "neutral"]);
  assert.ok(Object.values(ATTITUDE_DESCRIPTIONS).every((description) => description.length >= 20));
});

test("三种推荐判断都提供对应的快捷条件组", () => {
  assert.deepEqual(RECOMMENDATION_PRESETS.yes.map((group) => group.key), ["reasons", "cautions", "audiences"]);
  assert.deepEqual(RECOMMENDATION_PRESETS.depends.map((group) => group.key), ["audiences", "reasons", "cautions"]);
  assert.deepEqual(RECOMMENDATION_PRESETS.no.map((group) => group.key), ["noReasons", "issueTypes", "positives"]);
  assert.ok(Object.values(RECOMMENDATION_PRESETS).flatMap((groups) => groups).every((group) => group.options.length >= 3));
});

test("只有喜欢与超喜欢开放推荐，其他态度只能确认不会推荐", () => {
  assert.deepEqual(allowedRecommendationsForAttitude(null), []);
  assert.deepEqual(allowedRecommendationsForAttitude("like"), ["yes", "depends", "no"]);
  assert.deepEqual(allowedRecommendationsForAttitude("love"), ["yes", "depends", "no"]);
  for (const attitude of ["dislike", "neutral", "mixed"]) {
    assert.deepEqual(allowedRecommendationsForAttitude(attitude), ["no"]);
    assert.equal(isRecommendationAllowed(attitude, "yes"), false);
    assert.equal(isRecommendationAllowed(attitude, "depends"), false);
    assert.equal(isRecommendationAllowed(attitude, "no"), true);
  }
});

test("保留中日文标签并将第一个作品标签作为片名", () => {
  const text = "#穿越时空的少女 #电影院\n未来で待ってる，还是很打动我。";
  assert.deepEqual(extractHashtags(text), ["穿越时空的少女", "电影院"]);
  assert.deepEqual(parseDraft(text), {
    title: "穿越时空的少女",
    tags: ["穿越时空的少女", "电影院"],
    seriesPath: [],
    workTitleHint: null
  });
});

test("斜线作品标签只产生待确认的系列与作品提示", () => {
  const text = "#哆啦A梦/大雄与动物行星 #电影院\n小时候看过，今天重看。";
  assert.deepEqual(parseWorkTag("哆啦A梦/大雄与动物行星"), {
    raw: "哆啦A梦/大雄与动物行星",
    seriesPath: ["哆啦A梦"],
    workTitleHint: "大雄与动物行星"
  });
  assert.deepEqual(parseDraft(text), {
    title: "哆啦A梦/大雄与动物行星",
    tags: ["哆啦A梦/大雄与动物行星", "电影院"],
    seriesPath: ["哆啦A梦"],
    workTitleHint: "大雄与动物行星"
  });
});

test("斜线系列速记只作为别名，本地作品标题使用最后一级", () => {
  const record = {
    title: "哆啦A梦/大雄与云之王国",
    inputHints: { seriesPath: ["哆啦A梦"], workTitle: "大雄与云之王国" }
  };
  const local = reconcileLocalWorkTitle({
    id: "work_451",
    title: "哆啦A梦/大雄与云之王国",
    aliases: ["哆啦A梦/大雄与云之王国"],
    identity_status: "local_only"
  }, record);
  assert.equal(local.title, "大雄与云之王国");
  assert.ok(local.aliases.includes("哆啦A梦/大雄与云之王国"));
  const matched = reconcileLocalWorkTitle({ ...local, title: "哆啦A梦：大雄与云之王国", identity_status: "matched" }, record);
  assert.equal(matched.title, "哆啦A梦：大雄与云之王国");
});

test("多段路径保留全部上级线索且不会改写原标签", () => {
  assert.deepEqual(parseWorkTag("宇宙/系列/作品"), {
    raw: "宇宙/系列/作品",
    seriesPath: ["宇宙", "系列"],
    workTitleHint: "作品"
  });
});

test("每条本地记录先获得稳定作品身份且保留匹配别名", () => {
  const work = createLocalWork({
    id: "record_123",
    workId: "work_record_123",
    title: "哆啦A梦/大雄与动物行星",
    inputHints: { seriesPath: ["哆啦A梦"], workTitle: "大雄与动物行星" }
  });
  const { first_recorded_at, ...rest } = work;
  assert.ok(first_recorded_at, "first_recorded_at 应有值");
  assert.doesNotThrow(() => new Date(first_recorded_at).toISOString());
  assert.deepEqual(rest, {
    id: "work_record_123",
    work_id: "work_record_123",
    title: "大雄与动物行星",
    original_title: null,
    work_type: "unspecified",
    aliases: ["哆啦A梦/大雄与动物行星", "大雄与动物行星"],
    release_year: null,
    release_dates: { jp: null, cn: null, other: [] },
    external_refs: [],
    identity_status: "local_only",
    poster_subject_id: null,
    merged_from: [],
    match: { status: "idle", query: null, candidates: [], message: null }
  });
});

test("电影院元标签不会被误认为作品名", () => {
  assert.equal(parseDraft("#电影院 看完以后才想起来没写作品名").title, "未命名的电影");
});

test("确定性本地分析永远不推断推荐值", () => {
  const result = deterministicAnalysis("#雨中的车站 太喜欢了，会一直记得那场雨。");
  assert.equal(result.attitudeSuggestion, "love");
  assert.equal(result.recommendation, null);
  assert.equal(recommendationLabel(result.recommendation), "还没有判断");
  assert.ok(result.cards.length >= 1);
});

test("相同输入会产生相同的结构判断但使用独立卡片 ID", () => {
  const text = "#某部电影 第一幕让我感动。最后的安静也很好。";
  const first = deterministicAnalysis(text);
  const second = deterministicAnalysis(text);
  assert.equal(first.title, second.title);
  assert.equal(first.attitudeSuggestion, second.attitudeSuggestion);
  assert.deepEqual(first.cards.map(({ card_id, ...card }) => card), second.cards.map(({ card_id, ...card }) => card));
  assert.notEqual(first.cards[0].card_id, second.cards[0].card_id);
});

test("完成输入时先建立可独立存在的仅原文记录", () => {
  const record = createRawOnlyRecord("#夏日列车\n1. 第一感受\n2. 第二感受", "2026-08-02T00:00:00.000Z");
  assert.equal(record.status, "raw_only_confirmed");
  assert.equal(record.analysis_status, "pending");
  assert.equal(record.rawText, "#夏日列车\n1. 第一感受\n2. 第二感受");
  assert.deepEqual(record.cards, []);
});

// ─── R1：normalizeTitle ───────────────────────────────────────────────────────

test("normalizeTitle 归一化全角半角、【制式】前缀与多余空格", () => {
  assert.equal(normalizeTitle("　劇場版　まどか　"), "劇場版 まどか");
  assert.equal(normalizeTitle("【IMAX】劇場版まどか☆マギカ"), "劇場版まどか☆マギカ");
  assert.equal(normalizeTitle("【IMAX】【舞台挨拶付き】劇場版まどか☆マギカ"), "劇場版まどか☆マギカ");
  assert.equal(normalizeTitle("ＡＢＣ　１２３"), "ABC 123");
  assert.equal(normalizeTitle(""), "");
  assert.equal(normalizeTitle(null), "");
});

// ─── R1：workIdFor ────────────────────────────────────────────────────────────

test("workIdFor 有 subjectId 时用 bangumi 前缀，否则用本地 slug", () => {
  assert.equal(workIdFor({ subjectId: 1309, title: "随便" }), "work_bgm_1309");
  const local = workIdFor({ subjectId: null, title: "劇場版まどか" });
  assert.match(local, /^work_local_/);
  // 同一标题两次调用产生同一个 id（幂等，供 resolveWork 复用）
  assert.equal(local, workIdFor({ subjectId: null, title: "劇場版まどか" }));
});

// ─── R1：resolveWork ──────────────────────────────────────────────────────────

test("resolveWork：subjectId 命中已有 work", () => {
  const works = [{
    id: "work_bgm_1309",
    title: "哆啦A梦：大雄与动物行星",
    aliases: [],
    external_refs: [{ source: "bangumi", id: "1309" }],
    identity_status: "matched"
  }];
  const { work, isNew } = resolveWork(works, { title: "随便叫什么", subjectId: 1309 });
  assert.equal(isNew, false);
  assert.equal(work.id, "work_bgm_1309");
});

test("resolveWork：aliases 双向精确匹配命中", () => {
  const works = [{ id: "work_local_a", title: "正式名", aliases: ["俗称"], external_refs: [] }];
  assert.equal(resolveWork(works, { title: "俗称" }).isNew, false);
  assert.equal(resolveWork(works, { title: "随便", aliases: ["正式名"] }).isNew, false);
});

test("resolveWork：normalizeTitle 后标题命中", () => {
  const works = [{ id: "work_local_a", title: "【IMAX】劇場版まどか", aliases: [], external_refs: [] }];
  const { work, isNew } = resolveWork(works, { title: "劇場版まどか" });
  assert.equal(isNew, false);
  assert.equal(work.id, "work_local_a");
});

test("resolveWork：全不命中则新建，且同一标题连续三次 resolve 只产生一个 work", () => {
  let works = [];
  const first = resolveWork(works, { title: "全新的电影" });
  assert.equal(first.isNew, true);
  works = [...works, first.work];

  const second = resolveWork(works, { title: "全新的电影" });
  assert.equal(second.isNew, false);
  assert.equal(second.work.id, first.work.id);

  const third = resolveWork(works, { title: "全新的电影" });
  assert.equal(third.isNew, false);
  assert.equal(third.work.id, first.work.id);

  assert.equal(works.length, 1, "全程只应产生 1 个 work");
});

// ─── R1：promoteWorkToMatched ─────────────────────────────────────────────────

test("promoteWorkToMatched：id 变更、merged_from 记录、aliases 合并，release_dates.jp 与 release_year 一致", () => {
  const local = createLocalWork({
    id: "record_1",
    workId: "work_local_abc",
    title: "劇場版まどか",
    inputHints: {}
  });
  const promoted = promoteWorkToMatched(local, 1309, {
    title: "魔法少女まどか☆マギカ",
    originalTitle: "魔法少女まどか☆マギカ",
    type: "anime",
    releaseDate: "2012-10-06"
  });
  assert.equal(promoted.id, "work_bgm_1309");
  assert.deepEqual(promoted.merged_from, ["work_local_abc"]);
  assert.ok(promoted.aliases.includes("劇場版まどか"));
  assert.ok(promoted.aliases.includes("魔法少女まどか☆マギカ"));
  assert.equal(promoted.work_type, "animation_film");
  assert.equal(promoted.identity_status, "matched");
  assert.equal(promoted.release_dates.jp, "2012-10-06");
  assert.equal(promoted.release_year, 2012);
});

test("promoteWorkToMatched：Bangumi 条目无 date 字段时 release_dates.jp 为 null 且不清空原有 release_year", () => {
  const local = { ...createLocalWork({ id: "r2", workId: "work_local_x", title: "某片", inputHints: {} }), release_year: 1999 };
  const promoted = promoteWorkToMatched(local, 42, { title: "某片", type: "real" });
  assert.equal(promoted.release_dates.jp, null);
  assert.equal(promoted.release_year, 1999);
  assert.equal(promoted.work_type, "live_action_film");
  assert.doesNotThrow(() => promoteWorkToMatched(local, 42, {}));
});

// ─── R1：mergeWorks ───────────────────────────────────────────────────────────

test("mergeWorks：别名并集去重、已匹配优先、first_recorded_at 取最早", () => {
  const matched = {
    id: "work_bgm_1",
    title: "官方名",
    aliases: ["别名A"],
    identity_status: "matched",
    first_recorded_at: "2026-02-01T00:00:00.000Z",
    merged_from: [],
    release_dates: { jp: "2020-01-01", cn: null, other: [] }
  };
  const localDup = {
    id: "work_local_dup",
    title: "本地叫法",
    aliases: ["别名A", "别名B"],
    identity_status: "local_only",
    first_recorded_at: "2026-01-01T00:00:00.000Z",
    merged_from: [],
    release_dates: { jp: null, cn: "2020-02-02", other: [] }
  };
  const merged = mergeWorks(matched, [localDup]);
  assert.equal(merged.id, "work_bgm_1", "已匹配一方应作为主体");
  assert.ok(merged.aliases.includes("别名B"));
  assert.equal(new Set(merged.aliases).size, merged.aliases.length, "别名应去重");
  assert.deepEqual(merged.merged_from, ["work_local_dup"]);
  assert.equal(merged.first_recorded_at, "2026-01-01T00:00:00.000Z");
  assert.equal(merged.release_dates.jp, "2020-01-01", "冲突时以已匹配方为准");
  assert.equal(merged.release_dates.cn, "2020-02-02", "非空字段应被采纳");
});

// ─── R1：assignViewingRelations ───────────────────────────────────────────────

test("assignViewingRelations：单次为 first/1，三次为 first/rewatch/rewatch", () => {
  const single = assignViewingRelations([{ id: "ve1", screening_at: "2026-01-01T00:00:00+09:00" }]);
  assert.equal(single[0].viewing_relation, "first");
  assert.equal(single[0].watch_index, 1);

  const three = assignViewingRelations([
    { id: "ve1", screening_at: "2026-01-01T00:00:00+09:00" },
    { id: "ve2", screening_at: "2026-02-01T00:00:00+09:00" },
    { id: "ve3", screening_at: "2026-03-01T00:00:00+09:00" }
  ]);
  assert.deepEqual(three.map((e) => e.viewing_relation), ["first", "rewatch", "rewatch"]);
  assert.deepEqual(three.map((e) => e.watch_index), [1, 2, 3]);
});

test("assignViewingRelations：乱序输入不影响结果", () => {
  const events = [
    { id: "ve3", screening_at: "2026-03-01T00:00:00+09:00" },
    { id: "ve1", screening_at: "2026-01-01T00:00:00+09:00" },
    { id: "ve2", screening_at: "2026-02-01T00:00:00+09:00" }
  ];
  const result = assignViewingRelations(events);
  const byId = Object.fromEntries(result.map((e) => [e.id, e]));
  assert.equal(byId.ve1.watch_index, 1);
  assert.equal(byId.ve2.watch_index, 2);
  assert.equal(byId.ve3.watch_index, 3);
});

test("assignViewingRelations：在家在前、影院在后 → 在家是 first，影院是 rewatch（地点不影响判定）", () => {
  const result = assignViewingRelations([
    { id: "home", location_type: "home", screening_at: "2026-01-01T00:00:00+09:00" },
    { id: "cinema", location_type: "cinema", screening_at: "2026-06-01T00:00:00+09:00" }
  ]);
  const byId = Object.fromEntries(result.map((e) => [e.id, e]));
  assert.equal(byId.home.viewing_relation, "first");
  assert.equal(byId.cinema.viewing_relation, "rewatch");
});

test("assignViewingRelations：全部在影院的三次仍是 first/rewatch/rewatch", () => {
  const result = assignViewingRelations([
    { id: "a", location_type: "cinema", screening_at: "2026-01-01T00:00:00+09:00" },
    { id: "b", location_type: "cinema", screening_at: "2026-02-01T00:00:00+09:00" },
    { id: "c", location_type: "cinema", screening_at: "2026-03-01T00:00:00+09:00" }
  ]);
  assert.deepEqual(result.map((e) => e.viewing_relation), ["first", "rewatch", "rewatch"]);
});

test("assignViewingRelations：7 次观看 watch_index 到 7，无截断", () => {
  const events = Array.from({ length: 7 }, (_, i) => ({
    id: `ve${i}`,
    screening_at: `2026-0${i + 1}-01T00:00:00+09:00`
  }));
  const result = assignViewingRelations(events);
  assert.equal(result.length, 7);
  assert.equal(result.at(-1).watch_index, 7);
  assert.equal(result.at(-1).viewing_relation, "rewatch");
});

test("assignViewingRelations：补录更早的一次后重排，原 first 变 rewatch", () => {
  const before = assignViewingRelations([
    { id: "later", screening_at: "2026-06-01T00:00:00+09:00" }
  ]);
  assert.equal(before[0].viewing_relation, "first");

  const after = assignViewingRelations([
    ...before,
    { id: "earlier", screening_at: "2020-01-01T00:00:00+09:00" }
  ]);
  const byId = Object.fromEntries(after.map((e) => [e.id, e]));
  assert.equal(byId.earlier.viewing_relation, "first");
  assert.equal(byId.earlier.watch_index, 1);
  assert.equal(byId.later.viewing_relation, "rewatch");
  assert.equal(byId.later.watch_index, 2);
});

test("assignViewingRelations：relation_locked 的事件保留用户选择，矛盾时标 relation_conflict", () => {
  const result = assignViewingRelations([
    { id: "a", screening_at: "2026-01-01T00:00:00+09:00", relation_locked: true, viewing_relation: "rewatch" },
    { id: "b", screening_at: "2026-02-01T00:00:00+09:00" }
  ]);
  const byId = Object.fromEntries(result.map((e) => [e.id, e]));
  assert.equal(byId.a.viewing_relation, "rewatch", "锁定值应被保留，即使它是时间最早的一次");
  assert.equal(byId.a.relation_conflict, true, "与时间顺序矛盾应标记");
  assert.equal(byId.b.relation_conflict, undefined, "不矛盾的事件不应带该标记");
});

test("assignViewingRelations：时间字段按 viewed_on → createdAt 降级，不抛错", () => {
  assert.doesNotThrow(() => assignViewingRelations([
    { id: "a", viewed_on: "2026-01-01" },
    { id: "b", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "c" }
  ]));
});

test("assignViewingRelations 的实现不读取 location_type（缺失该字段也能正确工作）", () => {
  const events = [
    { id: "a", screening_at: "2026-01-01T00:00:00+09:00" },
    { id: "b", screening_at: "2026-02-01T00:00:00+09:00" }
  ];
  assert.ok(!("location_type" in events[0]));
  const result = assignViewingRelations(events);
  assert.deepEqual(result.map((e) => e.viewing_relation), ["first", "rewatch"]);
});
