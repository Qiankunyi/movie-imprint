import test from "node:test";
import assert from "node:assert/strict";
import {
  SIDEBAR_DAILY_STILL_KEY,
  localDayKey,
  normalizeSidebarStillPool,
  selectDailySidebarStill
} from "../src/sidebar-artwork.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

const pool = [
  "/public/assets/sidebar-stills/sidebar-01",
  "/public/assets/sidebar-stills/sidebar-02",
  "/public/assets/sidebar-stills/sidebar-03"
];

test("侧栏图片池只接受专用静态目录中的图片并去重", () => {
  assert.deepEqual(normalizeSidebarStillPool([...pool, pool[0], "/docs/old.png", "https://example.com/a.jpg"]), pool);
});

test("同一天始终复用第一次随机到的图片", () => {
  const storage = memoryStorage();
  const now = new Date(2026, 7, 9, 8);
  const first = selectDailySidebarStill(pool, { storage, now, random: () => 0.6 });
  const second = selectDailySidebarStill(pool, { storage, now: new Date(2026, 7, 9, 23), random: () => 0 });
  assert.equal(first, pool[1]);
  assert.equal(second, first);
  assert.deepEqual(JSON.parse(storage.getItem(SIDEBAR_DAILY_STILL_KEY)), { day: "2026-08-09", path: first });
});

test("第二天重新随机，空池安全隐藏图片区", () => {
  const storage = memoryStorage();
  assert.equal(selectDailySidebarStill([], { storage }), "");
  assert.equal(selectDailySidebarStill(pool, { storage, now: new Date(2026, 7, 9), random: () => 0 }), pool[0]);
  assert.equal(selectDailySidebarStill(pool, { storage, now: new Date(2026, 7, 10), random: () => 0.99 }), pool[2]);
  assert.equal(localDayKey(new Date(2026, 0, 2)), "2026-01-02");
});
