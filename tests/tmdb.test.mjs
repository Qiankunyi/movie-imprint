import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTmdbDetailRequest,
  buildTmdbImageUrl,
  buildTmdbSearchRequest,
  inferWorkType,
  isAllowedTmdbImageUrl,
  isValidTmdbPosterPath,
  normalizeTmdbDetail,
  normalizeTmdbMovies
} from "../src/tmdb.js";

test("搜索请求：带语言与分页，明确排除成人内容", () => {
  const { url } = buildTmdbSearchRequest("Birdman");
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://api.themoviedb.org/3/search/movie");
  assert.equal(parsed.searchParams.get("query"), "Birdman");
  assert.equal(parsed.searchParams.get("language"), "zh-CN");
  assert.equal(parsed.searchParams.get("include_adult"), "false");
});

test("详情请求：一次带回 external_ids，非法 id 返回 null", () => {
  const { url } = buildTmdbDetailRequest(194662);
  assert.ok(url.includes("/3/movie/194662"));
  assert.ok(url.includes("append_to_response=external_ids"));
  assert.equal(buildTmdbDetailRequest("abc"), null);
  assert.equal(buildTmdbDetailRequest(-1), null);
  assert.equal(buildTmdbDetailRequest(0), null);
});

// ─── R6 §12：作品类型推断（本次最容易出错的一处） ────────────────────────────

test("§12 红线：含动画类型判动画电影，绝不因为 media_type 是 movie 就判真人电影", () => {
  // 《你的名字。》在 TMDB 上同样是 movie，靠 genre 16 才能认出是动画电影
  assert.equal(inferWorkType([16, 18, 10749]), "animation_film");
  assert.equal(inferWorkType([{ id: 16, name: "动画" }]), "animation_film");
});

test("§12：标了类型但不含动画 → 真人电影；完全没有类型数据 → 未分类由用户认领", () => {
  assert.equal(inferWorkType([18, 35]), "live_action_film");
  assert.equal(inferWorkType([]), "unspecified");
  assert.equal(inferWorkType(undefined), "unspecified");
  assert.equal(inferWorkType(null), "unspecified");
  // 脏数据不应该被当成"有类型信息"
  assert.equal(inferWorkType(["", null]), "unspecified");
});

// ─── 海报路径校验（安全相关） ────────────────────────────────────────────────

test("poster_path 严格校验，挡住路径穿越与协议逃逸", () => {
  assert.equal(isValidTmdbPosterPath("/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg"), true);
  assert.equal(isValidTmdbPosterPath("/abc12345.webp"), true);

  assert.equal(isValidTmdbPosterPath("/../../etc/passwd"), false);
  assert.equal(isValidTmdbPosterPath("/a/b.jpg"), false, "不允许多级路径");
  assert.equal(isValidTmdbPosterPath("nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg"), false, "必须以斜杠开头");
  assert.equal(isValidTmdbPosterPath("/x.svg"), false, "扩展名白名单之外");
  assert.equal(isValidTmdbPosterPath("/short.jpg"), false, "文件名过短，不像 TMDB 的 hash");
  assert.equal(isValidTmdbPosterPath(""), false);
  assert.equal(isValidTmdbPosterPath(null), false);
});

test("图片 URL 只接受合法 path，尺寸档位也做白名单", () => {
  assert.equal(
    buildTmdbImageUrl("/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg"),
    "https://image.tmdb.org/t/p/w500/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg"
  );
  assert.equal(
    buildTmdbImageUrl("/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg", "original"),
    "https://image.tmdb.org/t/p/original/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg"
  );
  // 非法尺寸回落到 w500，不会把任意字符串拼进 URL
  assert.ok(buildTmdbImageUrl("/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg", "../../evil").includes("/t/p/w500/"));
  assert.equal(buildTmdbImageUrl("/../../evil.jpg"), null);
});

test("图片主机白名单：只认 https 的 image.tmdb.org", () => {
  assert.equal(isAllowedTmdbImageUrl("https://image.tmdb.org/t/p/w500/x.jpg"), true);
  assert.equal(isAllowedTmdbImageUrl("http://image.tmdb.org/t/p/w500/x.jpg"), false);
  assert.equal(isAllowedTmdbImageUrl("https://image.tmdb.org.evil.example/x.jpg"), false);
  assert.equal(isAllowedTmdbImageUrl("https://evil.example/image.tmdb.org/x.jpg"), false);
  assert.equal(isAllowedTmdbImageUrl("not a url"), false);
});

// ─── 归一化 ──────────────────────────────────────────────────────────────────

test("normalizeTmdbMovies：上限 10 条，缺标题或 id 的条目被丢弃", () => {
  const payload = {
    results: [
      {
        id: 194662,
        title: "鸟人",
        original_title: "Birdman or (The Unexpected Virtue of Ignorance)",
        release_date: "2014-08-27",
        genre_ids: [18, 35],
        poster_path: "/rSZs93P0LLxqlVEbI001UKoeCQC.jpg",
        overview: "一个过气演员试图在百老汇重新证明自己。",
        original_language: "en"
      },
      { id: 0, title: "非法 id" },
      { id: 5, title: "   " },
      ...Array.from({ length: 12 }, (_, i) => ({ id: 1000 + i, title: `片 ${i}` }))
    ]
  };
  const candidates = normalizeTmdbMovies(payload);
  assert.equal(candidates.length, 10);
  assert.deepEqual(candidates[0], {
    tmdbId: 194662,
    title: "鸟人",
    originalTitle: "Birdman or (The Unexpected Virtue of Ignorance)",
    releaseDate: "2014-08-27",
    year: 2014,
    workType: "live_action_film",
    posterPath: "/rSZs93P0LLxqlVEbI001UKoeCQC.jpg",
    summary: "一个过气演员试图在百老汇重新证明自己。",
    originalLanguage: "en",
    url: "https://www.themoviedb.org/movie/194662"
  });
});

test("normalizeTmdbMovies：original_title 与 title 相同时不重复存别名", () => {
  const [c] = normalizeTmdbMovies({ results: [{ id: 1, title: "Dunkirk", original_title: "Dunkirk" }] });
  assert.equal(c.originalTitle, null);
});

test("normalizeTmdbMovies：非法 poster_path 直接丢弃，不带进下游", () => {
  const [c] = normalizeTmdbMovies({ results: [{ id: 1, title: "某片", poster_path: "/../../evil.jpg" }] });
  assert.equal(c.posterPath, null);
});

test("normalizeTmdbMovies：空/异常载荷返回空数组，不抛错", () => {
  assert.deepEqual(normalizeTmdbMovies(null), []);
  assert.deepEqual(normalizeTmdbMovies({}), []);
  assert.deepEqual(normalizeTmdbMovies({ results: "nope" }), []);
});

test("normalizeTmdbDetail：只取需要的字段与长期身份标识（imdb / wikidata）", () => {
  const detail = normalizeTmdbDetail({
    id: 372058,
    title: "你的名字。",
    original_title: "君の名は。",
    release_date: "2016-08-26",
    runtime: 106,
    genres: [{ id: 16, name: "动画" }, { id: 18, name: "剧情" }],
    poster_path: "/q719jXXEzOoYaps6babgKnONONX.jpg",
    overview: "住在东京的少年与住在乡下的少女，在梦中交换了身体。",
    external_ids: {
      imdb_id: "tt5311514",
      wikidata_id: "Q23621347",
      facebook_id: "kiminonaha",
      twitter_id: "kimi_no_na_wa"
    },
    // 以下字段刻意不落库——不做「以后可能有用」的囤积
    budget: 0,
    revenue: 358000000,
    production_companies: [{ id: 1, name: "CoMix Wave Films" }]
  });

  assert.equal(detail.tmdbId, 372058);
  assert.equal(detail.originalTitle, "君の名は。");
  assert.equal(detail.year, 2016);
  assert.equal(detail.runtimeMinutes, 106);
  // 日本动画电影在 TMDB 上也是 movie —— 靠 genre 16 才没被错标成真人电影
  assert.equal(detail.workType, "animation_film");
  assert.deepEqual(detail.genres, ["动画", "剧情"]);
  assert.deepEqual(detail.externalIds, { imdb: "tt5311514", wikidata: "Q23621347" });
  assert.ok(!("budget" in detail) && !("revenue" in detail), "无关字段不进数据库");
  assert.ok(!("facebook" in detail.externalIds), "社交账号不是长期身份标识");
});

test("normalizeTmdbDetail：runtime 为 0 或缺失时记 null，不产生假数据", () => {
  const a = normalizeTmdbDetail({ id: 1, title: "某片", runtime: 0 });
  assert.equal(a.runtimeMinutes, null);
  const b = normalizeTmdbDetail({ id: 1, title: "某片" });
  assert.equal(b.runtimeMinutes, null);
  assert.deepEqual(b.externalIds, { imdb: null, wikidata: null });
});

test("normalizeTmdbDetail：id 或标题缺失返回 null", () => {
  assert.equal(normalizeTmdbDetail({ title: "没有 id" }), null);
  assert.equal(normalizeTmdbDetail({ id: 1 }), null);
  assert.equal(normalizeTmdbDetail(null), null);
});
