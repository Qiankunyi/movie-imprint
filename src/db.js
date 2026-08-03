/**
 * Hybrid db — Cloudflare D1（云端）+ IndexedDB（本地）双模式
 *
 * 逻辑：
 * - localStorage 里没有 mi_access_password → 全部走 IndexedDB（本地模式）
 * - 有密码 → 走 D1 API（云端模式）；遇到 401 自动清除密码并降级到 IndexedDB
 *
 * 对外接口与原 IndexedDB 版本完全相同，app.js 无需改动。
 */

// ─── IndexedDB（本地） ────────────────────────────────────────────────────────

const DB_NAME = "movie-imprint-local";
const DB_VERSION = 3;
const STORES = ["drafts", "records", "works", "meta", "viewingEvents"];

let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of STORES) {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("本地数据库升级被其他窗口阻止"));
    });
  }
  return databasePromise;
}

async function idbTransact(store, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    const request = operation(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("本地保存失败"));
  });
}

const idb = {
  get: (store, id) => idbTransact(store, "readonly", (target) => target.get(id)),
  getAll: (store) => idbTransact(store, "readonly", (target) => target.getAll()),
  put: (store, value) => idbTransact(store, "readwrite", (target) => target.put(value)),
  delete: (store, id) => idbTransact(store, "readwrite", (target) => target.delete(id)),

  putRecordWithWork: async (record, work) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["records", "works"], "readwrite");
      transaction.objectStore("works").put(work);
      transaction.objectStore("records").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("作品与记录保存失败"));
      transaction.onabort = () => reject(transaction.error || new Error("作品与记录保存失败"));
    });
  },

  putViewingEvents: async (events) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["viewingEvents"], "readwrite");
      const store = transaction.objectStore("viewingEvents");
      for (const event of events) store.put(event);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("场次保存失败"));
      transaction.onabort = () => reject(transaction.error || new Error("场次保存失败"));
    });
  },

  getViewingEventsByWork: async (workId) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["viewingEvents"], "readonly");
      const request = transaction.objectStore("viewingEvents").getAll();
      request.onsuccess = () => resolve((request.result || []).filter((e) => e.work_id === workId));
      request.onerror = () => reject(request.error);
    });
  },

  clear: async () => {
    const database = await openDatabase();
    await Promise.all(STORES.map((store) => new Promise((resolve, reject) => {
      const transaction = database.transaction(store, "readwrite");
      const request = transaction.objectStore(store).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })));
  }
};

// ─── 云端 D1 API ──────────────────────────────────────────────────────────────

const ACCESS_PASSWORD_KEY = "mi_access_password";

function isCloudSyncEnabled() {
  return !!(localStorage.getItem(ACCESS_PASSWORD_KEY));
}

function authHeaders() {
  const password = localStorage.getItem(ACCESS_PASSWORD_KEY) || "";
  return password ? { authorization: `Bearer ${password}` } : {};
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) throw new Error("db_401");
  return response;
}

async function apiGet(path) {
  const response = await apiFetch(path);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`db_fetch_error_${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

// ─── 路由：云端优先，401 降级本地 ───────────────────────────────────────────

/**
 * 尝试执行云端操作；遇到 401 清除密码并改走本地操作。
 */
async function cloudOp(cloudFn, localFn) {
  if (!isCloudSyncEnabled()) return localFn();
  try {
    return await cloudFn();
  } catch (e) {
    if (e.message === "db_401") {
      localStorage.removeItem(ACCESS_PASSWORD_KEY);
      return localFn();
    }
    throw e;
  }
}

// ─── 对外接口 ─────────────────────────────────────────────────────────────────

export const db = {
  get(store, id) {
    return cloudOp(
      () => apiGet(`/api/sync/${store}/${encodeURIComponent(id)}`),
      () => idb.get(store, id)
    );
  },

  getAll(store) {
    return cloudOp(
      async () => {
        const response = await apiFetch(`/api/sync/${store}`);
        if (!response.ok) throw new Error(`db_fetch_error_${response.status}`);
        return response.json();
      },
      () => idb.getAll(store)
    );
  },

  put(store, value) {
    return cloudOp(
      async () => {
        const response = await apiFetch(`/api/sync/${store}/${encodeURIComponent(value.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value)
        });
        if (!response.ok) throw new Error(`db_put_error_${response.status}`);
      },
      () => idb.put(store, value)
    );
  },

  delete(store, id) {
    return cloudOp(
      async () => {
        const response = await apiFetch(`/api/sync/${store}/${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
        if (!response.ok) throw new Error(`db_delete_error_${response.status}`);
      },
      () => idb.delete(store, id)
    );
  },

  putRecordWithWork(record, work) {
    return cloudOp(
      async () => {
        const response = await apiFetch("/api/sync/put-record-with-work", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ record, work })
        });
        if (!response.ok) throw new Error(`db_put_record_with_work_error_${response.status}`);
      },
      () => idb.putRecordWithWork(record, work)
    );
  },

  putViewingEvents(events) {
    return cloudOp(
      async () => {
        const response = await apiFetch("/api/sync/viewingEvents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(events)
        });
        if (!response.ok) throw new Error(`db_put_viewing_events_error_${response.status}`);
      },
      () => idb.putViewingEvents(events)
    );
  },

  getViewingEventsByWork(workId) {
    return cloudOp(
      async () => {
        const response = await apiFetch(
          `/api/sync/viewing-events-by-work?workId=${encodeURIComponent(workId)}`
        );
        if (!response.ok) throw new Error(`db_get_viewing_events_error_${response.status}`);
        return response.json();
      },
      () => idb.getViewingEventsByWork(workId)
    );
  }
};

export async function clearLocalData() {
  return cloudOp(
    async () => {
      const response = await apiFetch("/api/sync/clear", { method: "POST" });
      if (!response.ok) throw new Error(`db_clear_error_${response.status}`);
    },
    () => idb.clear()
  );
}
