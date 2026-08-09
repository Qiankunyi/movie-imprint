export const SIDEBAR_DAILY_STILL_KEY = "movie-imprint-sidebar-daily-still";

export function localDayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeSidebarStillPool(paths) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .map((path) => String(path || "").trim())
    .filter((path) => /^\/public\/assets\/sidebar-stills\/sidebar-\d{2}$/i.test(path)))];
}

/**
 * 同一自然日复用已选图片；日期变化或图片已从清单移除时才重新随机。
 * storage/random 都可注入，方便在无 DOM 环境下验证边界。
 */
export function selectDailySidebarStill(paths, {
  storage = globalThis.localStorage,
  now = new Date(),
  random = Math.random
} = {}) {
  const pool = normalizeSidebarStillPool(paths);
  if (!pool.length) return "";
  const day = localDayKey(now);

  try {
    const saved = JSON.parse(storage?.getItem(SIDEBAR_DAILY_STILL_KEY) || "null");
    if (saved?.day === day && pool.includes(saved.path)) return saved.path;
  } catch {
    // localStorage 不可用或旧值损坏时，仍可在本次会话里正常挑图。
  }

  const value = Number(random());
  const index = Math.max(0, Math.min(pool.length - 1, Math.floor((Number.isFinite(value) ? value : 0) * pool.length)));
  const path = pool[index];
  try {
    storage?.setItem(SIDEBAR_DAILY_STILL_KEY, JSON.stringify({ day, path }));
  } catch {
    // 隐私模式下写入失败不阻断侧栏。
  }
  return path;
}
