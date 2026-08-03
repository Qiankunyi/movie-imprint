# 任务：为「电影印记」接入 Cloudflare D1 云端同步

## 背景

此 app 目前所有数据（观影记录、草稿、壁纸偏好等）全部存储在浏览器本地的 IndexedDB。
用户在手机上记录的内容，电脑上完全看不到，因为两边浏览器各自独立。

**目标**：用 Cloudflare D1（云端 SQLite）替换 IndexedDB，让所有设备访问同一份数据。

---

## 项目结构（只读懂这些文件就够了）

```
K:\project\movie_Imprint\
├── wrangler.toml                  ← Cloudflare 配置，需要加 D1 binding
├── functions/
│   ├── _middleware.js             ← 已有的 ACCESS_PASSWORD 鉴权中间件（保持不变）
│   └── api/
│       ├── ai/                    ← AI 接口（不改）
│       └── bangumi/               ← Bangumi 接口（不改）
└── src/
    ├── db.js                      ← 核心：IndexedDB 封装，需要整体替换
    └── app.js                     ← 主应用（几乎不改，只改一行 import 版本号）
```

---

## 当前数据模型

IndexedDB 有 5 个 store，结构如下。每条数据都是一个 JSON 对象，必有 `id` 字段。

| Store 名称 | 典型内容 |
|---|---|
| `records` | 观影感想记录，id 如 `record_1720000000000_abc` |
| `works` | 作品信息，id 如 `work_record_xxx` |
| `drafts` | 草稿，常用 id 为字符串 `"active"` |
| `meta` | 偏好设置，id 如 `"wallpaper-preference"`, `"ai-preference"` |
| `viewingEvents` | 场次记录，含 `work_id` 字段指向对应 work |

---

## 当前 db.js 接口（替换后必须保持完全相同）

```js
db.get(store, id)                          // 返回单条，不存在返回 undefined
db.getAll(store)                           // 返回该 store 全部条目的数组
db.put(store, value)                       // upsert 一条（value 必含 id 字段）
db.delete(store, id)                       // 删除一条
db.putRecordWithWork(record, work)         // 原子写入 record + work 两条（事务）
db.putViewingEvents(events)               // 批量写入多条 viewingEvent
db.getViewingEventsByWork(workId)          // 返回 work_id === workId 的所有场次
clearLocalData()                           // 清空所有数据（reset 流程用）
```

---

## 鉴权机制（重要）

- `functions/_middleware.js` 已经对所有 `/api/*` 路由做了 `ACCESS_PASSWORD` 鉴权
- **新建的 D1 API 端点自动受此保护，不需要自己再写鉴权**
- 但新的 `src/db.js` 里的 fetch 调用需要携带密码头
- 密码存在 `localStorage` 的 key `"mi_access_password"` 里
- 请求头格式：`Authorization: Bearer <password>`
- 如果没设密码（空字符串），不加这个头，让 middleware 直接放行

---

## 实现方案

### 第一步：修改 wrangler.toml，加 D1 binding

在文件末尾追加：

```toml
[[d1_databases]]
binding = "DB"
database_name = "movie-imprint-db"
database_id = "PLACEHOLDER"
```

> `database_id` 先填 `"PLACEHOLDER"`，用户部署时自己跑 `wrangler d1 create movie-imprint-db` 获取真实 ID 后替换。

---

### 第二步：创建 SQL schema 文件

路径：`functions/api/sync/_schema.sql`

内容：

```sql
CREATE TABLE IF NOT EXISTS store_entries (
  store TEXT NOT NULL,
  id    TEXT NOT NULL,
  data  TEXT NOT NULL,
  PRIMARY KEY (store, id)
);
```

> 用单表存所有 store，data 列存 JSON 字符串。结构简单，完全对应 IndexedDB 的 key-value 模型。

---

### 第三步：创建 D1 API 端点

新建以下文件（全部放在 `functions/api/sync/` 下）：

#### 3a. `functions/api/sync/[store].js`
处理 `/api/sync/:store` 路由，即对整个 store 的操作：
- `GET` → 返回该 store 所有条目（getAll）
- `POST` → 批量写入多条（putViewingEvents 用）

方法参考：
```js
export async function onRequest(context) {
  const { store } = context.params;
  const ALLOWED = ["records", "works", "drafts", "meta", "viewingEvents"];
  if (!ALLOWED.includes(store)) return json(400, { error: "unknown_store" });

  if (context.request.method === "GET") {
    const { results } = await context.env.DB.prepare(
      "SELECT data FROM store_entries WHERE store = ?"
    ).bind(store).all();
    return json(200, results.map((row) => JSON.parse(row.data)));
  }

  if (context.request.method === "POST") {
    // 批量写入（用于 putViewingEvents）
    const items = await readJson(context.request);
    if (!Array.isArray(items)) return json(400, { error: "expected_array" });
    const stmt = context.env.DB.prepare(
      "INSERT OR REPLACE INTO store_entries (store, id, data) VALUES (?, ?, ?)"
    );
    await context.env.DB.batch(items.map((item) => stmt.bind(store, item.id, JSON.stringify(item))));
    return json(200, { ok: true });
  }

  return json(405, { error: "method_not_allowed" });
}
```

#### 3b. `functions/api/sync/[store]/[id].js`
处理 `/api/sync/:store/:id` 路由，即对单条的操作：
- `GET` → 返回单条（get）
- `PUT` → upsert 单条（put）
- `DELETE` → 删除单条（delete）

方法参考：
```js
export async function onRequest(context) {
  const { store, id } = context.params;
  const ALLOWED = ["records", "works", "drafts", "meta", "viewingEvents"];
  if (!ALLOWED.includes(store)) return json(400, { error: "unknown_store" });

  if (context.request.method === "GET") {
    const row = await context.env.DB.prepare(
      "SELECT data FROM store_entries WHERE store = ? AND id = ?"
    ).bind(store, id).first();
    return row ? json(200, JSON.parse(row.data)) : json(404, null);
  }

  if (context.request.method === "PUT") {
    const value = await readJson(context.request);
    await context.env.DB.prepare(
      "INSERT OR REPLACE INTO store_entries (store, id, data) VALUES (?, ?, ?)"
    ).bind(store, id, JSON.stringify(value)).run();
    return json(200, { ok: true });
  }

  if (context.request.method === "DELETE") {
    await context.env.DB.prepare(
      "DELETE FROM store_entries WHERE store = ? AND id = ?"
    ).bind(store, id).run();
    return json(200, { ok: true });
  }

  return json(405, { error: "method_not_allowed" });
}
```

#### 3c. `functions/api/sync/put-record-with-work.js`
处理 `/api/sync/put-record-with-work`（POST），原子写入 record + work：

```js
export async function onRequest(context) {
  if (context.request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const { record, work } = await readJson(context.request);
  const stmt = context.env.DB.prepare(
    "INSERT OR REPLACE INTO store_entries (store, id, data) VALUES (?, ?, ?)"
  );
  await context.env.DB.batch([
    stmt.bind("works", work.id, JSON.stringify(work)),
    stmt.bind("records", record.id, JSON.stringify(record))
  ]);
  return json(200, { ok: true });
}
```

#### 3d. `functions/api/sync/viewing-events-by-work.js`
处理 `/api/sync/viewing-events-by-work?workId=xxx`（GET）：

```js
export async function onRequest(context) {
  const workId = new URL(context.request.url).searchParams.get("workId");
  if (!workId) return json(400, { error: "missing_workId" });
  const { results } = await context.env.DB.prepare(
    "SELECT data FROM store_entries WHERE store = ?"
  ).bind("viewingEvents").all();
  const events = results
    .map((row) => JSON.parse(row.data))
    .filter((e) => e.work_id === workId);
  return json(200, events);
}
```

#### 3e. `functions/api/sync/clear.js`
处理 `/api/sync/clear`（POST），清空所有数据：

```js
export async function onRequest(context) {
  if (context.request.method !== "POST") return json(405, { error: "method_not_allowed" });
  await context.env.DB.prepare("DELETE FROM store_entries").run();
  return json(200, { ok: true });
}
```

#### 所有文件共用的辅助函数
每个文件都需要这两个辅助函数（直接写在各文件底部）：

```js
function json(status, body) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function readJson(request) {
  const text = await request.text();
  return JSON.parse(text || "{}");
}
```

---

### 第四步：替换 src/db.js

用以下内容完整替换现有 `src/db.js`（保持接口与原来完全一致）：

```js
/**
 * Cloud-backed db — 用 Cloudflare D1 API 替换 IndexedDB
 * 接口与原 IndexedDB 版本完全一致，app.js 无需改动。
 */

const ACCESS_PASSWORD_KEY = "mi_access_password";

function authHeaders() {
  const password = localStorage.getItem(ACCESS_PASSWORD_KEY) || "";
  return password ? { authorization: `Bearer ${password}` } : {};
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  return fetch(url, { ...options, headers });
}

async function apiGet(path) {
  const response = await apiFetch(path);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`db_fetch_error_${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

export const db = {
  async get(store, id) {
    return apiGet(`/api/sync/${store}/${encodeURIComponent(id)}`);
  },

  async getAll(store) {
    const response = await apiFetch(`/api/sync/${store}`);
    if (!response.ok) throw new Error(`db_fetch_error_${response.status}`);
    return response.json();
  },

  async put(store, value) {
    const response = await apiFetch(`/api/sync/${store}/${encodeURIComponent(value.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value)
    });
    if (!response.ok) throw new Error(`db_put_error_${response.status}`);
  },

  async delete(store, id) {
    const response = await apiFetch(`/api/sync/${store}/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error(`db_delete_error_${response.status}`);
  },

  async putRecordWithWork(record, work) {
    const response = await apiFetch("/api/sync/put-record-with-work", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ record, work })
    });
    if (!response.ok) throw new Error(`db_put_record_with_work_error_${response.status}`);
  },

  async putViewingEvents(events) {
    const response = await apiFetch("/api/sync/viewingEvents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events)
    });
    if (!response.ok) throw new Error(`db_put_viewing_events_error_${response.status}`);
  },

  async getViewingEventsByWork(workId) {
    const response = await apiFetch(
      `/api/sync/viewing-events-by-work?workId=${encodeURIComponent(workId)}`
    );
    if (!response.ok) throw new Error(`db_get_viewing_events_error_${response.status}`);
    return response.json();
  }
};

export async function clearLocalData() {
  const response = await apiFetch("/api/sync/clear", { method: "POST" });
  if (!response.ok) throw new Error(`db_clear_error_${response.status}`);
}
```

---

### 第五步：更新 app.js 的 import 版本号

在 `src/app.js` 第 1 行，将：
```js
import { db, clearLocalData } from "./db.js?v=8";
```
改为：
```js
import { db, clearLocalData } from "./db.js?v=9";
```

> 版本号变化会让浏览器重新加载模块，避免缓存旧的 IndexedDB 版本。

---

## 本地开发说明

本地运行时，Cloudflare D1 需要通过 wrangler 本地模拟。
在项目根目录创建 `.dev.vars` 文件（已在 .gitignore 中，不会提交）：

```
# 如果你本地有设置访问密码的话
# ACCESS_PASSWORD=你的密码
```

本地需先初始化 D1 schema：
```bash
npx wrangler d1 execute movie-imprint-db --local --file=functions/api/sync/_schema.sql
```

启动本地开发服务器：
```bash
npx wrangler pages dev . --port 4173
```

---

## 部署到线上的步骤（写给用户看的）

1. 在 Cloudflare 创建 D1 数据库：
   ```bash
   npx wrangler d1 create movie-imprint-db
   ```
   复制输出的 `database_id`，填入 `wrangler.toml`。

2. 初始化线上数据库 schema：
   ```bash
   npx wrangler d1 execute movie-imprint-db --remote --file=functions/api/sync/_schema.sql
   ```

3. 正常部署到 Cloudflare Pages（按你原来的方式部署即可）。

---

## 注意事项

- **现有本地数据不会自动迁移**：用户在各设备上已有的 IndexedDB 数据不会自动上传到云端。换上新版本后，云端初始为空，相当于全新开始。如需迁移历史数据，可以后续加导入功能，这次不做。
- **pagehide 草稿保存**：`app.js` 的 `pagehide` 事件里有一行 `db.put("drafts", ...)` 调用，由于是异步的，关闭页面时可能来不及完成。这是 fetch 的固有局限，可以后续用 `navigator.sendBeacon` 优化，这次不做。
- **不需要修改 `_middleware.js`**：新建的所有 `/api/sync/*` 路由自动被已有的鉴权中间件保护。
- **不需要修改任何其他 src/ 文件**：只改 `db.js` 和 `app.js` 的第 1 行。

---

## 执行检查清单

- [ ] `wrangler.toml` 末尾加了 `[[d1_databases]]` binding
- [ ] `functions/api/sync/_schema.sql` 已创建
- [ ] `functions/api/sync/[store].js` 已创建（含 GET 和 POST）
- [ ] `functions/api/sync/[store]/[id].js` 已创建（含 GET、PUT、DELETE）
- [ ] `functions/api/sync/put-record-with-work.js` 已创建
- [ ] `functions/api/sync/viewing-events-by-work.js` 已创建
- [ ] `functions/api/sync/clear.js` 已创建
- [ ] `src/db.js` 已用新版本完整替换
- [ ] `src/app.js` 第 1 行 import 版本号从 `v=8` 改为 `v=9`
