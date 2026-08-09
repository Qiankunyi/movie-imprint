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
  sortRecordsByViewingDate,
  recommendationLabel,
  resolveWork,
  workIdFor,
  upsertExternalRef,
  findWorkByExternalRef,
  createWorkFromCandidate,
  applyCandidateToWork
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
    title: "大雄与动物行星",
    original_title: null,
    work_type: "unspecified",
    aliases: ["哆啦A梦/大雄与动物行星", "大雄与动物行星"],
    release_year: null,
    release_dates: { jp: null, cn: null, other: [], entries: [] },
    external_refs: [],
    primary_source: null,
    poster: null,
    stills: [],
    runtime_minutes: null,
    genres: [],
    related_refs: [],
    tagline: null,
    identity_status: "local_only",
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

test("R6：workIdFor 永远生成 App 自己的内部 ID，不含任何外部数据源信息", () => {
  const a = workIdFor();
  const b = workIdFor();
  assert.match(a, /^work_/);
  assert.notEqual(a, b, "每次调用都应产生新的唯一 ID");
  // 红线：外部标识绝不能出现在主键里
  assert.ok(!/bgm|bangumi|tmdb|imdb/.test(a), "内部 ID 不得包含外部数据源标识");
});

// ─── R1：resolveWork ──────────────────────────────────────────────────────────

test("resolveWork：subjectId 命中已有 work（只看 external_refs，不看 id 长相）", () => {
  const works = [{
    id: "work_abc123",
    title: "哆啦A梦：大雄与动物行星",
    aliases: [],
    external_refs: [{ source: "bangumi", id: "1309" }],
    identity_status: "matched"
  }];
  const { work, isNew } = resolveWork(works, { title: "随便叫什么", subjectId: 1309 });
  assert.equal(isNew, false);
  assert.equal(work.id, "work_abc123");
});

test("R6：resolveWork 用 tmdb_id 命中已有 work（相同 tmdb_id 不得重复建 Work）", () => {
  const works = [{
    id: "work_abc123",
    title: "鸟人",
    aliases: [],
    external_refs: [{ source: "tmdb", id: "194662" }],
    identity_status: "matched"
  }];
  const { work, isNew } = resolveWork(works, {
    title: "Birdman",
    externalRefs: { tmdb: 194662 }
  });
  assert.equal(isNew, false, "标题完全不同，但 tmdb_id 相同就必须命中同一个 Work");
  assert.equal(work.id, "work_abc123");
});

test("R6：resolveWork 新建时把外部标识写进 external_refs，而不是写进 id", () => {
  const { work, isNew } = resolveWork([], {
    title: "Birdman",
    externalRefs: { tmdb: 194662, imdb: "tt2562232" }
  });
  assert.equal(isNew, true);
  assert.match(work.id, /^work_/);
  assert.ok(!work.id.includes("194662"), "外部 id 不得进入主键");
  assert.equal(work.external_refs.find((r) => r.source === "tmdb").id, "194662");
  assert.equal(work.external_refs.find((r) => r.source === "imdb").id, "tt2562232");
  assert.equal(work.identity_status, "matched");
  assert.equal(work.primary_source, "tmdb");
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

test("R6：promoteWorkToMatched 不再变更 id、不再写 merged_from，aliases 合并，上映日按未标注地区落库", () => {
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
  // R6 红线：匹配外部数据源只是新增一条 external_ref，作品身份从未改变
  assert.equal(promoted.id, local.id, "匹配 Bangumi 不得改变 Work.id");
  assert.deepEqual(promoted.merged_from, [], "id 没变，就不存在需要被记住的旧 id");
  assert.deepEqual(promoted.external_refs, [
    { source: "bangumi", id: "1309", url: "https://bangumi.tv/subject/1309" }
  ]);
  assert.deepEqual(promoted.poster, { source: "bangumi", subject_id: 1309 });
  assert.ok(promoted.aliases.includes("劇場版まどか"));
  assert.ok(promoted.aliases.includes("魔法少女まどか☆マギカ"));
  assert.equal(promoted.work_type, "animation_film");
  assert.equal(promoted.identity_status, "matched");
  // R5：Bangumi 的 date 字段不带地区语义（实测《蜘蛛侠：崭新之日》标的是中国上映日），
  // 所以抓取回来的日期一律记 region: "unknown"，绝不能自动写成日本上映日。
  assert.deepEqual(promoted.release_dates.entries, [
    { id: "unknown_2012-10-06", region: "unknown", date: "2012-10-06", source: "bangumi" }
  ]);
  assert.equal(promoted.release_dates.jp, null, "不得擅自认定为日本上映日");
  assert.equal(promoted.release_year, 2012);
});

test("promoteWorkToMatched：Bangumi 条目无 date 字段时不产生上映日条目，且不清空原有 release_year", () => {
  const local = { ...createLocalWork({ id: "r2", workId: "work_local_x", title: "某片", inputHints: {} }), release_year: 1999 };
  const promoted = promoteWorkToMatched(local, 42, { title: "某片", type: "real" });
  assert.deepEqual(promoted.release_dates.entries, []);
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
  // R5：上映日改成条目数组后，合并是"取并集"而不是"同一个槽位二选一"——
  // 两边各自标注的地区都保留下来，不会因为合并而丢失其中一个。
  assert.deepEqual(merged.release_dates.entries, [
    { id: "jp_2020-01-01", region: "jp", date: "2020-01-01", source: "legacy" },
    { id: "cn_2020-02-02", region: "cn", date: "2020-02-02", source: "legacy" }
  ]);
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

// ─── R5 补丁 6：时间线按观影日期排序 ─────────────────────────────────────────

test("sortRecordsByViewingDate：按观影日期倒序，而不是记录创建时间", () => {
  // 关键场景：今天补记一部三年前看的片。按 createdAt 排它会跑到最前面，
  // 但卡片右下角显示的是三年前的观影日期，看起来就像"排序坏了"。
  const records = [
    { id: "new_record_of_old_movie", createdAt: "2026-08-05T00:00:00.000Z" },
    { id: "recent_watch", createdAt: "2026-07-01T00:00:00.000Z" }
  ];
  const events = new Map([
    ["new_record_of_old_movie", { screening_at: "2023-05-01T10:00:00+09:00" }],
    ["recent_watch", { screening_at: "2026-07-18T09:50:00+09:00" }]
  ]);
  assert.deepEqual(
    sortRecordsByViewingDate(records, events).map((r) => r.id),
    ["recent_watch", "new_record_of_old_movie"]
  );
});

test("sortRecordsByViewingDate：没有场次的记录回落到 createdAt，且不修改入参", () => {
  const records = [
    { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", createdAt: "2026-06-01T00:00:00.000Z" }
  ];
  const original = [...records];
  assert.deepEqual(sortRecordsByViewingDate(records, new Map()).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(records, original, "不得就地修改传入数组");
  assert.deepEqual(sortRecordsByViewingDate([], null), []);
});

test("sortRecordsByViewingDate：只有日期没有时刻时用 viewed_on", () => {
  const records = [{ id: "a", createdAt: "2020-01-01" }, { id: "b", createdAt: "2020-01-01" }];
  const events = new Map([["a", { viewed_on: "2026-03-01" }], ["b", { viewed_on: "2026-09-01" }]]);
  assert.deepEqual(sortRecordsByViewingDate(records, events).map((r) => r.id), ["b", "a"]);
});

// ─── R6：external_refs upsert / 跨源共存 ──────────────────────────────────────

test("R6：upsertExternalRef 按 source 增量写入，不整体覆盖", () => {
  let refs = [];
  refs = upsertExternalRef(refs, { source: "bangumi", id: 1309 });
  refs = upsertExternalRef(refs, { source: "tmdb", id: "194662" });
  assert.equal(refs.length, 2, "两个不同的源应共存");

  // 同一个源再写一次是更新，不是追加
  refs = upsertExternalRef(refs, { source: "tmdb", id: "999" });
  assert.equal(refs.length, 2);
  assert.equal(refs.find((r) => r.source === "tmdb").id, "999");
  assert.equal(refs.find((r) => r.source === "bangumi").id, "1309", "更新 tmdb 不得抹掉 bangumi");

  // url 缺省时按源自动补
  assert.equal(refs.find((r) => r.source === "bangumi").url, "https://bangumi.tv/subject/1309");
});

test("R6：先有 TMDB 的 Work 再匹配 Bangumi，两条 external_ref 必须共存", () => {
  const tmdbWork = createWorkFromCandidate({
    source: "tmdb",
    sourceId: "194662",
    title: "鸟人",
    originalTitle: "Birdman",
    posterRef: { source: "tmdb", path: "/x.jpg" }
  });
  const promoted = promoteWorkToMatched(tmdbWork, 1309, { title: "バードマン", type: "real" });

  assert.equal(promoted.id, tmdbWork.id, "id 全程不变");
  assert.equal(promoted.external_refs.length, 2);
  assert.equal(promoted.external_refs.find((r) => r.source === "tmdb").id, "194662");
  assert.equal(promoted.external_refs.find((r) => r.source === "bangumi").id, "1309");
  assert.equal(promoted.primary_source, "tmdb", "已有 primary_source 不被后来的匹配改写");
  assert.equal(promoted.poster.source, "tmdb", "已有 TMDB 海报不降级成 Bangumi 封面");
});

test("R6：findWorkByExternalRef 按源精确查找，不跨源误命中", () => {
  const works = [
    { id: "w1", external_refs: [{ source: "bangumi", id: "100" }] },
    { id: "w2", external_refs: [{ source: "tmdb", id: "100" }] }
  ];
  assert.equal(findWorkByExternalRef(works, "bangumi", 100).id, "w1");
  assert.equal(findWorkByExternalRef(works, "tmdb", "100").id, "w2");
  assert.equal(findWorkByExternalRef(works, "imdb", "100"), undefined);
  assert.equal(findWorkByExternalRef(works, "bangumi", null), undefined);
});

// ─── R6：createWorkFromCandidate（观影前路径） ────────────────────────────────

test("R6：createWorkFromCandidate 创建的 Work 没有任何 Record / ViewingEvent 依赖", () => {
  const work = createWorkFromCandidate({
    source: "tmdb",
    sourceId: "194662",
    title: "鸟人",
    originalTitle: "Birdman",
    year: 2014,
    posterRef: { source: "tmdb", path: "/x.jpg" },
    externalIds: { imdb: "tt2562232" },
    runtimeMinutes: 119
  }, "2026-08-08T00:00:00.000Z");

  assert.match(work.id, /^work_/);
  assert.equal(work.title, "鸟人");
  assert.ok(work.aliases.includes("Birdman"), "原名应进别名，供日后观影时标题匹配命中");
  assert.equal(work.release_year, 2014);
  assert.equal(work.runtime_minutes, 119);
  assert.deepEqual(work.poster, { source: "tmdb", path: "/x.jpg" });
  assert.equal(work.identity_status, "matched");
  assert.equal(work.primary_source, "tmdb");
  // R6 §10：first_recorded_at = 第一次进入记忆系统的时间，不是首次观看时间
  assert.equal(work.first_recorded_at, "2026-08-08T00:00:00.000Z");
});

test("R6 §12：TMDB 候选判断不出类型时留 unspecified，绝不默认真人电影", () => {
  const unknown = createWorkFromCandidate({ source: "tmdb", sourceId: "1", title: "某动画电影" });
  assert.equal(unknown.work_type, "unspecified", "宁可未分类，也不能把动画电影错标成真人电影");

  const known = createWorkFromCandidate({ source: "tmdb", sourceId: "2", title: "某片", workType: "animation_film" });
  assert.equal(known.work_type, "animation_film", "能可靠判断时应采用");
});

test("R6：观影前建 Work → 观影后捕获流程必须命中同一个 Work（§14 核心用例）", () => {
  // 8/8：因为 Michael Keaton，把 Birdman 从 TMDB 加进片单
  const birdman = createWorkFromCandidate({
    source: "tmdb",
    sourceId: "194662",
    title: "鸟人",
    originalTitle: "Birdman"
  }, "2026-08-08T00:00:00.000Z");
  const works = [birdman];

  // 9/5：真正看了，捕获流程里用户写的标题是原名
  const viaOriginalTitle = resolveWork(works, { title: "Birdman" });
  assert.equal(viaOriginalTitle.isNew, false, "别名命中，不得产生第二个 Work");
  assert.equal(viaOriginalTitle.work.id, birdman.id);

  // 另一条路径：捕获流程匹配到了 TMDB 同一条目
  const viaTmdbId = resolveWork(works, { title: "完全不同的译名", externalRefs: { tmdb: "194662" } });
  assert.equal(viaTmdbId.isNew, false);
  assert.equal(viaTmdbId.work.id, birdman.id);

  // first_recorded_at 是「进入记忆系统的时间」，不因为后来真的看了而改变
  assert.equal(viaTmdbId.work.first_recorded_at, "2026-08-08T00:00:00.000Z");
});

test("R6：mergeWorks 合并跨源重复作品时，两边的 external_refs 取并集", () => {
  const bgm = {
    id: "w_bgm", title: "你的名字。", aliases: [], identity_status: "matched",
    first_recorded_at: "2026-01-01T00:00:00.000Z", merged_from: [],
    external_refs: [{ source: "bangumi", id: "150775" }],
    release_dates: { entries: [] }
  };
  const tmdb = {
    id: "w_tmdb", title: "君の名は。", aliases: [], identity_status: "matched",
    first_recorded_at: "2026-02-01T00:00:00.000Z", merged_from: [],
    external_refs: [{ source: "tmdb", id: "372058" }, { source: "imdb", id: "tt5311514" }],
    release_dates: { entries: [] }
  };
  const merged = mergeWorks(bgm, [tmdb]);
  assert.equal(merged.external_refs.length, 3, "bangumi + tmdb + imdb 全部保留");
  assert.deepEqual(merged.merged_from, ["w_tmdb"]);
  assert.equal(merged.first_recorded_at, "2026-01-01T00:00:00.000Z", "取最早");
});

// ─── R6 补丁 10：source-agnostic 的候选应用 ─────────────────────────────────

test("补丁10：applyCandidateToWork 支持 TMDB 候选——真人电影不再依赖 Bangumi", () => {
  const local = createLocalWork({ id: "r1", workId: "work_x", title: "鸟人", inputHints: {} });
  const applied = applyCandidateToWork(local, {
    source: "tmdb",
    sourceId: "194662",
    title: "鸟人",
    originalTitle: "Birdman or (The Unexpected Virtue of Ignorance)",
    releaseDate: "2014-08-27",
    year: 2014,
    workType: "live_action_film",
    posterRef: { source: "tmdb", path: "/rSZs93P0LLxqlVEbI001UKoeCQC.jpg" },
    externalIds: { imdb: "tt2562232" }
  });

  assert.equal(applied.id, local.id, "id 不得变更");
  assert.equal(applied.identity_status, "matched");
  assert.equal(applied.work_type, "live_action_film");
  assert.equal(applied.release_year, 2014);
  assert.equal(applied.external_refs.find((r) => r.source === "tmdb").id, "194662");
  assert.equal(applied.external_refs.find((r) => r.source === "imdb").id, "tt2562232");
  assert.deepEqual(applied.poster, { source: "tmdb", path: "/rSZs93P0LLxqlVEbI001UKoeCQC.jpg" });
  assert.ok(applied.aliases.includes("Birdman or (The Unexpected Virtue of Ignorance)"));
  // 上映日不带地区语义，一律按 unknown 落库由用户认领
  assert.deepEqual(applied.release_dates.entries, [
    { id: "unknown_2014-08-27", region: "unknown", date: "2014-08-27", source: "tmdb" }
  ]);
});

test("补丁10：Bangumi 候选走同一条路径，且两个源可以先后叠加", () => {
  const local = createLocalWork({ id: "r1", workId: "work_y", title: "你的名字。", inputHints: {} });
  const withBgm = applyCandidateToWork(local, {
    source: "bangumi", sourceId: "150775", title: "你的名字。", workType: "animation_film"
  });
  const withBoth = applyCandidateToWork(withBgm, {
    source: "tmdb", sourceId: "372058", title: "你的名字。", workType: "animation_film"
  });

  assert.equal(withBoth.id, local.id);
  assert.equal(withBoth.external_refs.length, 2, "两个源共存，后写的不抹掉先写的");
  assert.equal(withBoth.primary_source, "bangumi", "primary_source 一旦确定就不被后来的覆盖");
});

test("补丁10：候选判断不出类型时，不把 Work 已有的类型倒退成 unspecified", () => {
  const known = { ...createLocalWork({ id: "r1", workId: "w", title: "某片", inputHints: {} }), work_type: "animation_film" };
  const applied = applyCandidateToWork(known, { source: "tmdb", sourceId: "1", title: "某片", workType: "unspecified" });
  assert.equal(applied.work_type, "animation_film");
});

test("补丁10：已有海报不被候选覆盖（用户可能已经挑过）", () => {
  const withPoster = { ...createLocalWork({ id: "r1", workId: "w", title: "某片", inputHints: {} }), poster: { source: "tmdb", path: "/chosen-by-user.jpg" } };
  const applied = applyCandidateToWork(withPoster, {
    source: "bangumi", sourceId: "1", title: "某片", posterRef: { source: "bangumi", subject_id: 1 }
  });
  assert.deepEqual(applied.poster, { source: "tmdb", path: "/chosen-by-user.jpg" });
});

// ─── R6 补丁 12：刷新资料 / 删除作品的数据规则 ─────────────────────────────

test("补丁12：overwritePoster 只在刷新时打开，平时匹配新源不顶掉已有海报", () => {
  const withPoster = { ...createLocalWork({ id: "r", workId: "w", title: "某片", inputHints: {} }), poster: { source: "bangumi", subject_id: 1 } };
  const candidate = { source: "tmdb", sourceId: "9", title: "某片", posterRef: { source: "tmdb", path: "/new-by-region.jpg" } };

  const normal = applyCandidateToWork(withPoster, candidate);
  assert.deepEqual(normal.poster, { source: "bangumi", subject_id: 1 }, "平时不覆盖");

  const refreshed = applyCandidateToWork(withPoster, candidate, { overwritePoster: true });
  assert.deepEqual(refreshed.poster, { source: "tmdb", path: "/new-by-region.jpg" }, "刷新时才换");
});

test("补丁12：用户手动认领的「活动」「其他」永远不被外部候选覆盖", () => {
  for (const manual of ["event", "other"]) {
    const claimed = { ...createLocalWork({ id: "r", workId: "w", title: "某片", inputHints: {} }), work_type: manual };
    const applied = applyCandidateToWork(claimed, { source: "tmdb", sourceId: "1", title: "某片", workType: "live_action_film" });
    assert.equal(applied.work_type, manual, `${manual} 只可能来自手动认领，刷新不该抹掉`);
  }
  // 自动推断出来的值仍然允许被更新
  const auto = { ...createLocalWork({ id: "r", workId: "w", title: "某片", inputHints: {} }), work_type: "unspecified" };
  assert.equal(
    applyCandidateToWork(auto, { source: "tmdb", sourceId: "1", title: "某片", workType: "animation_film" }).work_type,
    "animation_film"
  );
});

test("补丁12：刷新不改变作品身份与首次记录时间", () => {
  const work = { ...createLocalWork({ id: "r", workId: "w_fixed", title: "鸟人", inputHints: {} }), first_recorded_at: "2026-08-08T00:00:00.000Z" };
  const refreshed = applyCandidateToWork(work, {
    source: "tmdb", sourceId: "194662", title: "鸟人", posterRef: { source: "tmdb", path: "/x.jpg" }
  }, { overwritePoster: true });
  assert.equal(refreshed.id, "w_fixed");
  assert.equal(refreshed.first_recorded_at, "2026-08-08T00:00:00.000Z", "刷新资料不动首次进入记忆系统的时间");
});
