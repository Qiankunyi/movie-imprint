/**
 * 作品与外部公开内容之间的引用关系。
 *
 * 这里刻意不抓取、也不保存原帖正文：URL 是事实来源，平台渲染只是可替换的展示层。
 */

export const PUBLICATION_PLATFORMS = {
  x: "X",
  bluesky: "Bluesky",
  bangumi: "Bangumi",
  douban: "豆瓣",
  weibo: "微博",
  instagram: "Instagram",
  youtube: "YouTube",
  blog: "博客",
  other: "网页"
};

const TRACKING_PARAMETERS = new Set([
  "fbclid", "gclid", "dclid", "igshid", "mc_cid", "mc_eid", "ref_src", "ref_url"
]);

function parsedHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch (_) {
    return null;
  }
}

export function isValidPublicationUrl(value) {
  return Boolean(parsedHttpUrl(value));
}

/**
 * 只做保守归一化：host 大小写/default port 交给 URL；移除 fragment、常见跟踪参数，
 * query 其余部分保持原意并排序。原始 URL 仍单独保存在 url 字段。
 */
export function normalizePublicationUrl(value) {
  const url = parsedHttpUrl(value);
  if (!url) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function detectPublicationPlatform(value) {
  const url = parsedHttpUrl(value);
  if (!url) return "other";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
  if (host === "bsky.app" || host.endsWith(".bsky.app")) return "bluesky";
  if (host === "bangumi.tv" || host.endsWith(".bangumi.tv") || host === "bgm.tv" || host.endsWith(".bgm.tv")) return "bangumi";
  if (host === "douban.com" || host.endsWith(".douban.com")) return "douban";
  if (host === "weibo.com" || host.endsWith(".weibo.com") || host === "weibo.cn" || host.endsWith(".weibo.cn")) return "weibo";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  if (/\b(blog|wordpress|medium|substack)\b/i.test(host)) return "blog";
  return "other";
}

export function publicationPlatformLabel(platform) {
  return PUBLICATION_PLATFORMS[platform] || PUBLICATION_PLATFORMS.other;
}

export function createExternalPublication({
  id,
  workId,
  url,
  publishedAt = null,
  viewingRecordId = null,
  note = null,
  title = null,
  now = new Date().toISOString()
} = {}) {
  const normalizedUrl = normalizePublicationUrl(url);
  if (!workId) throw new Error("external_publication_work_required");
  if (!normalizedUrl) throw new Error("external_publication_url_invalid");
  return {
    id,
    work_id: workId,
    url: String(url).trim(),
    normalized_url: normalizedUrl,
    platform: detectPublicationPlatform(url),
    published_at: publishedAt || null,
    viewing_record_id: viewingRecordId || null,
    note: note?.trim() || null,
    title: title?.trim() || null,
    created_at: now,
    updated_at: now
  };
}

export function updateExternalPublication(publication, changes = {}, now = new Date().toISOString()) {
  const url = changes.url ?? publication.url;
  const normalizedUrl = normalizePublicationUrl(url);
  if (!normalizedUrl) throw new Error("external_publication_url_invalid");
  return {
    ...publication,
    url: String(url).trim(),
    normalized_url: normalizedUrl,
    platform: detectPublicationPlatform(url),
    published_at: changes.publishedAt === undefined ? publication.published_at : (changes.publishedAt || null),
    viewing_record_id: changes.viewingRecordId === undefined ? publication.viewing_record_id : (changes.viewingRecordId || null),
    note: changes.note === undefined ? publication.note : (changes.note?.trim() || null),
    updated_at: now
  };
}

export function hasDuplicatePublication(publications, { workId, normalizedUrl, exceptId = null } = {}) {
  return (Array.isArray(publications) ? publications : []).some((item) =>
    item.id !== exceptId
    && item.work_id === workId
    && (item.normalized_url || normalizePublicationUrl(item.url)) === normalizedUrl
  );
}

export function sortExternalPublications(publications) {
  return [...(Array.isArray(publications) ? publications : [])].sort((a, b) => {
    const aKey = a.published_at || a.created_at || "";
    const bKey = b.published_at || b.created_at || "";
    return bKey.localeCompare(aKey) || String(b.id || "").localeCompare(String(a.id || ""));
  });
}

export function viewingPublicationLabel(publication, viewingEvents = []) {
  if (!publication?.viewing_record_id) return null;
  const event = (Array.isArray(viewingEvents) ? viewingEvents : []).find(
    (item) => item.id === publication.viewing_record_id
  );
  if (!event) return null;
  const index = Number(event.watch_index);
  if (event.viewing_relation === "first" || index === 1) return "第一次观看后发表";
  if (Number.isFinite(index) && index > 1) return `第 ${index} 次观看后发表`;
  return event.viewing_relation === "rewatch" ? "重看后发表" : "观看后发表";
}

/** X 官方 widgets.js 能接收的 status id；其余 X 页面统一走链接卡片。 */
export function xStatusId(value) {
  const url = parsedHttpUrl(value);
  if (!url || detectPublicationPlatform(value) !== "x") return null;
  return url.pathname.match(/\/status(?:es)?\/(\d+)/i)?.[1] || null;
}
