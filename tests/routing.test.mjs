import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoute,
  enterShelf,
  exitShelf,
  enterWork,
  exitWork,
  enterRecord,
  exitRecord,
  goHome,
  scrollFor
} from "../src/routing.js";

test("初始路由是首页，三个视图滚动位置都是 0", () => {
  const route = createRoute();
  assert.equal(route.view, "home");
  assert.equal(route.currentWorkId, null);
  assert.equal(route.activeRecordId, null);
  assert.equal(scrollFor(route), 0);
  assert.equal(scrollFor(route, "shelf"), 0);
  assert.equal(scrollFor(route, "work"), 0);
});

test("四个视图可以依次进入：home → shelf → work → detail", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 0 });
  assert.equal(route.view, "shelf");
  route = enterWork(route, "work_1", { scrollY: 0 });
  assert.equal(route.view, "work");
  assert.equal(route.currentWorkId, "work_1");
  route = enterRecord(route, "record_1", { scrollY: 0 });
  assert.equal(route.view, "detail");
  assert.equal(route.activeRecordId, "record_1");
});

test("从时间线进详情 → 返回时间线", () => {
  let route = createRoute();
  route = enterRecord(route, "record_1", { scrollY: 240 });
  assert.equal(route.detailReturnView, "home");
  route = exitRecord(route);
  assert.equal(route.view, "home");
  assert.equal(route.activeRecordId, null);
  assert.equal(scrollFor(route), 240);
});

test("从作品页进详情 → 返回作品页", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 10 });
  route = enterWork(route, "work_1", { scrollY: 20 });
  route = enterRecord(route, "record_1", { scrollY: 88 });
  assert.equal(route.detailReturnView, "work");
  route = exitRecord(route);
  assert.equal(route.view, "work");
  assert.equal(route.currentWorkId, "work_1");
  assert.equal(scrollFor(route, "work"), 88);
});

test("作品页返回固定回书架，不回时间线", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 0 });
  route = enterWork(route, "work_1", { scrollY: 0 });
  route = exitWork(route);
  assert.equal(route.view, "shelf");
  assert.equal(route.currentWorkId, null);
});

test("书架返回时间线", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 0 });
  route = exitShelf(route);
  assert.equal(route.view, "home");
});

test("滚动位置各自独立保持：离开首页/书架/作品页时各自记住，回来时能取回", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 120 }); // 离开首页时首页滚动在 120
  route = enterWork(route, "work_1", { scrollY: 340 }); // 离开书架时书架滚动在 340
  route = enterRecord(route, "record_1", { scrollY: 55 }); // 离开作品页时作品页滚动在 55

  // 从详情返回作品页，作品页滚动位置应为 55
  route = exitRecord(route);
  assert.equal(route.view, "work");
  assert.equal(scrollFor(route, "work"), 55);

  // 从作品页返回书架，书架滚动位置应为 340（进入作品页之前保存的）
  route = exitWork(route);
  assert.equal(route.view, "shelf");
  assert.equal(scrollFor(route, "shelf"), 340);

  // 从书架返回首页，首页滚动位置应为 120（进入书架之前保存的）
  route = exitShelf(route);
  assert.equal(route.view, "home");
  assert.equal(scrollFor(route, "home"), 120);
});

test("不传 scrollY 时不覆盖已保存的滚动位置", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 99 });
  route = exitShelf(route);
  route = enterShelf(route); // 没传 scrollY
  assert.equal(scrollFor(route, "home"), 99);
});

test("goHome 直接回时间线并清空当前作品/记录", () => {
  let route = createRoute();
  route = enterShelf(route, { scrollY: 0 });
  route = enterWork(route, "work_1", { scrollY: 0 });
  route = goHome(route);
  assert.equal(route.view, "home");
  assert.equal(route.currentWorkId, null);
  assert.equal(route.activeRecordId, null);
});

test("连续两次从时间线打开不同详情，detailReturnView 始终是 home", () => {
  let route = createRoute();
  route = enterRecord(route, "record_1", { scrollY: 10 });
  route = exitRecord(route);
  route = enterRecord(route, "record_2", { scrollY: 20 });
  assert.equal(route.detailReturnView, "home");
  assert.equal(scrollFor(route, "home"), 20);
});
