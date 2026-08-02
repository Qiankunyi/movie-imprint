import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTITUDE_DESCRIPTIONS,
  RECOMMENDATION_PRESETS,
  allowedRecommendationsForAttitude,
  createLocalWork,
  createRawOnlyRecord,
  deterministicAnalysis,
  extractHashtags,
  isRecommendationAllowed,
  parseDraft,
  parseWorkTag,
  reconcileLocalWorkTitle,
  recommendationLabel
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
  assert.deepEqual(work, {
    id: "work_record_123",
    work_id: "work_record_123",
    title: "大雄与动物行星",
    original_title: null,
    work_type: "unspecified",
    aliases: ["哆啦A梦/大雄与动物行星", "大雄与动物行星"],
    release_year: null,
    external_refs: [],
    identity_status: "local_only",
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
