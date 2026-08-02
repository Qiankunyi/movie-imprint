import test from "node:test";
import assert from "node:assert/strict";
import { applyListStyle, continueListOnEnter } from "../src/editor.js";

test("列表按钮在光标所在行插入有序或无序前缀", () => {
  const ordered = applyListStyle("#电影\n第一点", 8, 8, "ordered");
  assert.equal(ordered.text, "#电影\n1. 第一点");
  const unordered = applyListStyle(ordered.text, ordered.selectionStart, ordered.selectionEnd, "unordered");
  assert.equal(unordered.text, "#电影\n- 第一点");
});

test("有序列表沿用上一项编号并可批量转换选中行", () => {
  const continued = applyListStyle("1. 第一项\n第二项", 8, 8, "ordered");
  assert.equal(continued.text, "1. 第一项\n2. 第二项");
  const batch = applyListStyle("甲\n乙", 0, 3, "ordered");
  assert.equal(batch.text, "1. 甲\n2. 乙");
});

test("回车自动续写列表，空项目回车退出", () => {
  const next = continueListOnEnter("1. 第一项", 6, 6);
  assert.equal(next.text, "1. 第一项\n2. ");
  const exit = continueListOnEnter(next.text, next.text.length, next.text.length);
  assert.equal(exit.text, "1. 第一项\n");
  assert.equal(exit.selectionStart, exit.text.length);
});

test("普通段落和带选区的回车交给浏览器默认处理", () => {
  assert.equal(continueListOnEnter("普通段落", 4, 4), null);
  assert.equal(continueListOnEnter("- 项目", 2, 4), null);
});
