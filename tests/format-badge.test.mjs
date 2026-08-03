import test from "node:test";
import assert from "node:assert/strict";
import { formatBadge, eventBadges, isHighSpecFormat } from "../src/format-badge.js";

test("同一制式的不同写法归一化到同一个 key", () => {
  assert.equal(formatBadge("【DolbyCinema】").key, formatBadge("ドルビーシネマ").key);
  assert.equal(formatBadge("ドルビーシネマ").key, formatBadge("Dolby Cinema").key);
  assert.equal(formatBadge("IMAXレーザー").key, formatBadge("IMAX").key);
  assert.equal(formatBadge("IMAX").key, "imax");
});

test("未知制式优雅降级：中性配色，原样显示文本，不抛错", () => {
  const badge = formatBadge("35mm フィルム上映");
  assert.equal(badge.key, "unknown");
  assert.equal(badge.label, "35mm フィルム上映");
  assert.equal(badge.tone, "neutral");
  assert.equal(badge.style, "solid");
});

test("空值 / null → 不渲染制式徽章", () => {
  assert.equal(formatBadge(null), null);
  assert.equal(formatBadge(undefined), null);
  assert.equal(formatBadge(""), null);
  assert.equal(formatBadge("   "), null);
});

test("活动徽章与制式徽章返回不同的 style 标识（实心 vs 描边）", () => {
  const format = formatBadge("IMAX");
  const { badges } = eventBadges(["stage_greeting"]);
  assert.equal(format.style, "solid");
  assert.equal(badges[0].style, "outline");
});

test("4 个活动 → 只返回前 2 个 + overflow 2，且按约定优先级排序", () => {
  const { badges, overflow } = eventBadges([
    "bonus_distribution",
    "stage_greeting",
    "other_event",
    "cheer_screening"
  ]);
  assert.deepEqual(badges.map((badge) => badge.key), ["stage_greeting", "cheer_screening"]);
  assert.equal(overflow, 2);
});

test("event_types 为空数组 → 不渲染任何活动徽章，不产生空元素", () => {
  const { badges, overflow } = eventBadges([]);
  assert.deepEqual(badges, []);
  assert.equal(overflow, 0);
});

test("event_types 缺失（undefined）→ 同样安全返回空", () => {
  const { badges, overflow } = eventBadges(undefined);
  assert.deepEqual(badges, []);
  assert.equal(overflow, 0);
});

test("重复的活动 key 去重后只出现一次", () => {
  const { badges, overflow } = eventBadges(["stage_greeting", "stage_greeting"]);
  assert.equal(badges.length, 1);
  assert.equal(overflow, 0);
});

test("高规格制式判定：IMAX/Dolby/4DX/MX4D/ScreenX 为高规格，2D 与未知不是", () => {
  assert.equal(isHighSpecFormat("IMAX"), true);
  assert.equal(isHighSpecFormat("Dolby Atmos"), true);
  assert.equal(isHighSpecFormat("4DX"), true);
  assert.equal(isHighSpecFormat("MX4D"), true);
  assert.equal(isHighSpecFormat("ScreenX"), true);
  assert.equal(isHighSpecFormat("2D"), false);
  assert.equal(isHighSpecFormat("35mm"), false);
  assert.equal(isHighSpecFormat(null), false);
});
