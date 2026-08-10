/**
 * C6 导出模块
 *
 * 设计原则（见 docs/DEPLOYMENT_AND_RELEASE_PLAN.md · W3）：
 * 桌面网页的“下载文件”模式在手机上体验很差——下载后用户很难找到文件去了哪里。
 * 因此这里把“生成内容”和“交付内容”拆成两层：
 *   - exportJSON / exportMarkdown / exportTXT：纯函数，只负责生成字符串，可离线单测
 *   - deliverExport / copyExportText：交付层，通过依赖注入接收 navigator/document，
 *     优先走系统分享面板（纯文本分享，Web Share Level 1），不支持或分享失败时退化为浏览器下载；
 *     copyExportText 走 Clipboard API，供"复制文本"按钮使用
 *
 * 安全红线：不导出 AI 密钥、访问密码；场次信息只保留详情页已展示的字段
 * （影院、日期、时间、制式、座位），不导出订单号/票价/姓名/邮箱等票务敏感字段
 * （这些字段在票务解析阶段就已经被脱敏、从未进入 viewing_context）。
 */

import { attitudeLabel, recommendationLabel, formatDate } from "./domain.js";
import { answeredInterviewItems } from "./self-interview.js";

const dateFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" });
const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });

// ─── 1. 内容生成（纯函数） ──────────────────────────────────────────────────

function cleanViewingEvent(event) {
  const ctx = event.viewing_context || {};
  return {
    cinema: ctx.cinema_name || null,
    date: event.viewed_on || (event.screening_at ? event.screening_at.slice(0, 10) : null),
    start: event.screening_at || null,
    end: event.screening_ends_at || null,
    format: ctx.format || null,
    seats: ctx.seats?.length ? ctx.seats : []
  };
}

function viewingEventText(ve) {
  const dateStr = ve.date ? dateFmt.format(new Date(ve.date)) : "";
  const startStr = ve.start ? timeFmt.format(new Date(ve.start)) : "";
  const endStr = ve.end ? timeFmt.format(new Date(ve.end)) : "";
  const timeRange = startStr && endStr ? `${startStr}–${endStr}` : startStr;
  const parts = [ve.cinema, dateStr, timeRange, ve.format, ve.seats.length ? `座位 ${ve.seats.join("、")}` : ""].filter(Boolean);
  return parts.join(" · ");
}

/**
 * 把一条记录整理成统一的导出数据结构，供 JSON/Markdown/TXT 三种格式共用
 * @param {object} record
 * @param {object|null} work
 * @param {object[]} viewingEvents
 */
export function buildExportPayload(record, work, viewingEvents = []) {
  const bangumiRef = work?.external_refs?.find((ref) => ref.source === "bangumi") || null;
  return {
    schema_version: "movie-imprint-export-2.1",
    exported_at: new Date().toISOString(),
    title: work?.title || record.title,
    original_title: work?.original_title || null,
    release_year: work?.release_year || null,
    bangumi_id: bangumiRef?.id || null,
    recorded_at: record.createdAt,
    attitude: record.attitude || null,
    attitude_label: attitudeLabel(record.attitude),
    recommendation: record.recommendation || null,
    recommendation_label: recommendationLabel(record.recommendation),
    recommendation_note: record.recommendationNote || "",
    recommendation_details: record.recommendationDetails || null,
    emotions: (record.emotions || []).map((emotion) => emotion.label).filter(Boolean),
    raw_text: record.rawText || "",
    raw_revision_id: record.raw_revision_id || null,
    self_interview: {
      interview_id: record.self_interview?.interview_id || null,
      status: record.self_interview?.status || "not_started",
      answers: answeredInterviewItems(record.self_interview).map((answer) => ({
        question_id: answer.question_id,
        question_version: answer.question_version,
        question: answer.question,
        answer_text: answer.answer_text,
        revision_id: answer.revision_id
      }))
    },
    cards: (record.cards || []).map((card) => ({
      card_id: card.card_id,
      type: card.type,
      title: card.title || "",
      content: card.content,
      why_it_matters: card.why_it_matters ?? null,
      related_emotions: card.related_emotions || [],
      evidence: card.evidence || [],
      is_core: !!card.is_core,
      origin: card.origin || null,
      user_modified: !!card.user_modified,
      analysis_id: card.analysis_id || null
    })),
    viewing_events: (viewingEvents || []).map(cleanViewingEvent)
  };
}

export function exportJSON(record, work, viewingEvents = []) {
  return JSON.stringify(buildExportPayload(record, work, viewingEvents), null, 2);
}

export function exportMarkdown(record, work, viewingEvents = []) {
  const payload = buildExportPayload(record, work, viewingEvents);
  const lines = [];
  lines.push(`# ${payload.title}`);
  lines.push("");
  lines.push(`记录于 ${formatDate(payload.recorded_at)}`);
  if (payload.viewing_events.length) {
    lines.push("");
    lines.push("## 观影场次");
    for (const ve of payload.viewing_events) lines.push(`- ${viewingEventText(ve)}`);
  }
  lines.push("");
  lines.push("## 态度与推荐");
  lines.push(`- 个人态度：${payload.attitude_label}`);
  lines.push(`- 会推荐吗：${payload.recommendation_label}${payload.recommendation_note ? ` · ${payload.recommendation_note}` : ""}`);
  if (payload.emotions.length) lines.push(`- 文字中的情绪：${payload.emotions.join("、")}`);
  if (payload.cards.length) {
    lines.push("");
    lines.push("## 记忆卡片");
    for (const card of payload.cards) {
      lines.push("");
      lines.push(`### ${card.title || card.type}${card.is_core ? "（核心）" : ""}`);
      lines.push(`*${card.type}*`);
      lines.push("");
      lines.push(card.content);
      if (card.why_it_matters) lines.push("", `为什么想留下：${card.why_it_matters}`);
    }
  }
  if (payload.self_interview.answers.length) {
    lines.push("", "## 观后自我采访");
    for (const answer of payload.self_interview.answers) lines.push("", `### ${answer.question}`, "", answer.answer_text);
  }
  lines.push("", "## 原文", "", payload.raw_text);
  return lines.join("\n");
}

export function exportTXT(record, work, viewingEvents = []) {
  const payload = buildExportPayload(record, work, viewingEvents);
  const lines = [];
  lines.push(payload.title);
  lines.push(`记录于 ${formatDate(payload.recorded_at)}`);
  if (payload.viewing_events.length) {
    lines.push("");
    lines.push("观影场次：");
    for (const ve of payload.viewing_events) lines.push(`  ${viewingEventText(ve)}`);
  }
  lines.push("");
  lines.push(`个人态度：${payload.attitude_label}`);
  lines.push(`会推荐吗：${payload.recommendation_label}${payload.recommendation_note ? ` · ${payload.recommendation_note}` : ""}`);
  if (payload.emotions.length) lines.push(`文字中的情绪：${payload.emotions.join("、")}`);
  if (payload.cards.length) {
    lines.push("");
    lines.push("记忆卡片：");
    for (const card of payload.cards) {
      lines.push("");
      lines.push(`[${card.type}] ${card.title || "没有标题"}${card.is_core ? " ・核心" : ""}`);
      lines.push(card.content);
      if (card.why_it_matters) lines.push(`为什么想留下：${card.why_it_matters}`);
    }
  }
  if (payload.self_interview.answers.length) {
    lines.push("", "观后自我采访：");
    for (const answer of payload.self_interview.answers) lines.push("", answer.question, answer.answer_text);
  }
  lines.push("", "原文：", payload.raw_text);
  return lines.join("\n");
}

// ─── 2. 批量导出（多条记录） ─────────────────────────────────────────────────

/**
 * @param {{record: object, work: object|null, viewingEvents: object[]}[]} entries
 */
/**
 * R6：把片单整理成可导出的结构。
 *
 * 为什么片单必须进导出（R6 §14）：本项目的核心命题是"长期可保存的个人记忆资产"，
 * 而片单条目的 reason 恰恰是**发现过程**的记录——"因为重看《英雄归来》对
 * Michael Keaton 感兴趣，所以想看《鸟人》"。在此之前全量导出以 Record 为遍历
 * 起点，没有观影记录的作品和它们的加入理由完全不会出现在任何导出物里，
 * 只存在于 IndexedDB / D1，这与产品定位相悖。
 *
 * 未观看的作品即使没有任何 Viewing Record，也属于用户可导出的长期数据资产。
 *
 * @param {object[]} collections
 * @param {object[]} works
 * @param {(workId: string) => boolean} isWatched Work 是否已有观影记录（由调用方注入，
 *   因为"已看"是从 Record / ViewingEvent 派生的，export.js 不该自己查库）
 */
export function buildCollectionsExport(collections = [], works = [], isWatched = () => false) {
  const findWork = (workId) =>
    works.find((work) => work.id === workId)
    || works.find((work) => (work.merged_from || []).includes(workId))
    || null;

  return collections.map((collection) => ({
    title: collection.title,
    description: collection.description || "",
    created_at: collection.created_at || null,
    updated_at: collection.updated_at || null,
    entries: (collection.entries || []).map((entry) => {
      const work = findWork(entry.work_id);
      const bangumiRef = work?.external_refs?.find((ref) => ref.source === "bangumi") || null;
      const tmdbRef = work?.external_refs?.find((ref) => ref.source === "tmdb") || null;
      const imdbRef = work?.external_refs?.find((ref) => ref.source === "imdb") || null;
      return {
        title: work?.title || null,
        original_title: work?.original_title || null,
        release_year: work?.release_year ?? null,
        // 已看/未看是派生的，导出时算一次快照——条目里从来没存过这个字段
        watched: isWatched(entry.work_id),
        added_at: entry.added_at || null,
        reason: entry.reason || "",
        // §17 Discovery Context：从哪部作品发现的。本阶段不做关系图，但数据要留住
        discovered_from: entry.source_work_id ? (findWork(entry.source_work_id)?.title || null) : null,
        bangumi_id: bangumiRef?.id || null,
        tmdb_id: tmdbRef?.id || null,
        imdb_id: imdbRef?.id || null
      };
    })
  }));
}

export function buildExternalPublicationsExport(publications = [], works = []) {
  const findWork = (workId) =>
    works.find((work) => work.id === workId)
    || works.find((work) => (work.merged_from || []).includes(workId))
    || null;
  return publications.map((item) => ({
    id: item.id,
    work_id: item.work_id,
    work_title: findWork(item.work_id)?.title || null,
    url: item.url,
    normalized_url: item.normalized_url || null,
    platform: item.platform || "other",
    published_at: item.published_at || null,
    viewing_record_id: item.viewing_record_id || null,
    note: item.note || null,
    created_at: item.created_at || null,
    updated_at: item.updated_at || null
  }));
}

export function exportAllJSON(entries = [], collections = [], externalPublications = [], tags = [], tagAssignments = []) {
  return JSON.stringify({
    schema_version: "movie-imprint-export-all-0.4",
    exported_at: new Date().toISOString(),
    count: entries.length,
    records: entries.map(({ record, work, viewingEvents }) => buildExportPayload(record, work, viewingEvents)),
    collections,
    external_publications: externalPublications,
    tags,
    tag_assignments: tagAssignments
  }, null, 2);
}

/** 片单的 Markdown 段落。没有片单时返回空串，不留一个空标题。 */
export function exportCollectionsMarkdown(collections = []) {
  if (!collections.length) return "";
  const blocks = collections.map((collection) => {
    const lines = [`## ${collection.title}`];
    if (collection.description) lines.push("", collection.description);
    for (const entry of collection.entries) {
      const year = entry.release_year ? `（${entry.release_year}）` : "";
      lines.push("", `### ${entry.title || "未命名作品"}${year} · ${entry.watched ? "已看" : "未看"}`);
      if (entry.reason) lines.push("", entry.reason);
      if (entry.discovered_from) lines.push("", `> 从《${entry.discovered_from}》发现`);
    }
    return lines.join("\n");
  });
  return [`# 片单`, ...blocks].join("\n\n");
}

function exportExternalPublicationsMarkdown(publications = []) {
  if (!publications.length) return "";
  return ["# 外部发表", ...publications.map((item) => {
    const date = item.published_at ? ` · ${String(item.published_at).slice(0, 10)}` : "";
    const note = item.note ? `\n\n${item.note}` : "";
    return `## ${item.work_title || "未命名作品"} · ${item.platform || "other"}${date}\n\n${item.url}${note}`;
  })].join("\n\n");
}

export function exportAllMarkdown(entries = [], collections = [], externalPublications = []) {
  const records = entries
    .map(({ record, work, viewingEvents }) => exportMarkdown(record, work, viewingEvents))
    .join("\n\n---\n\n");
  const collectionsMd = exportCollectionsMarkdown(collections);
  const publicationsMd = exportExternalPublicationsMarkdown(externalPublications);
  return [records, collectionsMd, publicationsMd].filter(Boolean).join("\n\n---\n\n");
}

// ─── 3. 文件名 ───────────────────────────────────────────────────────────────

function sanitizeForFilename(value) {
  return String(value || "").replace(/[/\\:*?"<>|\s]+/g, "_").slice(0, 60) || "记录";
}

function todayKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE").format(date); // YYYY-MM-DD
}

export function exportFilename(work, record, ext) {
  const title = sanitizeForFilename(work?.title || record?.title || "记录");
  return `movie-imprint_${title}_${todayKey()}.${ext}`;
}

export function exportAllFilename(ext) {
  return `movie-imprint_全部记录_${todayKey()}.${ext}`;
}

// ─── 4. 交付层：分享优先，复制/下载为辅 ─────────────────────────────────────
//
// 通过依赖注入接收 navigator/document/URL/Blob/File，方便单测用 mock 对象覆盖
// 各分支；应用内调用时不传第二个参数，自动使用真实的浏览器全局对象。

function resolveEnv(env = {}) {
  return {
    navigator: env.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined),
    document: env.document ?? (typeof document !== "undefined" ? document : undefined),
    URL: env.URL ?? (typeof URL !== "undefined" ? URL : undefined),
    Blob: env.Blob ?? (typeof Blob !== "undefined" ? Blob : undefined),
    File: env.File ?? (typeof File !== "undefined" ? File : undefined)
  };
}

// 部分安卓/桌面的文件预览器在打开"裸下载"的文本文件时，会按系统默认编码（常见是 GBK）
// 猜测内容，而不是遵循 Blob 的 type=...;charset=utf-8（那只在 HTTP 响应里生效，本地文件
// 落盘后不带这个元信息）。加 UTF-8 BOM 是唯一能让几乎所有本地文本查看器都认对编码的办法，
// 对 Markdown/TXT 生效；JSON 不加 BOM，避免影响以后可能出现的 JSON.parse 重新导入。
const BOM_MIME_TYPES = new Set(["text/markdown", "text/plain"]);

function triggerDownload(content, filename, mimeType, { document: doc, URL: URLRef, Blob: BlobRef }) {
  if (!doc || !URLRef || !BlobRef) throw new Error("download_unavailable");
  const baseMimeType = mimeType.split(";")[0];
  const withBom = BOM_MIME_TYPES.has(baseMimeType) ? "\uFEFF" + content : content;
  const blob = new BlobRef([withBom], { type: mimeType });
  const url = URLRef.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  URLRef.revokeObjectURL(url);
  return { method: "download" };
}

/**
 * 直接触发浏览器下载（不走分享）——用于"下载文件"这类明确希望拿到本地文件的操作。
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 * @param {object} [env] 依赖注入，单测用
 */
export function downloadExport(content, filename, mimeType, env) {
  const { document: doc, URL: URLRef, Blob: BlobRef } = resolveEnv(env);
  return triggerDownload(content, filename, mimeType, { document: doc, URL: URLRef, Blob: BlobRef });
}

/**
 * 交付一份导出内容：手机上优先弹出系统分享面板，桌面或分享不可用时退化为下载。
 *
 * 注意：这里只用 Web Share Level 1 的纯文本分享（{title, text}），不尝试带文件分享。
 * 带文件分享（{files:[...]）在安卓 Chrome 上依赖一份不透明的、按浏览器版本变化的 MIME
 * 白名单，Markdown/JSON 大概率不在其中；`canShare` 判断失败后再退回文本分享还会二次调用
 * `navigator.share()`，容易因为"用户激活状态"已被第一次调用消耗而被浏览器直接拒绝、静默
 * 失败，表现为系统分享面板完全没有弹出、直接退化成了下载。纯文本分享是 Web Share 里支持
 * 最广、行为最一致的原语，一次调用，不存在这个问题。
 *
 * @param {{content: string, filename: string, mimeType: string, shareTitle?: string}} payload
 * @param {object} [env] 依赖注入，单测用；生产环境省略即可
 * @returns {Promise<{method: "share-text"|"download"|"cancelled"}>}
 */
export async function deliverExport({ content, filename, mimeType, shareTitle = "电影印记" }, env) {
  const { navigator: nav, document: doc, URL: URLRef, Blob: BlobRef } = resolveEnv(env);
  const baseMimeType = mimeType.split(";")[0];

  if (nav?.share && baseMimeType.startsWith("text/")) {
    try {
      await nav.share({ title: shareTitle, text: content });
      return { method: "share-text" };
    } catch (error) {
      if (error?.name === "AbortError") return { method: "cancelled" };
      // 分享真的失败（非用户取消）→ 退化为下载
    }
  }

  return triggerDownload(content, filename, mimeType, { document: doc, URL: URLRef, Blob: BlobRef });
}

/**
 * 复制文本到剪贴板——比分享更轻的选项，适合随手粘贴到微信/备忘录
 * @param {string} content
 * @param {object} [env]
 */
export async function copyExportText(content, env) {
  const { navigator: nav } = resolveEnv(env);
  if (!nav?.clipboard?.writeText) throw new Error("clipboard_unavailable");
  await nav.clipboard.writeText(content);
  return { method: "copy" };
}

export const MIME_TYPES = {
  json: "application/json;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8"
};
