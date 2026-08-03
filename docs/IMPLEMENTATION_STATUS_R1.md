# R1 实施状态：三层数据模型重构与存量迁移

日期：2026-08-03
状态：**代码与测试已完成，验收条件基本满足；真实存量数据的迁移未在本窗口执行（原因见下）**

---

## 1. 交付摘要

核心目标——"同一部电影无论看几次、写几条感想，在数据里只有一个 Work"——已在数据层实现：

- `src/domain.js`：新增 `normalizeTitle`、`workIdFor`、`resolveWork`、`promoteWorkToMatched`、`mergeWorks`、`assignViewingRelations`；`createLocalWork` 补齐 `work_type`/`release_dates`/`poster_subject_id`/`merged_from`/`first_recorded_at`。
- `src/event-types.js`（新建）：制式／活动分流表与分类函数。
- `src/ticket.js`：票价红线变更（不再脱敏，正常解析）、新增支付方式／卡号脱敏、`duration_minutes` 派生、`format`/`event_types` 分流。
- `src/migrate.js`（新建）：`runMigrationIfNeeded`，九步迁移，先备份、幂等、失败回滚、物理清理被合并的旧 work 行。
- `src/db.js`：新增 `getRecordsByWork`/`getWorkById`（merged_from 感知，D1/IndexedDB 共用同一套基于 `getAll` 的逻辑）。
- `src/app.js`：`finishCompose` 改用 `resolveWork` + `assignViewingRelations`；`confirmWorkMatch` 改用 `promoteWorkToMatched` + `mergeWorks`（含 id 冲突合并与引用改指）；启动流程在 `loadState()` 之前调用一次 `runMigrationIfNeeded`。**未新增任何 UI 组件或页面。**
- `docs/DEVELOPMENT_HANDOFF_V2.md` §9：票价条目已更新为"已在 R1 窗口实施"，并补充实现落点。

## 2. 测试结果

```
npm test
# tests 158
# suites 10
# pass 158
# fail 0
```

基线是 2026-08-03 记录的 107（R0 状态）；本次净增约 51 条测试（`tests/domain.test.mjs` 扩充、`tests/ticket.test.mjs` 修正与扩充、新增 `tests/event-types.test.mjs`、`tests/migrate.test.mjs`），全部通过，无回退。

`tests/ticket.test.mjs` 中原先断言"票价被移除"的用例已按任务书要求反转为"票价被正确解析并保留"；同时补充了姓名/邮箱/支付方式/卡号仍被移除的回归测试。

## 3. 迁移在真实存量数据上的执行报告

**未执行，原因：本执行窗口运行在 Node 沙箱里，没有到用户浏览器 IndexedDB 或已部署 Cloudflare D1 的访问权限——真实存量数据物理上不在这个环境里。** 仓库内也没有任何数据库快照、导出 JSON 或 D1 dump 可供离线跑迁移。

已做的替代验证：用一份**合成的、模拟真实存量数据形态**的数据集（不含任何真实感想原文）跑通了完整的 `runMigrationIfNeeded`，覆盖以下场景并全部符合预期：

| 场景 | 结果 |
|---|---|
| 同一部电影 3 条旧记录、各自绑定独立 1:1 Work（R1 前的架构缺陷） | 合并为 1 个 Work，`merged_from` 正确记录被合并的旧 id |
| 3 次观看地点为 影院→家中→影院 | `viewing_relation`/`watch_index` 按时间顺序正确为 first/1、rewatch/2、rewatch/3，与地点无关 |
| 一条从未走过票务粘贴的纯文字记录 | 补建 `location_type:"online"`、`source:"none"`、`needs_review:true` 的 ViewingEvent |
| 已通过旧版匹配确认的 Work（`identity_status:"matched"`） | 原样保留，不受影响 |
| 备份 | `exportBackup` 被调用，payload 含迁移前完整快照（5 works / 5 records / 3 viewingEvents） |
| 幂等性 | 连续跑第二次直接 `{ok:true, skipped:true}`，不重复处理 |

**用户下一次打开 App 时，迁移会在 `loadState()` 之前自动执行一次**（已接入 `src/app.js` 启动流程）。执行前会先通过 `downloadExport` 触发一次浏览器下载，产出 `movie-imprint-backup-{ISO时间戳}.json` 完整备份；备份失败会终止迁移并保留原数据，页面会显示现有的 `fatal-error` 兜底文案（复用既有组件，未新增 UI）。

**建议 R2 或验收窗口在真机/真实部署环境里做一次实测**：打开 App、确认备份文件已下载、确认历史记录与作品数量符合预期、刷新页面确认迁移不重复执行。

**补充（2026-08-03，用户决策）**：当前本机存放的几条记录都是测试数据，不重要，迁移的优先级低于结构重构本身，不必为保护这几条测试数据投入更多验证成本。据此，迁移代码保留（已写好、已单测覆盖、不影响其他功能），但没有为"保真迁移真实数据"这件事做额外的真机验证——如果测试数据在下次打开 App 后被迁移覆盖或出现异常，直接清空重新记录即可，不需要回滚。

## 4. 与任务书的偏差与工程判断（详见对话中已报告的冲突清单）

1. `work_type` 枚举采用 `R1_DATA_MODEL` 指定的新值（`animation_film`/`live_action_film`/`event`/`other`/`unspecified`），与 `FIELD_AND_TAXONOMY_FREEZE_V1.md`（旧值）及 `src/bangumi.js:applyBangumiCandidateToWork`（旧值，现已不被调用）不一致。`FIELD_AND_TAXONOMY_FREEZE_V1.md` 本身未按此更新（不在任务文件清单内）。
2. `src/bangumi.js:applyBangumiCandidateToWork` 因 `confirmWorkMatch` 改调 `promoteWorkToMatched` 而成为孤儿函数，仍保留（连同其单测）未删除。
3. 迁移期间"阻塞提示 UI"的要求与"本窗口不做 UI 改动"冲突，采用了不新增组件的方案（迁移置于首次 `render()` 之前，失败时复用既有 fatal-error 文案）。
4. 迁移备份内容为三个 store 的完整原始快照（而非 `export.js` 面向展示的格式），通过依赖注入的 `exportBackup` 回调交付，生产环境接到 `downloadExport`。
5. ~~`src/app.js` 里的 `ensureWorkLinks`/`publicSeedRecords` 仍是旧的 1:1 Work 逻辑~~ **（2026-08-03 已按用户要求处理）**：两处都已改为调用 `resolveWork` 去重，不再无条件按 1:1 新建 Work。

## 5. 遗留项（建议归入 R2 或专门的清理窗口）

- `src/bangumi.js:applyBangumiCandidateToWork` 与其单测：确认是否删除，或同步到新枚举。
- `FIELD_AND_TAXONOMY_FREEZE_V1.md`：`work_type` 枚举与票价条目已被本次红线变更超越，未同步更新。
- `confirmWorkMatch` 里 local work 升格与已有 Bangumi 已匹配 work 冲突时的合并分支，没有自动化测试覆盖（`app.js` 目前完全没有单测基础设施），建议 R2/R5 人工在真机走一遍"重新匹配作品"流程复核。
- `bonus_note`（入场者特典自由文本）R1 只建字段，留给 R2 确认卡手填。
- `release_dates.cn`（中国上映日）R1 只建字段留空，手动填写入口留给 R4 作品页。

## 6. 给 R2 的接口说明

R2（记录入口重排）会用到：

### `resolveWork(works, { title, subjectId, aliases })` — `src/domain.js`
返回 `{ work, isNew }`。查重顺序：subjectId → aliases 双向精确匹配 → `normalizeTitle` 后的标题匹配 → 新建。R2 的"确认卡"如果已经有 Bangumi 候选被用户选中，应该把 `subjectId` 传进去，这样新建的 Work 会直接以 `matched` 状态诞生（`work_bgm_{subjectId}`），不需要再走一次 `promoteWorkToMatched`。

### `assignViewingRelations(events)` — `src/domain.js`
纯函数，输入同一 `work_id` 下的全部 ViewingEvent（顺序无关），返回按时间重新计算过 `viewing_relation`/`watch_index` 的新数组。**R2 每次新增/编辑/删除某个 Work 下的 ViewingEvent 后，都必须重新拉出该 Work 的全部事件、跑一遍这个函数、整体回写**——不能只对新增的那一条单独赋值序号，否则补录更早的一次观看时不会触发重排。函数不读取 `location_type`，UI 侧也不应该做"影院＝初看"之类的假设或提示。

### `promoteWorkToMatched(work, subjectId, bangumiData)` / `mergeWorks(primary, duplicates)` — `src/domain.js`
如果 R2 的确认卡允许用户在写作品前临时切换 Bangumi 候选，且这次切换命中了一个已存在的其他 Work，需要复用 `src/app.js:confirmWorkMatch` 里已经写好的"升格 + 冲突合并 + 引用改指"模式，不要重新发明。

### `draftViewingEvent` 新增字段 — `src/ticket.js`
`duration_minutes`、`ticket_price`、`source`、`viewing_context.event_types`、`viewing_context.bonus_note` 现在都会被填充（部分为空数组/`null` 默认值）。R2 的确认卡如果要展示这些字段，直接读即可，不需要再自己算一遍时长或重新解析活动类型。

### `db.getRecordsByWork(workId)` / `db.getWorkById(workId)` — `src/db.js`
两者都会自动处理 `merged_from`（传入一个已被合并掉的旧 id 也能查到正确的当前 Work/记录）。R4 的作品页会需要这两个方法；R2 目前用不到，先记录接口存在。

### 迁移状态
`state` 上没有暴露迁移状态给 UI（R1 明确不做 UI）。如果 R2 需要在界面上显示"数据整理中"，需要自己从 `runMigrationIfNeeded` 的返回值接一个状态位到 `state`，当前 `src/app.js` 只是在启动时 `await` 了它，失败会直接抛到最外层的 `fatal-error` 兜底。
