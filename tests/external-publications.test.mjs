import test from "node:test";
import assert from "node:assert/strict";
import {
  createExternalPublication,
  detectPublicationPlatform,
  hasDuplicatePublication,
  normalizePublicationUrl,
  sortExternalPublications,
  updateExternalPublication,
  viewingPublicationLabel,
  xStatusId
} from "../src/external-publications.js";

test("识别预设平台，未知 HTTP(S) URL 仍归为 other", () => {
  assert.equal(detectPublicationPlatform("https://x.com/u/status/123"), "x");
  assert.equal(detectPublicationPlatform("https://bsky.app/profile/a/post/b"), "bluesky");
  assert.equal(detectPublicationPlatform("https://bangumi.tv/subject/1"), "bangumi");
  assert.equal(detectPublicationPlatform("https://movie.douban.com/review/1"), "douban");
  assert.equal(detectPublicationPlatform("https://example.com/post"), "other");
});

test("URL normalization 只移除 tracking，并保留有意义的 query", () => {
  assert.equal(
    normalizePublicationUrl("https://X.com/u/status/123/?utm_source=a&lang=zh&ref_src=b#reply"),
    "https://x.com/u/status/123?lang=zh"
  );
  assert.equal(normalizePublicationUrl("javascript:alert(1)"), null);
});

test("同一作品按 normalized URL 去重，不限制跨作品引用", () => {
  const item = createExternalPublication({
    id: "pub_1", workId: "work_1", url: "https://x.com/u/status/123?utm_source=a", now: "2026-08-10T00:00:00Z"
  });
  assert.equal(hasDuplicatePublication([item], { workId: "work_1", normalizedUrl: "https://x.com/u/status/123" }), true);
  assert.equal(hasDuplicatePublication([item], { workId: "work_2", normalizedUrl: "https://x.com/u/status/123" }), false);
});

test("编辑 URL 时重新识别平台并保留 created_at", () => {
  const item = createExternalPublication({ id: "p", workId: "w", url: "https://example.com/a", now: "2026-08-10T00:00:00Z" });
  const updated = updateExternalPublication(item, { url: "https://bangumi.tv/blog/1", note: "  记录  " }, "2026-08-11T00:00:00Z");
  assert.equal(updated.platform, "bangumi");
  assert.equal(updated.note, "记录");
  assert.equal(updated.created_at, item.created_at);
  assert.equal(updated.updated_at, "2026-08-11T00:00:00Z");
});

test("按 published_at/created_at 倒序并生成观影关联标签", () => {
  const sorted = sortExternalPublications([
    { id: "a", created_at: "2026-08-10" },
    { id: "b", published_at: "2026-08-12", created_at: "2026-08-09" }
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["b", "a"]);
  assert.equal(viewingPublicationLabel({ viewing_record_id: "e2" }, [{ id: "e2", viewing_relation: "rewatch", watch_index: 2 }]), "第 2 次观看后发表");
  assert.equal(xStatusId("https://twitter.com/u/status/987?s=20"), "987");
});
