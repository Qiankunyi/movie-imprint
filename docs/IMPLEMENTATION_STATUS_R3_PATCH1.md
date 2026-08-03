# 电影印记：R3 补丁 1（用户反馈 5 项）

日期：2026-08-04
对应窗口：本次临时插入的修改需求，基于 `docs/IMPLEMENTATION_STATUS_R3.md` 交付后的用户实测反馈

## 反馈与处理结果

| # | 反馈 | 结论 | 处理 |
|---|---|---|---|
| 1 | 海报太小 | 采纳 | 海报改为占据卡片整个左侧、随卡片高度拉伸，不再是四周留白里的 72×108 小缩略图 |
| 2 | "仅保存原文"影响卡片美观 | 采纳 | 从 footer 的文字行改为叠在海报左下角的小标签（暗色渐变衬底），footer 只剩态度标签 |
| 3 | 新记录写完就停在"仅保存原文" | 见下 | 补充手动跳过入口，见下 |
| 4 | 感想卡片/记忆卡片没有删除功能 | 采纳 | 记录详情页"更多"按钮接入删除记录；非 AI 建议的记忆卡片补充删除入口 |
| 5 | SCREENX 场次被误标成"Dolby Cinema" | 确认是 BUG，已修复 | 见下 |

## #3：这是计划内路径还是 BUG？

两者都有一点：

- `raw_only_confirmed` 本身是 `docs/PRODUCT_DEFINITION_MVP_V1.md`/`docs/TECHNICAL_SOLUTION_AND_IMPLEMENTATION_PLAN_V1.md` 里明确定义的合法正式状态（"AI 不可用时完整保留本地草稿，并允许 `raw_only_confirmed` 正式保存"）——不是渲染错误。
- 但实际的 BUG 是：写完感想后，`finalizeCaptureRecord()`（`src/domain.js`）**总是**先把记录设成 `raw_only_confirmed`，然后才异步触发后台 AI 整理（`runAiAnalysis`，`src/app.js`）。如果 AI 整理失败、变慢，或用户关闭了"自动整理"，记录就会**永久卡在** `raw_only_confirmed`——而详情页在这个状态下会**完全隐藏**"个人态度与推荐"入口和"＋ 添加卡片"（`src/app.js` 第 569/574 行原逻辑），用户唯一能做的只有点"重新整理"（重试 AI），没有任何手动路径。这和项目说明里"AI 并非先替用户写影评，而是先帮助用户整理记忆素材"的定位是矛盾的——手动路径不应该被 AI 卡住。

处理：在"原文已经保存"提示区块里，只要当前没有整理任务正在跑（`analysis_status !== "running"`），就同时显示"不等了，我自己选"按钮（`data-action="skip-to-manual"`），点击后把记录切到 `confirmed` / `analysis_status: "manual"`，直接解锁个人态度与记忆卡片区域。整理仍在后台跑时（`analysis_status === "running"`）不显示这个按钮，避免和 AI 写回互相覆盖。

## #5：SCREENX 被误标为 Dolby Cinema 的根因

真实案例（旧的蜘蛛侠测试记录）：票务邮件标题里的 `【SCREENX with DolbyAtmos・字幕】` 是一个【】里同时混了银幕规格（ScreenX）、音响系统（Dolby Atmos）和字幕标注的复合写法。

- 根因 1（`src/event-types.js`）：`classifyBracketContent()` 判定这段内容是"制式"之后，**把整段原文原样存进 format 字段**，没有从里面抽取出真正的制式关键词。
- 根因 2（`src/format-badge.js`）：`formatBadge()` 按固定顺序（IMAX → Dolby → 4DX → MX4D → ScreenX → 2D）用简单关键词匹配去猜，Dolby 排在 ScreenX 前面，只要字符串里出现裸的 "Dolby"（哪怕是 "DolbyAtmos" 这种音响系统标注，不是 "Dolby Cinema" 这个银幕品牌），就会被判定成"Dolby Cinema"。

修复（两层，互为防线）：
1. `src/event-types.js`：新增 `FORMAT_EXTRACT_PATTERNS`，按"银幕规格优先于纯音响系统"的优先级从括号内容里抽取真正的制式关键词，`SCREENX with DolbyAtmos・字幕` 现在只会存 `"SCREENX"`。这样新解析的票务不会再把复合写法整段存进 format 字段。
2. `src/format-badge.js`：把 Dolby 徽章的匹配规则从裸 `/Dolby/i` 收紧为 `/Dolby\s*Cinema/i`（以及 `ドルビーシネマ`），不再匹配单独出现的 "Dolby Atmos"/"DolbyAtmos"。这一层是防御性的，即使数据库里已经存了脏数据（旧的蜘蛛侠记录不需要手动迁移），徽章渲染时也会重新算出正确结果。

**旧的蜘蛛侠测试记录不需要手动改数据**——刷新页面后徽章会自动变成 "ScreenX"，因为徽章是每次渲染时从存储的 `format` 字段实时算出来的，不是写入时固化的。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/event-types.js` | 新增 `FORMAT_EXTRACT_PATTERNS`/`extractPrimaryFormat`，`classifyBracketContent` 判定为 format 时只保留抽取出的关键词 |
| `src/format-badge.js` | Dolby 规则从裸 `/Dolby/i` 收紧为 `/Dolby\s*Cinema/i` |
| `src/ticket.js` | 纯文本兜底的 `formatPatterns` 顺序调整：具体银幕规格排在裸 Dolby 前面（防御性，当前测试未直接覆盖这条路径） |
| `src/record-card.js` | 海报从 `record-card-row` 里 72×108 缩略图改为占满卡片左侧、随卡片高度拉伸；"仅保存原文"/"待确认作品"从 footer 文字行移到海报角落小标签（`posterStatusRibbon`） |
| `src/memory-list.js` | 非 AI 建议卡片（`user_added`/`user_accepted`/`user_modified`）新增"删除这张卡片"入口 |
| `src/app.js` | 详情页"更多"按钮从禁用状态接入 `record-menu` 底部弹层（删除整条记录，级联删除关联 ViewingEvent 并重算同作品下其余场次的初看/重看编号）；`raw-only-status` 区块新增"不等了，我自己选"手动跳过按钮；新增 `delete-card`/`skip-to-manual`/`open-record-menu`/`confirm-delete-record` action 处理与 `deleteRecord()` 辅助函数 |
| `styles/app.css` | 新增/调整：`.record-card-button`（横向 flex）、`.record-poster`（占满高度）、`.record-poster-status`（角落标签）、`.record-card-body`、`.record-card-footer`（默认靠右，草稿卡用 `.draft-footer` 保留两端对齐）、`.danger-action`（删除记录按钮）、`.card-actions`/`.danger-text-action`（删除卡片按钮）、`.raw-only-actions`；删除已死的 `.record-status.attention` 规则 |
| `index.html`/`sw.js` | 版本号 bump：app.css v20→v21，app.js v21→v22，Service Worker shell 缓存 v21→v22 |
| `tests/*.test.mjs` | 新增 13 条回归测试（新旧对照见下） |

## 测试

净变化：新增 13 条（4 条 record-card + 2 条 event-types + 2 条 format-badge + 1 条 memory-list，另 4 条已计入上述分类），245 → 254，全部通过。

```
# tests 254
# suites 21
# pass 254
# fail 0
```

## 未验证的部分（本窗口无浏览器环境，延续 R3 的已知限制）

- 海报新布局、状态标签角落叠加、删除确认弹层在真实设备上的观感——本窗口只做到了字符串结构与 CSS 规则层面的正确性验证（单元测试 + `node --check` 语法检查 + 手工读 CSS），没有像素级验证。
- `scripts/visual-check.mjs` 仍然是 R3 遗留的已知问题（未跑通），本窗口未触碰。
