# 电影印记：上线与发布计划

日期：2026-08-02  
状态：C4 核心完成，等待按本计划逐窗口执行  
负责人：每个开发窗口按本文档顺序独立执行，完成后更新对应进度节点

---

## 背景说明（给每个开发窗口）

C1—C4 核心功能已完成，79/79 测试通过。当前 app 运行方式是本机 `node server.mjs`，只能在自己电脑上访问。

**目标：** 部署到免费云平台，任何设备随时可用，支持 AI 整理、GitHub 存档、导出文件，最终开源。

---

## 托管平台决策（已确定，不再讨论）

**选用：Cloudflare Pages + Workers**

理由：
- 完全免费，无需信用卡，个人用量永远不超配额
- **零冷启动**：Workers 在全球边缘节点常驻，请求响应 < 50ms，没有 Render 那种黑屏 3 分钟的等待
- 静态文件（index.html、CSS、JS、SW）由 Pages CDN 全球分发，速度极快
- API 路由（Bangumi 代理、AI 代理）由 Workers 处理，无服务器，不睡眠

唯一代价：需要把 `server.mjs` 的 API 路由改写成 Cloudflare Workers 格式（约半个窗口的代码量），静态文件托管改为 Pages 自动构建。改写后原有功能不变。

---

## 窗口任务清单

### 窗口 W1：部署上线（优先级最高）

**结果：** 得到一个永久 HTTPS 网址，手机和电脑都能直接打开，不需要开自己电脑，无冷启动。

**具体任务：**

1. 在项目根目录初始化 git 仓库（`git init`），把源码推到新建的 GitHub 公开仓库 `movie-imprint`（注意：`.env` 文件和任何含 API 密钥的文件必须加入 `.gitignore`，不得上传）

2. 把 `server.mjs` 的以下 API 路由改写为 Cloudflare Workers functions（文件放在 `/functions/api/` 目录）：
   - `GET /api/providers` → `functions/api/providers.js`
   - `GET /api/bangumi/search` → `functions/api/bangumi/search.js`
   - `GET /api/bangumi/image` → `functions/api/bangumi/image.js`
   - `POST /api/analyze` → `functions/api/analyze.js`
   
   改写规则：每个 functions 文件导出 `onRequest(context)` 函数，用 `context.env.VARIABLE_NAME` 读取环境变量（替换原来的 `process.env`），返回 `new Response(body, { headers })`。Workers 支持原生 `fetch`，不需要改 Bangumi 请求逻辑。

3. 在项目根目录加 `wrangler.toml`（Cloudflare 配置文件），指定静态目录为项目根目录

4. 在 Cloudflare Pages 控制台：
   - 连接 GitHub 的 `movie-imprint` 仓库
   - 构建命令留空（静态站，不需要构建）
   - 配置环境变量：`GEMINI_API_KEY`、`OPENAI_API_KEY` 等（从用户本地 `.env` 文件里抄过去）

5. 加访问密码保护：在 `functions/_middleware.js` 加一个简单的 bearer token 检查。用户在 `localStorage` 存一次密码，每次请求自动带上。密码本身存在 Cloudflare 环境变量里。（不需要登录注册，就是一个固定密码）

6. 验证：手机和电脑浏览器都能打开，PWA 可安装，AI 整理正常，壁纸正常

**验收：** 有可用网址，功能与本地版相同，无冷启动延迟

---

### 窗口 W2：C4 收尾

**结果：** 票务粘贴流程完整跑通，详情页显示场次信息。

**具体任务：**

1. 修改 `finishCompose()`：记录和 Work 创建后，把 `state.pendingViewingEvents` 里的每个 event 的 `work_id` 更新为正式 Work ID，再写入 IndexedDB。写完后清空 `state.pendingViewingEvents`

2. 在 `renderDetail()` 的详情页加"观影场次"区块（如果该 work 有关联的 viewingEvents）：显示影院名、日期、时间段、放映制式、座位。布局参考现有"记录卡"样式，不加新的设计组件

3. 跑全量测试，确认 79/79 通过

4. 在 Android 尺寸浏览器里验证票务粘贴→确认→详情页显示场次完整流程

**验收：** 从粘贴到详情页显示场次，端到端跑通

---

### 窗口 W3：C6 导出

**结果：** 详情页出现导出面板，手机和电脑都能方便地把记录带出这个 app；同时支持一次性导出全部记录。

**背景（W3 执行前的设计讨论，2026-08-03）：** 原方案（`URL.createObjectURL` + `<a download>`）是纯 PC 网页思路——手机浏览器下载后文件去哪里找非常不直观（iOS Safari 尤其明显），这个 app 本身又是要装到手机主屏用的 PWA。因此改为"分享优先，复制/下载为辅"：优先调用 Web Share API 弹出系统分享面板（文件由用户选的目标 App 接管，不再经过浏览器下载目录），不支持时逐级退化为文本分享、剪贴板复制、最后才是传统文件下载。

**具体任务：**

1. 新建 `src/export.js`，两层设计：
   - 内容生成（纯函数，可单测）：`exportJSON` / `exportMarkdown` / `exportTXT(record, work, viewingEvents)`，都基于共用的 `buildExportPayload()`；内容含完整原文、态度、情绪、卡片、场次（场次只保留详情页已展示的影院/日期/时间/制式/座位字段，不含订单号/票价/姓名/邮箱等票务敏感字段——这些字段在票务解析阶段就已脱敏，从未进入 `viewing_context`）
   - 交付层（依赖注入 navigator/document，方便单测 mock）：`deliverExport()` 按 文件分享 → 文本分享 → 浏览器下载 三级自动退化；`copyExportText()` 走 Clipboard API；`downloadExport()` 是不经过分享的直接下载，供"下载文件"这类明确要拿到本地文件的场景使用
   - 批量导出：`exportAllJSON()` / `exportAllMarkdown()`，把多条记录打包为一个 JSON 数组文件或一个用 `---` 分隔的合集 Markdown 文件

2. 详情页头部原来禁用的导出图标改为可点击，打开导出面板（bottom-sheet，复用现有偏好设置的视觉样式）：
   - "分享…"（主操作，一键分享 Markdown 版本，自动选目标 App）
   - "复制 Markdown" / "复制纯文本"（Clipboard API，比分享更轻，适合随手粘贴到微信/备忘录）
   - "下载文件"：Markdown / 纯文本 / JSON 三个按钮，走传统下载，服务桌面用户和明确要本地文件备份的场景

3. 偏好设置面板新增"数据导出"区块，支持批量导出全部记录：分享全部记录（Markdown 合集）、下载全部记录（JSON 备份）

4. 写单元测试（`tests/export.test.mjs`）：内容生成用现有 fixture 验证三种格式都包含原文且不含票务敏感字段；交付层用 mock 的 navigator/document 验证文件分享／文本分享／复制／下载／用户取消各分支

**验收：** 单条记录可分享/复制/下载，全部记录可批量导出，内容完整，不含 AI 密钥、访问密码或敏感票务字段；手机上分享后能在目标 App（如"文件"、备忘录、微信）里找到内容，不再依赖"下载目录"

---

### 窗口 W4：C6 GitHub 同步（授权）

**结果：** 设置层出现 GitHub Token 输入入口，用户可以填写并验证 Personal Access Token。

**具体任务：**

1. 在设置层（`wallpaperSettingsOverlay`）加"数据同步"区块

2. 实现 Token 存储：Token 只存在 `localStorage`（不进 IndexedDB，不上传服务器）。显示 token 时只露出后 4 位

3. 新建 `src/github.js`，实现：
   - `validateToken(token)` → 调用 GitHub API `GET /user`，验证 token 有效，返回用户名
   - `ensureRepo(token, owner)` → 确认或创建 `movie-imprint-records` 私有仓库

4. 验证时显示"正在验证…" / "已连接：username" / "Token 无效"状态

5. 在设置层加"私人记录仓库"字段（默认 `movie-imprint-records`），用户可自定义

**验收：** 用户填入真实 Token 后，能看到 GitHub 用户名确认，私有仓库存在或自动创建

---

### 窗口 W5：C6 GitHub 同步（推送）

**结果：** 详情页可以把当前记录推送到 GitHub 私有仓库，文件按日期和片名组织。

**具体任务：**

1. 在 `src/github.js` 实现：
   - `pushRecord(token, owner, repo, record, work, viewingEvents)` → 把 JSON 和 Markdown 内容通过 GitHub Contents API（`PUT /repos/:owner/:repo/contents/:path`）推送；文件路径：`records/YYYY/MM/作品名_记录ID.md` 和 `.json`
   - 如果文件已存在，先 GET 取 sha，再 PUT 更新（防止重复推送报错）
   - 失败时不影响本地记录，只显示错误信息

2. 在详情页操作区加"同步到 GitHub"按钮（仅在 Token 已配置时显示）

3. 同步前显示将要写入的仓库路径（"将保存到 username/movie-imprint-records/records/2026/08/"），用户点确认再推送

4. 同步成功后在详情页显示 GitHub 链接

**验收：** 真实推送到 GitHub 私有仓库，文件内容完整，二次推送不报错

---

### 窗口 W6-W9：C5 完整结构编辑（可拆分为多个窗口）

**结果：** 情绪标签、完整卡片类型库、卡片编辑/删除/排序可用。

这 4 个窗口按以下顺序执行，每个窗口独立交付可用功能：

**W6：** 46 个情绪标签接入（`FIELD_AND_TAXONOMY_FREEZE_V1.md` 已列出全部标签），在详情页可选择/取消，AI 建议态度上显示情绪标签

**W7：** 44 种卡片类型库（分组展示、搜索、最近使用），添加卡片时先进类型库

**W8：** 卡片删除、改类型、排序（上移/下移）

**W9：** 初看/重看关系字段；后续补充记录（无新场次的情况）

每个窗口结束时跑全量测试。

---

### 窗口 W10：开源发布

**结果：** `movie-imprint` 源码仓库设为 Public，有 README，有使用说明。

**具体任务：**

1. 检查 git 历史，确认没有 API 密钥、没有个人私人感想原文进入历史（验证案例已使用合成文本）

2. 写 `README.md`：项目简介（中文）、截图、功能列表、自部署说明（Cloudflare + 环境变量）、数据隐私说明

3. 在 GitHub 仓库页面设置 Topics（anime, movie, pwa, personal-tool）

4. 仓库设为 Public

5. 确认 `movie-imprint-records`（个人记录仓库）仍为 Private，和源码仓库严格分开

**验收：** GitHub 页面可正常访问，README 可读，私人记录仓库不对外可见

---

## 执行原则（每个窗口必读）

- 每个窗口开始前：先读本文件，再读 `docs/DEVELOPMENT_HANDOFF_V2.md`，再检查对应阶段的 `IMPLEMENTATION_STATUS_*.md`
- 每个窗口结束后：更新对应 `IMPLEMENTATION_STATUS_*.md`，跑全量测试确认无回退
- 不批量实现后续窗口的功能；专注当前窗口的交付目标
- 安全红线：API 密钥只通过环境变量注入，不进入任何文件、日志、导出或 GitHub 历史

## 当前进度

- [x] C1 本地可靠记录
- [x] C2 作品匹配与壁纸
- [x] C3 AI 结构化整理
- [x] C4 票务脱敏与解析（主体完成，W2 做收尾）
- [x] W1 部署上线（已完成，见下方说明）
- [x] 云端同步（D1，W1 外追加，见下方说明）
- [x] W2 C4 收尾（已完成）
- [x] W3 导出（已完成，见下方说明）
- [ ] W4 GitHub 授权（注：实时跨设备同步已由 D1 实现，W4 聚焦 GitHub 归档备份）
- [ ] W5 GitHub 推送
- [ ] W6-W9 C5 完整编辑
- [ ] W10 开源发布

---

## W1 完成说明（2026-08-03）

已部署到 Cloudflare Pages，网址：`movie-imprint.pages.dev`

完成内容：
- 全部 API 路由迁移至 `functions/api/`（Bangumi、AI、同步接口）
- `functions/_middleware.js`：`ACCESS_PASSWORD` 鉴权，仅保护 `/api/*` 路由，页面与静态资源直接放行
- `wrangler.toml` 配置完成，D1 binding 已绑定（`DB` → `movie-imprint-db`，ID：`000885ef-1362-4758-a643-b957dd802930`）

---

## 云端同步实现说明（2026-08-03）

**方案：Cloudflare D1 + IndexedDB 混合降级**

架构：
- 有访问密码（`mi_access_password` 存于 localStorage）→ 数据读写走 D1 云端
- 无密码 → 静默降级到 IndexedDB 本地存储，app 完全可用
- 遇到云端错误（401 密码错误 / 500 配置问题）→ 自动降级，不崩溃

新增文件：
- `functions/api/sync/_schema.sql`：D1 表结构（单表 `store_entries`，store+id 为主键，data 存 JSON）
- `functions/api/sync/[store].js`：GET（getAll）/ POST（批量写入）
- `functions/api/sync/[store]/[id].js`：GET / PUT / DELETE（单条操作）
- `functions/api/sync/put-record-with-work.js`：原子写入 record + work
- `functions/api/sync/viewing-events-by-work.js`：按 work_id 查场次
- `functions/api/sync/clear.js`：清空所有数据
- `functions/api/sync/status.js`：诊断端点，验证 D1 binding 是否可用

修改文件：
- `src/db.js`：完整替换为混合双模式，保持原有接口不变；新增 `migrateLocalToCloud()` 用于将本机 IndexedDB 数据一次性上传到 D1
- `src/app.js`：偏好设置面板加「云端同步」区块（密码输入、测试连接、上传本机数据、断开连接）；去掉原有 `prompt()` 鉴权
- `styles/app.css`：`.settings-sync-row` 样式

用户操作流程（部署后）：
1. 偏好设置 → 云端同步 → 输入 `ACCESS_PASSWORD` → 开启同步
2. 点「测试连接」验证 D1 可用
3. 点「上传本机数据到云端」迁移历史记录（每台设备操作一次；跳过 D1 已有记录，不覆盖）
4. 刷新页面，数据跨设备一致

注意事项：
- 迁移策略为「只补不覆盖」：D1 已有的 id 不会被本地旧数据覆盖，应先在数据最新的设备上传
- 现有本地历史数据不会自动迁移，需手动点「上传本机数据」
- `pagehide` 时的草稿异步保存可能在关闭页面时来不及完成（fetch 的固有局限，后续可用 `navigator.sendBeacon` 优化）

---

## W3 完成说明（2026-08-03）

按上方"背景"小节的设计执行：分享优先，复制/下载为辅，单条与批量导出都覆盖。

新增文件：
- `src/export.js`：内容生成（`buildExportPayload` / `exportJSON` / `exportMarkdown` / `exportTXT`）+ 批量导出（`exportAllJSON` / `exportAllMarkdown`）+ 交付层（`deliverExport` 三级自动退化、`downloadExport` 直接下载、`copyExportText` 剪贴板复制）+ 文件名生成（`exportFilename` / `exportAllFilename`）
- `tests/export.test.mjs`：16 个用例，覆盖内容完整性、票务敏感字段排除、批量导出、文件名清理、交付层各分支（文件分享／文本分享／下载／用户取消／复制）

修改文件：
- `src/app.js`：详情页头部导出图标从禁用改为可点击（`data-action="open-export"`），新增 `exportOverlay()` 面板（分享 / 复制 Markdown·TXT / 下载 JSON·Markdown·TXT）；偏好设置面板新增"数据导出"区块（分享全部记录 Markdown 合集、下载全部记录 JSON 备份）；新增 `buildAllExportEntries()` 汇总所有记录的 work 与场次
- `styles/app.css`：`.export-sheet` 复用 `.wallpaper-settings` 的底部安全区留白
- `index.html`：`app.css` 与 `app.js` 缓存版本号各 +1

验证：`node --test tests/*.test.mjs` 全量 103/103 通过（含新增 16 个导出测试，无回退）；`node --check` 确认 `app.js`/`export.js` 语法正确。Web Share API 的实机行为（iOS/Android 系统分享面板是否弹出、文件分享 vs 文本分享分支是否命中预期）建议在真机或 Android 尺寸浏览器里再走一遍，沙箱环境无法模拟 `navigator.share`。
