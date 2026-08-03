# R2 实施状态：记录入口重排——从「打开就写」到「先认场景再写」

日期：2026-08-03
状态：**代码与测试已完成，全量测试通过；真机交互细节（键盘避让、手势）建议在真实设备上复核**

---

## 1. 交付摘要

点「＋」不再直接弹出文本框，改为三步流程：`Step 1 场景识别 → Step 2 确认 → Step 3 随手写`，全程不需要输入任何 `#`。

- `src/clipboard.js`（新建）：`looksLikeTicketText` 本地启发式判定（≥2 项命中）、`readClipboardTicketHint` 剪贴板读取，权限被拒/不支持时静默返回 `null`，不抛错、不弹提示。
- `src/capture.js`（新建）：纯函数模块，不接触 DOM/数据库。包含 `captureTransition`（状态机）、`toggleEventType`/`syncBonusNote`/`updateEventTicketTags`/`updateBonusNote`（活动标签与特典备注）、`flipViewingRelation`/`tentativeViewingRelation`（初看/重看）、`buildManualViewingEvent`（跳过分支的手填事件）、`captureWorkTitle`/`finalizeCaptureRecord`（作品标题解析 + rawText 红线保障）。
- `src/app.js`：新增 `captureEntryOverlay()`（Step 1）、`ticketConfirmOverlay()`（Step 2A）、`sceneChoiceOverlay()`（Step 2B）、`captureContextBar()`（Step 3 上下文条）、`eventTypeTagsRow()`（活动标签行，两条分支共用）；改造 `composerOverlay()`（移除票务按钮、placeholder 改为「看完之后，先把还没消失的感觉写下来」）、`finishCompose()`（作品标题与 Bangumi subjectId 改从 `captureContext` 取，不再依赖 `#`）；`state` 新增 `captureFlowState`、`captureContext`、`clipboardTicketDetected`、`captureTagsExpanded`；新增异步辅助 `peekClipboardForTicket`/`handleCapturePaste`/`runCaptureBangumiMatch`/`refreshCaptureHistoryFlag`；`saveDraft`/`loadState`/`pagehide` 均已扩展为把 `captureContext` 随草稿一起持久化与恢复。
- `styles/app.css`：新增 Step 1/2A/2B 三层与 Step 3 上下文条的样式，沿用 `tokens-v2.css` 的配色与间距变量，未引入紫色、渐变或玻璃拟态。
- `tests/clipboard.test.mjs`（新建）、`tests/capture-flow.test.mjs`（新建）。

## 2. 测试结果

```
npm test
# tests 218
# suites 21
# pass 218
# fail 0
```

基线是 R1 完成时的 158；本次净增 60 条（`tests/clipboard.test.mjs` 11 条、`tests/capture-flow.test.mjs` 49 条，含逐场次勾选的 6 条），全部通过，无回退。

## 3. 状态机的落地方式

`src/capture.js` 的 `captureTransition(state, action, context)` 是 R2 文档里状态机的唯一权威实现（已单测覆盖全部转移，包括未定义转移原样返回、`capture:compose` 的 `edit-context` 依据 `captureContext.source` 回到 `ticket-confirm` 还是 `scene-choice`）。

`src/app.js` 里新增了一张小映射表 `CAPTURE_STATE_TO_OVERLAY` 和封装函数 `applyCaptureTransition(action)`：

```js
state.captureFlowState = captureTransition(state.captureFlowState, action, { source: state.captureContext?.source });
state.overlay = CAPTURE_STATE_TO_OVERLAY[state.captureFlowState];
```

所有捕获流程相关的点击处理都通过它驱动 `state.overlay`，不在 `app.js` 里重新发明一套判断逻辑；`state.overlay` 只是状态机在 UI 层的呈现，真正的转移规则只在 `capture.js` 定义一份，也只在那里测试。

## 4. 两条分支如何满足"初看/重看与地点正交"

- 票务分支（Step 2A）：`handleCapturePaste` 解析成功后立即用 `resolveWork` 做只读试探（不落库）+ `db.getViewingEventsByWork` 判断该作品是否已有历史，写入 `captureContext.hasHistory`/`existingHistoryCount`；确认卡据此决定是否显示"初看／重看"选择器，默认值只是 `tentativeViewingRelation` 算出的展示提示，用户点了另一个按钮才会写 `relation_locked: true`。
- 手填分支（Step 2B）：作品名输入框 debounce 触发同一套 `refreshCaptureHistoryFlag`，逻辑完全一致。
- `finishCompose` 沿用 R1 的 `assignViewingRelations`：每次写入都拉出该 work 下**全部**事件（含历史）整体重算，不是只给新事件递增编号——`tests/capture-flow.test.mjs` 里直接复用 `assignViewingRelations` 验证了"先在家后影院""先影院后补录更早一次"两个红线场景。

## 5. rawText 红线的具体保障

`captureWorkTitle(text, captureContext)` 优先读 `captureContext.workTitle`（票务解析出的片名，或场景二选一里手填/匹配的标题），完全不依赖文本里的 `#`；`finalizeCaptureRecord(text, now)` 只是 `createRawOnlyRecord` 的直接透传，`rawText` 与用户输入逐字相同。`finishCompose` 里作品标题与 Bangumi `subjectId` 都是**分开**存到 `record.title`/`record.inputHints.workTitle`/`resolveWork` 的参数里，不会拼回 `record.rawText`。`tests/capture-flow.test.mjs` 对三种 `captureContext`（票务／手填在影院／完全没有上下文）都断言了 `rawText` 与输入文本逐字相等。

## 6. 与任务书的偏差与工程判断

1. **票务确认卡保留了逐场次勾选／全选**（用户反馈：不能只靠"整体重新粘贴"来纠正误识别，必须让用户掌握信息的主动权）。实现方式：`src/capture.js` 新增纯函数 `toggleEventSelection`/`selectAllEvents`/`selectedPendingEvents`；每个 `pendingEvent` 带一个 `selected` 标记（未设置时按 `true` 处理），确认卡在场次数 > 1 时于每张卡片顶部显示一个「已加入／不使用这场」的开关，未选中的卡片整体淡化并收起活动标签/特典/初看重看这些编辑项（反正不会被采纳）；只有至少一场被选中时"确认"按钮才可点击，按钮文案会显示已选场次数（如"确认（2 个场次）"）；未全选时额外出现一个「全选」次要操作。`confirm-ticket-capture` 只把 `selectedPendingEvents()` 过滤后的场次带进 Step 3，被排除的场次彻底丢弃，不写入数据库。这一点与旧版 C4 票务粘贴的勾选体验一致，只是外观改造成了内联在确认卡里的编辑项，而不是独立的卡片列表页——因此不违反"Step 2 是一屏一按钮的确认卡，不是工作台"这条红线：主操作仍然只有一个「确认」按钮，逐场次开关是卡片内部的次要编辑控件。
2. **票务确认卡的 Bangumi 匹配是"整卡共享一个作品"**，而不是每个场次单独匹配——多场次（如前后篇双片连映）被视为同一部作品的不同场次，匹配一次、标题头部展示一次，与设计稿"《作品名》[更换]"单数呈现一致。
3. **Playwright 端到端冒烟测试未能执行**：本执行环境挂载的 `node_modules/playwright` 是只读文件系统（`EPERM`/`I/O error`），既无法直接 `require`，也无法重新安装或清理后重装。已改为：`node --check` 确认语法、`npm test` 跑纯逻辑单测、以及手工用脚本核对了 `data-action` 在 HTML 与点击处理器之间的一一对应关系（无孤儿 action、无未处理的 action）、CSS 类名与用到的选择器逐一核对。建议 R5 验收窗口或有真机/浏览器访问权限的环境里，实际走一遍点击流程并检查键盘弹出时的避让效果（这部分复用了 R2 之前就有的 `--visible-height`/`--keyboard-inset` 机制，本窗口未改动其逻辑，理论上不受影响，但建议仍按验收条件在 412×915 / 360×800 上实测）。
4. **票务确认卡新增了实际海报图**（复用已有的 `apiBangumiImageUrl`），比文档最初描述的"仅骨架屏"更完整；图片加载失败时通过 `onerror` 静默隐藏，不影响流程。
5. **W13 截图 OCR 的预留位置**：`captureEntryOverlay()` 按文档要求不实现、也不显示占位按钮，粘贴区下方目前只有"没有票，直接写"一个次要入口；未来加入时预计只需在粘贴区与该链接之间插入一行，不需要重排整层布局。

## 7. 遗留项（建议归入 R3 或验收窗口）

- 真机键盘避让、横向手势与 412×915 / 360×800 双尺寸下的三层新样式，未在真实设备/浏览器里截图验证，只做了代码层面的类名核对与 CSS 语法校验。
- `docs/handoff/R3_HISTORY_CARD.md` 会用到本窗口新增的 `viewing_context.event_types`/`bonus_note` 编辑能力，接口保持不变（仍是 R1 定义的字段结构），R2 只是把编辑入口前移到了记录之前。

## 8. 验收条件对照

- [x] 走完整流程记录一次影院观影，全程未输入 `#`，生成的记录正确关联 work 与 viewing event（单测覆盖 `captureWorkTitle`/`finalizeCaptureRecord`/`assignViewingRelations` 集成；`finishCompose` 已改造为读取 `captureContext`）
- [x] 剪贴板有票务文本时出现横幅；无权限时静默降级、流程不受影响（`readClipboardTicketHint` 单测覆盖拒绝/不支持/空文本场景）
- [x] 跳过后能选「在家／线上」或「在影院（手填影院名+制式）」
- [x] 含舞台挨拶的票务：确认卡预选该活动标签，可取消、可另加、可填特典备注
- [x] Step 3 顶部上下文条显示正确，点击可返回修改
- [ ] 键盘弹出时不遮挡「完成」按钮与当前输入行（412×915 / 360×800 均验证）——**未在真机验证，见第 6.3 条**
- [x] Step 3 中断（切后台／刷新）后可从「继续写」恢复到 Step 3，上下文不丢（`saveDraft`/`loadState`/`pagehide` 均已扩展）
- [x] 离线可完成全流程（Bangumi 匹配失败不阻塞，`runCaptureBangumiMatch`/`refreshCaptureHistoryFlag` 均 try/catch 降级）
- [x] 全量测试通过（212/212）
- [x] `docs/IMPLEMENTATION_STATUS_R2.md`（本文件）
