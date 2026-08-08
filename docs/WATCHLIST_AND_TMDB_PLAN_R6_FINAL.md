# R6 · 最终实施方案（清库前提 · 简化版）

> 取代 `WATCHLIST_AND_TMDB_AUDIT_R6.md` 的 C / D / E 三章。
> A（当前实现）与 B（差距分析）两章仍然有效，继续参考。
>
> **前提变更**：App 处于开发测试阶段，现有数据全部是测试数据，**不需要历史兼容**。
> 因此以下内容全部**删除**，不再出现在方案里：
> ~~历史 Work ID 保留~~ · ~~`entries[] + work_ids[]` 双写~~ · ~~惰性 migration~~ · ~~旧版 PWA 兼容分支~~

---

## 0. 简化后的净效果

| 原方案 | 最终方案 | 省掉的东西 |
|---|---|---|
| 历史 ID 保留 + 新建 UUID 两套风格并存 | **Work.id 一律 `work_<ts>_<rand>`，永不变更** | 两套 ID 风格、ID 变更链路的新增分支 |
| `entries[]` + `work_ids[]` 永久双写 | **`entries[]` 唯一权威** | 所有增删排序的双份维护 |
| `normalizeCollection()` / `normalizeWork()` 惰性迁移 | **不需要**（清库重建） | 两个归一化函数 + 每次 loadState 的 map 开销 |
| 书架"默认隐藏未看" | **书架 = 全部 Work 总库，用状态筛选区分** | 特殊隐藏规则 |
| 8 个实施步骤 | **7 个 Phase**，Phase 0 清库 | 兼容性验证步骤 |

---

## 1. 数据模型（最终形态）

### Work

```js
{
  id: "work_m2x8k1_a7f3q9",     // 永久内部 ID，创建后任何情况都不再变更
  title, original_title, aliases: [],
  work_type: "animation_film" | "live_action_film" | "event" | "other" | "unspecified",
  release_year,
  release_dates: { entries: [{ id, region, date, source }] },   // R5 结构不变

  external_refs: [                          // 按 source upsert，绝不整体覆盖
    { source: "bangumi", id: "123",     url: "https://bangumi.tv/subject/123" },
    { source: "tmdb",    id: "194662",  url: "https://www.themoviedb.org/movie/194662" },
    { source: "imdb",    id: "tt2562232" }
  ],
  primary_source: "bangumi" | "tmdb" | null,        // 只是 preferred source，不是身份
  poster: { source: "bangumi", subject_id: 123 } | { source: "tmdb", path: "/x.jpg" } | null,
  runtime_minutes, genres: [],

  identity_status: "local_only" | "matched",        // 语义扩展为「已关联任一外部源」
  related_refs: [], tagline, summary,
  merged_from: [],                                   // 保留（见 §2.3）
  first_recorded_at,                                 // 首次进入个人数据库的时间（§10）
  match: { ... }                                     // 不变
}
```

**删除的字段**：`work_id`（与 `id` 完全冗余）、`poster_subject_id`（由 `poster` 取代）。

### Collection

```js
{
  id, title, description, created_at, updated_at,
  entries: [                                   // 唯一权威数据，数组顺序即展示顺序
    { work_id, added_at, reason, source_work_id }
  ]
}
```

**没有 `work_ids[]`。**

### Record / ViewingEvent / Series

**完全不动。**

---

## 2. 关键设计决定

### 2.1 Work.id 永不变更

`workIdFor()` 退化为 `createId("work")`，不再接受 `subjectId`。
`promoteWorkToMatched()` 不再计算新 id、不再写 `merged_from`，只做：`external_refs` upsert + `identity_status` + 元数据填充 + `poster` + `primary_source`。

**连带简化**：`app.js confirmWorkMatch()` 里那段「新 id 撞上已有 work → mergeWorks → 遍历重写 records/events → 删旧行」的级联，**触发条件从「id 冲突」改为「external ref 冲突」**——即用户把 Work A 匹配到 bangumi:123，而 Work B 已经持有 bangumi:123。这是真正的重复作品，仍然必须合并。代码保留，但从「每次升格都可能触发」变成「罕见路径」。

### 2.2 `first_recorded_at` 的语义正式确定

= **这个 Work 第一次进入我的记忆系统的时间**，不是首次观看时间。
观影后建卡与片单加入建卡**都**写它；后续加入其他片单、后续观看都不修改它。（§10）

### 2.3 `merged_from` 保留，但不再有自动写入者

理由：§9 明确要求「跨源疑似同一作品只提示不自动合并」，即**将来一定会有用户确认后的手动合并**，那时仍需要 `merged_from` 让旧引用不失效。
读路径（`findWorkById` / `fetchWorkEvents` / `db.getRecordsByWork` / `summarizeWorksForShelf`）**原样保留，一行不改**，已有测试继续覆盖。写入者只剩 §2.1 的 external-ref 冲突合并。

### 2.4 `src/migrate.js` 完全不动

清库后它对空库跑一次、写个 meta 就结束。
⚠️ 但要记一笔：`buildMigratedDataset()` 里的 `groupWorks()` 按标题相似度贪心分组，**如果将来 bump `MIGRATION_VERSION`，两部标题相近的未看作品可能被错误合并**。本次不 bump，后续要 bump 时必须先处理这一点。

### 2.5 清库执行方式

代码里已经有现成入口，不需要新写：

- `?reset` → `clearLocalData()`（本地 IndexedDB 全清；开了云端同步则调 `/api/sync/clear` 清 D1）
- `?clean` → `ensureSeedData()` 跳过播种

⚠️ **坑**：`?reset` 分支里的 `history.replaceState({}, "", location.pathname)` 会把查询串抹掉，而 `ensureSeedData()` 是在之后的 `loadState()` 里读 `location.search` 的 —— 所以 **`?reset` 之后 demo 种子数据会自动长回来**。

**处理**：本次顺手**删除 `publicSeedRecords()` 与 `ensureSeedData()`**。理由：这是个人使用的 App，两条 demo 记录（《穿越时空的少女》《雨中的车站》）在新数据模型下只会污染书架和片单，且清库后必然复活。删掉比修 `?clean` 传递逻辑更干净。

### 2.6 书架 = 全部 Work 总库（§4–§8）

**第一排**（作品属性）：`全部 / 动画电影 / 真人电影 / 活动 / 未分类` —— **不动**。

**第二排**：`[已看 ▾] [最近观看 ▾] [特别场次]`

- 两个下拉用**原生 `<select>`**（styled as chip）。理由：手机上直接调起系统 picker，不引入任何新的浮层／手势交互，绕开 R5 记录过的「手势吃掉 click」和 `render()` 三段缓存导致的焦点丢失问题。
- 观看状态定义：
  - **已看** = 存在 ViewingEvent **或** 存在 Record
  - **想看** = 无 ViewingEvent 且无 Record，**且**至少属于一个 Collection
  - **全部** = 全部 Work
- 默认 `已看`。
- **想看状态下**（§10）：隐藏排序下拉与「特别场次」，固定按 `first_recorded_at` 排序。因为最近观看／最多观看／特别场次在无观看记录时全部无意义，而首次记录仍然有效。
- **不为想看发明任何新排序体系**（§9）。

### 2.7 TMDB 的 `work_type`（§12）

按可靠信息判断，判断不了才 `unspecified`：

| 条件 | 判定 |
|---|---|
| TMDB `genre_ids` 含 16（Animation） | `animation_film` |
| 已有 bangumi ref 且 bangumi type = anime | `animation_film` |
| TMDB 有 `origin_country` 且非动画类型明确 | `live_action_film` |
| 其余 | `unspecified`（用户在作品页认领） |

红线：**绝不因为 TMDB 的 media_type = movie 就判 `live_action_film`**。

### 2.8 搜索策略（§11，保持原结论）

本地立即搜 → debounce 350ms + 最少 2 字符 + `AbortController` → Bangumi 与 TMDB `Promise.allSettled` 并行 → 折叠去重（相同 external id 必须去重；跨源疑似只提示不合并）→ 本地优先排序。
不做「该搜哪个源」的启发式。Bangumi `limit` 由 3 提到 10。

---

## 3. 文件级修改计划

### 新增

| 文件 | 用途 |
|---|---|
| `src/tmdb.js` | TMDB 纯函数层，结构对称于 `src/bangumi.js` |
| `src/work-search.js` | 统一候选模型、本地搜索、跨源折叠去重、排序 |
| `functions/api/tmdb/search.js` | 代理 `/3/search/movie`，24h 内存缓存 |
| `functions/api/tmdb/movie.js` | 代理 `/3/movie/{id}?append_to_response=external_ids` |
| `functions/api/tmdb/image.js` | 图片代理，白名单 `image.tmdb.org`，安全逻辑照抄 `bangumi/image.js` |
| `tests/tmdb.test.mjs`、`tests/work-search.test.mjs` | 新增测试 |

### 修改

| 文件 | 改什么 | 风险 |
|---|---|---|
| `src/domain.js` | `workIdFor` → UUID；`resolveWork` 多源；`promoteWorkToMatched` 不改 id + upsert；新增 `createWorkFromCandidate` / `upsertExternalRef` / `findWorkByExternalRef` | 中，核心模块 |
| `src/library.js` | Collection 改 `entries[]`；新增 `addEntryToCollection` / `removeEntry` / `moveEntry` / `updateEntryReason`；`collectionWorks` 走 `findWorkById` | 低（纯函数） |
| `src/work-view.js` | `summarizeWorksForShelf` 派生 `isWatched` / `inCollection`；`filterShelfEntries` 加 `watchStatus` | 低（纯函数） |
| `src/app.js` | 片单页 CRUD + reason + 状态角标；书架第二排；搜索面板；海报双源；删 seed | 中，按区块隔离改 |
| `src/export.js` | 片单纳入全量导出 | 低 |
| `src/bangumi.js` | `limit` 3→10；删死代码 `applyBangumiCandidateToWork` | 极低 |
| `functions/api/bangumi/search.js` | 无（limit 在 `src/bangumi.js` 里） | — |
| `server.mjs` | 补 tmdb 三个端点的本地路由 | 极低 |
| `.dev.vars.example` | `TMDB_API_KEY` / `TMDB_LANGUAGE` | 无 |
| `tests/domain / library / work-view / bangumi.test.mjs` | 随实现更新 | — |

### 不动（复用，绝不重写）

`src/db.js`（不新增 store，一行不改）· `src/migrate.js` · `functions/api/bangumi/*`（图片代理的安全逻辑照抄给 TMDB）· `functions/_middleware.js` · `assignViewingRelations` · `fetchWorkEvents` 的 merged_from 感知 · `routing.js` · 手势系统 · `render()` 三段缓存 · `library.js` 的 Series 全部逻辑

---

## 4. 实施顺序

| Phase | 内容 | 验收 |
|---|---|---|
| **0** | 手动导出 JSON 备份；`npm test` 全绿基线（当前 318 通过） | 备份在手 |
| **1** | `domain.js` Work 身份重构 + 测试 | `tests/domain.test.mjs` |
| **2** | `library.js` Collection entries + 测试 | `tests/library.test.mjs` |
| **3** | `work-view.js` 书架观看状态 + 测试 | `tests/work-view.test.mjs` |
| **4** | `app.js` 接线：片单页 CRUD、书架两排筛选、删 seed、清库 | 手测；片单功能完整 |
| **5** | TMDB：`src/tmdb.js` + 三个端点 + 海报双源 + `server.mjs` | `tests/tmdb.test.mjs`；搜索出结果、海报能显示 |
| **6** | 统一搜索 + 一次完成添加（`work-search.js` + overlay） | `tests/work-search.test.mjs`；§10/§11/§14 端到端 |
| **7** | 导出纳入片单；跨源疑似提示；未看作品页文案；全量回归 | `npm test` 全绿 |

Phase 1–4 完成即可发布一次（片单功能完整化，无外部依赖变更）；5–7 一次。

**§14 端到端验收用例**（Phase 6 后必测）：

```
搜索 Birdman（TMDB）→ 加入「Michael Keaton 补片」并写 reason
  → 书架「想看」里出现 Birdman，first_recorded_at = 今天
  → 走捕获流程记录一次观看（标题填「鸟人」）
  → 断言：works 里仍然只有 1 个 Birdman，id 未变
  → 书架「已看」里出现，「想看」里消失
  → 片单里 Birdman 仍在，reason 仍在，显示「已看」
```
