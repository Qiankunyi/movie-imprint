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

---

## 补丁 1 第三轮（用户实机截图反馈）

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 海报比例还是不对，比第一轮固定 112px 还窄 | 见下：放弃 flex + aspect-ratio 循环推导，改成"固定宽度 → aspect-ratio 反推高度" |
| 2 | 同一条记录缺少"重新让 AI 干活、生成卡片"的入口 | 新增 `request-ai-cards`，见下 |

### #1：海报比例根因

第二轮的 `.record-poster { align-self: stretch; aspect-ratio: 2/3; }`（不设宽度，靠拉伸后的高度反推宽度）理论上符合 CSS 规范，但需要浏览器在"宽度 auto"和"高度 stretch"之间做一次相互依赖的两阶段计算。实机截图显示这个推导没有按预期解出来——四张卡片（不管高矮、有没有真实海报图）的海报宽度看起来几乎是同一个很窄的固定值，说明浏览器很可能把"auto 宽度"直接解析成了海报内部几乎没有内容时的固有宽度（接近 0），而不是按 aspect-ratio 反推，比第一轮固定 112px 还窄。

改成不依赖这种循环推导的写法：宽度固定为 108px（definite），高度用 `aspect-ratio: 2/3` 直接从宽度算出来（162px）——这是 aspect-ratio 最基础、所有浏览器都保证支持的用法（宽度已知，用比例求高度），不需要浏览器去猜先定哪个维度。代价：如果卡片因为徽章换行等原因比 162px 更高，海报底部会留一点背景色空隙，不会再撑满到卡片最底部；但形状保证始终是正确的电影海报比例，不会再变形、变窄。`.record-card-button` 的 `min-height` 相应从 152px 调整为 162px（= 108×1.5），让默认情况下卡片高度和海报高度正好对齐、没有空隙。

### #2：AI 重新生成卡片入口

根因：记录一旦离开 `raw_only_confirmed`（无论是 AI 首次整理成功，还是用户点了上一轮新加的"不等了，我自己选"），详情页就再也没有任何按钮能让 AI 重新看一遍原文——`runAiAnalysis()` 的首次整理逻辑本身也故意加了 `status !== "raw_only_confirmed"` 就直接跳过的保护（这是对的，防止重复调用时把用户已经保留/添加的卡片整个覆盖掉），但结果是这个保护之外完全没有对应的"安全重跑"入口，只能一张一张手动加卡片。

新增 `requestAiCards()`（`src/app.js`）：不改动 `runAiAnalysis()` 首次整理那条已经跑通、有测试路径依赖的逻辑，另起一个可以反复安全调用的函数——新的 AI 建议**追加**在已有卡片后面（`order` 接着算），不覆盖、不删除用户已经写好/保留/接受过的卡片；只有在用户还没手动确认过态度时（`attitudeProvenance` 为空）才会用这次的态度建议刷新"建议"字段本身，已经选好的 `attitude`/`recommendation` 不会被动。入口是详情页"留下来的片段"标题行新增的"AI 建议卡片"按钮（和"＋ 添加卡片"并排），失败时会在下面显示具体原因（复用第二轮加的错误展示思路）。

### 涉及文件（第三轮）

| 文件 | 改动 |
|---|---|
| `styles/app.css` | `.record-poster` 改为固定 108px 宽 + `aspect-ratio: 2/3` 反推高度（不再靠 flex stretch 反推宽度）；`.record-card-button` min-height 152→162px；窄屏媒体查询恢复海报宽度覆写（92px）；新增 `.memory-heading-actions`、`.card-suggestion-error` |
| `src/app.js` | 新增 `requestAiCards()`；"留下来的片段"标题行新增"AI 建议卡片"按钮与失败原因展示；新增 `request-ai-cards` action 处理 |
| `index.html`/`sw.js` | 版本号再次 bump：app.css v22→v23，app.js v23→v24 |

### 测试

本轮改动同样是 CSS + app.js 无独立单测的部分，全量测试保持 254 pass / 0 fail（`node --check` 语法检查、CSS 花括号配对另行确认无误）。海报比例与"AI 建议卡片"按钮的实际观感仍需要你在真机上确认——这次换了完全不依赖 flex 循环推导的写法，理论上不应该再出现"越改越窄"的情况，但我这边还是没有浏览器可以自己截图验证。

---

## 补丁 1 第四轮（真机截图反馈：PC 正常、安卓上下拉伸变形；AI 密钥更新未生效）

### #1：真正的根因找到了

前三轮一直在"要不要靠 flex 从高度反推宽度"上打转，这轮才发现漏掉的是完全不同方向的一个问题：`.record-card-button` 上有 `align-items: stretch`，这个属性会**默认继承给所有子元素**，而 `.record-poster` 一直没有自己的 `align-self` 去覆盖它。所以即使第三轮把宽度改成固定 108px、用 `aspect-ratio: 2/3` 算出 162px 高度，父级的 `stretch` 还是会在布局时把海报的高度强行改写成"卡片实际有多高"，而宽度还锁死在 108px——比例因此被破坏，看起来就是"上下被拉伸"。

为什么 PC 正常、手机不正常：桌面宽视口下文字不容易换行，卡片高度本来就接近 162px，拉伸幅度很小、不明显；手机窄视口下标题/场次/徽章更容易换行，卡片被撑得更高，同一个 108px 宽的盒子被拉伸得更厉害，问题才会明显地暴露出来——你的判断方向（"卡片长宽比在 PC 和手机上不一致"）是对的，只是不一致的原因是这个继承来的 `stretch`，不是响应式断点设置错了。

修复：给 `.record-poster` 显式加上 `align-self: flex-start`，让它使用自己算好的 108×162 尺寸，不再被父级的 `stretch` 覆盖。现在无论卡片实际渲染多高、无论 PC 还是手机，海报的宽高比都是恒定的，不会再变形。

### #2：AI 密钥更新为什么没生效

先把你的猜测排除掉：**不是"APP 文件里记录的 Gemini API 没有一起更新"**——我搜了整个仓库，确认代码里任何地方都不存在硬编码的 API Key（`src/ai-providers.js` 里密钥只通过 `context.env.GEMINI_API_KEY` 这种方式，在每次请求时从 Cloudflare 的环境变量里现读，不会被写进代码、缓存或 IndexedDB）。所以密钥内容本身不可能"和文件不同步"。

真正需要确认的是**改的地方对不对**。这个项目里有两个完全不同的 Cloudflare 配置区域，容易混淆：

1. **D1** —— 只是这个 App 用来同步你的观影记录/作品数据的 SQL 数据库（`wrangler.toml` 里 `[[d1_databases]]` 那一块，`binding = "DB"`），和 AI 密钥完全无关，D1 的设置页面里不会有、也不应该有 Gemini API Key 这个东西。
2. **环境变量 / Secrets** —— AI 密钥应该配置在这里，路径是 Cloudflare 控制台里你这个 Pages 项目的 **Settings → Environment variables**（不是 D1 的设置页）。变量名必须完全是 `GEMINI_API_KEY`（区分大小写，参考仓库里 `.dev.vars.example` 的命名），如果之前是加在别的名字下（比如漏了 `_API_KEY` 后缀、或者大小写不同），代码读不到就会一直显示"尚未配置"。

如果名字和位置都确认没问题，还有两个常见的坑：
- Cloudflare Pages 的环境变量通常分 **Production** 和 **Preview** 两套，你要改的是你实际访问的那个域名对应的那一套，改错了套用不上。
- 少数情况下改了环境变量后需要**重新触发一次部署**才会应用到已经构建好的 Functions。

最快的自查方法，不用等我：打开 App → 右上角 ⋯ → 设置 → "AI 偏好"，看 Gemini 那一行——如果显示的是模型名字（比如 `gemini-2.0-flash-lite`），说明服务端已经识别到密钥了，那问题就在别的环节（可以再叫我看）；如果还是显示"尚未配置密钥"，说明 Cloudflare 那边的环境变量还没生效，需要按上面几点重新检查。

### 涉及文件（第四轮）

| 文件 | 改动 |
|---|---|
| `styles/app.css` | `.record-poster` 补上 `align-self: flex-start`，不再被父级 `.record-card-button` 的 `align-items: stretch` 覆盖 |
| `index.html`/`sw.js` | 版本号再次 bump：app.css v23→v24，Service Worker shell 缓存 v24→v25 |

第 2 项是 Cloudflare 项目配置问题，不涉及代码改动；已在仓库里核实过没有硬编码密钥（`wrangler.toml`、`.dev.vars.example` 均已核对）。

### 测试

本轮只改了一处 CSS 属性，全量测试保持 254 pass / 0 fail，CSS 花括号配对确认无误。

---

## 补丁 1 第五轮（用户提供 Cloudflare 环境变量截图，证明第四轮的"配置位置"判断是错的）

用户在 Cloudflare Pages 的 Variables and secrets 里明确展示了 `GEMINI_API_KEY` 已经配在正确的位置（不是 D1），App 的"AI 偏好"设置里也确实显示了具体的模型名字——说明第四轮"D1 和环境变量搞混了"这个判断是错的，问题出在别处。

### 真正找到的问题：诊断信息一直存在，但从来没有传回给用户

重新逐行核对 `src/ai-providers.js` → `functions/api/ai/analyze.js` 这条链路，发现一个实实在在的代码缺口：`fetchJson()`（`src/ai-providers.js`）在请求 Gemini/OpenAI/... 失败时，其实已经把上游接口返回的**具体状态码和错误信息**记在了 `error.status` / `error.upstreamMessage` 上（比如 Google 会返回"API key not valid"、"model not found"、"quota exceeded"这类具体原因）——但 `functions/api/ai/analyze.js` 的 catch 分支从来没有读过这两个字段，只要不是"格式错误"或"没配置"这两种已知情况，一律回一句固定文案"整理暂时没有完成，原文已经保留"。也就是说，即便请求失败的具体原因一直都被程序拿到了，也从来没有人把它写进最终返回给你的那句话里——上一轮我加的"显示 analysis_error"那个改动，看到的也只会是这句没有信息量的固定文案，帮不上真正的诊断。

修复：新增 `describeAiError()`（`src/ai-providers.js`），把 `error.status`/`error.upstreamMessage`（或者网络层错误的 `error.message`）拼进最终返回给客户端的提示文案里，`functions/api/ai/analyze.js` 和 `functions/api/ai/recommendation.js` 都接入了这个函数。不会泄露密钥本身（密钥不会出现在任何上游错误信息里，这类错误信息本来就是"密钥无效/模型不存在/配额超限"这种诊断性文字）。

**麻烦你现在再点一次"AI 建议卡片"或"重新整理"，把详情页里显示出来的具体错误文案发给我**——这次应该不再是"整理暂时没有完成"这句空话，而是类似"HTTP 400：API key not valid"这种具体原因，看到这句话基本就能确定真正卡在哪一步了。

另外提醒一点（不确定，仅供你自己核对）：截图里 `GEMINI_API_KEY` 的值是以 `AQ.Ab8...` 开头的，我记忆中 Google 的 API Key 通常是 `AIza` 开头的一串；如果这个值其实是别的类型的凭证（比如 OAuth token）被误当成 API Key 填了进去，也会导致"密钥位置配对了、但内容本身无效"。这一点不确定是否已经变化，等这次的具体报错文案出来后可以互相印证。

### 涉及文件（第五轮）

| 文件 | 改动 |
|---|---|
| `src/ai-providers.js` | 新增 `describeAiError()`：把上游错误的状态码/具体信息拼接进最终提示文案 |
| `functions/api/ai/analyze.js`、`functions/api/ai/recommendation.js` | catch 分支改用 `describeAiError()`，不再对所有上游失败都返回同一句固定文案 |
| `tests/ai-providers.test.mjs` | 新建，5 条测试覆盖 `describeAiError()` 各种输入组合 |

### 测试

净增 5 条（`tests/ai-providers.test.mjs`），254 → 259，全部通过：

```
# tests 259
# pass 259
# fail 0
```

这一轮是后端 Cloudflare Functions 的改动，不涉及前端静态资源，未做 `index.html`/`sw.js` 的版本号 bump。

---

## 补丁 1 第六轮（拿到具体报错后，真正的根因）

上一轮加的诊断信息终于把真实原因暴露出来了：

```
HTTP 404：This model models/gemini-2.0-flash-lite is no longer available.
Please update your code to use a newer model...
```

和你的猜测、和我之前怀疑的密钥格式都无关——**是代码里写死的默认模型名 `gemini-2.0-flash-lite` 被 Google 下线了**，不是配置问题，是这份代码本身过期了。用户没有单独设置 `GEMINI_MODEL` 环境变量，所以一直落到这个已经失效的默认值上。

联网核实了一下现状（Google 2026 年中把 Interactions API 立为 Gemini 的主入口，`generateContent` 变成"legacy 但仍完全支持"，`gemini-2.0-flash-lite` 已经不在服务列表里；当前同档位、仍在正常服务的是 `gemini-3.5-flash-lite`）：

- `src/ai-providers.js` 里 Gemini 的 `defaultModel` 从 `gemini-2.0-flash-lite` 改成 `gemini-3.5-flash-lite`——同一个"flash-lite"档位（便宜、快，适合这种结构化整理任务）的现行替代型号，继续走 `generateContent` 端点（这个端点本身没有下线，只是模型名字过期了），没有改去 Google 新推的 Interactions API——那是请求/响应结构完全不同的另一套契约（角色消息变成"typed steps"），为了修一个型号名过期的问题去重写整个契约不划算，风险和收益不成比例。
- 顺带核实到 `gemini-3.5-flash-lite` 不支持自定义 `temperature`/`top-K`/`top-P`（现在传了会被静默忽略，官方文档写明未来世代会直接报 400），所以把 `callGemini()` 里原来写死的 `temperature: 0.1` 去掉了——原本靠它保证输出保守，现在完全靠 `AI_SYSTEM_PROMPT` 里那组"硬规则"（逐字证据、态度判定标准等）来保证，不依赖 temperature。

**这轮改完之后，麻烦你再点一次"AI 建议卡片"确认能不能正常出结果。** OpenAI/Anthropic/DeepSeek/Kimi 那几个默认模型名这次没有联网逐一核实——你目前只配置了 Gemini 的密钥，其余几个没有实际调用到，如果以后切换到别的供应商发现同类报错，是同一个"默认模型名过期"的问题，思路一样。

### 涉及文件（第六轮）

| 文件 | 改动 |
|---|---|
| `src/ai-providers.js` | Gemini 默认模型 `gemini-2.0-flash-lite` → `gemini-3.5-flash-lite`；`callGemini()` 去掉不再支持的 `temperature` 参数 |

### 测试

未新增测试（这是一处纯配置值修正，没有可单测的新逻辑分支），全量测试保持 259 pass / 0 fail。

### 参考来源

- [Interactions API 总览 — Google AI for Developers](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Migrating to the Interactions API — Google AI for Developers](https://ai.google.dev/gemini-api/docs/migrate-to-interactions)
- [Gemini API 模型列表 — Google AI for Developers](https://ai.google.dev/gemini-api/docs/models)
- [What's new in Gemini 3.5 Flash（temperature 参数限制）— Google AI for Developers](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5)
- [Gemini 3.6 Flash & 3.5 Flash-Lite 开发者指南 — DEV Community](https://dev.to/googleai/gemini-36-flash-35-flash-lite-developer-guide-268i)
