import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanOcrCinemaCandidate,
  cleanOcrTitleCandidate,
  normalizeOcrTicketInput,
  rowsFromOcrLayout
} from "../src/ticket-normalize.js";

test("OCR normalize 合并异常空格并保留可确定的票务实体", () => {
  const result = normalizeOcrTicketInput(`大 地 影院 益阳 剧院 > 4 9
哆 啦 A 梦：伴 我 同行 wa
2015-05-28 3 号 厅 £2)
00:05~01:40 ”9 排 6 座 = a`);
  assert.deepEqual(result.text.split("\n"), [
    "大地影院益阳剧院 > 4 9",
    "哆啦A梦：伴我同行 wa",
    "2015-05-28 3号厅 £2)",
    "00:05～01:40 ”9排6座 = a"
  ]);
  assert.equal(cleanOcrCinemaCandidate(result.lines[0].text), "大地影院益阳剧院");
  assert.equal(cleanOcrTitleCandidate(result.lines[1].text), "哆啦A梦：伴我同行");
});

test("OCR layout 按纵向重叠关系恢复同行字段，并按 x 坐标排序", () => {
  const rows = rowsFromOcrLayout({ lines: [
    { text: "3 号 厅", bbox: { x0: 260, y0: 100, x1: 340, y1: 125 } },
    { text: "2015-05-28", bbox: { x0: 20, y0: 98, x1: 170, y1: 126 } },
    { text: "9 排 6 座", bbox: { x0: 260, y0: 150, x1: 350, y1: 176 } },
    { text: "00:05~01:40", bbox: { x0: 20, y0: 148, x1: 180, y1: 177 } }
  ] });
  assert.deepEqual(rows.map((row) => row.text), [
    "2015-05-28 3号厅",
    "00:05～01:40 9排6座"
  ]);
});

test("OCR 尾部清理保持合法英文标题标记", () => {
  assert.equal(cleanOcrTitleCandidate("哆啦A梦：伴我同行 wa"), "哆啦A梦：伴我同行");
  assert.equal(cleanOcrTitleCandidate("电影 A"), "电影 A");
  assert.equal(cleanOcrTitleCandidate("LOVE"), "LOVE");
});
