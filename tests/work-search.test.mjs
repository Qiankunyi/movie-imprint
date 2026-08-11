import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkMatchOutcome,
  bangumiCandidateToUnified,
  buildSearchResults,
  foldIntoLocal,
  localWorkToCandidate,
  markCrossSourceDuplicates,
  searchLocalWorks,
  sortExternalCandidates,
  summarizeSearchSources,
  filterCandidatesBySource,
  countBySource,
  hasDegradedSource,
  looksCJK,
  tmdbCandidateToUnified,
  uniqueBangumiLinkCandidate
} from "../src/work-search.js";

const bgm = (id, title, extra = {}) => ({ subjectId: id, title, type: "anime", releaseDate: null, summary: null, ...extra });
const tmdb = (id, title, extra = {}) => ({ tmdbId: id, title, workType: "unspecified", year: null, posterPath: null, summary: null, ...extra });

// ─── 本地搜索 ────────────────────────────────────────────────────────────────

test("本地搜索命中别名——搜原名也能找到用译名存的 Work", () => {
  const works = [
    { id: "w1", title: "鸟人", aliases: ["鸟人", "Birdman"], external_refs: [], release_year: 2014 },
    { id: "w2", title: "无关的片", aliases: [], external_refs: [] }
  ];
  assert.deepEqual(searchLocalWorks(works, "Birdman").map((c) => c.workId), ["w1"]);
  assert.deepEqual(searchLocalWorks(works, "鸟人").map((c) => c.workId), ["w1"]);
  // 大小写与全角/半角差异不应该影响命中（normalizeTitle 的既有行为）
  assert.deepEqual(searchLocalWorks(works, "birdman").map((c) => c.workId), ["w1"]);
});

test("本地搜索标出「已经在这个片单里」，避免用户重复加入", () => {
  const works = [{ id: "w1", title: "鸟人", aliases: [], external_refs: [] }];
  const [c] = searchLocalWorks(works, "鸟人", { isInCollection: (id) => id === "w1" });
  assert.equal(c.inThisCollection, true);
});

test("空查询返回空，不把整个库倒出来", () => {
  const works = [{ id: "w1", title: "鸟人", aliases: [], external_refs: [] }];
  assert.deepEqual(searchLocalWorks(works, ""), []);
  assert.deepEqual(searchLocalWorks(works, "   "), []);
});

// ─── 统一候选模型 ────────────────────────────────────────────────────────────

test("三个来源都转成同一形状，external id 各自归位", () => {
  const local = localWorkToCandidate({
    id: "w1", title: "你的名字。", original_title: "君の名は。", release_year: 2016,
    work_type: "animation_film", poster: { source: "tmdb", path: "/x.jpg" },
    external_refs: [{ source: "bangumi", id: "150775" }, { source: "tmdb", id: "372058" }]
  });
  assert.equal(local.source, "local");
  assert.equal(local.workId, "w1");
  assert.deepEqual(local.externalIds, { bangumi: "150775", tmdb: "372058" });

  const b = bangumiCandidateToUnified(bgm(150775, "你的名字。", { releaseDate: "2016-08-26", type: "anime" }));
  assert.deepEqual(b.externalIds, { bangumi: "150775" });
  assert.equal(b.year, 2016);
  assert.equal(b.workType, "animation_film");
  assert.deepEqual(b.posterRef, { source: "bangumi", subject_id: 150775 });

  const t = tmdbCandidateToUnified(tmdb(372058, "你的名字。", { year: 2016, workType: "animation_film", posterPath: "/q7.jpg" }));
  assert.deepEqual(t.externalIds, { tmdb: "372058" });
  assert.deepEqual(t.posterRef, { source: "tmdb", path: "/q7.jpg" });
});

// ─── §9：相同 external id 必须去重 ──────────────────────────────────────────

test("§9：外部候选命中本地 Work 的 external_ref 时被折叠，不重复展示", () => {
  const local = [localWorkToCandidate({
    id: "w1", title: "你的名字。", aliases: [], external_refs: [{ source: "bangumi", id: "150775" }]
  })];
  const external = [
    bangumiCandidateToUnified(bgm(150775, "你的名字。")),
    bangumiCandidateToUnified(bgm(999, "另一部片"))
  ];
  const kept = foldIntoLocal(external, local);
  assert.deepEqual(kept.map((c) => c.sourceId), ["999"], "已经在库里的那条应被折叠掉");
});

test("§9：本地 Work 持有 tmdb_id 时，TMDB 候选同样被折叠", () => {
  const local = [localWorkToCandidate({
    id: "w1", title: "鸟人", aliases: [], external_refs: [{ source: "tmdb", id: "194662" }]
  })];
  const kept = foldIntoLocal([tmdbCandidateToUnified(tmdb(194662, "鸟人"))], local);
  assert.deepEqual(kept, []);
});

test("§9：只有标题相同、external id 不同时不折叠——同名电影太多了", () => {
  const local = [localWorkToCandidate({
    id: "w1", title: "无间道", aliases: [], external_refs: [{ source: "tmdb", id: "111" }]
  })];
  const kept = foldIntoLocal([tmdbCandidateToUnified(tmdb(222, "无间道"))], local);
  assert.equal(kept.length, 1, "标题相同不构成折叠依据");
});

// ─── §9：跨源疑似同一作品只提示，不自动合并 ────────────────────────────────

test("§9：Bangumi 与 TMDB 的同一部片被标记为疑似，但两条都保留", () => {
  const candidates = [
    bangumiCandidateToUnified(bgm(150775, "你的名字。", { releaseDate: "2016-08-26" })),
    tmdbCandidateToUnified(tmdb(372058, "你的名字。", { year: 2016 }))
  ];
  const marked = markCrossSourceDuplicates(candidates);
  assert.equal(marked.length, 2, "绝不自动合并——两条都要展示，由用户判断");
  assert.equal(marked[0].possibleDuplicateOf.source, "tmdb");
  assert.equal(marked[1].possibleDuplicateOf.source, "bangumi");
});

test("§9：上映年份差一年仍算疑似（不同地区上映时间常常跨年）", () => {
  const marked = markCrossSourceDuplicates([
    bangumiCandidateToUnified(bgm(1, "君の名は。", { releaseDate: "2016-08-26" })),
    tmdbCandidateToUnified(tmdb(2, "你的名字。", { year: 2017, originalTitle: "君の名は。" }))
  ]);
  assert.ok(marked[0].possibleDuplicateOf, "原名相同、年份差 1，应提示");
});

test("§9：年份差太多不判疑似——重制版与原版不是同一部", () => {
  const marked = markCrossSourceDuplicates([
    bangumiCandidateToUnified(bgm(1, "无间道", { releaseDate: "2002-12-12" })),
    tmdbCandidateToUnified(tmdb(2, "无间道", { year: 2016 }))
  ]);
  assert.ok(!marked[0].possibleDuplicateOf);
  assert.ok(!marked[1].possibleDuplicateOf);
});

test("§9：缺年份时一律不判疑似——只靠标题会大量误判同名电影", () => {
  const marked = markCrossSourceDuplicates([
    bangumiCandidateToUnified(bgm(1, "同名片")),
    tmdbCandidateToUnified(tmdb(2, "同名片"))
  ]);
  assert.ok(!marked[0].possibleDuplicateOf);
});

test("§9：同一个源内部的两条不互相标记为跨源疑似", () => {
  const marked = markCrossSourceDuplicates([
    tmdbCandidateToUnified(tmdb(1, "某片", { year: 2020 })),
    tmdbCandidateToUnified(tmdb(2, "某片", { year: 2020 }))
  ]);
  assert.ok(!marked[0].possibleDuplicateOf);
  assert.ok(!marked[1].possibleDuplicateOf);
});

// ─── 排序 ────────────────────────────────────────────────────────────────────

test("标题完全匹配排最前，其次前缀匹配", () => {
  const sorted = sortExternalCandidates([
    tmdbCandidateToUnified(tmdb(1, "鸟人归来", { year: 2020 })),
    tmdbCandidateToUnified(tmdb(2, "鸟人", { year: 2014 })),
    tmdbCandidateToUnified(tmdb(3, "关于鸟人的一切", { year: 2021 }))
  ], "鸟人");
  assert.deepEqual(sorted.map((c) => c.sourceId), ["2", "1", "3"]);
});

test("日文查询让 Bangumi 结果靠前，拉丁字母让 TMDB 靠前——但两个源的结果都在", () => {
  const mixed = [
    tmdbCandidateToUnified(tmdb(1, "某片", { year: 2020 })),
    bangumiCandidateToUnified(bgm(2, "某片", { releaseDate: "2020-01-01" }))
  ];
  assert.equal(sortExternalCandidates(mixed, "けいおん")[0].source, "bangumi");
  assert.equal(sortExternalCandidates(mixed, "Birdman")[0].source, "tmdb");
  assert.equal(sortExternalCandidates(mixed, "けいおん").length, 2, "偏好只影响顺序，不过滤任何一个源");
});

// ─── 完整装配 ────────────────────────────────────────────────────────────────

test("buildSearchResults：本地优先 + 折叠 + 同源去重 + 疑似标记", () => {
  const local = searchLocalWorks(
    [{ id: "w1", title: "你的名字。", aliases: ["君の名は。"], external_refs: [{ source: "bangumi", id: "150775" }], release_year: 2016 }],
    "你的名字"
  );
  const { local: localOut, external } = buildSearchResults({
    local,
    bangumi: [
      bgm(150775, "你的名字。", { releaseDate: "2016-08-26" }),
      bgm(150775, "你的名字。", { releaseDate: "2016-08-26" }) // 同源重复
    ],
    tmdb: [tmdb(372058, "你的名字。", { year: 2016, originalTitle: "君の名は。" })],
    query: "你的名字"
  });

  assert.equal(localOut.length, 1);
  // Bangumi 那条已经在本地库里 → 折叠；TMDB 那条是新的 → 保留
  assert.deepEqual(external.map((c) => `${c.source}:${c.sourceId}`), ["tmdb:372058"]);
  // 唯一剩下的外部候选没有同源伙伴可比，不该带疑似标记
  assert.ok(!external[0].possibleDuplicateOf);
});

test("buildSearchResults：空输入不抛错", () => {
  const out = buildSearchResults({});
  assert.deepEqual(out, { local: [], external: [] });
});

// ─── R6 补丁 3：数据源状态必须可见 ───────────────────────────────────────────

test("补丁3：未配置密钥与「搜到 0 条」必须能区分开", () => {
  const [bgm, tmdbStatus] = summarizeSearchSources({
    bangumi: { state: "ok", count: 8 },
    tmdb: { state: "unconfigured" }
  });
  assert.equal(bgm.text, "Bangumi 8 条");
  assert.equal(bgm.tone, "normal");
  assert.match(tmdbStatus.text, /未配置密钥/);
  assert.equal(tmdbStatus.tone, "warn");
  // 这正是实测时看到的场景：结果里只有 Bangumi，而界面完全没说 TMDB 没参与
  assert.notEqual(tmdbStatus.text, "TMDB 0 条");
});

test("补丁3：请求失败与「搜到 0 条」也必须能区分开", () => {
  const [, tmdbStatus] = summarizeSearchSources({
    bangumi: { state: "ok", count: 3 },
    tmdb: { state: "failed", error: "TMDB 401" }
  });
  assert.match(tmdbStatus.text, /暂时不可用/);
  assert.match(tmdbStatus.text, /TMDB 401/);
  assert.equal(tmdbStatus.tone, "error");
});

test("补丁3：两个源都正常时也照常显示条数，不是只在出错时才提示", () => {
  const summary = summarizeSearchSources({ bangumi: { state: "ok", count: 2 }, tmdb: { state: "ok", count: 5 } });
  assert.deepEqual(summary.map((s) => s.text), ["Bangumi 2 条", "TMDB 5 条"]);
  assert.equal(hasDegradedSource({ bangumi: { state: "ok" }, tmdb: { state: "ok" } }), false);
});

test("补丁3：任一源未配置或失败都算降级", () => {
  assert.equal(hasDegradedSource({ tmdb: { state: "unconfigured" } }), true);
  assert.equal(hasDegradedSource({ tmdb: { state: "failed" } }), true);
  assert.equal(hasDegradedSource({}), false);
});

test("补丁3：CJK 查询识别——用于解释「TMDB 对中文片名收录有限」而不是硬编码某部片", () => {
  assert.equal(looksCJK("鸟人"), true);
  assert.equal(looksCJK("バードマン"), true);
  assert.equal(looksCJK("君の名は。"), true);
  assert.equal(looksCJK("Birdman"), false);
  assert.equal(looksCJK(""), false);
});

// ─── R6 补丁 8：按数据源筛选结果 ────────────────────────────────────────────

test("补丁8：按来源过滤外部候选，不传或传 all 时不过滤", () => {
  const list = [
    bangumiCandidateToUnified(bgm(1, "魔女宅急便")),
    bangumiCandidateToUnified(bgm(2, "魔女宅急便 真人版")),
    tmdbCandidateToUnified(tmdb(3, "魔女宅急便"))
  ];
  assert.deepEqual(filterCandidatesBySource(list, "bangumi").map((c) => c.sourceId), ["1", "2"]);
  assert.deepEqual(filterCandidatesBySource(list, "tmdb").map((c) => c.sourceId), ["3"]);
  assert.equal(filterCandidatesBySource(list, null).length, 3);
  assert.equal(filterCandidatesBySource(list, "all").length, 3);
  assert.deepEqual(filterCandidatesBySource(list, "不存在的源"), []);
});

test("补丁8：countBySource 用于判断筛选 chip 该不该可点", () => {
  const list = [
    bangumiCandidateToUnified(bgm(1, "甲")),
    tmdbCandidateToUnified(tmdb(2, "乙")),
    tmdbCandidateToUnified(tmdb(3, "丙"))
  ];
  assert.deepEqual(countBySource(list), { bangumi: 1, tmdb: 2 });
  assert.deepEqual(countBySource([]), {});
});

test("补丁8：筛选不改变原数组，也不影响跨源疑似标记", () => {
  const list = markCrossSourceDuplicates([
    bangumiCandidateToUnified(bgm(1, "魔女の宅急便", { releaseDate: "1989-07-29" })),
    tmdbCandidateToUnified(tmdb(2, "魔女宅急便", { year: 1989, originalTitle: "魔女の宅急便" }))
  ]);
  const onlyTmdb = filterCandidatesBySource(list, "tmdb");
  assert.equal(list.length, 2, "原数组不变");
  assert.equal(onlyTmdb.length, 1);
  // 疑似标记是筛选前就打好的，筛掉另一条之后标记仍然在——用户切回全部还能看到对照
  assert.ok(onlyTmdb[0].possibleDuplicateOf);
});

test("海报关联：唯一同名同年 Bangumi 结果可以一键关联", () => {
  const work = { title: "蜘蛛侠3", original_title: "Spider-Man 3", aliases: ["蜘蛛侠 3"], release_year: 2007 };
  const candidates = [
    bgm(1, "蜘蛛侠3", { originalTitle: "Spider-Man 3", releaseDate: "2007-05-01" }),
    bgm(2, "蜘蛛侠：英雄无归", { releaseDate: "2021-12-17" })
  ];
  assert.equal(uniqueBangumiLinkCandidate(work, candidates)?.subjectId, 1);
});

test("海报关联：同名候选有歧义或年份冲突时必须让用户确认", () => {
  const work = { title: "某片", aliases: [], release_year: 2007 };
  assert.equal(uniqueBangumiLinkCandidate(work, [
    bgm(1, "某片", { releaseDate: "2007-01-01" }),
    bgm(2, "某片", { releaseDate: "2007-05-01" })
  ]), null, "两个同样可信的结果不能擅自选一个");
  assert.equal(uniqueBangumiLinkCandidate(work, [bgm(3, "某片", { releaseDate: "2017-01-01" })]), null);
});

test("详情页作品匹配保留双源状态，TMDB 未配置时不会伪装成零结果", () => {
  const sources = {
    bangumi: { state: "ok", count: 8 },
    tmdb: { state: "unconfigured", count: 0 }
  };
  const candidates = [{ source: "bangumi", sourceId: "1", title: "魔戒2：双塔奇兵" }];
  const match = buildWorkMatchOutcome({
    query: "指环王 双塔奇兵",
    candidates,
    sources,
    correcting: true
  });

  assert.equal(match.status, "needs_confirmation");
  assert.equal(match.query, "指环王 双塔奇兵");
  assert.equal(match.sources.tmdb.state, "unconfigured");
  assert.deepEqual(match.candidates, candidates);
});

test("修正匹配没有候选时仍保留查询词和来源状态，允许继续换英文名搜索", () => {
  const sources = {
    bangumi: { state: "ok", count: 0 },
    tmdb: { state: "ok", count: 0 }
  };
  const match = buildWorkMatchOutcome({
    query: "The Lord of the Rings: The Two Towers",
    candidates: [],
    sources,
    correcting: true
  });

  assert.equal(match.status, "no_results");
  assert.equal(match.query, "The Lord of the Rings: The Two Towers");
  assert.equal(match.correcting, true);
  assert.equal(match.sources, sources);
  assert.match(match.message, /保留当前匹配/);
});

test("两个作品数据库都失败时明确进入 unavailable 且不丢失各源错误", () => {
  const sources = {
    bangumi: { state: "failed", count: 0, error: "timeout" },
    tmdb: { state: "failed", count: 0, error: "HTTP 503" }
  };
  const match = buildWorkMatchOutcome({ query: "Two Towers", sources });

  assert.equal(match.status, "unavailable");
  assert.equal(match.sources.bangumi.error, "timeout");
  assert.equal(match.sources.tmdb.error, "HTTP 503");
});
