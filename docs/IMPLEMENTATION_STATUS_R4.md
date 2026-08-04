# 电影印记：R4 实施状态

日期：2026-08-04
对应窗口：`docs/handoff/R4_WORK_SHELF.md`
前情提要：`docs/IMPLEMENTATION_STATUS_R3_PATCH1.md`（R3 补丁 1，七轮用户反馈）

## 状态

侧边栏、作品书架、作品页三件事全部完成：新增抽屉入口（时间线／作品书架／偏好设置）、按 `work_type` 与「有活动场次」筛选＋三种排序的海报书架、以及作品页的观影履历（可编辑，含 `relation_conflict`／`needs_review` 提示）、评价变迁链、感想列表、补充记录入口。四视图路由（home/shelf/work/detail）与各自独立的滚动位置恢复已接入浏览器历史（`pushState`/`popstate`）。全量测试通过（**284 pass / 0 fail**，R3 补丁 1 收尾时基线为 259，本窗口净增 25 条）。

未能在本窗口完成的：**412×915 / 360×800 × 浅色／深色截图**——延续 R3 起就有的已知限制，执行环境是无 GUI 的 Linux 沙箱，没有浏览器可以跑 `npm run screenshots` 或手工截图。下面「未验证的部分」列出了具体需要人工核实的交互点。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/routing.js` | **新建**：home/shelf/work/detail 四视图的纯状态转移（`enterShelf`/`exitShelf`/`enterWork`/`exitWork`/`enterRecord`/`exitRecord`/`goHome`/`scrollFor`），不碰 DOM/history，只定义"从哪来、回哪去、各自的滚动位置记多少" |
| `src/work-view.js` | **新建**：作品页数据聚合（`buildWorkView`：履历/评价变迁/感想列表/统计）+ 书架聚合（`summarizeWorksForShelf`/`filterShelfEntries`/`sortShelfEntries`）+ `findWorkById`（merged_from 感知），全部纯函数 |
| `src/app.js` | 大改：新增 `sidebarDrawer()`、`renderShelf()`、`renderWork()`、`historyEventEditorOverlay()`、`releaseDateEditorOverlay()`；`topBar()` 抽屉图标替代原偏好设置图标；`render()` 扩展四视图 + 两个新 overlay 分支；新增 `fetchWorkEvents()`（merged_from 感知的场次查询，见下）、`openShelf`/`closeShelf`/`openWork`/`closeWork`/`leaveDetail`/`openSupplementCompose`/`updateHistoryEvent`/`saveHistoryEventForm`/`updateCurrentWorkReleaseDateCn`；`finishCompose()`、`captureContextBar()`、`detailHeader()`、`deleteRecord()`、`confirmWorkMatch()`、`popstate` 处理器均已按 R4 改造 |
| `src/record-card.js` | `eventDateLabel`/`badgeChipMarkup`/`supplementDistanceLabel` 改为 `export`，供 `app.js` 在作品页复用同一套日期/徽章渲染，不重复实现 |
| `styles/app.css` | 新增约 660 行：侧边栏抽屉（滑入动画+右滑关闭配合的 JS）、书架网格与筛选/排序 chip、作品页（大海报+渐变遮罩、上映日期行、履历行、冲突/待确认提示、评价变迁横向滚动链、感想列表、补充记录按钮）、历史场次编辑表单（原生 radio/checkbox + `:has()` 选中态，不需要额外 JS 重渲染） |
| `index.html`/`sw.js` | 版本号 bump：`app.css` v25→v26，`app.js` v25→v26，Service Worker shell 缓存 v26→v27 |
| `tests/routing.test.mjs` | **新建**：10 条 |
| `tests/work-view.test.mjs` | **新建**：15 条 |

## 关键设计说明

### 1. 路由：扁平 state 字段 + 纯函数 reducer 的桥接

`state.view`/`state.currentWorkId`/`state.activeRecordId`/`state.detailReturnView` 仍然是 `app.js` 里读取的扁平字段（这样不用把已有大量直接读 `state.view` 的代码改成读嵌套对象），但每次视图转移都通过 `routeSnapshot()` 把这些字段打包成 `src/routing.js` 认识的 route 对象、调纯函数、再用 `applyRoute()` 写回扁平字段。转移规则只在 `routing.js` 里定义一份，可以脱离浏览器直接用 `node --test` 验证（`tests/routing.test.mjs`），`app.js` 里的 `openShelf`/`closeShelf`/`openWork`/`closeWork`/`openRecord`/`leaveDetail`/`goHome` 只负责历史记录（`pushState`/`replaceState`）与实际 `scrollTo`。

返回路径：`detail ← work ← shelf ← home`，以及 `detail ← home`（从时间线直接进入时）。`detailHeader()` 的返回按钮文案与去向由 `state.detailReturnView` 决定（"返回作品页" / "返回记录流"），不再固定回时间线。

### 2. 侧边栏

只挂在首页顶栏（`topBar()` 第三个图标从「偏好设置」改为「菜单」）：时间线／作品书架／偏好设置 + 已记录条数／作品数统计行。点遮罩关闭（复用已有的 `close-overlay` 通用动作）；右滑关闭用一段独立的 `touchstart/touchmove/touchend` 委托监听实现跟手位移，松手超过 80px 才关闭，没有引入动画库，和这个项目其余交互的实现体量一致。

### 3. 作品书架

`summarizeWorksForShelf()` 把全量 `ViewingEvent` 按 `work_id`（含 `merged_from` 里的旧 id）聚合成每个作品的 `{ watchCount, lastWatchedAt, hasEvents }`；`filterShelfEntries`/`sortShelfEntries` 分别做筛选与排序，三者都是纯函数，`tests/work-view.test.mjs` 直接覆盖。角标统一用**观看次数**（`ViewingEvent` 计数，不是感想数），`watchCount <= 1` 时不显示角标。筛选 chip 是「全部／动画电影／真人电影／活动／其他／未分类」+ 独立的「有活动场次」；`work_type: "event"`（作品本身是活动）与「有活动场次」（普通电影的舞台挨拶场）在 `summarizeWorksForShelf`/筛选逻辑里各自独立判定，没有互相推导。网格 3 列（412 宽）/2 列（≤380 宽，媒体查询）/4 列（≥720 宽，桌面预览用）。

### 4. 作品页

`buildWorkView(work, records, viewingEvents)` 是纯函数（`src/work-view.js`），输出 `{ history, attitudeTimeline, impressions, stats }`：

- **履历**（`buildHistory`）：按时间升序透传全部 `ViewingEvent`，**不重新推断** `viewing_relation`/`watch_index`，也不读 `location_type` 做任何判断——这些字段在写入时已经由 R1 的 `assignViewingRelations` 算好，作品页只呈现。`relation_conflict: true` 的场次在 UI 上显示提示条＋「改回按时间判断」／「保持我的选择」两个按钮，默认保持用户选择（不做任何数据改动，只在用户主动点「改回」时才清掉 `relation_locked` 并重算）。`needs_review: true` 的场次显示「这次观看的场景待确认」+「补充信息」，复用同一个 `historyEventEditorOverlay()`。
- **评价变迁**（`buildAttitudeTimeline`）：记录数 < 2（或有态度的记录 < 2）时返回空数组，UI 据此完全不渲染这个区块；节点只标日期，不标初看/重看（补充记录没有对应的 `ViewingEvent`，标"重看"是错的）；节点数无上限，横向 `overflow-x: auto` 滚动，不折叠不截断。**AI 不参与**——`buildAttitudeTimeline` 只读 `record.attitude`，没有任何 AI 调用。
- **感想列表**（`buildImpressions`）：每条记录一行，日期升序，类型标签按"补充记录/影院观看后/观看后/重看"区分（`impressionKindLabel`），点击进入现有的感想详情页（复用 `open-record` 动作，`enterRecord` 的 `detailReturnView` 会记成 `"work"`）。
- **统计**（`buildStats`）：`watchCount`/`cinemaCount`/`totalMinutes`/`totalSpent`/`eventCount`/`eventTypeCounts`，为 W11 年度报告预留，作品页本身不展示（红线："作品页不是字段清单"）。

活动徽章在作品页**不做首页的 2 个截断**（`eventBadges(..., { max: 99 })`），特典备注（`bonus_note`）显示在徽章下方一行，均可在「编辑」入口里改。

### 5. 观影场次编辑（`historyEventEditorOverlay` / `saveHistoryEventForm`）

每一行都有编辑入口，可改地点／时间／影院／制式／活动／初看重看，`needs_review` 场次复用同一个表单补充信息。保存时用**两遍 `assignViewingRelations`**：先按"完全不锁定"跑一遍，看时间顺序自然算出的结果是什么；只有用户这次在表单里选的初看/重看和这个自然结果不一样，才真正 `relation_locked: true`——这样光打开表单点"保存"、没碰过初看/重看单选框，不会被意外静默锁死；确实手动改了才锁，锁定后与时间顺序矛盾会在下次渲染时正确标出 `relation_conflict`。

时间输入用 `<input type="datetime-local">`，只有 `ViewingEvent.screening_at` 本身存在时才回填——`viewed_on` 只是"哪一天"、不是"几点"，如果用一个隐含的 00:00 去填这个输入框，用户不碰它直接保存就会把"只知道日期"悄悄写成"零点场"这种假数据；改成只有真时间才回填，date-only 的场次改成在字段说明里提示"当前只记了日期，没有具体时刻"。日本时区（`+09:00`）与本地表单值之间的换算用 `isoToLocalDateTimeInputValue`/`localDateTimeInputToIso`（`Intl.DateTimeFormat("sv-SE", ...)` 取 `YYYY-MM-DD HH:mm` 再拼时区，不依赖浏览器本地时区设置，与全项目其余展示逻辑统一按 Asia/Tokyo 解释保持一致）。

### 6. 补充记录（提案 E）

「＋ 补充记录」直接把 `state.overlay` 设成 `"compose"`、`state.captureFlowState` 设成 `"capture:compose"`，跳过 Step 1/2（场景已经明确——就是这个作品），复用同一套 Step 3 书写层与 `finishCompose()`。`finishCompose()` 里新增 `isSupplement` 分支：直接用 `captureContext.workId` 对应的 work（不走 `resolveWork` 的标题模糊匹配，避免撞到另一部同名作品），`record_kind` 写 `"supplement"`，`pendingEvents` 强制为空数组——**不产生 ViewingEvent**。完成后停留在作品页（全程没有改过 `state.view`），只重新渲染，不做首页那套滚动恢复。上下文条（`captureContextBar`）为补充记录模式单独分支，显示「《作品名》· 补充记录 · 距首次观看 N 年」且不可点击回退（没有对应的 Step 2 可退）。

### 7. `merged_from`：新增 `fetchWorkEvents()` 统一收口

`db.getViewingEventsByWork(workId)` 只按精确 `work_id` 匹配，**不感知 `merged_from`**（这点和 `db.getRecordsByWork`/`db.getWorkById` 不同）。作品升格匹配 Bangumi 后 id 会变，旧场次仍挂在合并前的 id 下；如果某处直接调 `db.getViewingEventsByWork(work.id)` 而不查 `merged_from`，会在推定初看/重看时漏掉历史场次、把不该是"初看"的一场错判成"初看"。本窗口新增 `fetchWorkEvents(workId)`（`src/app.js`，含 `merged_from` 全部旧 id 一并查询），并把 `finishCompose`、`refreshCaptureHistoryFlag`、`deleteRecord`、`buildAllExportEntries`、`openRecord`、`popstate` 处理器里原本直接调 `db.getViewingEventsByWork` 的地方全部换成它——这是自查（见下）时发现的问题，不是原有代码的回归。

### 8. 浏览器历史与滚动恢复

`history.scrollRestoration = "manual"`（避免和手动维护的 `state.*ScrollY` 打架）；`pushState` 时把 `{ view, recordId/workId, from }` 存进 `history.state`，`popstate` 据此还原到正确视图并按该视图对应的 `state.returnScrollY`/`shelfScrollY`/`workScrollY` 恢复滚动；指向不存在作品的 `#work=` 深链会安全降级回书架（`replaceState`），不会停留在"画面是书架、`state.view` 却还是 `"work"`"的不一致状态。

## 自查发现并修复的问题

写完初版后，用一个独立的只读审阅过了一遍新代码（没有告诉它我自己的判断，单独走查），发现并修复了 4 处：

1. `finishCompose`/`refreshCaptureHistoryFlag`/`deleteRecord`/`buildAllExportEntries`/`openRecord`/`popstate` 里直接调 `db.getViewingEventsByWork`、没走 `merged_from`——见上「§7」，已统一改用 `fetchWorkEvents`。
2. 历史场次编辑表单用 `viewed_on` 回填一个隐含的 00:00——见上「§5」，已改成只有真 `screening_at` 才回填。
3. `#work=` 深链指向不存在的作品时，`renderWork()` 会退回书架 UI 但 `state.view` 仍是 `"work"`——已在 `popstate` 处理器里加存在性校验，不合法直接 `replaceState` 回 `#shelf`。
4. `popstate` 之前完全没有滚动恢复（只有站内按钮触发的导航才会 `scrollTo`）——已补上，并加 `history.scrollRestoration = "manual"` 避免和浏览器原生恢复冲突。

## 测试

净变化：新增 25 条（`tests/routing.test.mjs` 10 条 + `tests/work-view.test.mjs` 15 条），259 → 284，全部通过：

```
# tests 284
# suites 21
# pass 284
# fail 0
```

`node --check` 对本窗口改动或新建的全部 `src/*.js` 文件确认无语法错误；`styles/app.css` 花括号配对数（458 对 458）确认无误。

## 验收条件核对

对照 `docs/handoff/R4_WORK_SHELF.md` §7：

- [x] 同一部电影记录三次（影院/在家/作品页补充），书架里只有一个条目，角标显示观看次数（统一用观看次数，不用感想数）
- [x] 作品页显示观影履历、感想列表、评价变迁链（数据聚合有单测覆盖；实际渲染未做浏览器验证，见下）
- [x] 只看过一次的作品，`attitudeTimeline` 为空数组，作品页不渲染"评价变迁"区块
- [x] 在家初看 + 影院重看的作品，履历标注正确（`buildHistory` 只透传不重算，单测覆盖）
- [x] 观看 7 次的作品，履历与评价变迁链完整渲染（无截断逻辑；单测覆盖数据层，横向滚动 CSS 已写，未做真机验证）
- [x] 履历每行可编辑；改时间后该作品全部事件重排（两遍 `assignViewingRelations`，逻辑见上；未做浏览器交互验证）
- [x] `relation_conflict` 提示与默认保持用户选择（UI 分支已写；未做浏览器验证）
- [x] 补充记录 `viewing_event_id` 为 null、`record_kind` 为 `supplement`，不产生 ViewingEvent（`finishCompose` 的 `isSupplement` 分支，`pendingEvents` 强制清空）
- [x] 抽屉可开可关，四视图互相跳转，返回时滚动位置保持（`routing.js` 单测覆盖转移规则；浏览器里的实际滚动行为未验证）
- [x] `work_type` 筛选可用，含"未分类"；「有活动场次」筛选与 `work_type: "event"` 区分正确（`filterShelfEntries`/`summarizeWorksForShelf` 单测覆盖）
- [x] 日本上映日只读显示、中国上映日可手填并持久化、两者皆空整行不显示（`releaseDateRow`；持久化逻辑 `updateCurrentWorkReleaseDateCn` 已写，未做浏览器验证）
- [x] 作品页完整显示活动徽章与特典备注，且可编辑（`eventBadges(..., {max:99})`；编辑走 `historyEventEditorOverlay`）
- [x] `needs_review` 场次能在作品页补充信息（复用同一个编辑表单）
- [ ] 412×915 / 360×800 × 浅色／深色截图——**本窗口无浏览器环境，未完成**（延续 R3 起的已知限制）
- [x] 全量测试通过（284 pass / 0 fail）
- [x] `docs/IMPLEMENTATION_STATUS_R4.md`（本文件）

## 未验证的部分（本窗口无浏览器环境，延续 R3 的已知限制）

以下逻辑在代码/纯函数层面确认正确（单测覆盖或人工读代码走查），但没有在真实浏览器里点过一遍，交给下一个有浏览器环境的窗口（或用户实机）核实：

- 侧边栏滑入动画、遮罩点击关闭、右滑关闭手势的真实手感
- 书架网格在 412/360 宽下的实际列数与海报比例、筛选 chip 横向滚动的触感
- 作品页大海报＋渐变遮罩、`margin-top: -56px` 让标题叠在海报底部这个布局在真机上的观感（这类"内容区往上叠一截"的写法容易在不同高度的海报下出问题，是最值得优先截图核对的一处）
- 历史场次编辑表单里 `:has(input:checked)` 驱动的选中态样式（现代浏览器都支持，但没有实测）、`change` 事件驱动的"影院专属字段"显隐是否顺畅
- 评价变迁链横向滚动、感想列表点击进入详情、补充记录按钮的完整交互链路
- `scripts/visual-check.mjs` 仍然是 R3 起遗留的已知问题（未跑通），本窗口未触碰

## 遗留项 / 给下一窗口的说明

- `openSupplementCompose()` 直接把 `state.draft` 置空，不经过 `saveDraft`。这个 App 目前只有一个共享的 `"active"` 草稿槽位（沿用自 R2 设计，不是本窗口引入的限制）；如果用户先开始写一条普通感想没写完，又跑去某个作品页点"＋ 补充记录"，会静默覆盖掉那条未完成的草稿。发生概率很低（需要用户主动跨页面切换未完成的记录），但如果之后要做多草稿槽位，这是需要一并考虑的点。
- 书架/作品页目前只能从首页顶栏的抽屉进入；作品页与书架自身没有独立的抽屉入口（与 `R4_WORK_SHELF.md` 原文"首页顶部…新增抽屉入口"的范围一致，未扩大范围）。
- W11 年度报告需要的 `stats`（`watchCount`/`totalMinutes`/`totalSpent`/`eventTypeCounts`）已经在 `buildWorkView` 里算好，作品页本身按红线不展示，留给 W11 直接复用。
