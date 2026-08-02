import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBangumiCandidateToWork,
  buildBangumiImageRequest,
  buildBangumiSearchRequest,
  buildWorkSearchQuery,
  chooseDailyWallpaper,
  chooseNextWallpaper,
  isAllowedBangumiImageUrl,
  normalizeBangumiSubjects
} from "../src/bangumi.js";

test("系列速记会组合成搜索线索而不是作品身份", () => {
  assert.equal(buildWorkSearchQuery({
    title: "哆啦A梦/大雄与动物行星",
    inputHints: { seriesPath: ["哆啦A梦"], workTitle: "大雄与动物行星" }
  }), "哆啦A梦：大雄与动物行星");
});

test("图片代理只接受正式条目 ID 与 Bangumi 图片主机", () => {
  assert.equal(buildBangumiImageRequest(449), "https://api.bgm.tv/v0/subjects/449/image?type=large");
  assert.equal(buildBangumiImageRequest("not-an-id"), null);
  assert.equal(isAllowedBangumiImageUrl("https://lain.bgm.tv/pic/cover/l/example.jpg"), true);
  assert.equal(isAllowedBangumiImageUrl("http://lain.bgm.tv/pic/cover/l/example.jpg"), false);
  assert.equal(isAllowedBangumiImageUrl("https://lain.bgm.tv.evil.example/cover.jpg"), false);
});

test("同一天从已匹配作品中稳定选择同一张壁纸", () => {
  const works = [
    { id: "work_b", title: "作品乙", identity_status: "matched", external_refs: [{ source: "bangumi", id: "202", url: "https://bgm.tv/subject/202" }] },
    { id: "work_local", title: "本地作品", identity_status: "local_only", external_refs: [] },
    { id: "work_a", title: "作品甲", identity_status: "matched", external_refs: [{ source: "bangumi", id: "101", url: "https://bgm.tv/subject/101" }] }
  ];
  const first = chooseDailyWallpaper(works, "2026-08-02");
  const second = chooseDailyWallpaper([...works].reverse(), "2026-08-02");
  assert.deepEqual(first, second);
  assert.ok([101, 202].includes(first.subjectId));
  assert.equal(chooseDailyWallpaper([works[1]], "2026-08-02"), null);
});

test("换一张壁纸按稳定作品顺序轮换", () => {
  const works = [
    { id: "work_b", title: "乙", identity_status: "matched", external_refs: [{ source: "bangumi", id: "2" }] },
    { id: "work_a", title: "甲", identity_status: "matched", external_refs: [{ source: "bangumi", id: "1" }] }
  ];
  assert.equal(chooseNextWallpaper(works, "work_a", "2026-08-02").workId, "work_b");
  assert.equal(chooseNextWallpaper(works, "work_b", "2026-08-02").workId, "work_a");
});

test("确认候选只更新稳定 Work 并保存 Bangumi 外部身份", () => {
  const result = applyBangumiCandidateToWork({
    id: "work_1",
    work_id: "work_1",
    title: "哆啦A梦/大雄与动物行星",
    aliases: ["哆啦A梦/大雄与动物行星", "大雄与动物行星"],
    external_refs: [],
    identity_status: "local_only",
    match: { status: "needs_confirmation", query: "哆啦A梦 大雄与动物行星", candidates: [] }
  }, {
    subjectId: 1309,
    title: "哆啦A梦：大雄与动物行星",
    originalTitle: "ドラえもん のび太とアニマル惑星",
    type: "anime",
    releaseDate: "1990-03-10",
    url: "https://bgm.tv/subject/1309"
  });
  assert.equal(result.title, "哆啦A梦：大雄与动物行星");
  assert.equal(result.work_type, "animation_movie");
  assert.equal(result.release_year, 1990);
  assert.equal(result.identity_status, "matched");
  assert.deepEqual(result.external_refs, [{ source: "bangumi", id: "1309", url: "https://bangumi.tv/subject/1309" }]);
  assert.equal(result.match.status, "confirmed");
});

test("Bangumi 搜索只请求动画与真人条目且最多三个候选", () => {
  const request = buildBangumiSearchRequest("哆啦A梦：大雄与动物行星");
  assert.equal(request.url, "https://api.bgm.tv/v0/search/subjects?limit=3&offset=0");
  assert.deepEqual(request.body.filter, { type: [2, 6], nsfw: false });

  const candidates = normalizeBangumiSubjects({ data: [
    { id: 1, name: "A", name_cn: "甲", type: 2, date: "1990-01-01", images: { common: "https://example.com/1.jpg" } },
    { id: 2, name: "B", name_cn: "", type: 6, date: null, images: null },
    { id: 3, name: "C", name_cn: "丙", type: 2 },
    { id: 4, name: "D", name_cn: "丁", type: 2 }
  ] });
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates[0], {
    subjectId: 1,
    title: "甲",
    originalTitle: "A",
    type: "anime",
    releaseDate: "1990-01-01",
    image: "https://example.com/1.jpg",
    url: "https://bangumi.tv/subject/1"
  });
});
