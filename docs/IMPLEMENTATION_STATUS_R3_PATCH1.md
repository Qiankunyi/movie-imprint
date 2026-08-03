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

---

## 补丁 1 第二轮（同一窗口，用户实机看过第一轮效果后的追加反馈）

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 海报"变窄"——第一轮用固定 112px 宽 + 拉伸到卡片全高，卡片一高海报就被压成竖条 | `.record-poster` 改用 `aspect-ratio: 2 / 3`（标准电影海报比例）反推宽度：高度=卡片高度，宽度随卡片变高自动向右延伸，不再是固定窄宽度 |
| 2 | 记忆卡片的删除不该摆在卡片正面，应该和首页记录删除一样走二级入口；建议"编辑"界面左下角删除、右下角保存 | 采纳用户的方案：`cardEditorOverlay()`（`src/app.js`）新增 `.card-editor-actions` 底部操作行，左下角"删除"（仅编辑已存在、非待审 AI 建议的卡片时出现）、右下角"保存修改"；卡片正面（`src/memory-list.js`）不再有删除按钮 |
| 3 | AI 分析整理感想的功能为什么"现在"停止了？是计划内还是意外 BUG？ | 见下 |

### #3：代码审计结论

逐条查了触发链路（`finishCompose()` → `runAiAnalysis()` → `/api/ai/analyze` → `src/ai-providers.js` → 各家供应商 API），**没有发现本次或此前改动引入的代码级 BUG**：只要「自动整理新记录」开关是开着的（默认就是开的，`state.recordingPreference ||= { autoAnalyze: true }`），每条新记录都会照常触发后台整理。

我无法直接打开你实际部署的那份 App（这个环境没有浏览器/网络能连到你的站点），所以没法当场复现"现在停了"这个现象本身。能想到的、最可能的两个非代码原因，麻烦你花一分钟自己核对一下：

1. **设置里的"自动整理新记录"是不是被关掉了**——设置面板里那一行，如果显示"当前关闭；完成时只保存原文"，说明是这个开关的原因，不是 BUG，打开就恢复了。
2. **AI 服务的密钥/额度是不是在服务端（Cloudflare）失效了**——如果开关是开着的但还是一直失败，大概率是部署环境里配置的 API Key 过期/被撤销/额度用完，这属于运维配置问题，不是这份代码的逻辑 BUG。

顺手把一个真实的观测缺口补上了：之前 AI 整理失败后，详情页只显示"上次没有整理完成，原文不受影响"这句通用文案，`record.analysis_error` 里其实存了具体错误信息但从来没有显示出来。现在如果失败，"原文已经保存"下面会多一行"原因：xxx"（`.raw-only-error`），下次再遇到卡住可以直接看到是密钥没配置、超时还是别的问题，不用来回猜。

### 涉及文件（第二轮）

| 文件 | 改动 |
|---|---|
| `styles/app.css` | `.record-poster` 改用 `aspect-ratio: 2/3` 替代固定宽度拉伸；删除窄屏媒体查询里的海报宽度覆写（不再需要）；新增 `.card-editor-actions`、`.raw-only-error`；删除已死的 `.card-actions` 规则 |
| `src/memory-list.js` | 非 AI 建议卡片正面不再渲染删除按钮 |
| `src/app.js` | `cardEditorOverlay()` 新增底部左右操作行（删除 + 保存）；`delete-card` 处理器补充关闭弹层；`raw-only-status` 区块新增 `analysis_error` 展示 |
| `tests/memory-list.test.mjs` | 更新为断言"卡片正面不直接出现 delete-card" |
| `index.html`/`sw.js` | 版本号再次 bump：app.css v21→v22，app.js v22→v23 |

### 测试

本轮改动是 CSS + app.js（无独立单测的 DOM 层）+ memory-list.js 的一处收窄，全量测试保持 254 pass / 0 fail（`node --check` 语法检查另行确认无误）。
