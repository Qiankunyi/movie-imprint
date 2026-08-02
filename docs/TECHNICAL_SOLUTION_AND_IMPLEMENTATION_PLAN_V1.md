# 电影印记：技术方案与实施计划 v1

> **交互修订（2026-08-01）：** 架构、安全与数据管线结论保持不变；台前路由和页面实施以 [《以记录为中心的交互修订 v2》](INTERACTION_DESIGN_REVISION_V2.md) 为准。后台处理阶段不再一一对应用户页面。

- 状态：阶段 A 技术提案，待用户确认
- 日期：2026-08-01
- 范围：架构、数据流、安全边界、目录规划、风险与实施顺序
- 不包含：页面实现、生产环境开通、真实密钥配置
- 产品依据：`DEVELOPMENT_HANDOFF_V1.md` 及其中列出的全部产品、字段、原型、视觉与验证文档

---

## 1. 结论

推荐采用一套移动优先、单仓库、单语言的全栈方案：

```text
Android PWA（Next.js App Router + TypeScript）
  ├─ IndexedDB：未完成草稿、已脱敏票务结果、离线 outbox
  ├─ Service Worker：应用壳与静态资源；不缓存私人 API 响应
  └─ HTTPS / 用户主动操作
       ↓
Next.js 服务端边界（Vercel Node.js Runtime）
  ├─ 会话校验、请求限流、幂等控制
  ├─ OpenAI Responses API 代理
  ├─ Bangumi API 代理与缓存
  └─ GitHub App 短期令牌与主动同步
       ↓
Supabase Postgres + Auth
  ├─ 正式记录的日常主存储
  ├─ AI 草稿、人工确认与修订历史分层保存
  └─ RLS：即使未来增加用户，也按 owner 隔离

GitHub 私有数据仓库
  └─ 正式保存后由用户主动触发的 JSON / Markdown / TXT 备份
```

核心判断：

1. **应用数据库是日常主副本，GitHub 是用户拥有的可阅读备份。** 不采用 GitHub-only，也不采用浏览器-only。
2. **原始感想先落本机，再尝试网络。** AI、Bangumi、数据库或 GitHub 任一失败，都不能使原文丢失。
3. **票务与感想是两条隔离的数据管线。** 原始票务文本只在浏览器内存中处理；脱敏前不离开设备，确认后只保存非敏感场次字段。
4. **AI 只产生有证据、待确认的草稿。** 原文、AI 输出和人工确认结果分别保存，AI 永远没有直接正式保存或同步权限。
5. **视觉阶段先于页面开发。** 本方案确认后仍先交付 tokens 与六个关键 Android 样张；样张未确认前不批量实现页面。

---

## 2. 十项技术选择

### 2.1 Web／PWA 框架与语言

**推荐：Next.js App Router + React + TypeScript strict mode。**

理由：

- 单仓库覆盖移动 Web UI、服务端 API、鉴权回调和部署，降低单人维护成本；
- App Router 原生支持 Web App Manifest，当前官方文档已有完整 PWA 指南；
- TypeScript 可让冻结字段、AI JSON Schema、数据库 DTO 和导出模型共享类型；
- 服务端边界适合保护 AI、GitHub 和数据库高权限密钥。

配套建议：

- 包管理器：`pnpm`；
- 运行时：当前 LTS Node.js，版本写入 `.nvmrc`／`engines` 并由锁文件固定；
- 表单与 schema：Zod；
- 本地数据库封装：Dexie（底层仍为 IndexedDB）；
- 图标：Material Symbols；不引入整套默认紫色 Material 主题。

代价：App Router、服务端／客户端组件边界与离线逻辑需要明确约束；PWA 的离线数据策略仍需自行实现，不能只靠 manifest。

替代：Vite + React + Hono/独立 API。构建更轻，但会增加前后端部署、鉴权和类型共享的拼装成本。

降级：若 Next.js PWA 支持出现阻碍，保留 React/TypeScript 领域层，改为 Vite PWA；数据库与 API 契约不变。

### 2.2 部署平台

**推荐：Vercel 托管 Next.js；Supabase 托管 Auth 与 Postgres。**

理由：Next.js 适配直接、预览环境清晰、HTTPS 和回滚成本低；数据库、认证和 RLS 由 Supabase 集成，避免自建长期运行服务。

区域：应用函数与数据库尽量选择接近主要使用地的日本／东北亚区域；正式开通前再核对当时各套餐实际可选区域，避免在文档中写死不存在的区域名。

代价：两个托管商；免费额度、冷启动和区域能力可能变化；离开平台时需迁移环境变量和部署配置。

替代：Cloudflare Workers/Pages + 托管 Postgres。边缘延迟更低，但 Node 兼容、数据库连接和 GitHub App 私钥处理更复杂。

降级：静态 PWA 仍可打开并恢复本地草稿；远端保存、AI、搜索与同步显示“暂不可用”，不影响继续写原文。

### 2.3 单用户登录与会话保护

**推荐：Supabase Auth 的邀请制邮箱 Magic Link／OTP，关闭公开注册。**

实现边界：

- 首个用户由管理员邀请；应用再校验配置中的允许用户 ID；
- 服务端路由每次验证会话，不以“页面隐藏”代替授权；
- 会话 Cookie 使用 `Secure`、`SameSite=Lax`，敏感写操作校验来源并限流；
- 所有业务表启用 RLS，使用 `owner_id = auth.uid()`；
- `owner_id` 是存储授权外壳，不加入用户可迁移的领域 JSON，也不改变冻结的六层产品实体；
- Supabase secret/service key 只在可信服务端，绝不进入浏览器 bundle。

理由：手机登录负担低；单用户阶段不必维护密码；RLS 为未来扩展保留正确边界。

代价：依赖邮件投递；Magic Link 过期或跨设备打开时需要重新发起。

替代：GitHub 登录并限制 GitHub user ID。入口更统一，但会把“打开私人记录”和“授权私有仓库写入”两个不同权限混在一起。

降级：邮件不可达时允许配置一次性恢复码，仅用于账号恢复，不作为日常登录；不开放匿名访问。

### 2.4 应用数据库及主副本关系

**推荐：Supabase Postgres 为正式数据主副本；GitHub 为派生备份；IndexedDB 为工作副本。**

数据库按冻结模型拆表：

- `works`；
- `viewing_events`；
- `imprint_records`；
- `raw_layers` 与 `raw_revisions`；
- `ai_analyses`（不可覆盖原文）；
- `confirmed_imprint_layers`；
- `memory_cards` 与关联表；
- `action_layers`；
- `sync_jobs`、`export_revisions`；
- `user_custom_taxonomy`。

所有根记录使用 UUIDv7 或 ULID 等稳定、与片名和日期无关的 ID；最终在实现 ADR 中只选一种。关系约束由数据库外键保证：一条感想只属于一个作品，但可关联零到多个场次。

写入规则：正式保存使用单个数据库事务；导出和 GitHub 同步读取同一个不可变 `record_revision` 快照，避免三种格式互相漂移。

代价：需要 SQL migration、RLS 和事务测试。

替代：自托管 PostgreSQL。控制更高，但备份、升级、监控和安全维护成本不适合 MVP。

降级：数据库暂时不可达时，把待写入的确认快照放入本地 outbox，恢复后幂等提交；正式保存完成前不得显示“已同步”。

### 2.5 本地草稿、离线队列与恢复

**推荐：Dexie/IndexedDB + Service Worker + 前台重试 outbox。**

本地 stores：

- `drafts`：片名、原始感想、非敏感已填字段、保存时间、输入哈希；
- `ticket_results`：只保存已脱敏、待确认的场次；
- `outbox`：待执行的远端保存／AI 分析请求描述，不包含 GitHub 自动同步指令；
- `app_meta`：本地 schema 版本与迁移状态。

保存策略：输入后短防抖保存，同时在 `visibilitychange`、`pagehide` 时立即 flush；每次写入生成递增本地 revision。恢复时以最新完整 revision 为准，绝不使用 `localStorage` 保存长文本或令牌。

队列策略：每项带 `operation_id`、输入哈希和幂等键；前台启动、网络恢复和用户主动重试时排空。Background Sync 只作为增强，不作为正确性的唯一依赖。

Service Worker 只缓存版本化应用壳、字体与静态图标；`/api/**`、认证回调、记录正文和票务结果使用 `no-store`，避免私人响应被 Cache Storage 留存。

本地安全说明：IndexedDB 受浏览器 origin 隔离，但不等同于磁盘加密。MVP 依赖 Android 设备锁与浏览器沙箱；界面不能声称“本地加密”。

代价：需要处理多标签页、升级中断和配额不足。通过 Web Locks 或租约记录避免两个页面同时排队提交。

降级：若 Service Worker 被禁用，IndexedDB 草稿仍工作；若 IndexedDB 不可用，明确阻止开始长文本录入并提示更换浏览器，不静默退回易丢失的内存草稿。

### 2.6 AI 服务端代理、模型、结构化输出和成本

**修订后的推荐：供应商无关的服务端 AI 代理；用户可选择 Gemini、OpenAI、Claude、DeepSeek 或 Kimi。当前首个实测适配器使用 Gemini。**

理由：用户可能已经拥有不同供应商的 API，产品数据与界面不应被某一家模型绑定。各适配器负责调用供应商的结构化输出或严格函数参数能力，随后统一执行本应用自己的 Schema、枚举、长度和证据 excerpt 原文定位校验。

模型路由：

- 当前首选：Gemini `gemini-3.6-flash`；
- 可选：OpenAI、Claude、DeepSeek、Kimi，由各自服务端环境变量配置模型；
- 只有离线验证集证明证据归属、保守判断和稳定性达标后，才切换某家的默认模型；
- 模型 ID、reasoning、prompt 版本均由服务端配置并写入分析元数据，不散落在前端。

请求规则：

- 支持时关闭供应商侧存储；
- 输入只含产品文档允许的最少字段与当前原文；
- 票务邮件绝不拼入感想分析；
- 票务 AI 仅接收浏览器已脱敏、确定性模板无法处理的非敏感片段；
- JSON Schema 的枚举直接来自冻结稿，输出后再做 Zod 校验和证据 excerpt 原文可定位检查；
- refusal、超时、schema 校验失败分别处理，不展示半成品；
- 每次最多一次自动重试；之后交给用户选择“重试／返回编辑／只保存原文”。

成本控制：

- 固定提示词放在前部以利用缓存；
- 限制输出卡片数量只依据原文内容，不为省钱截断原文；
- 在调用前估算输入规模，异常长文本先提示预计耗时／成本，不擅自摘要；
- 每日／每月服务端预算和单用户速率限制；
- 记录输入、缓存和输出 token 及失败率，不记录完整原文到日志；
- 使用 12 条代表集做模型、prompt 和 reasoning 的回归比较。

代价：第三方 API 成本和数据处理边界需要用户接受；模型 alias 可能随时间变化。

密钥方案：由用户自带任一受支持供应商的 API key；密钥只存在服务端环境，不进入浏览器、IndexedDB、日志或导出资产。

降级：AI 不可用时完整保留本地草稿，并允许 `raw_only_confirmed` 正式保存。

### 2.7 GitHub 授权与令牌存储

**推荐：单独的 GitHub App，仅授予选定 `movie-imprint-records` 仓库 `Contents: write` 与 metadata read。**

实现：

- 用户安装 App 时明确选择单个私有数据仓库；
- 数据库只保存 installation ID、仓库 ID/name、默认分支与最近同步状态；
- GitHub App 私钥放在部署平台受保护的服务端密钥中；
- 每次用户主动同步时在服务端签发短期 installation token；不把 token 持久化到数据库或浏览器；
- 同步前显示仓库、分支和目标路径；同步 job 使用 revision + content hash 幂等；
- 发现远端文件 SHA 与最近同步基线不一致时停止并提示，不自动覆盖或双向合并。

理由：GitHub App 可限制到用户选择的仓库和细粒度权限；installation token 为短期令牌，优于长期 PAT。

代价：需要注册 GitHub App、管理私钥和安装回调；首次配置步骤多于 PAT。

替代：Fine-grained PAT 手工配置。开发快，但令牌是长期秘密，轮换和误配置风险更高，仅作为自托管／个人调试降级。

降级：未配置或同步失败时，本地与数据库正式记录不受影响；仍可下载 JSON／Markdown／TXT。

### 2.8 Bangumi API 缓存、限流与降级

**推荐：服务端代理正式 `POST /v0/search/subjects`，只返回最多三个消歧所需字段。**

规则：

- 客户端停止输入约 500–800ms 后请求，少于两个有效字符不自动搜索；
- 本地作品与别名先查，外部查询并行或随后补充；
- 服务端对规范化 query + 类型条件做 24 小时缓存；成功绑定的 subject 按 ID 长缓存并允许人工刷新；
- 单用户采用保守令牌桶，突发最多 3 次、持续不超过约 1 次/秒；实际阈值在联调时按官方响应调整；
- 设置可识别的 User-Agent 与联系信息；不抓取 Bangumi 页面，不读取用户评论；
- 成功绑定的条目可通过官方 `GET /v0/subjects/{subject_id}/image` 读取封面，作为首页按日壁纸候选；图片由应用缓存并设置容量／过期策略，不在每次启动时重复请求；
- 当日壁纸由本地日期与用户已记录的 subject ID 集合确定，同一天保持稳定；用户换一张时只更新本地选择，不改作品数据；
- 图片失败、断网或无封面时使用缓存或内置原创二次元视觉，不让外部图片服务阻塞首页；
- 429 尊重 `Retry-After`；连续失败打开短时熔断，页面继续提供本地候选和“按当前输入新建”。

真人电影覆盖不足时先记录搜索失败率；达到真实样本阈值后再提交第二正式数据源 ADR，不在 MVP 中私自加入爬虫。

代价：缓存会有短时旧数据；服务端代理多一个外部依赖。

替代：浏览器直接请求。实现简单，但无法统一缓存、限流、User-Agent 与故障策略。

降级：任何错误都不阻止本地作品创建；已绑定外部 ID 不因暂时查询失败而解除。

### 2.9 数据迁移与 `schema_version`

**推荐：数据库 migration 序号与领域 `schema_version` 分离。**

- SQL 使用只增不改的顺序 migration；
- 导出 JSON 使用产品 schema 版本，例如 `0.1`，并提供独立 JSON Schema；
- IndexedDB 使用整数版本和逐级升级函数；
- AI 输出另有 `analysis_schema_version` 与 `prompt_version`；
- 读取旧数据时经纯函数 adapter 升级到当前内存模型；首次正式写回才生成新 revision，不静默改写 GitHub 历史；
- destructive migration 先做数据库备份与导出 fixture 回归，保留可回滚窗口。

代价：同一阶段维护三类版本号，但能避免数据库结构、导出协议和 AI prompt 被错误绑在一起。

替代：只使用一个版本号。初期简单，后续会导致无关变化互相触发迁移，不推荐。

降级：无法迁移的记录进入只读模式，仍允许下载原始 JSON 与原文，不以失败写回破坏旧数据。

### 2.10 自动化测试、隐私测试和部署检查

**推荐工具：Vitest + Testing Library + Playwright + axe-core + SQL/RLS 测试。**

测试层：

1. 单元：字段枚举、导出器、文件名清洗、票务拆分／脱敏、证据定位、迁移 adapter；
2. 数据库：外键、事务、RLS、跨 owner 拒绝、幂等写入；
3. 合同：OpenAI JSON Schema、Bangumi 响应映射、GitHub 路径与 hash；
4. E2E：核心纵向切片、离线恢复、AI 失败、仅原文、GitHub 失败；
5. 视觉／无障碍：412×915、360×800、浅色、深色、200% 字体近似检查、键盘和 TalkBack 语义；
6. 隐私：在网络 mock、日志、Sentry payload、导出和 GitHub mock 中断言不存在姓名、邮箱、订单号、QR token、票价和票务原文；
7. AI 回归：只在私有 CI/本地使用充分脱敏或合成 fixture；公开仓库不提交私人原文。

部署闸门：类型检查、lint、单元、SQL/RLS、E2E 主路径、隐私 canary、PWA manifest/service worker、Lighthouse/axe、环境变量缺失检查全部通过后才能生产部署。

代价：初期测试投入较高，但这里的主要风险是数据丢失和隐私泄漏，不能只靠手测。

替代：只做 E2E 冒烟。无法覆盖脱敏和迁移边界，不接受为生产方案。

降级：外部 API 的 live 测试可在密钥不可用时跳过，但 schema fixture、隐私断言和本地降级路径不能跳过。

---

## 3. 数据流与安全边界

### 3.1 原始感想

```text
键盘输入
  → IndexedDB draft（立即、可恢复）
  → 用户点击开始整理
  → 服务端会话校验与限流
  → 用户选定的 AI 供应商（最少字段）
  → schema + evidence 校验
  → AI 草稿独立保存
  → 用户逐项确认
  → 数据库事务保存正式 revision
```

禁止：AI 覆盖 `raw_text`、模型输出直接成为正式记录、失败时删除草稿。

### 3.2 票务

```text
原始邮件（浏览器内存）
  → 本地拆分消息
  → 本地敏感模式检测与移除
  → 确定性 SMT/通用模板解析
  → 必要时仅发送脱敏残片给票务 AI
  → 用户确认非敏感场次
  → 保存 ViewingEvent 候选
  → 清空原始邮件内存
```

原始邮件、被移除值和其 hash 均不进入 IndexedDB、服务器日志、数据库、OpenAI、导出或 GitHub。

### 3.3 导出与 GitHub

```text
confirmed/raw_only_confirmed revision
  → 同一领域快照
  ├─ JSON（基准）
  ├─ Markdown（派生）
  └─ TXT（派生）
       → 用户先预览仓库与路径
       → 主动触发 GitHub App 同步
```

保存、导出、同步是三个独立动作；任何一步失败都不回滚数据库正式记录。

### 3.4 日志

允许记录：request ID、用户匿名稳定 ID、记录 ID、input hash、schema/prompt/model 版本、耗时、token 数、错误类别。

禁止记录：原始感想全文、票务文本、证据全文、令牌、Cookie、邮箱、GitHub 文件内容。调试需要正文时只允许用户主动导出本地诊断包，并默认再次脱敏。

---

## 4. 仓库与目录规划

```text
movie-imprint/
├─ app/                     # Next.js 路由与页面壳
│  ├─ (auth)/
│  ├─ (app)/
│  └─ api/                  # AI、Bangumi、GitHub、健康检查
├─ components/
│  ├─ ui/                   # tokens 驱动的基础组件
│  └─ movie-imprint/        # 领域组合组件
├─ domain/                  # 冻结实体、枚举、Zod schema、纯函数
├─ features/
│  ├─ drafts/
│  ├─ ticket-import/
│  ├─ analysis/
│  ├─ records/
│  ├─ export/
│  └─ github-sync/
├─ lib/
│  ├─ browser/              # IndexedDB、outbox、SW
│  └─ server/               # auth、db、OpenAI、GitHub、Bangumi
├─ styles/
│  ├─ tokens.css
│  └─ globals.css
├─ public/
├─ supabase/
│  ├─ migrations/
│  └─ tests/
├─ schemas/                 # 导出与 AI JSON Schema
├─ tests/
│  ├─ fixtures-public/      # 合成／充分脱敏
│  ├─ e2e/
│  ├─ privacy/
│  └─ visual/
├─ docs/
│  ├─ adr/
│  └─ design/
└─ .github/workflows/
```

领域代码不从 UI 组件反向导入；服务端 secrets 目录由 `server-only` 边界保护；公开 fixture 与私人验证集物理分离。

---

## 5. 实施阶段与验收闸门

### A. 技术方案（当前）

输出本文件；用户确认关键选型。不开通生产服务，不写页面。

### B. 视觉基线（下一步）

输出 design tokens、六个 412×915 Android 浅色样张、首页／新建／确认工作台深色样张，以及 360×800 检查。用户确认前停止。

### C. 最小纵向切片

只实现：首页 → 新建电影 → IndexedDB 草稿 → 只保存原文 → 记录详情。先证明原文安全、手机输入、数据事务和视觉落地。

### D. AI 整理

加入固定 schema、证据、五项态度、46 情绪、44 卡片类型、失败降级与人工确认。

### E. 电影专属能力

加入票务本地脱敏、多场次、影院特别放映和观看场景。

### F. 导出与 GitHub

加入三种同源导出、GitHub App、主动同步和冲突停止策略。

每阶段都必须保留前阶段的离线、仅原文和失败恢复能力。

---

## 6. 主要风险与降级

| 风险 | 预防 | 用户可见降级 |
|---|---|---|
| Android 清理站点存储 | 数据库正式保存、醒目草稿状态、可下载备份 | 提醒草稿尚未远端保存，不伪装为正式记录 |
| IndexedDB 配额／升级失败 | 事务、版本迁移测试、配额检查、保留上一版本 | 草稿只读导出；阻止继续覆盖 |
| AI 无证据或格式异常 | Structured Outputs、excerpt 定位、验证集回归 | 重试／返回编辑／仅原文 |
| 票务 PII 泄漏 | 本地先拆分脱敏、网络 canary、日志默认拒绝正文 | 停止票务解析；感想仍可保存 |
| Bangumi 不可用 | 缓存、限流、熔断 | 按输入创建本地作品 |
| GitHub API／授权失败 | GitHub App 短期 token、hash 幂等、冲突停止 | 数据库记录不回滚；稍后重试或下载 |
| 托管商故障／锁定 | 标准 Postgres、标准 JSON、无平台专属领域模型 | 静态 PWA + 本地草稿；导出后迁移 |
| 模型 alias 行为变化 | 记录 model/prompt 版本、回归集、生产可 pin snapshot | 回退到已验证模型或仅原文 |
| 私人样本误入公开仓库 | fixture 目录隔离、secret/PII scan、CI 阻断 | 构建失败，不发布 |

---

## 7. 需要用户确认的技术选择

以下均给出默认推荐；阶段 B 视觉样张不依赖这些服务实际开通，但阶段 C 开发前需要确认：

1. 接受 **Next.js + TypeScript + Vercel**，还是偏好 Cloudflare／自托管？
2. 接受 **Supabase Auth + Postgres** 作为日常主存储，并使用邀请制邮箱登录？
3. 选择 **Gemini／OpenAI／Claude／DeepSeek／Kimi** 中已配置的服务；是否需要按供应商设置月度预算上限？
4. 接受 **GitHub App** 作为正式同步授权；还是为了个人 MVP 先用 fine-grained PAT？
5. 正式数据与 AI 请求允许使用哪些托管区域／第三方服务？如有数据驻留限制，需要在开通前明确。
6. 稳定 ID 最终选择 UUIDv7 还是 ULID；推荐 UUIDv7，以数据库原生与时间局部性为先。

没有确认的项目不会在后续实现中被默默写死。

---

## 8. 当前官方依据（2026-08-01 核对）

- Next.js PWA 指南：<https://nextjs.org/docs/app/guides/progressive-web-apps>
- Supabase Auth：<https://supabase.com/docs/guides/auth>
- Supabase Row Level Security：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- OpenAI 当前模型选择：<https://developers.openai.com/api/docs/models>
- OpenAI Structured Outputs：<https://developers.openai.com/api/docs/guides/structured-outputs>
- OpenAI Responses API 迁移指南：<https://developers.openai.com/api/docs/guides/migrate-to-responses>
- Gemini Structured Outputs：<https://ai.google.dev/gemini-api/docs/structured-output>
- Claude Structured Outputs：<https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
- DeepSeek JSON Output：<https://api-docs.deepseek.com/guides/json_mode/>
- Kimi 对话补全与严格函数参数：<https://platform.kimi.com/docs/api/chat>
- GitHub App installation token：<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>
- Bangumi API：<https://bangumi.github.io/api/>

外部服务的套餐、区域、限额和模型价格会变化；实现时必须再次核对，不能把本文件当作永久不变的供应商合同。
