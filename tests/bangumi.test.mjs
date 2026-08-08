import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBangumiImageRequest,
  buildBangumiSearchRequest,
  buildWorkSearchQuery,
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

test("R6：Bangumi 搜索请求动画与真人条目，候选上限 10（片单搜索场景 3 条不够用）", () => {
  const request = buildBangumiSearchRequest("哆啦A梦：大雄与动物行星");
  assert.equal(request.url, "https://api.bgm.tv/v0/search/subjects?limit=10&offset=0");
  assert.deepEqual(request.body.filter, { type: [2, 6], nsfw: false });

  const candidates = normalizeBangumiSubjects({ data: [
    { id: 1, name: "A", name_cn: "甲", type: 2, date: "1990-01-01", images: { common: "https://example.com/1.jpg" } },
    { id: 2, name: "B", name_cn: "", type: 6, date: null, images: null },
    { id: 3, name: "C", name_cn: "丙", type: 2 },
    { id: 4, name: "D", name_cn: "丁", type: 2 }
  ] });
  // name_cn 为空且 name 也拿不到标题的条目会被丢弃，其余全部保留
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates[0], {
    subjectId: 1,
    title: "甲",
    originalTitle: "A",
    type: "anime",
    releaseDate: "1990-01-01",
    summary: null,
    image: "https://example.com/1.jpg",
    url: "https://bangumi.tv/subject/1"
  });
});

test("normalizeBangumiSubjects 带回 summary，供一句话简介抽首句使用", () => {
  const [candidate] = normalizeBangumiSubjects({ data: [
    { id: 7, name: "X", name_cn: "某片", type: 2, date: "2020-05-05", summary: "少女们签下契约，换取一个愿望。代价是什么，没有人告诉过她们。" }
  ] });
  assert.equal(candidate.summary, "少女们签下契约，换取一个愿望。代价是什么，没有人告诉过她们。");
});
