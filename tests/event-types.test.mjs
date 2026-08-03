import test from "node:test";
import assert from "node:assert/strict";
import { classifyBracketContent, extractEventTypes } from "../src/event-types.js";
import { extractFormatAndTitle } from "../src/ticket.js";

test("classifyBracketContent 识别制式关键词", () => {
  assert.deepEqual(classifyBracketContent("IMAX"), { kind: "format", value: "IMAX" });
});

test("classifyBracketContent 识别活动关键词", () => {
  assert.deepEqual(classifyBracketContent("舞台挨拶付き"), { kind: "event", key: "stage_greeting" });
});

test("【IMAX】【舞台挨拶付き】劇場版○○ → format/event_types 正确分流，片名干净", () => {
  const { movieTitle, format, eventTypes } = extractFormatAndTitle("【IMAX】【舞台挨拶付き】劇場版○○");
  assert.equal(format, "IMAX");
  assert.deepEqual(eventTypes, ["stage_greeting"]);
  assert.equal(movieTitle, "劇場版○○");
});

test("正文里出现「応援上映」但片名无【】→ 仍能提取到 cheer_screening", () => {
  const text = "作品名：劇場版まどか☆マギカ\n本日は応援上映にご参加いただきありがとうございます。";
  assert.deepEqual(extractEventTypes(text), ["cheer_screening"]);
});

test("同一封邮件出现两次「舞台挨拶」→ event_types 去重，只有一项", () => {
  const text = "本日は舞台挨拶付き上映です。舞台挨拶終了後は速やかにご退出ください。";
  assert.deepEqual(extractEventTypes(text), ["stage_greeting"]);
});

test("未知的【】内容 → 保守写入 format，不丢失", () => {
  const { format, eventTypes } = extractFormatAndTitle("【デジタルリマスター版】劇場版○○");
  assert.equal(format, "デジタルリマスター版");
  assert.deepEqual(eventTypes, []);
});

test("回归保护：前篇／后篇等区分词不被制式／活动提取吞掉", () => {
  const front = extractFormatAndTitle("【DolbyCinema】劇場版 魔法少女まどか☆マギカ 前編 始まりの物語");
  const back = extractFormatAndTitle("【DolbyCinema】劇場版 魔法少女まどか☆マギカ 後編 永遠の物語");
  assert.ok(front.movieTitle.includes("前編"));
  assert.ok(back.movieTitle.includes("後編"));
});

test("无任何活动的普通场次 → event_types 为空数组（不是 null）", () => {
  const { eventTypes } = extractFormatAndTitle("劇場版 鬼滅の刃");
  assert.deepEqual(eventTypes, []);
  assert.deepEqual(extractEventTypes("完全没有活动信息的普通文本"), []);
});

test("classifyBracketContent 对空内容返回 unknown", () => {
  assert.deepEqual(classifyBracketContent(""), { kind: "unknown", value: "" });
});

test("work_type 与 event_types 不互相推导：other_event 不会被自动分类命中", () => {
  // EVENT_TYPES 表里 other_event 的正则列表为空，意味着它只能由用户手动选择，
  // 不会被 classifyBracketContent/extractEventTypes 自动匹配到。
  assert.notEqual(classifyBracketContent("随便什么活动说明文字").kind, "event");
});
