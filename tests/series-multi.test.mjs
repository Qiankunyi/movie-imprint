/**
 * 回归测试：一部作品可以同时归入多个系列。
 *
 * 用户反馈的 bug：
 *   《蜘蛛侠：英雄归来》归入「蜘蛛侠（MCU）」之后，再归入「蜘蛛侠」大系列时，
 *   前一个归属被悄悄取消了——表现为"只能属于一个系列"。
 *
 * 根因在两处：
 *   1. app.js assignWorkToSeries 归入前先 removeWorkFromSeries(previous)
 *   2. library.js findSeriesForWork 只返回第一个匹配
 * 数据结构本身（series.member_ids）从来就支持多归属。
 *
 * 这里守住三条：多归属能成立、各系列内的位次互相独立、退出一个不影响另一个。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSeries,
  addWorkToSeries,
  removeWorkFromSeries,
  findAllSeriesForWork,
  findSeriesForWork,
  seriesMemberDetails
} from "../src/library.js";

const NOW = "2026-08-01T00:00:00.000Z";

/** 「蜘蛛侠（MCU）」与「蜘蛛侠」大系列，英雄归来同时属于两者。 */
function scene() {
  let mcu = createSeries({ title: "蜘蛛侠（MCU）" }, NOW);
  mcu = addWorkToSeries(mcu, "w_homecoming", NOW);
  mcu = addWorkToSeries(mcu, "w_far_from_home", NOW);

  let big = createSeries({ title: "蜘蛛侠" }, NOW);
  // 大系列里前面还有山姆·雷米三部曲和超凡两部
  for (const id of ["w_raimi1", "w_raimi2", "w_raimi3", "w_amazing1", "w_amazing2"]) {
    big = addWorkToSeries(big, id, NOW);
  }
  big = addWorkToSeries(big, "w_homecoming", NOW);

  return { mcu, big };
}

test("同一部作品可以同时出现在两个系列的成员里", () => {
  const { mcu, big } = scene();
  assert.ok((mcu.member_ids || []).includes("w_homecoming"));
  assert.ok((big.member_ids || []).includes("w_homecoming"));
});

test("findAllSeriesForWork 返回全部所属系列", () => {
  const { mcu, big } = scene();
  const found = findAllSeriesForWork([mcu, big], "w_homecoming");
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((series) => series.title).sort(), ["蜘蛛侠", "蜘蛛侠（MCU）"].sort());
});

test("findAllSeriesForWork 对没有归属的作品返回空数组", () => {
  const { mcu, big } = scene();
  assert.deepEqual(findAllSeriesForWork([mcu, big], "w_venom"), []);
});

test("findAllSeriesForWork 的顺序稳定（按标题排序）", () => {
  const { mcu, big } = scene();
  const a = findAllSeriesForWork([mcu, big], "w_homecoming").map((series) => series.title);
  const b = findAllSeriesForWork([big, mcu], "w_homecoming").map((series) => series.title);
  assert.deepEqual(a, b, "传入顺序不同就给出不同结果，UI 会跳来跳去");
});

test("各系列内的位次互相独立", () => {
  const { mcu, big } = scene();
  // MCU 里英雄归来是第 1 部，大系列里排在雷米三部曲和超凡两部之后
  assert.equal(seriesMemberDetails(mcu, "w_homecoming").seriesOrder, 1);
  assert.equal(seriesMemberDetails(big, "w_homecoming").seriesOrder, 6);
});

test("退出其中一个系列，另一个的归属不受影响", () => {
  const { mcu, big } = scene();
  const leftBig = removeWorkFromSeries(big, "w_homecoming");

  assert.equal((leftBig.member_ids || []).includes("w_homecoming"), false);
  assert.ok((mcu.member_ids || []).includes("w_homecoming"), "退出大系列时把 MCU 的归属也弄丢了");
  assert.equal(findAllSeriesForWork([mcu, leftBig], "w_homecoming").length, 1);
});

test("退出后再加回来，不会产生重复成员", () => {
  const { mcu } = scene();
  const left = removeWorkFromSeries(mcu, "w_homecoming");
  const rejoined = addWorkToSeries(left, "w_homecoming", NOW);
  const count = (rejoined.member_ids || []).filter((id) => id === "w_homecoming").length;
  assert.equal(count, 1);
});

test("重复归入同一个系列是幂等的", () => {
  const { mcu } = scene();
  const again = addWorkToSeries(mcu, "w_homecoming", NOW);
  assert.deepEqual(again.member_ids, mcu.member_ids);
});

test("findSeriesForWork 作为兼容入口仍可用，取排序后的第一个", () => {
  const { mcu, big } = scene();
  const first = findAllSeriesForWork([mcu, big], "w_homecoming")[0];
  assert.equal(findSeriesForWork([mcu, big], "w_homecoming").id, first.id);
  assert.equal(findSeriesForWork([mcu, big], "w_venom"), null);
});

// ── 删除作品时必须退出全部系列 ──────────────────────────────────────────────

test("删除作品的影响面统计要算上全部系列，不能只算第一个", () => {
  const { mcu, big } = scene();
  // 复现 app.js workDeletionImpact 里的系列筛选
  const ids = new Set(["w_homecoming"]);
  const seriesList = [mcu, big].filter((series) =>
    (series.member_ids || []).some((memberId) => ids.has(memberId))
  );
  assert.equal(seriesList.length, 2, "只统计到一个系列，删除后会在另一个里留下死引用");

  // 删除流程逐个退出后，两边都不该再有它
  const after = seriesList.map((series) => removeWorkFromSeries(series, "w_homecoming"));
  assert.equal(findAllSeriesForWork(after, "w_homecoming").length, 0);
});
