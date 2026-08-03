import test from "node:test";
import assert from "node:assert/strict";
import { memoryListMarkup } from "../src/memory-list.js";

function sampleCards() {
  return [
    { card_id: "card_1", type: "被击中的瞬间", title: "标题一", content: "内容一", is_core: true, order: 0, provenance: "local_deterministic" },
    { card_id: "card_2", type: "场景", title: "标题二", content: "内容二", is_core: false, order: 1, provenance: "user_added" },
    { card_id: "card_3", type: "台词", title: "标题三", content: "内容三", is_core: false, order: 2, provenance: "ai_suggested" }
  ];
}

test("3 张卡片 → 一次渲染出 3 个 .memory-card，不是 1 个", () => {
  const html = memoryListMarkup(sampleCards());
  const matches = html.match(/data-testid="memory-card"/g) || [];
  assert.equal(matches.length, 3);
});

test("不含分页控件、不含左右滑动提示、不含轮播语义", () => {
  const html = memoryListMarkup(sampleCards());
  assert.doesNotMatch(html, /memory-pagination/);
  assert.doesNotMatch(html, /左右滑动/);
  assert.doesNotMatch(html, /aria-roledescription="轮播"/);
  assert.doesNotMatch(html, /previous-card/);
  assert.doesNotMatch(html, /next-card/);
});

test("含 role=\"list\" 与 role=\"listitem\"", () => {
  const html = memoryListMarkup(sampleCards());
  assert.match(html, /role="list"/);
  const listitemMatches = html.match(/role="listitem"/g) || [];
  assert.equal(listitemMatches.length, 3);
});

test("0 张卡片 → 空状态维持", () => {
  const html = memoryListMarkup([]);
  assert.match(html, /memory-empty/);
  assert.doesNotMatch(html, /memory-card/);
});

test("is_core 卡片仍带核心样式", () => {
  const html = memoryListMarkup(sampleCards());
  assert.match(html, /memory-card core"/);
});

test("AI 建议卡的保留／删除按钮仍在每张卡上正确渲染", () => {
  const html = memoryListMarkup(sampleCards());
  assert.match(html, /data-action="accept-ai-card" data-card-id="card_3"/);
  assert.match(html, /data-action="remove-ai-card" data-card-id="card_3"/);
  // 非 AI 建议的卡片不应该带这组按钮
  assert.doesNotMatch(html, /data-card-id="card_1">保留这张/);
});

test("aria-label 标注卡片总数", () => {
  const html = memoryListMarkup(sampleCards());
  assert.match(html, /记忆卡片，共 3 张/);
});
