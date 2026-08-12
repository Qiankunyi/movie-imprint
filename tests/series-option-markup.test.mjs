/**
 * 结构守卫：`.series-option` 这个 class 被系列弹窗和片单弹窗共用，
 * 它的每一行都必须同时带上 `.series-option-check` 和 `.series-option-body`。
 *
 * 为什么要专门守这条（真实回归）：
 *   给系列加多选勾时，`.series-option` 一度写成
 *   `grid-template-columns: 22px minmax(0, 1fr)`。片单弹窗复用了同一个 class，
 *   但它的行里没有勾选那一层，于是**片单标题被自动放进了 22px 宽的第一列**——
 *   整个片单名被挤成一列竖排的字，一个片单占掉大半个屏幕。
 *
 *   CSS 那边现在改成了 flex（少一个子元素也不会被塞进固定宽度的槽），
 *   但共用 class 的两处结构保持一致仍然是前提：勾选位是"选中/未选中都占位"的，
 *   缺了它两个弹窗的文字起点会对不齐。
 *
 * 这个测试直接读 src/app.js 的源码做结构检查——app.js 是重 DOM 的大模块，
 * 没法在 Node 里整体导入，而这类"共用 class 的结构漂移"恰恰是源码层面就能看出来的。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "src", "app.js"), "utf8");

/** 抓出每一段 `class="series-option ...">` 到它对应 `</button>` 之间的模板片段。 */
function seriesOptionBlocks(text) {
  const blocks = [];
  const marker = 'class="series-option ';
  let from = 0;
  for (;;) {
    const start = text.indexOf(marker, from);
    if (start === -1) break;
    const end = text.indexOf("</button>", start);
    assert.notEqual(end, -1, "series-option 的 <button> 没有闭合");
    blocks.push(text.slice(start, end));
    from = end;
  }
  return blocks;
}

test("每个 .series-option 行都同时带勾选位和内容层", () => {
  const blocks = seriesOptionBlocks(source);
  assert.ok(blocks.length >= 2, `至少应有系列与片单两处复用，实际找到 ${blocks.length} 处`);

  for (const [index, block] of blocks.entries()) {
    assert.ok(
      block.includes("series-option-check"),
      `第 ${index + 1} 处 .series-option 缺少 .series-option-check —— 标题会掉进勾选列`
    );
    assert.ok(
      block.includes("series-option-body"),
      `第 ${index + 1} 处 .series-option 缺少 .series-option-body`
    );
    assert.ok(
      block.includes("series-option-title"),
      `第 ${index + 1} 处 .series-option 缺少 .series-option-title`
    );
  }
});

test("多选行都带 role=checkbox 与 aria-checked", () => {
  for (const [index, block] of seriesOptionBlocks(source).entries()) {
    assert.ok(block.includes('role="checkbox"'), `第 ${index + 1} 处缺少 role="checkbox"`);
    assert.ok(block.includes("aria-checked="), `第 ${index + 1} 处缺少 aria-checked`);
  }
});

test("CSS 里 .series-option 不能再用固定首列的 grid", () => {
  const css = readFileSync(join(root, "styles", "app.css"), "utf8");
  const rule = css.slice(css.indexOf("\n.series-option {"), css.indexOf("\n.series-option-check {"));
  assert.ok(rule.includes("display: flex"), ".series-option 应该用 flex");
  assert.equal(
    /grid-template-columns/.test(rule),
    false,
    "固定首列的 grid 正是竖排文字那个 bug 的成因"
  );
});

test("弹窗主按钮文案统一为「新建」，不再是「新建并…」", () => {
  assert.equal(/新建并归入|新建并加入/.test(source), false, "还有「新建并…」的旧文案");
  const doneButtons = source.match(/<button class="sheet-done" type="submit">([^<]*)<\/button>/g) || [];
  assert.ok(doneButtons.length > 0, "没找到任何 sheet-done 提交按钮");
});
