# R6 · 片单独立化（观影前备忘录）+ TMDB 第二数据源

本轮起因是片单的一个核心逻辑问题：R5 建的片单只能从**已经存在于 App 中的作品**里挑，
而 App 里的作品几乎都是"看完电影写感想"时顺带产生的。于是「作品存在于 App 中」事实上
等价于「用户已经看过它」——而补片片单本质上是一个**观影前**行为。

> 举例：重看《蜘蛛侠：英雄归来》后觉得 Michael Keaton 的秃鹫非常不错，想补他的
> 《鸟人》《聚焦》《大创业家》。这三部都还没看过，当然也不在数据库里，但我现在就想
> 建一个「Michael Keaton 补片」把它们放进去。

配套的第二件事：Bangumi 对日本动画的数据质量很好，但真人电影、欧美电影覆盖不足，
所以新增 TMDB 作为**第二数据源**——不是替换，是共存。

---

## ⚠️ 数据基线声明（重要，后续开发请先读这一段）

**R6 是测试阶段最后一次允许破坏旧数据兼容的数据模型重整。**

本轮直接删除了旧的 Work ID 风格、旧的 `collection.work_ids[]` 结构与演示种子数据，
没有写任何兼容分支或惰性迁移——前提是当时库里全是开发测试数据，清空重建的成本
远低于为几条测试条目背上长期技术债。

**R6 清库之后产生的数据，应视为正式的新基线。**

此后的任何修改，原则上都需要：

1. 明确说明会不会影响已有数据；
2. 需要改数据形状时，优先设计**向后兼容**的方案（新增字段、读取时归一化），
   而不是"反正清库重来"；
3. 确实必须做破坏性变更时，先给出迁移方案与风险说明，并保证迁移前自动备份
   （`src/migrate.js` 的九步流程已经内建"备份失败则终止迁移"这条约束，继续沿用）。

即：R6 之前"清库重来"是被允许的默认选项，R6 之后不再是。

---

## 1. Work 身份：内部 ID 与外部标识彻底分离

### 问题

R1～R5 的 `workIdFor()` 是这样的：

```js
if (subjectId) return `work_bgm_${subjectId}`;   // Bangumi ID 被编码进了主键
return `work_local_${slugify(normalizeTitle(title))}`;
```

于是「匹配到 Bangumi」就等于「主键变更」，`promoteWorkToMatched()` 会把 `work.id`
从 `work_local_xxx` 改成 `work_bgm_1309`，然后调用方必须手工做一整套级联：检测新 id
是否撞上已有 work → 合并 → 遍历所有 records 改 `work_id` → 拉所有 viewingEvents 改
`work_id` 并重跑 `assignViewingRelations` → 物理删除旧 work 行 → 修正内存 state。

这条链路在项目历史上**已经出过两次线上 bug**，代码注释里都留着记录：
`src/migrate.js` 的 `r1-work-dedup-2`、以及 `app.js confirmWorkMatch()` 里那段
"书架里同一部电影出现两个条目，一个有海报有记录、另一个只剩标题"的说明。
加入 TMDB 后组合数还会翻倍（local→bgm、local→tmdb、bgm+tmdb 互认…）。

### 做法

**Work.id = App 自己生成的永久内部 ID，创建后任何情况都不再变更。**

```js
export function workIdFor() {
  return createId("work");        // work_m2x8k1_a7f3q9
}
```

Bangumi / TMDB / IMDb / Wikidata 全部只是 external references：

```js
external_refs: [
  { source: "bangumi", id: "150775", url: "https://bangumi.tv/subject/150775" },
  { source: "tmdb",    id: "372058", url: "https://www.themoviedb.org/movie/372058" },
  { source: "imdb",    id: "tt5311514" }
]
```

`promoteWorkToMatched()` 现在只做「增加一条 external_ref + 填元数据」，不碰 id、
不写 `merged_from`。

### 连带简化

`confirmWorkMatch()` 的合并逻辑**触发条件从「id 冲突」改成「external ref 冲突」**——
即用户把 Work A 匹配到 bangumi:123，而 Work B 早就持有 bangumi:123。这才是真正的
重复作品（R6 §9：相同 bangumi_id 不得产生两个 Work）。代码保留，但从"每次匹配都
可能触发"变成罕见路径。

`merged_from` 字段与全部读路径（`findWorkById` / `fetchWorkEvents` /
`db.getRecordsByWork` / `summarizeWorksForShelf` / `collectionWorkEntries`）**原样保留**：
将来跨源重复作品被用户确认合并时仍然需要它，让旧引用不失效。

### 新增：观影前建卡的入口

```js
createWorkFromCandidate(candidate, now)   // src/domain.js
```

从一条搜索候选直接建 Work，**不产生任何 Record / ViewingEvent**。

在此之前全项目唯一的 Work 落库函数是 `db.putRecordWithWork(record, work)`——两者在
同一个事务里强绑定写入，这正是"作品存在 = 已经看过"这个隐含前提的物理来源。

### 字段变化

| 字段 | 变化 |
|---|---|
| `id` | 永久内部 ID，不再含外部数据源信息 |
| `work_id` | **删除**（与 `id` 完全冗余） |
| `poster_subject_id` | **删除**，由 `poster` 取代 |
| `poster` | 新增：`{source:"bangumi", subject_id}` 或 `{source:"tmdb", path}` |
| `primary_source` | 新增：preferred source，**不是作品身份** |
| `runtime_minutes` / `genres` | 新增（TMDB 详情能拿到时才填） |
| `external_refs` | 语义变更：按 source **upsert**，不再整体覆盖 |
| `identity_status` | 语义扩展为「已关联任一外部源」，不再专指 Bangumi |
| `first_recorded_at` | 语义**明确**：见下节 |

### `first_recorded_at` 的语义正式确定

= **这个 Work 第一次进入我的记忆系统的时间**，不是首次观看时间。

```
8/8   因为 Michael Keaton 把 Birdman 加进片单 → first_recorded_at = 8/8
8/20  又把它加进另一个片单                    → 不变
9/5   真正看了，新增 ViewingEvent              → 仍然是 8/8
```

观影后建卡与观影前从片单建卡**都**写它。这也是书架「首次记录」排序在"想看"状态下
依然成立的依据。

---

## 2. 片单：`entries[]` 承载语境

### 问题

R5 的结构是 `work_ids: string[]`——只是一串 ID，装不下"我当时为什么想看这部电影"。

而片单实际上还承担备忘录功能，且**理由属于条目而不是作品**：同一部《鸟人》在
「Michael Keaton 补片」里的理由是"重看《英雄归来》后觉得他的秃鹫很好"，在
「2010 年代补片」里可能是"补奥斯卡最佳影片"。

### 做法

```js
Collection {
  id, title, description, created_at, updated_at,
  entries: [
    { work_id, added_at, reason, source_work_id }
  ]
}
```

`entries[]` 是**唯一权威数据，没有 `work_ids[]` 镜像**。双写会让此后所有增删排序都要
维护两份数据，是确定的技术债。

`source_work_id` 是 §17 Discovery Context 的预留字段——"从哪部作品发现的"。
本阶段**只存不展示**，不做知识图谱、不做关系图 UI、不做演员→作品自动关联。

### 「是否已看」绝不存进条目

由 `isWorkWatched(workId)` 从 Work 是否存在观影记录实时派生：

```js
有 ViewingEvent || 有 Record        // 两者取或
```

取或而不是只看 Event，是因为「补充记录」这类 record 本来就不产生 ViewingEvent，
只看 Event 会把确实看过的作品误判成没看过。

于是同一部《鸟人》同时在三个片单里时，看完之后三个片单**同时**翻转成"已看"，
不需要分别去改三条条目。

**看完不自动删除条目**——片单本身也是"我过去对什么感兴趣、怎么发现它的"这段记录。

### 顺手修掉的一个既存隐患

R5 的 `collectionWorks()` 用裸 Map 按 id 查表。如果作品后来被合并，片单里存的旧 id
就查不到，条目会**凭空消失**。R6 的 `collectionWorkEntries()` 走 `merged_from` 回查。

### 新的片单 UI

片单详情页从"一个作品方格 + 一句叫你去作品页"改成列表条目：海报、标题年份、
已看/未看角标、加入理由、上移下移、移除，页内直接有「＋ 添加作品」。
FAB 增加「编辑片单信息」。片单列表页每行显示「N 部 · M 部未看」。

---

## 3. 书架 = 全部 Work 的统一总库

### 定位修正

书架不是"已观看作品专属列表"。两条路径产生的 Work 都属于书架：

```
观看作品 → 写感想 → 创建 Work → 进入书架
建立片单 → 搜索未看的作品 → 创建 Work → 加入片单 → 同时进入书架
```

区别只体现在筛选状态上。

### 三种观看状态

| 状态 | 定义 |
|---|---|
| 已看（默认） | 存在 ViewingEvent 或存在 Record |
| 想看 | 没有观影记录，**且**至少存在于一个片单中 |
| 全部 | 全部 Work |

「想看」要求 `inCollection`：一个既没看过、又不在任何片单里的 Work 只是数据库里的
孤立条目（例如匹配过程中的中间产物），只在"全部"里出现。

### 两排筛选是硬约束

第一排（作品属性）**不动**：`全部 / 动画电影 / 真人电影 / 活动 / 未分类`。

第二排原本是三个排序 chip + 特别场次共四个，再加观看状态会挤到第三排——手机上放不下。
改成：

```
[ 已看 ▾ ]  [ 最近观看 ▾ ]  [ 特别场次 ]
```

两个下拉用**原生 `<select>`**。理由：手机上直接调起系统 picker，不引入任何新的浮层，
绕开 R5 反复踩过的"手势层吃掉 click"以及 `render()` 三段缓存导致的焦点丢失。

**「特别场次」保持独立按钮，没有被降级成排序菜单里的一项**——它是为日本院线的
应援上映 / 舞台挨拶 / 声优登台这类场次而存在的，和排序完全不是一个维度。

### 「想看」状态下不发明新排序

最近观看、最多观看、特别场次在没有任何观影事件时全部无意义，这一档直接把排序下拉
和特别场次按钮**收起来**，固定按「首次记录」排。

也**不**增加"最近加入 / 最早加入 / 标题排序"这类仅为功能完整而存在的排序——对未看
作品真正有意义的是**为什么想看**，那由片单和 `entry.reason` 承担。书架的"想看"只是
所有未观看 Work 的统一总览入口，真正的组织与上下文留在片单里。

切到"想看"时 `state.shelfFilter.sort` 保持原值，切回"已看"仍是用户原来选的排序。

---

## 4. TMDB：第二数据源，不是替代

### 分工

| 数据源 | 更擅长 |
|---|---|
| Bangumi | 日本动画、动画电影、TV Anime、OVA / ONA |
| TMDB | 真人电影、欧美电影、日本真人电影、广义电影搜索 |

但**不把作品类型和数据源硬编码成一对一关系**——日本动画电影在 TMDB 上同样有条目。
数据源只是 `primary_source`，不构成作品身份。

### 新增文件

| 文件 | 说明 |
|---|---|
| `src/tmdb.js` | 纯函数层，结构刻意与 `src/bangumi.js` 对称 |
| `functions/api/tmdb/search.js` | `/3/search/movie` 代理，24h 内存缓存 |
| `functions/api/tmdb/movie.js` | `/3/movie/{id}?append_to_response=external_ids` |
| `functions/api/tmdb/image.js` | 海报代理 |

图片代理**照抄 `functions/api/bangumi/image.js` 的全部安全逻辑**，不发明新写法：
手动处理重定向（≤3 跳）并对每一跳重新校验 host、content-type 白名单、6MB 上限、
`nosniff` + same-origin CORP。

TMDB 特有的一点：上游 URL 由 `poster_path` 拼出来，所以 path 必须先过严格正则
（只允许「斜杠 + base62 文件名 + 扩展名」），否则 `/../..` 之类的输入能把请求引到
image.tmdb.org 上的任意路径。

密钥：`TMDB_ACCESS_TOKEN`（v4 bearer，推荐）或 `TMDB_API_KEY`（v3），二选一。
**都不配也不算错误**——搜索返回空候选，统一搜索面板照常展示 Bangumi 与本地结果，
不会整个报错。

### §12：作品类型推断的红线

**绝不能因为 TMDB 的 media_type 是 movie 就判成真人电影**——那样会把《你的名字。》
标成真人电影。分档：

| 条件 | 判定 |
|---|---|
| 类型含动画（genre 16） | `animation_film` |
| 有类型数据但不含 16 | `live_action_film` |
| 完全没有类型数据 | `unspecified`，由用户在作品页认领 |

原则：宁可暂时未分类，也不要误判。

> 这里在开发中被自己的测试抓到一个真 bug：`Number("") === 0` 且
> `Number.isInteger(0)` 为真，所以 `["", null]` 这种脏数据会被当成"有类型信息但
> 不是动画"，从而判成真人电影——正是要避免的那类误判。已改为要求 id > 0。

---

## 5. 统一作品搜索

用户不需要理解 Bangumi 和 TMDB 的区别，也不需要选「从哪里添加」，只有一个
「搜索作品」。

### 流程

```
输入
  ↓ 本地搜索立刻出（内存过滤 state.works，0 延迟，命中标题或任一别名）
  ↓ debounce 350ms + 最少 2 字符 + token 作废过期请求
  ↓ Promise.allSettled([Bangumi, TMDB])   ← 任一失败不阻塞另一个
  ↓ 折叠去重 → 跨源疑似标记 → 排序
  ↓ 选中候选 → 可选填写「为什么想看」→ 一次完成 Work 创建 + 片单条目创建
```

不要求用户先「导入作品」再回到片单添加。

### 去重与疑似判定（`src/work-search.js`）

**折叠只认 external id 精确相等**——候选命中本地某个 Work 的 `external_refs` 就折叠成
那条本地结果。标题相同不作数，同名电影太多。

**跨源疑似只打标记，绝不自动合并**：归一化后的原产地标题相同 且 年份差 ≤ 1
（不同地区上映常跨年）才判定；任一方缺年份则不判定。两条候选都照常展示，只在其中
提示一句「可能与列表中另一条是同一部」。

理由：同名不同片、重制版与原版、剧场版与 TV 版都会踩中"标题+年份"这类启发式，
自动合并的误判代价（两部不同电影被并成一个 Work，且要靠用户自己发现）远大于让用户
多点一次。

### 不做「该搜哪个源」的启发式

两个源都发请求，差异**只体现在排序权重**上：标题完全匹配 > 前缀匹配 > 日文查询让
Bangumi 靠前 / 拉丁字母让 TMDB 靠前 > 年份新→旧。猜主源一旦猜错，用户遇到的是
"搜不到"这种最糟的结果。

### 结果区局部重绘

搜索面板**不能走全量 `render()`**：`render()` 会整体重写 overlay 挂载点的 HTML，
输入框被重建，焦点与输入法组合状态全部丢失。所以只替换结果区的 DOM，仅在
「选中/取消选中候选」导致下方表单出现或消失时才整块重渲染，并手动恢复光标位置。

### §14 端到端闭环

```
搜索 Birdman（TMDB）→ 加入「Michael Keaton 补片」并写 reason
  → 书架「想看」出现 Birdman，first_recorded_at = 今天
  → 日后真正观看，捕获流程里填「鸟人」
  → 命中同一个 Work（别名匹配），id 未变，不产生第二个 Work
  → 书架「已看」出现，「想看」消失
  → 片单里 Birdman 仍在，reason 仍在，显示「已看」
```

`tests/domain.test.mjs` 与 `tests/work-view.test.mjs` 各有一条专门覆盖这个闭环的用例。

---

## 6. 片单纳入完整数据导出

本项目的核心命题是"长期可保存的个人记忆资产"，而片单条目的 `reason` 恰恰是**发现
过程**的记录。此前全量导出以 Record 为遍历起点，没有观影记录的作品和它们的加入理由
完全不会出现在任何导出物里，只存在于 IndexedDB / D1——这与产品定位相悖。

现在 JSON 与 Markdown 全量导出都带上片单，每条含 `title / watched / added_at /
reason / discovered_from / bangumi_id / tmdb_id / imdb_id`。

`watched` 是导出时现算的**快照**（由调用方注入 `isWorkWatched`），条目里依然不存
这个字段。导出 schema 升到 `movie-imprint-export-all-0.2`。

导出按钮的可用条件从「有记录」放宽到「有记录**或**有片单」——否则一个只建了补片
清单的新用户导不出任何东西。

---

## 7. 顺手清掉的历史包袱

| 项 | 说明 |
|---|---|
| 演示种子数据 | `publicSeedRecords()` / `ensureSeedData()` 删除。那是最初版本的测试文件，在新数据模型下只会污染书架和片单，而且 `?reset` 之后必然复活（`history.replaceState` 会抹掉查询串，`?clean` 传不进 `ensureSeedData`） |
| `applyBangumiCandidateToWork()` | 死代码，`app.js` 从未 import，只有测试在用；而且它产出的 `work_type` 是 `animation_movie`，与全项目其它地方的 `animation_film` 对不上 |
| Bangumi 搜索 `limit=3` | 提到 10。3 条对片单搜索场景远远不够 |
| `normalizeTmdbMovies` 的截断顺序 | 先过滤再截断。反过来的话前 10 条混进无效条目就会少给候选（Bangumi 那边的老实现就是这个顺序，limit=3 时不明显） |
| `server.mjs` 缺两个端点 | `/api/bangumi/subject` 与 `/api/ai/tagline` 此前只有生产实现，`npm run dev` 下作品页的「一句话简介」整块功能是坏的。本轮补齐，行为与对应 Pages Function 一致 |

---

## 数据与同步层改动

**没有新增 store。** 片单条目内嵌在 collection 文档里（一个片单几十条，不是几万条），
因此：

- `src/db.js` **一行未改**，`DB_VERSION` 保持 4
- `functions/api/sync/[store].js` 与 `[store]/[id].js` 的 ALLOWED 白名单未动
- D1 仍然只有 `store_entries(store, id, data)` 一张表，schemaless，零 DDL

`src/migrate.js` **完全未改**。清库后它对空库跑一次、写个 meta 就结束。

> ⚠️ 但要记一笔：`buildMigratedDataset()` 里的 `groupWorks()` 按标题相似度贪心分组。
> **如果将来 bump `MIGRATION_VERSION`，两部标题相近的未看作品可能被错误合并**——
> 未看作品是 R6 才出现的新物种，那套分组逻辑写的时候并不知道它们的存在。
> 下次要 bump 之前必须先处理这一点。

---

## 新增 / 改动的文件

### 新增

| 文件 | 说明 |
|---|---|
| `src/tmdb.js` | TMDB 纯函数层 |
| `src/work-search.js` | 统一候选模型、本地搜索、跨源折叠去重、排序 |
| `functions/api/tmdb/search.js` | TMDB 搜索代理 |
| `functions/api/tmdb/movie.js` | TMDB 详情代理 |
| `functions/api/tmdb/image.js` | TMDB 海报代理 |
| `tests/tmdb.test.mjs` | 14 例 |
| `tests/work-search.test.mjs` | 16 例 |
| `docs/WATCHLIST_AND_TMDB_AUDIT_R6.md` | 改动前的代码审计 |
| `docs/WATCHLIST_AND_TMDB_PLAN_R6_FINAL.md` | 最终实施方案 |

### 改动

| 文件 | 改了什么 |
|---|---|
| `src/domain.js` | 永久内部 ID；`upsertExternalRef` / `findWorkByExternalRef` / `workPosterRef` / `createWorkFromCandidate`；`resolveWork` 多源查重；`promoteWorkToMatched` 不改 id；`mergeWorks` 取 external_refs 并集 |
| `src/library.js` | Collection 改 `entries[]`；条目增删改排序纯函数；`collectionWorkEntries` 走 `merged_from` |
| `src/work-view.js` | `summarizeWorksForShelf` 派生 `isWatched` / `inCollection`；`filterShelfEntries` 加 `watchStatus`；`sortShelfEntries` 在 want 档强制 `first` |
| `src/app.js` | 片单页重做；书架第二排；统一搜索面板；海报多源分发；删种子数据；`confirmWorkMatch` 改判定条件 |
| `src/export.js` | `buildCollectionsExport` / `exportCollectionsMarkdown`；全量导出带片单 |
| `src/record-card.js` | `buildPosterUrl` 回调改为接收整个 work（多数据源） |
| `src/bangumi.js` | limit 3→10；删死代码 |
| `src/migrate.js` | `ensureWorkFields` 跟进新字段（`poster` / `primary_source` / `runtime_minutes` / `genres`） |
| `server.mjs` | TMDB 三端点 + 补齐 `bangumi/subject` 与 `ai/tagline` |
| `sw.js` | 海报离线缓存同时认 `/api/tmdb/image` |
| `styles/app.css` | 书架下拉、片单条目列表、搜索面板 |
| `index.html` / `sw.js` | 缓存版本号 bump（R6 改了多个模块的公开接口，不 bump 会让已安装 PWA 新旧模块混搭） |
| `.dev.vars.example` | TMDB 环境变量 |

---

## 测试与验证

**376 个测试全部通过**（R6 起点 318，新增 58）。

```
tests/domain.test.mjs        Work 身份、external_refs 共存、观影前→观影后闭环
tests/library.test.mjs       entries 结构、reason 归属条目、排序、merged_from 回查
tests/work-view.test.mjs     三种观看状态、两个维度正交、想看档排序、§14 状态翻转
tests/tmdb.test.mjs          类型推断红线、poster_path 路径穿越、归一化
tests/work-search.test.mjs   折叠去重、疑似只提示不合并、排序偏好
tests/export.test.mjs        片单导出、watched 快照、merged_from 回查
```

浏览器端冒烟测试**没能跑**：开发沙箱下载不到 Chromium，`scripts/visual-check.mjs`
依赖的 Playwright 浏览器装不上。改用两项静态一致性检查补位：

1. `src/app.js` 的每个具名 import 都对得上目标模块的实际导出；
2. 所有 `data-action` / `state.overlay` / `<form id>` 都有对应处理器；前端调用的每个
   `/api/*` 路径在生产（Pages Functions）与本地 dev（`server.mjs`）两侧都存在。

以及 `node server.mjs` 下的端点存活检查：非法输入一律 400（含
`/api/tmdb/image?path=/../../evil.jpg` 被正确挡下），静态资源与新模块 200。

**实机验证仍需人工过一遍**，重点是三处静态检查覆盖不到的地方：

- 搜索面板边打字边搜时输入框是否保持焦点（含中文输入法组合态）
- 书架两个原生 `<select>` 在手机上的实际观感与两排是否真的没被撑破
- 片单条目的上移/下移与手势层是否冲突
