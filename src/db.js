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

async function transact(store, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    const request = operation(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("本地保存失败"));
  });
}

export const db = {
  get: (store, id) => transact(store, "readonly", (target) => target.get(id)),
  getAll: (store) => transact(store, "readonly", (target) => target.getAll()),
  put: (store, value) => transact(store, "readwrite", (target) => target.put(value)),
  delete: (store, id) => transact(store, "readwrite", (target) => target.delete(id)),
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

  /** 保存一个或多个 ViewingEvent（用户确认后调用） */
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

  /** 获取指定 work_id 的全部场次 */
  getViewingEventsByWork: async (workId) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["viewingEvents"], "readonly");
      const request = transaction.objectStore("viewingEvents").getAll();
      request.onsuccess = () =>
        resolve((request.result || []).filter((e) => e.work_id === workId));
      request.onerror = () => reject(request.error);
    });
  }
};

export async function clearLocalData() {
  const database = await openDatabase();
  await Promise.all(STORES.map((store) => new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    const request = transaction.objectStore(store).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  })));
}
