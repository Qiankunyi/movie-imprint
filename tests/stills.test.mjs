import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WORK_STILLS,
  addWorkStill,
  createExternalStill,
  createTmdbStill,
  moveWorkStill,
  normalizeExternalImageUrl,
  normalizeWorkStills,
  removeWorkStill,
  setPrimaryWorkStill
} from "../src/stills.js";

test("外链剧照只接受无凭据的 https URL", () => {
  assert.equal(normalizeExternalImageUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
  assert.equal(normalizeExternalImageUrl("http://example.com/a.jpg"), null);
  assert.equal(normalizeExternalImageUrl("https://user:pass@example.com/a.jpg"), null);
  assert.equal(normalizeExternalImageUrl("javascript:alert(1)"), null);
});

test("剧照去重且最多保留 4 张", () => {
  const inputs = ["a", "b", "c", "d", "e"].map((name) => createTmdbStill(`/${name.repeat(8)}.jpg`));
  let stills = [];
  for (const still of inputs) stills = addWorkStill(stills, still);
  assert.equal(stills.length, MAX_WORK_STILLS);
  assert.deepEqual(addWorkStill(stills, inputs[0]), stills);
});

test("设置主图、调整顺序与删除都保持有限集合", () => {
  const a = createExternalStill("https://example.com/a.jpg");
  const b = createExternalStill("https://example.com/b.jpg");
  const c = createExternalStill("https://example.com/c.jpg");
  const source = normalizeWorkStills([a, b, c]);
  assert.equal(setPrimaryWorkStill(source, c.id)[0].id, c.id);
  assert.deepEqual(moveWorkStill(source, b.id, "down").map((item) => item.id), [a.id, c.id, b.id]);
  assert.deepEqual(removeWorkStill(source, b.id).map((item) => item.id), [a.id, c.id]);
});
