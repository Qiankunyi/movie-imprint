# R1 · 三层数据模型重构与存量迁移

**前置阅读（按顺序，必须读完再动代码）：**
1. `docs/RESTRUCTURE_PLAN_R1-R5.md`（主方案，尤其第 2、3、9 节）
2. `docs/DEVELOPMENT_HANDOFF_V2.md`（第 9 节的票价条目本窗口要改）
3. `docs/FIELD_AND_TAXONOMY_FREEZE_V1.md`
4. `src/domain.js`、`src/ticket.js`、`src/db.js`、`src/app.js` 的 `finishCompose`

**本窗口不做任何 UI 改动。** 交付一个数据层正确、测试完备、存量数据已安全迁移的基础。

---

## 目标

同一部电影无论看几次、写几条感想，在数据里**只有一个 Work**；每次观看是一个 ViewingEvent；每次书写是一个 Record。初看／重看由系统推定。

---

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/domain.js` | 大改：Work 实体化、`resolveWork`、`normalizeTitle`、新字段 |
| `src/ticket.js` | 中改：票价不再脱敏、解析票价、派生观影时长 |
| `src/migrate.js` | **新建**：存量迁移脚本 |
| `src/db.js` | 小改：新增按 work 查询 records 的方法 |
| `src/app.js` | 中改：`finishCompose` 改用 `resolveWork`；启动时触发迁移 |
| `tests/domain.test.mjs` | 扩充 |
| `tests/ticket.test.mjs` | **修正**：票价断言反转 |
| `tests/migrate.test.mjs` | **新建** |
| `docs/DEVELOPMENT_HANDOFF_V2.md` | 第 9 节票价条目更新 |

---

## 任务

### 1. `domain.js`：Work 实体化

新增：

```js
export function normalizeTitle(title)
// 去首尾空格、连续空格归一、全角→半角（英数字与括号）、
// 去掉【...】制式前缀、去掉版本后缀（「デジタルリマスター版」等可先留空实现）
// 不做繁简转换

export function workIdFor({ subjectId, title })
// subjectId 存在 → `work_bgm_${subjectId}`
// 否则 → `work_local_${slug}`，slug 由 normalizeTitle 结果做 URL-safe 编码

export function resolveWork(works, { title, subjectId, aliases = [] })
// 返回 { work, isNew }
// 查重顺序（主方案 §3.1）：
//   1. subjectId 命中 external_refs 或 id
//   2. aliases 精确匹配（双向）
//   3. normalizeTitle(title) 与已有 work 的 normalizeTitle(title) 或 normalizeTitle(alias) 相等
//   4. 都不中 → 新建

export function promoteWorkToMatched(work, subjectId, bangumiData)
// local work 匹配到 Bangumi 后升格：
//   新 id = work_bgm_{subjectId}
//   旧 id push 进 merged_from
//   合并 aliases、写 poster_subject_id、release_year、external_refs
//   identity_status = "matched"

export function mergeWorks(primary, duplicates)
// 返回合并后的 work：aliases 并集去重、merged_from 累加、
// first_recorded_at 取最早、已匹配字段优先保留
```

修改 `createLocalWork`：新增 `work_type: "unspecified"`、`poster_subject_id: null`、`merged_from: []`、`first_recorded_at`、`release_dates`。

**`release_dates`（为提案 M 的纪念日功能预采数据）：**

```js
release_dates: { jp: null, cn: null, other: [] }   // "YYYY-MM-DD" 或 null
```

- `promoteWorkToMatched` 时，从 Bangumi 条目的 `date` 字段写入 `release_dates.jp`（Bangumi 的 `date` 通常就是日本上映／放送日，覆盖率高）
- `release_year` 改为**优先由 `release_dates.jp` 派生**；无日期时仍可独立填写，不要因为改造把原有的年份弄丢
- `cn`（中国上映日）Bangumi 一般没有，R1 **只建字段留空**，手动填写入口由 R4 的作品页提供
- `mergeWorks` 合并时：`release_dates` 各字段取**非空的那个**；两边都非空且不一致 → 保留已匹配 Bangumi 那一方的值

**功能本身在 W14 做，R1 只负责把数据采下来。** 理由与票价、活动字段相同：R1 正在做迁移，顺手多存一个日期几乎零成本；等 W14 再补就要对全部存量 Work 再迁一次。

**`work_type` 取值**：`animation_film` / `live_action_film` / `event` / `other` / `unspecified`。R1 只建字段并默认 `unspecified`；若 Bangumi 匹配结果的 `type` 字段可判断动画，则自动填 `animation_film`，否则保持 `unspecified`。**不要让 AI 推断。**

### 2. `domain.js`：初看／重看推定

```js
export function assignViewingRelations(events)
// 输入：同一 work_id 下的全部 ViewingEvent
// 按 screening_at（缺失则 viewed_on，再缺失则 createdAt）升序排序
// 依次写入 watch_index = 1,2,3...；index === 1 → viewing_relation = "first"，否则 "rewatch"
// 纯函数，返回新数组，不改入参
// 用户手动改过的（带 relation_locked: true）：保留其 viewing_relation，
//   但 watch_index 仍按时间重算；若两者矛盾则额外标 relation_conflict: true
```

**AI 不得参与这个推定。**

#### ⚠️ 这里有两个必须做对的点

**1. `viewing_relation` 与 `location_type` 完全正交。**

代码里**不得出现任何形式的「影院＝初看」假设**。初看只意味着「时间上最早的那一次」，它完全可能发生在家里：用户可能先在家看过，之后趁重映才去影院——此时影院那次是 `rewatch`。

`assignViewingRelations` 的实现里**不应该读到 `location_type` 这个字段**。如果读到了，说明写错了。

`watch_index` **无上限**，第 7 次就是 7。不要写死只处理两三次的分支。

**2. 补录早期观看会导致整体重排。**

用户可能今天记录了影院观影，之后才想起「其实几年前在家看过」并补录一次更早的事件。所以：

- **每次写入或修改任何 ViewingEvent 后，都要对该 work 的全部事件重跑 `assignViewingRelations` 并整体回写**，不能只给新事件递增编号
- 重排后原来的 `first` 可能变成 `rewatch`，这是正确行为
- 若某事件 `relation_locked: true` 且重排后与时间顺序矛盾 → **保留用户的选择**，另加 `relation_conflict: true`。系统不得擅自覆盖用户判断，也不得假装没有矛盾。R4 作品页会显示提示让用户自己决定

### 3. `ticket.js`：票价与时长

**红线变更**（主方案 §9，用户已决策）：

- `redactSensitiveInfo` **移除对票价的脱敏**：删除 `src/ticket.js:39-41` 的票价脱敏规则，并从 `parseTicketText` 返回值的 `sensitiveDataRemoved` 数组（`src/ticket.js:364`）里去掉 `"ticket_price"`。姓名、邮箱、手机号、订单号、取票码、QR URL、会员登录 URL 的移除逻辑**全部保持不变**
- 同步修正 `src/ticket.js:159` 的注释（「不提取：…票价（这些已在脱敏阶段移除）」已不成立）
- **新增**对支付信息的移除：卡号（含后四位）、支付方式明细、支付账户名。这与票价不同——票价是观影事实，支付信息是金融信息
- 新增 `parseTicketPrice(segment)` → `{ amount: number, currency: "JPY" } | null`。支持 `￥2,000` / `2000円` / `¥2000` 等常见写法；多个座位有多个票价时取合计，合计不可得时取各项之和
- `parseScreeningSegment` 输出增加 `ticketPrice`
- `draftViewingEvent` 输出增加：
  - `ticket_price`
  - `duration_minutes`：由 `screening_ends_at - screening_at` 计算，任一缺失则 `null`
  - `source: "ticket_paste"`
  - `viewing_context.event_types`（数组，见下）与 `viewing_context.bonus_note`
  - `location_type` 保持 `"cinema"`

### 3b. `ticket.js`：制式与活动分流（提案 I）

**当前缺陷：** `extractFormatAndTitle` 把片名里的 `【...】` 前缀**一律当作制式**存进 `format`。所以 `【舞台挨拶付き】` 现在会被错误地记为一种"制式"。

**制式（硬件规格）与活动（这一场的性质）是两类东西，必须分开：**

| | 例子 | 字段 |
|---|---|---|
| 制式 | IMAX、IMAXレーザー、Dolby Cinema、Dolby Atmos、4DX、MX4D、ScreenX、2D、3D | `viewing_context.format`（单值） |
| 活动 | 舞台挨拶、応援上映、爆音上映、先行上映、特典配布 | `viewing_context.event_types`（数组） |

同一场可以既是 IMAX 又是舞台挨拶付き，所以 `format` 单值、`event_types` 多值。

新增 `src/event-types.js`：

```js
export const EVENT_TYPES = [
  ["stage_greeting",      "舞台挨拶",         [/舞台挨拶/, /舞台あいさつ/]],
  ["talk_show",           "トークショー",     [/トークショー/, /トークイベント/]],
  ["cheer_screening",     "応援上映",         [/応援上映/, /応援上映会/]],
  ["roar_screening",      "爆音上映",         [/爆音上映/, /爆音/]],
  ["advance_screening",   "先行上映",         [/先行上映/, /先行公開/]],
  ["premiere",            "プレミア上映",     [/プレミア上映/, /ジャパンプレミア/]],
  ["revival",             "リバイバル上映",   [/リバイバル/, /復活上映/]],
  ["all_night",           "オールナイト上映", [/オールナイト/]],
  ["live_viewing",        "ライブビューイング", [/ライブビューイング/, /ライブ?ビューイング/]],
  ["bonus_distribution",  "入場者特典",       [/入場者特典/, /来場者特典/, /特典配布/]],
  ["other_event",         "其他活动",         []]
];

export function classifyBracketContent(content)
// 返回 { kind: "format", value } | { kind: "event", key } | { kind: "unknown", value }
// 先匹配制式关键词，再匹配 EVENT_TYPES 的正则，都不中则 unknown

export function extractEventTypes(text)
// 从整封脱敏后的邮件文本里提取活动，返回 key 数组（去重）
// 不只看【】前缀——舞台挨拶信息常出现在正文
```

`extractFormatAndTitle` 改造：`【...】` 内容交给 `classifyBracketContent` 分流。

- `format` → 写入 `viewing_context.format`
- `event` → push 进 `viewing_context.event_types`
- `unknown` → **保守处理，写入 `format`**（保持现有行为，避免信息丢失）
- **无论哪种，都仍然从片名中移除**（现有行为不变，前篇／后篇等区分词继续不得被吞掉）

`bonus_note`：R1 只建字段，默认 `null`。票务邮件里的特典描述格式过于自由，不做自动解析，留给 R2 的确认卡手填。

`work_type` 与 `event_types` 的关系：**互相独立，不得互相推导**。「一场有舞台挨拶的动画电影」是 `work_type: "animation_film"` + `event_types: ["stage_greeting"]`；`work_type: "event"` 只用于作品本身就是活动的情况（如 Live Viewing 演唱会）。

### 4. `migrate.js`（新建）

```js
export async function runMigrationIfNeeded(db, { exportBackup })
```

严格按主方案 §3.4 的九步执行。要点：

- **第一步必须先导出 JSON 备份**，复用 `src/export.js` 的现有能力，文件名 `movie-imprint-backup-{ISO时间戳}.json`。备份失败则**终止迁移**
- 幂等：先读 `meta.migration_version`，等于 `"r1-work-dedup"` 直接返回
- 全程在内存中构建完整的新数据集，**校验通过后才批量写库**；任何一步抛错 → 不写库、保留原数据、返回 `{ ok: false, error }`
- 旧 record 的 `workId`（驼峰）→ 新 `work_id`（下划线）。**保留 `workId` 字段一个版本周期**，值同步为新 id，避免 `app.js` 里遗漏的读取点报错
- 无 ViewingEvent 的旧 record：补建 `location_type: "online"`、`source: "none"`、`needs_review: true` 的 Event
- 迁移完成后写 `meta.migration_version = "r1-work-dedup"` 与 `meta.migration_ran_at`

在 `app.js` 的 `loadState()` 之前调用一次。迁移期间显示一个简单的阻塞提示（「正在整理数据…」），不要让用户在迁移中途操作。

### 5. `app.js`：`finishCompose` 改造

现有代码：

```js
record.workId = `work_${record.id}`;
const work = createLocalWork(record);
await db.putRecordWithWork(record, work);
```

改为：

```js
const { work, isNew } = resolveWork(state.works, {
  title: parsedTitle,
  subjectId: null,
  aliases: []
});
record.work_id = work.id;
record.workId = work.id;              // 兼容期保留
record.record_kind = "viewing";
record.viewing_event_id = null;       // 有 Event 时在下方回填
await db.putRecordWithWork(record, work);
```

ViewingEvent 写入段：

- `work_id` 用去重后的 work id
- 写入后调用 `assignViewingRelations` 重算该 work 下**全部** Event 的 relation 与 index，一并回写
- 把 Event id 回填到 `record.viewing_event_id`

`requestWorkMatch` / `confirmWorkMatch` 成功后，调用 `promoteWorkToMatched`；若升格后的 id 与某个已存在的 work 冲突，调用 `mergeWorks` 合并，并把所有指向旧 id 的 record 与 event 改指到合并后的 id。

### 6. `db.js`

新增：

```js
db.getRecordsByWork(workId)   // 含 merged_from 命中
db.getWorkById(workId)        // 若 workId 出现在某 work 的 merged_from 里，返回那个 work
```

D1 与 IndexedDB 双路径都要实现。

---

## 测试要求

`tests/domain.test.mjs` 新增：

- `normalizeTitle`：全角半角、【IMAX】前缀、多余空格
- `resolveWork`：subjectId 命中 / aliases 命中 / 标题命中 / 全不中新建；**同一标题连续三次 resolve 只产生一个 work**
- `promoteWorkToMatched`：id 变更、merged_from 记录、aliases 合并；**Bangumi 的 `date` 正确写入 `release_dates.jp`，且 `release_year` 与之一致**
- `mergeWorks`：并集去重、已匹配优先、first_recorded_at 取最早；`release_dates` 各字段取非空值，冲突时以已匹配方为准
- Bangumi 条目无 `date` 字段 → `release_dates.jp` 为 `null`，不抛错；原有的 `release_year` 不被清空
- 迁移后的旧 work 都有 `release_dates` 结构（不是 `undefined`）
- `assignViewingRelations`：
  - 单次 → `first/1`；三次 → `first/1`、`rewatch/2`、`rewatch/3`
  - **乱序输入正确排序**（入参顺序不影响结果）
  - **在家在前、影院在后 → 在家是 `first`，影院是 `rewatch`**（这条是重点，防止「影院＝初看」的隐含假设）
  - **全部在影院的三次 → 仍然是 `first/rewatch/rewatch`**，地点不影响判定
  - **7 次观看 → `watch_index` 到 7，无截断**
  - **补录更早的一次后重排：原 `first/1` 变为 `rewatch/2`，新事件成为 `first/1`**
  - `relation_locked: true` 的事件 → `viewing_relation` 被保留；与时间顺序矛盾时 `relation_conflict === true`；不矛盾时不加该标记
  - 时间字段缺失时按 `viewed_on` → `createdAt` 依次降级，不抛错
  - **实现内不读取 `location_type`**（可用 mock 断言：传入只有时间字段、没有 `location_type` 的事件也能正确工作）

`tests/ticket.test.mjs` 修正：

- 原「票价被移除」的断言 **反转为「票价被正确解析为 `{amount, currency}`」**
- 新增：姓名、邮箱、取票码仍被移除（回归保护）
- 新增：支付方式与卡号后四位被移除
- 新增：`duration_minutes` 由起止时间正确派生；任一缺失则为 `null`

`tests/event-types.test.mjs`（新建）：

- `classifyBracketContent("IMAX")` → `{kind:"format"}`；`classifyBracketContent("舞台挨拶付き")` → `{kind:"event", key:"stage_greeting"}`
- `【IMAX】【舞台挨拶付き】劇場版○○` → `format: "IMAX"`、`event_types: ["stage_greeting"]`、片名 `劇場版○○`
- 正文里出现「応援上映」但片名无【】→ 仍能提取到 `cheer_screening`
- 同一封邮件出现两次「舞台挨拶」→ `event_types` 去重，只有一项
- 未知的【】内容 → 保守写入 `format`，不丢失
- **回归保护：前篇／后篇等区分词不被制式／活动提取吞掉**
- 无任何活动的普通场次 → `event_types` 为空数组（不是 `null`）

`tests/migrate.test.mjs`（新建）：

- 3 条 record 指向 3 个同名重复 work → 迁移后 1 个 work、3 条 record 全部指过去
- 迁移幂等：连续跑两次结果一致
- 备份失败 → 不写库、返回 `ok: false`
- 中途抛错 → 原数据完好
- 无 Event 的旧 record 被补建 `online` + `needs_review` 的 Event
- `viewing_relation` 与 `watch_index` 正确回填

---

## 验收条件

- [ ] 全量测试通过，且总数不低于原基线 **107 条**（实测于 2026-08-03，`npm test` → 107 pass / 0 fail）
- [ ] 用同一部电影的标题连续创建三条记录，`state.works` 里只有一个 work
- [ ] 三次观看的 `watch_index` 为 1/2/3，`viewing_relation` 为 first/rewatch/rewatch
- [ ] **在家看在前、影院看在后 → 在家那次是 `first`**（不得因为是影院就判为初看）
- [ ] 补录一次时间更早的观影 → 该 work 全部事件整体重排，原 `first` 变 `rewatch`
- [ ] `assignViewingRelations` 的实现中不出现 `location_type`
- [ ] 拿一份真实票务文本跑通：票价被解析出来，姓名／邮箱／取票码／支付信息仍被移除
- [ ] 一份含舞台挨拶的真实票务文本：`format` 与 `event_types` 正确分流，片名干净
- [ ] `work_type` 与 `event_types` 未互相推导
- [ ] 在有存量数据的环境跑迁移：备份 JSON 已生成、重复 work 已合并、记录条数不变
- [ ] 迁移跑第二次无副作用
- [ ] `docs/DEVELOPMENT_HANDOFF_V2.md` 第 9 节票价条目已更新
- [ ] 更新 `docs/IMPLEMENTATION_STATUS_R1.md` 记录完成情况与遗留项

---

## 红线

- 原始感想先本地保存再联网，任何改动不得破坏这条
- 票务原文仍**不持久化**
- 票价**不得**进入 AI 请求体
- 姓名、邮箱、手机号、订单号、取票码、二维码令牌、支付信息**仍然强制移除**
- 迁移**必须**先备份、**必须**幂等、**必须**可回滚
- 不使用私人真实感想原文做测试夹具

---

## 交付

1. 冲突与发现清单（读完文档后先报告）
2. 代码改动
3. 测试结果（全量）
4. 迁移在真实存量数据上的执行报告
5. `docs/IMPLEMENTATION_STATUS_R1.md`
6. 遗留项与 R2 的接口说明（R2 需要用到 `resolveWork` 与 `assignViewingRelations`）
