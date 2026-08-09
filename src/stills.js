/**
 * 作品剧照是用户主动保存的有限集合，不是远端图库的镜像。
 * 数组顺序就是展示顺序，第 1 张同时是主展示图。
 */
export const MAX_WORK_STILLS = 4;

export function normalizeExternalImageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.href.length > 2048) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeWorkStills(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item.source === "tmdb" ? "tmdb" : item.source === "external" ? "external" : null;
    const path = source === "tmdb" && /^\/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/i.test(item.path || "")
      ? item.path
      : null;
    const url = source === "external" ? normalizeExternalImageUrl(item.url) : null;
    const key = path ? `tmdb:${path}` : url ? `external:${url}` : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: String(item.id || `still_${result.length}_${Date.now()}`),
      source,
      ...(path ? { path } : { url }),
      added_at: item.added_at || new Date(0).toISOString()
    });
    if (result.length === MAX_WORK_STILLS) break;
  }
  return result;
}

function stillId() {
  return `still_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createExternalStill(url, now = new Date().toISOString()) {
  const normalized = normalizeExternalImageUrl(url);
  return normalized ? { id: stillId(), source: "external", url: normalized, added_at: now } : null;
}

export function createTmdbStill(path, now = new Date().toISOString()) {
  if (!/^\/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/i.test(path || "")) return null;
  return { id: stillId(), source: "tmdb", path, added_at: now };
}

export function addWorkStill(stills, still) {
  const current = normalizeWorkStills(stills);
  if (!still || current.length >= MAX_WORK_STILLS) return current;
  return normalizeWorkStills([...current, still]);
}

export function removeWorkStill(stills, id) {
  return normalizeWorkStills(stills).filter((item) => item.id !== id);
}

export function moveWorkStill(stills, id, direction) {
  const current = normalizeWorkStills(stills);
  const index = current.findIndex((item) => item.id === id);
  const target = index + (direction === "up" ? -1 : direction === "down" ? 1 : 0);
  if (index < 0 || target < 0 || target >= current.length || target === index) return current;
  const next = current.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function setPrimaryWorkStill(stills, id) {
  const current = normalizeWorkStills(stills);
  const index = current.findIndex((item) => item.id === id);
  if (index <= 0) return current;
  return [current[index], ...current.slice(0, index), ...current.slice(index + 1)];
}
