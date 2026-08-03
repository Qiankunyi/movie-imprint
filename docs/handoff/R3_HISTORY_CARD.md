# R3 · 首页鉴赏履历卡 · 移除轮换壁纸 · 卡片改竖向

**前置：R1、R2 已验收通过。**

**前置阅读：**
1. `docs/RESTRUCTURE_PLAN_R1-R5.md`（尤其第 5 节与提案 J／K／L）
2. `docs/design/DESIGN_TOKENS_V2.md`、`docs/design/tokens-v2.css`、`docs/design/VISUAL_REVIEW_V2.md`
3. `docs/design/revision-02/renders/contact-sheet-*.png`
4. `src/app.js` 的 `recordCard()`、`renderHome()`、`memoryCard()`、`wallpaperSettingsOverlay()`；`styles/app.css`

**本窗口有三件事：**

1. 首页卡片从「感想文字预览」改为「鉴赏履历」
2. **移除轮换壁纸**（用户 2026-08-03 决定，红线变更）
3. **记忆卡片从横向分页改为竖向连续流动**（用户 2026-08-03 决定，红线变更）

---

# 第一部分：移除轮换壁纸

## 为什么移除

用户实测结论：卡片铺满屏幕后壁纸基本看不到，壁纸功能没有兑现价值；日本几家主流影院 App 都没有把首页做成壁纸背景，观看体验并不好。

同时 R3 引入海报后，**视觉识别已经由海报承担**，作品聚合（R4）也提供了另一条浏览路径。壁纸的存在价值被这两者取代。

**移除带来的直接收益：** 首页不再有「壁纸 vs 文字对比度」这个长期约束，卡片设计彻底自由，半透明／不透明之争一并消失。

## ⚠️ 删除边界：不要误删海报要用的东西

| 保留（R3 的海报依赖它们） | 删除 |
|---|---|
| `apiBangumiImageUrl()`（app.js:71） | `resolveDailyWallpaper()`（app.js:264） |
| `buildBangumiImageRequest()`（bangumi.js:29） | `saveWallpaperPreference()`（app.js:294） |
| `isAllowedBangumiImageUrl()`（bangumi.js:35） | `changeWallpaper()`（app.js:299） |
| C2 建立的图片缓存策略 | `wallpaperCandidates()`（bangumi.js:44） |
| `functions/api/bangumi/` 全部代理路由 | `chooseDailyWallpaper()`（bangumi.js:54） |
| | `chooseNextWallpaper()`（bangumi.js:66） |

**误删 `apiBangumiImageUrl` 或图片代理 = 海报全挂。** 动手前先确认这三个保留项没有被壁纸代码"顺手"引用。

## 具体删除清单

**`src/app.js`：**

- 第 3 行 import：去掉 `chooseDailyWallpaper`、`chooseNextWallpaper`、`wallpaperCandidates`，保留 `applyBangumiCandidateToWork`、`buildWorkSearchQuery`
- `state.wallpaper`、`state.wallpaperPreference`（第 82–83 行）
- `resolveDailyWallpaper()`、`saveWallpaperPreference()`、`changeWallpaper()`
- `loadState()` 里的 `await resolveDailyWallpaper()`（第 240 行）
- `renderHome()` 里的 `.wallpaper`、`.wallpaper-image`、`.wallpaper-scrim`、`.wallpaper-credit`（第 363–369 行）
- `renderDetail()` 里的 `.detail-wallpaper`（第 548 行）
- action：`change-wallpaper`、壁纸模式切换相关

**`src/bangumi.js`：** 删除三个壁纸函数。

**`styles/app.css`：** 13 处 `wallpaper` 相关规则。

**`docs/design/tokens-v2.css`：** `--wallpaper-scrim`、`--wallpaper-header-scrim`（浅色 44–45 行、深色 68–69 行）。

**`tests/bangumi.test.mjs`：** 删除 `chooseDailyWallpaper` / `chooseNextWallpaper` 的用例（约 5 处断言）。

> **注意：删除后全量测试数会下降**（当前基线 107）。这**不算回退**，但必须在交付报告里写清「删除壁纸用例 N 条、新增 M 条、净变化」，不要让下一个窗口误判为测试丢失。

## 设置面板要改名，不要整个删掉

`wallpaperSettingsOverlay()`（app.js:609）虽然叫这个名字，但**它同时承载云端同步、AI 偏好等设置**。

- 重命名为 `settingsOverlay()`，`data-testid` 从 `wallpaper-settings` 改为 `settings`
- 删除其中的壁纸模式选择与「换一张」按钮（app.js:619–621）
- **保留** `syncSettingsSection()`、AI 偏好、数据导出等全部其他区块
- 顶栏 action `open-wallpaper-settings` 改名为 `open-settings`

## 首页空状态（壁纸移除后必须重做）

壁纸原本承担了「首次使用时首页不至于空荡」的作用。移除后需要一个真正的空状态：

- 保留 C2 已有的**原创二次元视觉资源**，用作空状态插画（这部分资产不删）
- 文案沿用现有的「电影散场以后，先把还没消失的感觉留下来。」
- 插画 + 文案 + 一个指向底部「＋」的轻引导

**不要留下一个只有「＋」按钮的白屏。**

---

# 第二部分：鉴赏履历卡

## 三种卡片形态

### A. 影院卡（`location_type === "cinema"`）

```
┌────────────────────────────────────┐ ← 金属质感细描边 + 顶部横向渐变高光
│ ┌────┐  《作品名》                  │
│ │海报│  2026/08/03 (日) 19:20       │
│ │    │  TOHO シネマズ 新宿           │
│ └────┘  ⟦IMAX⟧ ⟨舞台挨拶⟩ ⟦重看·第2次⟧│
│                            喜欢 ·  │
└────────────────────────────────────┘
```

⟦实心⟧ = 制式徽章，⟨描边⟩ = 活动徽章。两者的区分见下文。

**注意：影院卡不等于初看卡。** 影院场次完全可能是第 2、第 3 次观看（重映、二刷），此时增强描边与制式勋章照常显示——去影院重看不比初看"低一等"。徽章行里的「重看 · 第N次」只是一条事实标注，不影响卡片的视觉规格。

### B. 线上／在家卡（`home` / `online` / `other`）

```
┌────────────────────────────────────┐ ← 普通描边，无高光
│ ┌────┐  《作品名》                  │
│ │海报│  2026/11/20                  │
│ │    │  在家观看                     │
│ └────┘  ⟦重看 · 第2次⟧              │
│                          超喜欢 ·  │
└────────────────────────────────────┘
```

### C. 补充记录卡（`record_kind === "supplement"`）

```
┌────────────────────────────────────┐ ← 左侧细竖线，与观影卡区分
│ ┌────┐  《作品名》                  │
│ │海报│  补充记录 · 距首次观看 3 年    │
│ └────┘                             │
│                          超喜欢 ·  │
└────────────────────────────────────┘
```

日期弱化，因为补充记录的重点是「距离多久」而不是「哪天写的」。

### D. 草稿卡

维持现状（「继续写」），但如果草稿已有 `captureContext`，显示海报与作品名。

## 影院卡的增强视觉

**用制式勋章承载荣誉感，不是整卡发光。**

### 制式徽章配色（实心底 + 白字，方角）

| 制式 | 视觉 |
|---|---|
| `IMAX` | 深蓝底 + 浅蓝描边 |
| `Dolby Cinema` / `Dolby Atmos` | 深灰黑底 + 金色描边 |
| `4DX` / `MX4D` | 橙红底 |
| `ScreenX` | 青底 |
| `2D` / 未知 | 中性灰底，低对比，不抢戏 |

制式字符串来自 `viewing_context.format`，需要一个归一化映射表（`src/format-badge.js`），把 `【DolbyCinema】`、`ドルビーシネマ`、`IMAXレーザー` 等写法映射到统一 key，未命中则原样显示为中性徽章。

### 活动徽章（与制式徽章是两个家族）

R1 已把「制式（影厅硬件规格）」与「活动（这一场的性质）」分成两个字段。视觉上也必须能一眼区分：

- **制式徽章**：实心底色 + 白字，方角，视觉更"硬"——它代表设备规格
- **活动徽章**：描边样式（透明底 + 彩色边框和文字），圆角，视觉更"软"——它代表这一场发生了什么

活动配色（来自 `src/event-types.js` 的 `EVENT_TYPES`）：

| 活动 | 描边色 |
|---|---|
| `stage_greeting` 舞台挨拶 / `talk_show` トークショー | 暖红 —— 有人来了，规格最高 |
| `cheer_screening` 応援上映 / `roar_screening` 爆音上映 | 暖橙 —— 现场氛围类 |
| `advance_screening` 先行上映 / `premiere` プレミア上映 | 金 —— 抢先看到 |
| `revival` リバイバル / `all_night` オールナイト | 靛蓝 |
| `live_viewing` ライブビューイング | 青 |
| `bonus_distribution` 入場者特典 | 中性描边 + 小礼物图标 |
| `other_event` | 中性描边 |

**首页卡片上的显示规则（防止徽章挤爆 360 宽）：**

- 最多显示 **1 个制式徽章 + 2 个活动徽章**
- 活动超过 2 个 → 显示前 2 个 + 一个 `+N` 徽章
- 活动优先级：`stage_greeting` > `talk_show` > `premiere` > `advance_screening` > `cheer_screening` > `roar_screening` > 其余按 `EVENT_TYPES` 顺序
- `bonus_note` **不上首页卡片**（属于详情页与作品页）

有活动的影院卡视觉权重应高于普通影院卡——这类场次本身就是更值得记住的经历。

### 卡片描边

- 影院卡：1px 金属质感描边（浅色／深色各一套 token），卡片顶部一道 2px 横向渐变高光
- 高规格制式（IMAX / Dolby / 4DX / MX4D / ScreenX）→ 描边与高光透明度更高
- 普通 2D 影院卡 → 只有描边，无高光
- 线上卡 → 常规描边，无高光

**不要给整张卡加外发光（box-shadow glow）**：会显脏，且与既有的克制风格不符。

**壁纸移除后，卡片可以不再是纯不透明**——但本窗口不做半透明，先把不透明的履历卡做扎实。背景变干净之后是否还需要透明层次，等实机看过再说。

## 海报

- 取自 `work.poster_subject_id`，走已有的 `apiBangumiImageUrl()`
- 固定宽度约 72px、2:3 比例、圆角
- 无海报（`local_only` 或加载失败）→ 用作品名首字生成的占位块，配色取自既有 token，不用彩色随机
- 加载中 → 骨架块，不要闪烁
- **海报必须缓存**，复用 C2 已建立的缓存策略；断网时用缓存

## 数据获取注意

`renderHome()` 现在只有 `state.records`。R3 需要每条 record 同时拿到 `work`（海报、标题）与 `viewingEvent`（日期、影院、制式、初看重看）。

**不要在渲染时逐条查库。** 在 `loadState()` 里一次性把 `state.viewingEvents` 加载为全量数组，并建立 `Map<record_id, event>` 与 `Map<work_id, work>` 索引，渲染时 O(1) 查表。记录数增长后这一点会变得重要。

---

# 第三部分：记忆卡片改竖向连续流动

## 为什么改

用户实测：横向滑动切换卡片"非常别扭、不自然"。手指的默认动作是顺着进度条竖向滑屏幕，横向分页与这个直觉相反。

竖向还有一个结构性好处：**W8 要做的卡片上移／下移排序，在竖向布局里才说得通**。横向分页里"上移"没有对应的空间隐喻。

## ⚠️ 这条覆盖一条已冻结的规则

`DEVELOPMENT_HANDOFF_V2.md` §5 与 §3 的「记忆卡片一次完整显示一张，不截断下一张」是为横向分页写的。**现予废止**，替换为：

> 记忆卡片竖向依次排列，自由连续滚动。下一张露出一角，作为"还有内容"的提示。

「露出一角」在竖向里不是缺陷而是**必要的可滚动性提示**——这与原规则的立意（不要让用户以为内容被切掉了）其实一致，只是横向和竖向的实现方式相反。

## 改造 `memoryCard()`（app.js:419）

**删除：**

- `state.activeCardIndex`（app.js:89 及全部读写点：424–425、1049、1397、1410）
- `.memory-pagination` 整块（‹ › 按钮、`N / M` 计数、`.dots`）
- `.swipe-hint`「左右滑动切换」
- `showMemoryCard()`（app.js:1079）及 `previous-card` / `next-card` action
- 左右方向键切换的键盘处理
- `role="region" aria-roledescription="轮播"` 的轮播语义

**改为：**

```html
<div class="memory-list" role="list" data-testid="memory-list">
  <article class="memory-card" role="listitem" data-testid="memory-card">…</article>
  <article class="memory-card core" role="listitem" data-testid="memory-card">…</article>
  …
</div>
```

- 全部卡片一次渲染，竖向排列，卡片之间留明确间距
- 单张卡片内部结构、编辑按钮、证据折叠、AI 建议的保留／删除按钮**全部不变**
- 不做吸附（scroll-snap），自由滚动
- 空状态 `.memory-empty` 维持现状

## 卡片感不能丢

竖向连续流动的风险是**看起来像普通笔记 App 的列表**。靠这几点保住"一张一张的卡片"的感觉：

- 卡片间距明显大于卡片内部行距
- 每张卡有完整的边界（描边或轻微阴影），不做通栏分隔线
- `is_core`（核心卡片）保留现有的强调样式
- 卡片类型标签保持在每张卡的顶部，让边界更清晰

## 无障碍

- 从「轮播」语义改为 `role="list"` / `role="listitem"`
- `aria-label` 更新为「记忆卡片，共 N 张」
- 删除左右方向键处理后，确认 Tab 键仍能依次进入每张卡的编辑按钮

---

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/app.js` | 重写 `recordCard()`；改造 `renderHome()`、`renderDetail()`、`memoryCard()`；删除壁纸全部逻辑；`wallpaperSettingsOverlay()` → `settingsOverlay()` |
| `src/bangumi.js` | 删除三个壁纸函数（**保留** `buildBangumiImageRequest`、`isAllowedBangumiImageUrl`） |
| `src/format-badge.js` | **新建**：制式与活动的徽章元数据、归一化、显示数量截断（活动 key 定义在 R1 的 `src/event-types.js`，本文件只负责视觉映射） |
| `styles/app.css` | 新增履历卡、徽章、金属描边、竖向卡片列表样式；删除 13 处壁纸规则 |
| `docs/design/tokens-v2.css` | 新增描边／高光／徽章配色 token；删除两个 scrim token |
| `tests/format-badge.test.mjs` | **新建** |
| `tests/record-card.test.mjs` | **新建** |
| `tests/memory-list.test.mjs` | **新建** |
| `tests/bangumi.test.mjs` | 删除壁纸用例 |

---

## 测试要求

`tests/format-badge.test.mjs`：

- `【DolbyCinema】` / `ドルビーシネマ` / `Dolby Cinema` → 同一个 key
- `IMAXレーザー` / `IMAX` → 同一个 key
- 未知制式 → 中性徽章，原样显示文本，不抛错
- 空值 / null → 不渲染徽章
- 活动徽章与制式徽章返回不同的 `style` 标识（实心 vs 描边）
- 4 个活动 → 只返回前 2 个 + `+2`，且按约定优先级排序
- `event_types` 为空数组 → 不渲染任何活动徽章，不产生空元素

`tests/record-card.test.mjs`：

- cinema record → 含影院名、制式徽章、增强描边 class
- home record → 含「在家观看」、无制式徽章、无高光 class
- supplement record → 含「补充记录」、含间隔年数、日期弱化
- `watch_index >= 2` → 显示「重看 · 第N次」
- `watch_index === 1` → 不显示「初看」徽章（避免每张卡都挂一个没信息量的标签）
- `watch_index === 1` 且 `location_type === "home"` → 卡片正常渲染，不显示重看徽章（在家也可以是初看）
- `watch_index === 7` → 显示「重看 · 第7次」，两位数不撑破布局
- 影院卡且 `watch_index >= 2` → 增强描边与制式勋章照常显示，不因为是重看就降级
- 无海报 → 渲染占位块而非破图
- 卡片**不再**渲染感想原文预览
- 无记录 → 渲染空状态插画与文案，不是白屏

`tests/memory-list.test.mjs`：

- 3 张卡片 → 一次渲染出 3 个 `.memory-card`，不是 1 个
- 不含 `.memory-pagination`、不含「左右滑动」提示、不含 `aria-roledescription="轮播"`
- 含 `role="list"` 与 `role="listitem"`
- 0 张卡片 → 空状态维持
- `is_core` 卡片仍带核心样式
- AI 建议卡的保留／删除按钮仍在每张卡上正确渲染

回归保护：

- 全局搜索 `wallpaper` / `activeCardIndex`，源码中应无残留（文档除外）
- `apiBangumiImageUrl` 与 Bangumi 图片代理仍可用（海报回归测试）

---

## 验收条件

- [ ] 首页三种卡片形态视觉可区分，影院卡明显更「重」
- [ ] 制式徽章配色正确，未知制式优雅降级
- [ ] 活动徽章（描边）与制式徽章（实心）一眼可区分；含舞台挨拶的场次视觉权重更高
- [ ] 360 宽下「IMAX + 舞台挨拶 + 入場者特典 + 重看第2次」四个徽章不溢出、不错行
- [ ] **壁纸完全移除**，首页无 scrim、无「今日壁纸」署名、设置里无壁纸选项
- [ ] **海报仍正常显示**，断网走缓存无破图（确认没有误删图片代理）
- [ ] **设置面板改名后，云端同步、AI 偏好、数据导出等区块全部还在**
- [ ] 无记录时首页显示空状态插画与文案，不是白屏
- [ ] **记忆卡片竖向排列，一次显示全部**，无左右切换、无分页控件
- [ ] 竖向滚动手感自然，卡片边界清晰，不像通用笔记列表
- [ ] 412×915 / 360×800 × 浅色／深色，四张截图齐备
- [ ] 点击卡片仍正确进入感想详情，返回后滚动位置不变
- [ ] 全量测试通过；交付报告写明「删除 N 条 + 新增 M 条 = 净变化」
- [ ] `docs/IMPLEMENTATION_STATUS_R3.md`

---

## 红线

- 不使用紫色、紫色渐变、玻璃拟态、通用 AI SaaS 模板
- **本窗口不做半透明卡片**（半透明+模糊=玻璃拟态，是硬红线；壁纸移除后这个需求本身也消失了）
- 卡片不是字段清单——座位号、票价、时长、特典备注**不上首页卡片**，它们属于详情页和作品页
- 删除壁纸时**不得**误删 `apiBangumiImageUrl`、Bangumi 图片代理、图片缓存策略
- 删除壁纸时**不得**误删设置面板里的同步、AI、导出区块

---

## 需要同步更新的文档

- `docs/DEVELOPMENT_HANDOFF_V2.md`：§7「壁纸实现约束」整节废止（标注为已移除，保留历史说明）；§3 第 1、2 条状态描述去掉壁纸；§5「记忆卡片一次完整显示一张，不截断下一张」改为竖向流动规则
- `docs/VISUAL_DESIGN_DIRECTION_V1.md`：壁纸相关方向标注废止
- `docs/IMPLEMENTATION_STATUS_C2.md`：追加一行说明壁纸功能已于 R3 移除，作品匹配与图片接口保留
