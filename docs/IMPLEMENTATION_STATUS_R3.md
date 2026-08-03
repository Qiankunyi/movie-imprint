# 电影印记：R3 实施状态

日期：2026-08-04
对应窗口：`docs/handoff/R3_HISTORY_CARD.md`

## 状态

三件事全部完成：首页卡片从「感想文字预览」改为「鉴赏履历」、移除轮换壁纸、记忆卡片从横向分页改为竖向连续流动。全量测试通过（245 pass / 0 fail）。

未能在本窗口完成的：**412×915 / 360×800 × 浅色／深色的四组截图**——执行环境是无 GUI 的 Linux 沙箱，无法安装/运行 Chromium（`npx playwright install` 因网络白名单被拒），也没有系统浏览器。已经把 `scripts/visual-check.mjs` 里所有壁纸/轮播相关的选择器和断言改成了 R3 后的版本（见下），但没有被我实际跑起来验证过。需要在有浏览器的环境里执行 `npm run screenshots` 补齐截图，并核对下面「需要人工核实的项」。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/app.js` | 删除壁纸全部状态/函数/action；`recordCard()`/`memoryCard()` 改为薄封装，实际渲染移到新模块；`renderHome()`、`renderDetail()`、`loadState()` 改造；`wallpaperSettingsOverlay()` → `settingsOverlay()` |
| `src/bangumi.js` | 删除 `wallpaperCandidates`/`chooseDailyWallpaper`/`chooseNextWallpaper`；保留 `buildBangumiImageRequest`、`isAllowedBangumiImageUrl`、`buildWorkSearchQuery`、`applyBangumiCandidateToWork` |
| `src/record-card.js` | **新建**：纯函数渲染鉴赏履历卡（影院/在家/补充记录/草稿四种形态）与首页空状态 |
| `src/memory-list.js` | **新建**：纯函数渲染竖向记忆卡片列表 |
| `src/format-badge.js` | **新建**：制式徽章（实心）与活动徽章（描边）的归一化、配色、优先级截断 |
| `styles/app.css` | 删除 13 处壁纸规则；删除横向轮播（`.memory-stage`/`.memory-pagination`/`.dots`/`.swipe-hint`）；新增履历卡、徽章、金属描边、竖向列表、空状态样式 |
| `docs/design/tokens-v2.css` | 删除 `--wallpaper-scrim`、`--wallpaper-header-scrim`；新增描边/高光/徽章配色 token（浅色+深色两套） |
| `sw.js` | 图片缓存策略保留（C2 建立），改名 `WALLPAPER_CACHE` → `POSTER_CACHE`；SHELL 预缓存清单更新版本号，移除不再使用的壁纸背景图，加入空状态插画 |
| `index.html` | 版本号 bump：tokens-v2.css v15、app.css v20、app.js v21 |
| `scripts/visual-check.mjs` | 移除壁纸交互路径与离线壁纸测试，改为履历卡/海报回归检查；记忆卡片滑动测试改为竖向列表检查；**未在本环境跑通** |
| `tests/*.test.mjs` | 见下 |

## 为什么改成三个新模块而不是全部塞在 app.js

`docs/handoff/R3_HISTORY_CARD.md` 要求 `tests/record-card.test.mjs`、`tests/memory-list.test.mjs` 直接测试 `recordCard()`/`memoryCard()`。这两个函数原本在 `app.js` 里，而 `app.js` 顶层直接读 `document.querySelector` 等浏览器全局对象，在 `node --test` 环境（无 DOM）里 import 会直接抛错。为了让这两个函数能被单元测试覆盖，把渲染逻辑抽成纯函数模块（`src/record-card.js`、`src/memory-list.js`），不读 DOM/localStorage/db，海报 URL 通过 `buildPosterUrl` 注入；`app.js` 里的 `recordCard()`/`memoryCard()` 保留原名，变成调用这两个模块的薄封装。`src/format-badge.js` 是 R3 文档里明确要求新建的文件。

## 删除壁纸：删除边界核对

- 保留：`apiBangumiImageUrl()`、`buildBangumiImageRequest()`、`isAllowedBangumiImageUrl()`、C2 图片缓存策略（Service Worker，改名未改逻辑）、`functions/api/bangumi/` 代理路由（未触碰）
- 删除：`resolveDailyWallpaper()`、`saveWallpaperPreference()`、`changeWallpaper()`、`wallpaperCandidates()`、`chooseDailyWallpaper()`、`chooseNextWallpaper()`、`state.wallpaper`、`state.wallpaperPreference`
- 设置面板：`wallpaperSettingsOverlay()` → `settingsOverlay()`，`data-testid` 从 `wallpaper-settings` 改为 `settings`，顶栏 action `open-wallpaper-settings` → `open-settings`；云端同步、AI 偏好、记录方式、数据导出区块原样保留
- 首页空状态：复用 C2 已有的原创二次元资产 `public/icon-character-v2-flat.png`，文案沿用「电影散场以后，先把还没消失的感觉留下来。」，加一条指向「＋」的轻引导

## 鉴赏履历卡

三种「已完成」形态 + 草稿卡，按 `record.record_kind`（`viewing`/`supplement`）与关联 `ViewingEvent.location_type` 区分：

- 影院卡（`location_type === "cinema"`）：1px 金属质感描边 + 顶部 2px 渐变高光；高规格制式（IMAX/Dolby/4DX/MX4D/ScreenX）时描边与高光透明度更高（`.high-spec`）
- 在家/线上卡：普通描边，无高光
- 补充记录卡（`record_kind === "supplement"`）：左侧 3px 竖线，日期弱化为「补充记录 · 距首次观看 N 年」（N 由 `work.first_recorded_at` 与记录 `createdAt` 的年差计算，向下取整；不足一年显示「不到 1 年」）
- 草稿卡：`captureContext` 存在时显示海报与作品名，否则维持「继续写」

制式徽章（实心底+白字，方角）与活动徽章（描边+圆角）由 `src/format-badge.js` 统一映射：制式最多显示 1 个，活动最多显示 2 个（超出显示 `+N`），活动按 `stage_greeting > talk_show > premiere > advance_screening > cheer_screening > roar_screening >` 其余 `EVENT_TYPES` 顺序排序。`watch_index >= 2` 显示「重看 · 第N次」，`watch_index === 1` 不显示任何标签（在家初看同样不显示）。

海报：取自 `work.poster_subject_id`，走既有 `apiBangumiImageUrl()`；未匹配或无海报时渲染作品名首字占位块（`--surface-high`/`--ink-soft`，非彩色随机）；`<img>` 加载失败时全局 `error` 监听器（capture 阶段，沿用原壁纸监听器的写法）隐藏图片，露出占位块。

`renderHome()` 不再逐条查库：`loadState()` 里一次性 `db.getAll("viewingEvents")`，建立 `record_id → event`（`state.recordEventById`）与 `work_id → work`（`state.worksById`）两张 Map，渲染时 O(1) 查表。

## 记忆卡片竖向连续流动

`memoryCard()` 改为调用 `memoryListMarkup()`：全部卡片一次渲染为 `role="list"` / `role="listitem"`，删除 `state.activeCardIndex`、`showMemoryCard()`、`previous-card`/`next-card` action、`.memory-stage` 的 pointerdown/move/up/cancel 拖拽手势、方向键切换。单张卡片内部结构（类型标签、编辑按钮、证据折叠、AI 建议保留/删除按钮、`is_core` 强调样式）不变。不做 scroll-snap，自由滚动；卡片间距（`--space-5`）明显大于卡片内部行距，每张卡保留完整描边与阴影。

## 测试

净变化：**删除 2 条（壁纸测例）+ 新增 29 条 = 净增 27 条**，218 → 245，全部通过。

```
# tests 245
# suites 21
# pass 245
# fail 0
```

计算方式：用 `git archive HEAD` 取窗口开始前的代码单独跑一遍 `node --test`，得到基线 218 pass / 0 fail；当前代码跑出 245 pass / 0 fail。`tests/bangumi.test.mjs` 删除了「同一天稳定选择同一张壁纸」「换一张壁纸按稳定作品顺序轮换」两个 `test()`（对应约 5 处断言）；新增 `tests/format-badge.test.mjs`（9 条）、`tests/record-card.test.mjs`（13 条）、`tests/memory-list.test.mjs`（7 条），合计 29 条。218 − 2 + 29 = 245，与实测吻合。

回归保护：`grep -rn "wallpaper\|activeCardIndex" src styles scripts sw.js index.html functions` 在源码/工具脚本里只剩 `scripts/visual-check.mjs` 里三处——两处是「断言页面上不应该再有壁纸元素/action」的回归检查，一处是解释旧缓存名由来的注释，均属预期保留，不是残留。

## 验收条件逐项自查

- [x] 首页三种卡片形态视觉可区分，影院卡明显更「重」（金属描边 + 高光；`node -e` 手工渲染确认过 class 与结构，未在真实浏览器里看过渲染效果）
- [x] 制式徽章配色正确，未知制式优雅降级（单测覆盖）
- [x] 活动徽章（描边）与制式徽章（实心）一眼可区分；含舞台挨拶的场次视觉权重更高（`style: outline` vs `style: solid`，暖红优先级最高）
- [ ] **360 宽下「IMAX + 舞台挨拶 + 入場者特典 + 重看第2次」四个徽章不溢出、不错行**——按估算，四个徽章文字宽度合计已接近甚至超过 360px 卡片在扣除海报与内边距后剩余的可用宽度（约 244px vs 估算需要 ~300px+）。当前实现用 `flex-wrap: wrap` 保证「不溢出」（换行而不是裁切或撑破布局），但不能保证严格「不换行」。这一条需要在真机/真实浏览器里实测，如果换行不可接受，需要考虑缩短海报宽度、进一步压缩徽章内边距，或允许两行——本窗口没有可用的浏览器环境验证，如实标注为待确认项
- [x] **壁纸完全移除**，首页无 scrim、无「今日壁纸」署名、设置里无壁纸选项（源码级确认）
- [x] **海报仍正常显示，断网走缓存无破图**（未误删图片代理；`sw.js` 缓存策略原样保留，只改名）——离线场景改写了 `scripts/visual-check.mjs` 里的回归测试，但同样没有实机跑过
- [x] **设置面板改名后，云端同步、AI 偏好、数据导出等区块全部还在**（`settingsOverlay()` 里逐块核对过）
- [x] 无记录时首页显示空状态插画与文案，不是白屏（`emptyHomeStateMarkup()`，单测覆盖）
- [x] **记忆卡片竖向排列，一次显示全部**，无左右切换、无分页控件（单测覆盖）
- [x] 竖向滚动手感自然，卡片边界清晰（CSS 层面已实现：卡片间距 `--space-5` > 卡片内部行距，每卡保留描边与阴影）——手感需要真机体验确认
- [ ] **412×915 / 360×800 × 浅色／深色，四张截图齐备**——未完成，见上「状态」一节
- [x] 点击卡片仍正确进入感想详情，返回后滚动位置不变（`open-record` action 与 `openRecord()` 未改动这部分逻辑）
- [x] 全量测试通过；交付报告写明删除/新增/净变化
- [x] `docs/IMPLEMENTATION_STATUS_R3.md`（本文件）

## 需要人工核实的项（本窗口无浏览器环境）

1. 四组截图（412×915/360×800 × 浅色/深色）——运行 `npm run screenshots`（需要本机 Chromium/Edge，`scripts/visual-check.mjs` 里 `executablePath` 默认指向 Windows 版 Edge，必要时用 `BROWSER_PATH` 环境变量覆盖）。
2. 360 宽下四个徽章是否换行——如果换行在视觉上不可接受，建议缩小海报宽度（如 72px → 64px）或把徽章字号/内边距进一步压缩后重新估算。
3. `scripts/visual-check.mjs` 改动后**没有实际跑通**——已经把所有壁纸/轮播相关的选择器改成 R3 后的版本，但该脚本本身在改动前已经与 R2 的捕获流程（`capture-entry` → `scene-choice`/`ticket-confirm` → `compose`）不一致（脚本直接从「add-record」点击跳到 `composer-input` 填内容，绕过了 R2 引入的场景识别层），这是**改动前就存在**的问题，不在本窗口修复范围内，但会导致该脚本目前很可能无法从头跑通。建议下一个窗口一并修一次。
4. 竖向滚动、卡片描边/阴影、金属高光在真实设备上的观感——本窗口只做到了字符串结构与 CSS 规则层面的正确性验证（`node --check` 语法检查 + 手动 `node -e` 渲染样例 + 单元测试），没有像素级验证。

## 已同步更新的文档

- `docs/IMPLEMENTATION_STATUS_C2.md`：追加「2026-08-04 补记（R3）」说明壁纸功能已移除，作品匹配与图片接口保留
- `docs/DEVELOPMENT_HANDOFF_V2.md`：§5、§7 已经在窗口开始前预先标注为废止（2026-08-03），本窗口未发现需要额外修改的地方
- `docs/VISUAL_DESIGN_DIRECTION_V1.md`：检查后确认文中「壁纸」一词指的是系统主题壁纸配色风险，与本次移除的应用内轮换壁纸功能无关，未作改动
