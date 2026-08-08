# R6 · 片单独立化 + TMDB 双数据源｜代码审计与方案

> 阶段：**只审计、只设计，不改代码**。
> 审计范围：`src/`、`functions/`、`server.mjs`、`docs/`（R1–R5 全部实现状态文档）。

---

## A. 当前实现

### A.0 存储底座（先说这个，因为它决定了后面所有 migration 的成本）

| 层 | 实现 | 关键事实 |
|---|---|---|
| 本地 | IndexedDB `movie-imprint-local`，`DB_VERSION = 4` | 7 个 store：`drafts / records / works / meta / viewingEvents / series / collections`，每个都是 `keyPath: "id"` 的**纯文档存储**，没有任何索引、没有字段约束 |
| 云端 | Cloudflare D1 | 全库**只有一张表**：`store_entries(store TEXT, id TEXT, data TEXT, PRIMARY KEY(store,id))`，`data` 是整条 JSON 字符串 |
| 路由 | `src/db.js` `cloudOp()` | 有 `mi_access_password` 走 D1，401 自动降级 IndexedDB。对外接口 `get/getAll/put/delete` 两条路径完全同形 |

**结论（非常重要）：本项目不存在关系型 schema。**
给 Work 加字段、给 Collection 加字段，**不需要任何 SQL DDL，也不需要 IndexedDB 版本号 bump**（只有新增 store 才需要 bump）。
所谓「数据库 migration」在这个项目里只有两种形态：

1. `src/migrate.js` 的一次性全量重写（bump `MIGRATION_VERSION` 触发，**会强制弹一次 JSON 备份下载**）；
2. 读取时惰性归一化（`normalizeReleaseDates()` 就是现成先例）。

新增 store 时必须**同时**改三处，缺一不可：

- `src/db.js` 的 `STORES` 常量 + `DB_VERSION`
- `functions/api/sync/[store].js` 的 `ALLOWED` 白名单
- `functions/api/sync/[store]/[id].js` 的 `ALLOWED` 白名单

---

### A.1 Work / Movie 模型

定义在 `src/domain.js`（`createLocalWork`），R5 在 `src/library.js` 里扩了资料层。当前完整字段：

```
id                 内部主键
work_id            = id（冗余镜像，历史遗留）
title / original_title / aliases[]
work_type          animation_film | live_action_film | event | other | unspecified
release_year
release_dates      { jp, cn, other[], entries[{id, region, date, source}] }   ← R5 新格式
external_refs      [{ source: "bangumi", id, url }]
related_refs       [] （Bangumi 关联条目锚点）
tagline / summary
identity_status    "local_only" | "matched"
poster_subject_id  ← 只认 Bangumi subject id
merged_from        []  被合并掉的旧 work id
first_recorded_at
match              { status, query, candidates[], message, confirmedSubjectId }
```

**Work 在存储层已经是独立实体。** `records.work_id` 和 `viewingEvents.work_id` 都是外键式引用，Work 文档本身不嵌在 Record 里。
即：`Work ← Record` / `Work ← ViewingEvent` 的方向**已经是对的**，第二节要求的关系图当前已成立。

### A.2 ⚠️ 当前 Work ID 体系（本次最大的结构性问题）

`src/domain.js` `workIdFor()`：

```js
if (subjectId) return `work_bgm_${subjectId}`;   // ← Bangumi ID 被编码进主键
return `work_local_${slugify(normalizeTitle(title))}`;
```

由此派生出一整条**「ID 会变更 + 级联重写」**的链路：

```
local work (work_local_xxx)
  → 用户在详情页确认 Bangumi 匹配
  → promoteWorkToMatched()  把 id 改成 work_bgm_<sid>
  → confirmWorkMatch() 必须手工：
       ① 检测新 id 是否撞上已有 work → mergeWorks()
       ② 遍历所有 records 改 work_id
       ③ 拉所有 viewingEvents 改 work_id + 重跑 assignViewingRelations
       ④ 物理删除旧 work 行
       ⑤ 修正 state.works / state.currentWorkId
```

这条链路在项目历史上**已经出过至少两次线上 bug**，代码注释里写得很清楚：

- `src/migrate.js` 版本 `r1-work-dedup-2` 的注释：漏了第 ④ 步 → 书架里出现「幽灵重复条目」（一个有海报有记录，一个只剩标题）；
- `src/app.js` `confirmWorkMatch()` 里同一段注释：实时匹配路径漏了同一步，事后补的。

**加入 TMDB 后，如果沿用同一套模式（`work_tmdb_xxx`），这条链路的组合数会翻倍**（local→bgm、local→tmdb、bgm+tmdb 互认…），几乎必然再出同类 bug。

另外 `promoteWorkToMatched()` 里：

```js
external_refs: [{ source: "bangumi", id: sid, url: ... }],   // ← 整体覆盖，不是 upsert
```

只要将来一个 Work 同时有 bangumi 和 tmdb 引用，**后写的会把先写的抹掉**。

### A.3 作品创建流程（片单问题的根因）

全项目**只有三条**路径会产生 Work，且全部是「观影后」：

| # | 入口 | 位置 | 触发条件 |
|---|---|---|---|
| 1 | 捕获流程完成 | `app.js finishCompose()` → `resolveWork()` → `db.putRecordWithWork(record, work)` | 用户写完感想 |
| 2 | 旧数据补链 | `app.js ensureWorkLinks()` | record 缺 work_id |
| 3 | Bangumi 升格/合并 | `app.js confirmWorkMatch()` | 已有 work 匹配成功 |

注意路径 1 的落库函数是 `putRecordWithWork(record, work)` —— **Work 和 Record 在同一个事务里被强绑定写入**。
不存在任何「只创建 Work、不创建 Record」的入口。这就是「App 里的作品 ≈ 已看过的作品」这个隐含前提的物理来源。

去重逻辑 `resolveWork(works, {title, subjectId, aliases})` 三级：

1. `subjectId` 命中 `id === work_bgm_<sid>` 或 `external_refs` 里 source=bangumi 的项
2. `title`/`aliases` 与已有 work 的 `title`/`aliases` **精确**相等
3. `normalizeTitle()` 归一化后相等（去【制式】前缀、全角转半角、空格归一；明确不做繁简转换）

**这三级全部只认 Bangumi。**

### A.4 观影记录（Viewing Record）

两个实体，不是一个：

- **Record**（感想）：`{id, work_id, workId, record_kind: "viewing"|"supplement", viewing_event_id, rawText, cards[], attitude, recommendation…}`
- **ViewingEvent**（场次）：`{id, work_id, record_id, viewed_on, screening_at, duration_minutes, viewing_relation, watch_index, location_type, ticket_price, screened_content, viewing_context{cinema_name, format, seats, event_types…}, source, needs_review, status}`

初看/重看由 `domain.js assignViewingRelations()` 纯按**时间顺序**推定（红线：绝不读 `location_type`），每次写入都要对该 work 的**全部**事件重跑并整体回写。
跨 `merged_from` 取事件必须走 `app.js fetchWorkEvents()`，不能直接调 `db.getViewingEventsByWork()`（后者不感知 merged_from）。

### A.5 片单（collections）当前实现

R5 引入。模型在 `src/library.js`：

```js
{ id: `collection_<slug>_<ts>`, title, description, work_ids: [], created_at, updated_at }
```

纯函数：`createCollection / addWorkToCollection / removeWorkFromCollection / collectionsForWork / collectionWorks`。

UI（`src/app.js`）：

| 视图/面板 | 函数 | 能力 |
|---|---|---|
| 片单列表 `#collections` | `renderCollections()` L1061 | 列出片单 + 新建（只有 title，没有 description 输入） |
| 片单详情 `#collection=<id>` | `renderCollection()` L1084 | 只渲染 `workGridMarkup()` + **删除片单**（FAB 菜单） |
| 加入片单面板 | `collectionsEditorOverlay()` L1822 | 多选勾选 + 新建并加入 |
| 作品页片单行 | `collectionsRow()` L881 | chips + 「＋ 加入片单」按钮 |

**为什么片单只能添加已有作品——三个叠加的原因：**

1. **数据层**：`work_ids: string[]` 只能存 ID，ID 必须先存在于 `works` store；
2. **交互层**：加入动作的**唯一起点是作品页**（`data-action="edit-collections"`），而作品页只能从书架进入，书架只渲染 `state.works`。片单详情页**根本没有「添加作品」按钮**——它的空状态文案就是证据：`"这个片单还没有作品——到作品页点「＋ 加入片单」把它放进来"`；
3. **创建层**：见 A.3，没有任何脱离 Record 创建 Work 的入口。

其余缺口：无编辑片单（改名/改描述）、无排序、无 `added_at`、无 `reason`。

### A.6 Bangumi 接入现状

**后端（Cloudflare Pages Functions）**

| 端点 | 文件 | 说明 |
|---|---|---|
| `GET /api/bangumi/search?q=` | `functions/api/bangumi/search.js` | POST 上游 `/v0/search/subjects`，`filter.type=[2,6]`（动画+三次元）、`nsfw:false`、**`limit=3`**、24h Worker 级内存缓存（上限 100 条） |
| `GET /api/bangumi/subject?id=` | `functions/api/bangumi/subject.js` | 取完整 summary（搜索接口的 summary 会截断） |
| `GET /api/bangumi/image?subjectId=` | `functions/api/bangumi/image.js` | 图片代理。**安全实现很扎实**：手动 redirect（≤3 跳）、host 白名单 `lain.bgm.tv`、`no_icon_subject.png` 判 404、content-type 白名单、6MB 上限、`nosniff` + `same-origin` CORP |

统一由 `functions/_middleware.js` 做 `ACCESS_PASSWORD` 校验（图片额外支持 `?token=`，因为 CSS 里嵌 URL 带不了请求头）。

**前端**

- `src/bangumi.js`（纯函数）：`buildBangumiSearchRequest / normalizeBangumiSubjects / buildBangumiImageRequest / isAllowedBangumiImageUrl`
- 调用点只有两处，**都不是「边输入边搜」**：
  - `requestWorkMatch(recordId)` —— 详情页匹配面板，用户点触发
  - `runCaptureBangumiMatch(query)` —— 捕获流程 Step 2「场景二选一」里手填标题后触发
- **没有 debounce 机制**（现在不需要，因为都是显式触发）
- 海报：`shelfPosterMarkup()` / `workHeroMarkup()` **硬编码** `identity_status === "matched" && poster_subject_id` → `/api/bangumi/image?subjectId=`

**本地开发注意**：`server.mjs` 手写路由表只挂了 `bangumi/search`、`bangumi/image`、`ai/*`——**`bangumi/subject` 和全部 `sync/*` 在 `node server.mjs` 下不可用**，本地跑 D1 必须用 `wrangler pages dev`。新增端点要记得同步这张表。

### A.7 顺手发现的两个既有小问题（不属于本次范围，仅记录）

1. `src/bangumi.js applyBangumiCandidateToWork()` 是**死代码**——`src/app.js` 从未 import，只有 `tests/bangumi.test.mjs` 在测它。而且它产出的 `work_type` 是 `animation_movie`/`live_action_movie`，与 `domain.js` 和 UI 标签表用的 `animation_film`/`live_action_film` **对不上**。建议后续单独清理，本次不动。
2. `export.js` 全量导出以 Record 为遍历起点 → 未来「有 Work 无 Record」的片单作品**不会进导出**。见 B.9。

---

## B. 与目标之间的差距

### B.1 逐条对照

| 需求（章节） | 状态 | 说明 |
|---|---|---|
| §2 Work 独立于 Viewing Record | 🟡 **存储层已满足，入口层不满足** | 关系方向正确；但唯一写入口是 `putRecordWithWork()`，无法产生「无 Record 的 Work」 |
| §2 不能重复创建第二个 Birdman | 🟡 部分 | `resolveWork()` 去重只认 bangumi + 标题 |
| §3 多个自定义片单 | ✅ | `collections` store 已支持 |
| §3 Create / Delete / Add / Remove | ✅ | 已有 |
| §3 **Edit Watchlist** | ❌ | 无改名/改描述入口，新建时也填不了 description |
| §3 **Reorder** | ❌ | `work_ids` 是数组，顺序天然可排；但没 UI。`series` 已有 `moveWorkInSeries()` 可直接照抄 |
| §3 一个 Work 属多个片单 | ✅ | |
| §4 Entry 存 `added_at` / `reason` | ❌ | `work_ids: string[]` 承载不了。**本次必须改的数据结构** |
| §4 同一 Work 在不同片单有不同 reason | ❌ | 同上 |
| §5 已看/未看由 ViewingEvent 派生 | ✅ **设计上已满足** | 片单条目里从来没存过 watched 标记，改造时守住即可 |
| §5 看完不自动删除条目 | ✅ | 无此逻辑 |
| §5 片单里显示已看/未看 | ❌ | `renderCollection()` 只渲染 `workGridMarkup()`，无状态角标 |
| §6 保留 Bangumi | ✅ | 不动 |
| §6 新增 TMDB | ❌ | 完全不存在 |
| §7 数据源只是 preferred source | ❌ | 当前 `identity_status: "matched"` 隐含「= 匹配到 Bangumi」；无 `primary_source` 字段 |
| §8 internal Work ID ≠ 外部 ID | ❌ **高风险** | 见 A.2，Bangumi ID 直接编码进主键 |
| §9 避免重复作品 | 🟡 | bangumi_id 去重已有；tmdb_id 无；跨源匹配无 |
| §10 统一搜索体验 | ❌ | 现有两个匹配 UI 都绑死在「某条 record 的上下文」里，不能独立打开 |
| §11 搜索策略（debounce/限流/状态） | ❌ | 无 debounce（现无需求）；有 24h 缓存和 6s 超时可复用；`limit=3` 对片单场景太少 |
| §12 TMDB 元数据落库 | ❌ | |
| §13 不依赖外部 API 实时展示 | 🟡 | 文本元数据已快照落库 ✅；**海报每次都请求 `/api/bangumi/image`**（有 24h 边缘缓存 + `cache-control: max-age=86400`，可接受） |
| §14 观影前→观影后打通 | ❌ | 未看的 Work 存在后，`finishCompose()` 的 `resolveWork()` 能否正确命中它 → 见 B.4 |
| §15 已有数据兼容 | ⚠️ | 见 B.5 |
| §17 Discovery Context 扩展性 | 🟡 | 改成 entry 对象后加 `source_work_id` 是零成本的 |

### B.2 潜在冲突 ①：书架会混入未看作品

`renderShelf()` → `summarizeWorksForShelf(state.works, state.allViewingEvents)`，对**全部** works 生成条目。
一旦通过片单创建了未观看的 Work：

- 未看作品会**直接出现在「作品书架」**里，`watchCount = 0`
- `lastWatchedAt` 会回落到 `work.first_recorded_at`，于是**未看的片按「最近观看」排序混进已看列表**
- 「首次记录时间」排序同理被污染

书架的语义是「我的观影收藏」，这是必须处理的冲突，而不是可选优化。

### B.3 潜在冲突 ②：作品页在「无记录」状态下的表现

`buildWorkView(work, [], [])` 本身是安全的（三个数组都返回空，`buildStats` 全 0，不产生 NaN）。
需要逐个确认的 UI：

- `attitudeTimeline` 空 → 区块不显示 ✅（`buildAttitudeTimeline` <2 条直接返回 `[]`）
- `impressions` / `history` 空 → 需要一句合适的空状态文案，当前文案是围绕「已看」写的
- FAB 的「补充记录」入口（`openSupplementCompose`）在未看作品上语义不成立，应替换为「记录这次观看」
- `workMetaLine` / `releaseDateRow` / `taglineRow` 在只有 TMDB 数据时要能正常显示

### B.4 潜在冲突 ③：观影前 Work 与观影后捕获流程的会合点

`finishCompose()` 里：

```js
({ work } = resolveWork(state.works, {
  title: resolvedTitle,
  subjectId: state.captureContext?.subjectId ?? null,
  aliases: []
}));
```

**这是 §14「不能出现 Work A / Work B」的唯一关键路径。** 三种会合失败的场景：

| 场景 | 现状会发生什么 |
|---|---|
| 片单里的 Birdman 来自 TMDB（无 bangumi_id），观影后捕获流程用 Bangumi 匹配到同一部 | `subjectId` 是 bangumi id，`resolveWork` 第 1 级查不到（TMDB work 没有 bangumi ref）→ 落到第 2/3 级标题匹配 → **若译名不同（「鸟人」vs「Birdman」）则新建 Work B** ❌ |
| 片单里的作品来自 TMDB，观影后用户手填了不同译名 | 同上，新建 Work B ❌ |
| 片单里的作品来自 Bangumi，观影后也匹配 Bangumi | 第 1 级命中 ✅ |

所以 §14 的打通**不只是加个 tmdb_id 去重**，还必须：`resolveWork` 扩展成多源、`aliases` 在创建 Work 时把两个源的所有标题变体（title / original_title / 各语言 title）都收进去。

### B.5 数据迁移风险

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| bump `MIGRATION_VERSION` 会**强制弹出 JSON 备份下载** | 中 | `runMigrationIfNeeded()` 第一步就是 `exportBackup()`，失败即终止。手机上下载文件体验很差。**对策：本次不 bump，改用惰性迁移**（见 C.6） |
| 云端 D1 与本地 IndexedDB 数据形状不同步 | 中 | 用户可能 A 设备已升级、B 设备还是旧前端。**对策：新旧字段双写（`work_ids` 与 `entries` 并存），旧前端读 `work_ids` 仍然正常** |
| `migrateLocalToCloud()` 只上传云端**没有的 id**（跳过已存在的） | 中 | 如果 collection 文档在两端都存在但一端已升级成 entries，同步不会覆盖 → 升级信息可能丢。**对策：惰性迁移在每次读取时幂等执行，任一端打开都会自愈** |
| `merged_from` 与新 entry 结构的交互 | 中 | 片单 entry 存的 `work_id` 可能指向被合并掉的旧 id。**对策：`collectionWorks()` 必须改用 `findWorkById()`（已支持 merged_from 回查），不能继续用裸 Map 查表** ← 这是当前 `library.js` 的一个既存隐患 |
| 新增 store | — | **本方案不新增 store**，`DB_VERSION` 和两处 `ALLOWED` 白名单都不用动 ✅ |

### B.6 Bangumi + TMDB 共存风险

| 风险 | 说明 |
|---|---|
| `external_refs` **整体覆盖** | `promoteWorkToMatched()` 里是 `external_refs: [{...}]` 直接赋值。若一个 Work 先有 tmdb ref、后匹配 bangumi，tmdb ref 会被静默抹掉 → **必须改成按 source upsert** |
| `identity_status` 语义含糊 | 现在 `"matched"` 隐含「匹配到 Bangumi」。海报判断、匹配面板、书架都读它。TMDB 匹配也置 `matched` 会让「有 bangumi 海报」的判断失效 → 海报判断必须改成读 poster 引用本身，不读 `identity_status` |
| 海报通路单一 | `apiBangumiImageUrl(subjectId)` 是唯一图片入口，TMDB 海报（`https://image.tmdb.org/t/p/w500/xxx.jpg`）无路可走 |
| TMDB 限流与密钥 | TMDB 要 API key/Bearer token；必须走 Functions 代理，**绝不能把 key 放进前端** |
| `work_type` 映射 | 现在只有 `bangumi.type === "anime"/"real"` 两分支。TMDB movie 应映射到 `live_action_film`，但**日本动画电影在 TMDB 上也是 movie** → 若无脑映射会把《你的名字。》标成真人电影。**对策：TMDB 结果不自动写 `work_type`，留 `unspecified` 由用户在作品页认领**（这条路径 R5 已经建好了） |
| 搜索请求量翻倍 | 两源并行 → 每次搜索 2 个上游请求；Bangumi 无 token 时限流较紧 |

### B.7 重复 Work 风险（§9）

| 场景 | 现状 | 目标 |
|---|---|---|
| 同一 bangumi_id 二次导入 | ✅ 已防 | 保持 |
| 同一 tmdb_id 二次导入 | ❌ | 第一阶段**必须**防 |
| 《你的名字。》先 Bangumi 后 TMDB | ❌ 会产生两个 Work | 第一阶段：**检测 + 提示用户确认，不自动合并** |
| 片单加入 vs 观影后捕获 | ❌ 见 B.4 | 第一阶段必须打通 |

跨源自动匹配的误判风险是真实存在的（同名不同片、重制版 vs 原版、剧场版 vs TV 版），符合用户「优先安全方案」的要求 → **不做自动合并**。

### B.8 UI/交互冲突

- 片单详情页目前的 FAB 菜单只有「删除片单 / 返回片单列表」，要插入「添加作品」「编辑片单」两项（`fabActionsFor()` L524）
- 项目有一套复杂的手势系统（侧边栏拖拽、手势层、`suppressClickAfterGesture()`），R5 文档里明确记录过「手势吃掉 click 导致侧边栏入口全部失效」的 bug —— **新面板必须复用现有 `overlay` 机制（`overlayRoot` 挂载点），绝不自建浮层**
- `render()` 用 `lastBaseHtml / lastFabHtml / lastOverlayHtml` 三段缓存跳过无变化重写。搜索面板每次输入都会重渲染 overlay → **输入框会失焦**。必须像现有 `composerOverlay` 那样处理焦点，或让搜索结果区局部更新

### B.9 导出/数据资产影响

`export.js` 的 `exportAllJSON/Markdown` 以 Record 为遍历起点。未看的 Work + 片单 entry（含 reason）**不会出现在任何导出物里**。
考虑到本项目的核心命题是「长期可保存的个人记忆资产」，片单的 reason 恰恰是「发现过程」的记录——**建议本阶段就把片单纳入全量导出**，否则这部分数据只存在于 IndexedDB/D1，不符合产品定位。

---

## C. 推荐方案

### C.1 核心决策：Work ID 策略

**推荐：方案 A —— 停止 ID 变更，新建一律 UUID，历史 ID 原样保留。**

具体三条规则：

1. **历史 ID 不动**。`work_bgm_123` / `work_local_xxx` 就地视为「internal id 恰好长得像外部 id」，不做全量重编号。零迁移风险。
2. **新建 Work 一律 `work_<base36ts>_<rand>`**（复用现成的 `domain.js createId("work")`）。身份信息只写进 `external_refs`。
3. **`promoteWorkToMatched()` 不再改 `work.id`**，只做：`external_refs` upsert + `identity_status` + 元数据填充 + `poster` 设置。

带来的直接收益：

- A.2 那条「ID 变更 → 级联重写 records/events → 删旧行」的高危链路，**新数据永远不会再触发**
- `confirmWorkMatch()` 里的合并/级联代码**原样保留不动**（历史数据、以及未来的手动合并仍然需要它），只是新路径不再走进去
- `resolveWork()` 第 1 级本来就同时查 `id === work_bgm_<sid>` **和** `external_refs`，所以停止改 ID 后查重照样命中 ✅

> **不推荐方案 B（全量 UUID 化迁移）**：要重写全部 works + records + viewingEvents + collections.work_ids + series.member_ids 的引用，且 D1 与 IndexedDB 双端各跑一次，收益只是「ID 好看」，风险远大于收益。

### C.2 数据模型调整（全部为增量，不删任何旧字段）

**Work —— 新增 4 个字段，其余不动**

```js
{
  // …现有字段全部保留…

  external_refs: [                          // 改为按 source upsert，不再整体覆盖
    { source: "bangumi", id: "123", url: "…" },
    { source: "tmdb",    id: "194662", url: "…" },
    { source: "imdb",    id: "tt2562232" },   // TMDB external_ids 顺手拿到就存
  ],

  primary_source: "bangumi" | "tmdb" | null,  // ← 新增：preferred source，不是身份
  poster: { source: "bangumi", subject_id: 123 }
        | { source: "tmdb", path: "/xxx.jpg" }
        | null,                               // ← 新增；poster_subject_id 保留双写
  runtime_minutes: null,                      // ← 新增（TMDB 有则填）
  genres: [],                                 // ← 新增（TMDB 有则填）
}
```

- `identity_status` 的语义**扩展**为「已关联任一外部源」，不再等同于 Bangumi
- `work_type` **不由 TMDB 自动推断**（见 B.6），保持 `unspecified` 让用户在作品页认领
- 「是否已看」**不新增字段**，由 `records.length > 0 || viewingEvents.length > 0` 派生（老数据里有 record 无 event 的情况必须算「已看」）

**Collection —— `work_ids` 升级为 `entries`，双写兼容**

```js
{
  id, title, description, created_at, updated_at,

  entries: [                       // ← 新增，权威数据
    {
      work_id:        "work_xxx",
      added_at:       "2026-08-08T…",
      reason:         "重看《蜘蛛侠：英雄归来》后觉得 Michael Keaton 的秃鹫很好",
      source_work_id: "work_bgm_456" | null   // ← §17 Discovery Context 预留，本阶段只写不展示
    }
  ],

  work_ids: ["work_xxx"]           // ← 保留！从 entries 派生的镜像，写入时同步维护
}
```

- `work_ids` 保留是**向后兼容的关键**：旧版前端（另一台设备的缓存 PWA）读它仍然正常
- 排序 = `entries` 的数组顺序，直接照抄 `library.js moveWorkInSeries()` 的实现

### C.3 数据源抽象

新增 `src/work-search.js`，定义**统一候选模型**（两个源都归一化到它）：

```js
{
  source: "local" | "bangumi" | "tmdb",
  sourceId: "123",
  workId: "work_xxx" | null,        // source === "local" 时有值
  title, originalTitle,
  year: 2014 | null,
  mediaType: "movie" | "anime" | "tv" | "unknown",
  posterRef: { source, subject_id|path } | null,
  summary,
  externalIds: { bangumi?, tmdb?, imdb? }
}
```

`src/tmdb.js` 与 `src/bangumi.js` **完全对称**（纯函数、可 Node 单测、不碰 DOM/网络）：
`buildTmdbSearchRequest / normalizeTmdbMovies / normalizeTmdbDetail / buildTmdbPosterUrl`。

数据源只是 `primary_source`，**不参与作品身份判断**。

### C.4 搜索流程

```
用户输入
  ↓ 立即：本地搜索（内存过滤 state.works，标题 + aliases + normalizeTitle）→ 0 延迟渲染「已在你的库里」分组
  ↓ debounce 350ms，且 query.length >= 2
  ↓ Promise.allSettled([bangumiSearch, tmdbSearch])   ← 两源并行，任一失败不阻塞另一个
  ↓ 折叠去重：
      ① 候选的 external id 命中本地 work.external_refs → 丢弃候选，用本地条目替代
      ② bangumi 候选 vs tmdb 候选：normalizeTitle(original_title) 相同 且 年份差 ≤1
         → 【只标记「可能是同一部」，不自动合并】，两条都展示，让用户选
  ↓ 渲染：本地组 → 外部组（排序：标题完全匹配 > 年份 > 源优先级）
```

关于「谁是主源」：**第一阶段两源都发，UI 不向用户暴露来源选择**。理由——启发式猜主源一旦猜错，用户会遇到「搜不到」这种最糟的体验；两源并行每次搜索只多一个上游请求，成本可控。源的差异只体现在**排序权重**上（查询含假名/日文 → Bangumi 结果靠前；含拉丁字母/年份 → TMDB 靠前）。

必须落实的工程细节（§11）：

- `limit` 从 Bangumi 现在的 **3 提到 10**（片单搜索场景 3 条远远不够）
- debounce 350ms + 最小 2 字符 + `AbortController` 取消上一次请求
- 复用现有的 24h Worker 内存缓存模式和 6s `AbortSignal.timeout`
- 四种状态齐全：loading / empty（「没有找到，可以先按标题手动创建」）/ error（分源提示：「Bangumi 暂时不可用，以下是 TMDB 结果」）/ 已在库中

### C.5 片单添加流程（一次完成，不要求先「导入作品」）

```
片单详情页 →「＋ 添加作品」
  → 统一搜索面板（C.4）
  → 选中一条候选
  → 同一面板内出现可选的「为什么想看」备注框 + 「加入片单」按钮
  → 提交时执行 resolveOrCreateWorkFromCandidate(candidate)：
       ① candidate.source === "local"           → 直接用该 work
       ② external ref 命中已有 work             → 用该 work，并 upsert 缺失的 ref
       ③ 都不命中                                → 新建 Work（UUID）+ 落 metadata 快照
                                                   （不创建任何 Record / ViewingEvent）
  → addEntryToCollection(collection, { work_id, reason, added_at })
  → db.put("collections", …) + 必要时 db.put("works", …)
```

作品页的「＋ 加入片单」路径**完全保留**，只是在写入时改走 entry 结构。

### C.6 Migration 方案（**推荐惰性迁移，不 bump `MIGRATION_VERSION`**）

在 `src/library.js` 新增两个幂等归一化函数，在**读取时**调用：

```js
normalizeCollection(collection)  // work_ids[] → entries[]（added_at 回落 created_at，reason 空）
                                 // 同时保证 work_ids 与 entries 一致
normalizeWork(work)              // external_refs 去重；poster 从 poster_subject_id 回填
```

调用点：`loadState()` 读完 `collections`/`works` 后各跑一次 map。
写入时：`addEntryToCollection` 等函数同时维护 `entries` 和 `work_ids`。

**为什么优于 bump `MIGRATION_VERSION`：**

| | 惰性迁移 | bump MIGRATION_VERSION |
|---|---|---|
| 强制备份下载弹窗 | 无 | **有**（手机上体验很差） |
| 全量重写 works/records/events | 不需要 | 需要 |
| 云端/本地双端一致性 | 任一端打开即自愈 | 需两端各跑一次 |
| 失败影响面 | 单条文档 | 全库 |
| 旧字段保留 | 是 | 是 |

`src/migrate.js` **完全不改**（仍作为历史数据去重的兜底）。

需要变更的其他配置：

- `.dev.vars.example`：新增 `TMDB_API_KEY=` / `TMDB_ACCESS_TOKEN=` / `TMDB_LANGUAGE=zh-CN`
- 图片代理：**新建** `functions/api/tmdb/image.js`（白名单 `image.tmdb.org`），不动已经跑得很稳的 `bangumi/image.js`
- `server.mjs` 本地路由表补上新端点

### C.7 UI 调整范围

| 位置 | 改动 | 幅度 |
|---|---|---|
| `renderCollection()` | ＋添加作品按钮；每条显示 reason；已看/未看角标；移除按钮；上下移 | 中 |
| `renderCollections()` | 新建表单加 description；每行加「编辑」 | 小 |
| 新增 `workSearchOverlay()` | 统一搜索面板（复用 `overlay` 机制） | **新增，最大块** |
| 新增 `collectionEditorOverlay()` | 改标题/描述 | 小 |
| `fabActionsFor()` | 片单详情页加「添加作品」「编辑片单」 | 小 |
| `shelfPosterMarkup()` / `workHeroMarkup()` | 抽出 `posterUrlFor(work)`，支持 bangumi/tmdb 双源 | 小但触点多 |
| `renderShelf()` | **默认过滤未观看作品**；筛选栏加「想看」chip 可切换 | 中（见 B.2） |
| 作品页 | 未看状态的空状态文案；「补充记录」→「记录这次观看」 | 小 |
| `collectionsEditorOverlay()` | 写入改走 entry | 小 |
| `export.js` | 片单（含 reason）纳入全量导出 | 小（见 B.9） |

---

## D. 文件级修改计划

### D.1 新增文件

| 文件 | 用途 | 依赖 |
|---|---|---|
| `src/tmdb.js` | TMDB 纯函数层，**结构完全对称于 `src/bangumi.js`** | 无 |
| `src/work-search.js` | 统一候选模型、本地搜索、跨源折叠去重、排序。**纯函数，不碰 DOM/网络** | `domain.js`（normalizeTitle） |
| `functions/api/tmdb/search.js` | 代理 `/3/search/movie`，24h 内存缓存，照抄 `bangumi/search.js` 骨架 | `src/tmdb.js` |
| `functions/api/tmdb/movie.js` | 代理 `/3/movie/{id}?append_to_response=external_ids,credits`，只提取需要的字段 | `src/tmdb.js` |
| `functions/api/tmdb/image.js` | 图片代理，白名单 `image.tmdb.org`。**照抄 `bangumi/image.js` 的全部安全逻辑** | `src/tmdb.js` |
| `tests/tmdb.test.mjs` | 对称于 `tests/bangumi.test.mjs` | |
| `tests/work-search.test.mjs` | 折叠去重、排序、跨源冲突检测 | |

### D.2 修改文件

| 文件 | 为什么改 | 风险 |
|---|---|---|
| `src/library.js` | ① `entries` 结构的增删改查纯函数；② `normalizeCollection()` 惰性迁移；③ **`collectionWorks()` 改用 `findWorkById()` 以感知 `merged_from`**（既存隐患，见 B.5） | 低（纯函数，有测试） |
| `src/domain.js` | ① `workIdFor()` 新建走 UUID；② `promoteWorkToMatched()` 停止改 id + `external_refs` 改 upsert；③ `resolveWork()` 扩展多源查重；④ 新增 `createWorkFromCandidate()`（不带 Record 的 Work 工厂） | **中—高**，核心模块，必须先补测试 |
| `src/work-view.js` | `summarizeWorksForShelf()` 增加 `isWatched` 派生；`filterShelfEntries()` 增加「想看」维度 | 低（纯函数，有测试） |
| `src/app.js` | 搜索面板、片单页改造、海报双源、FAB、事件分发、`loadState()` 里加归一化 | **中**，4150 行，改动要按区块隔离 |
| `src/export.js` | 片单纳入全量导出 | 低 |
| `functions/api/bangumi/search.js` | **只改一处**：`limit=3` → `limit=10` | 极低 |
| `src/bangumi.js` | 同上（`buildBangumiSearchRequest` 里的 limit） | 极低 |
| `server.mjs` | 本地开发路由表补 tmdb 三个端点 | 极低 |
| `.dev.vars.example` | TMDB 环境变量说明 | 无 |
| `tests/library.test.mjs`、`tests/domain.test.mjs`、`tests/work-view.test.mjs` | 补测试 | — |

### D.3 应当复用、**不要重写**的现有模块

- ✅ `src/db.js` 的 `cloudOp()` 云端/本地双路由 —— 本方案不新增 store，`db.js` **一行都不用改**
- ✅ `functions/api/bangumi/image.js` 的安全逻辑（手动 redirect、host 白名单、size/type 校验）—— TMDB 图片代理**照抄，不发明新写法**
- ✅ `functions/_middleware.js` 的 `ACCESS_PASSWORD` 校验 —— 新端点自动被覆盖，无需改动
- ✅ `src/migrate.js` 的九步迁移 + 备份优先 —— **完全不动**
- ✅ `domain.js assignViewingRelations()` 初看/重看推定 + `app.js fetchWorkEvents()` 的 `merged_from` 感知 —— 红线逻辑，不碰
- ✅ `confirmWorkMatch()` 的合并/级联重写代码 —— 历史数据仍需要它，保留
- ✅ `library.js moveWorkInSeries()` —— 片单排序直接照抄
- ✅ `routing.js` + 手势系统 + `render()` 三段缓存 —— R5 踩过坑，绝对不动
- ✅ `collectionsEditorOverlay()`、`renderCollections()` 的既有骨架 —— 增量改，不重写

### D.4 绝对不应推倒重写的三件事

1. **Work ID 全量重编号** —— 见 C.1，风险远大于收益
2. **把 collections 拆成独立的 `watchlist_entries` store** —— 需要动 `db.js` STORES + `DB_VERSION` bump + 两处 D1 白名单 + 迁移，而 entries 内嵌在 collection 文档里完全够用（一个片单几十条，不是几万条）
3. **重写 Bangumi 接入层去「统一」两个源** —— 两个 `src/*.js` 纯函数模块并列、各自归一化到统一候选模型即可，不需要抽象基类

---

## E. 实施顺序（低风险优先，每步可独立验证、可独立回滚）

| 步骤 | 内容 | 验收 | 风险 |
|---|---|---|---|
| **0** | 手动导出一份全量 JSON 备份；`npm test` 全绿基线 | 备份文件在手 | — |
| **1** | **纯函数层：片单 entry 结构 + 惰性迁移**。`library.js` 加 entries CRUD、`normalizeCollection()`、修 `collectionWorks()` 的 merged_from 隐患。**不接 UI** | `tests/library.test.mjs` 通过；旧 `work_ids` 数据能幂等升级 | 低 |
| **2** | **接线到现有 UI**：`loadState()` 归一化、现有加入/移出路径改走 entries（双写 `work_ids`）。此时功能表现与现在完全一致 | 现有片单功能零回归 | 低 |
| **3** | **片单页补齐**：添加/移除/排序/编辑/reason 展示/已看未看角标。**此时作品仍只能从已有库里选**（用本地搜索） | 片单变成完整的 CRUD | 低 |
| **4** | **Work 身份重构**：`domain.js` 的 UUID 新建、`promoteWorkToMatched` 停止改 id、`external_refs` upsert、`resolveWork` 多源。**先只接 Bangumi**，验证 §14 打通（片单加入 Bangumi 作品 → 观影后捕获 → 命中同一 Work） | `tests/domain.test.mjs`；端到端手测 §14 | **中—高**，本次最需要小心的一步 |
| **5** | **书架隔离**：`summarizeWorksForShelf` 加 `isWatched`，书架默认过滤未看，加「想看」chip | 未看作品不污染书架排序 | 低 |
| **6** | **TMDB 接入（只读）**：`src/tmdb.js` + 三个 Functions 端点 + 海报双源。先只做「搜索能出结果、海报能显示」，**不接入创建流程** | 搜索面板能列出 TMDB 结果 | 中 |
| **7** | **统一搜索 + 一次完成的添加**：`work-search.js` 折叠去重、debounce/取消/四态、`resolveOrCreateWorkFromCandidate()`、reason 输入 | §10 §11 完整验收 | 中 |
| **8** | **收尾**：片单纳入导出；跨源「可能是同一部」提示（只提示不自动合并）；作品页未看状态文案 | | 低 |

**建议合并发布点**：步骤 1–3 可作为一次独立发布（片单功能完整化，零外部依赖变更）；4–5 一次；6–8 一次。

---

## 需要你拍板的三个决策

1. **Work ID 策略** —— 推荐 C.1 方案 A（历史 ID 不动、新建 UUID、停止 ID 变更）。是否确认？
2. **未看作品在「作品书架」里怎么处理** —— 推荐默认隐藏 + 加「想看」筛选 chip。也可以选「和已看混排但加角标」。
3. **搜索时两源并行 vs 按查询猜主源** —— 推荐两源并行、只在排序上体现差异，不向用户暴露来源选择。
