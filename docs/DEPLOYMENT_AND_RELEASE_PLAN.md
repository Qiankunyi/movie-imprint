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

**结果：** 详情页出现导出按钮，可以下载该记录的 JSON / Markdown / TXT 文件。

**具体任务：**

1. 新建 `src/export.js`，实现三个函数：
   - `exportJSON(record, work, viewingEvents)` → 返回格式化 JSON 字符串，包含完整原文、态度、情绪、卡片、场次（不含敏感票务字段）
   - `exportMarkdown(record, work, viewingEvents)` → 返回 Markdown 字符串，格式：标题、日期、场次信息、原文、态度与推荐、记忆卡片分节
   - `exportTXT(record, work, viewingEvents)` → 纯文本，适合直接阅读

2. 在 `renderDetail()` 的操作区加三个导出按钮

3. 点击后用 `URL.createObjectURL` + `<a download>` 触发浏览器下载，文件名格式：`movie-imprint_作品名_YYYY-MM-DD.json`

4. 写对应单元测试（`tests/export.test.mjs`），用现有 fixture 验证三种格式都包含原文

**验收：** 三种格式均可下载，内容完整，不含 AI 密钥或敏感票务字段

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
- [ ] W1 部署上线
- [ ] W2 C4 收尾
- [ ] W3 导出
- [ ] W4 GitHub 授权
- [ ] W5 GitHub 推送
- [ ] W6-W9 C5 完整编辑
- [ ] W10 开源发布
