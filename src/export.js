/**
 * C6 导出模块
 *
 * 设计原则（见 docs/DEPLOYMENT_AND_RELEASE_PLAN.md · W3）：
 * 桌面网页的“下载文件”模式在手机上体验很差——下载后用户很难找到文件去了哪里。
 * 因此这里把“生成内容”和“交付内容”拆成两层：
 *   - exportJSON / exportMarkdown / exportTXT：纯函数，只负责生成字符串，可离线单测
 *   - deliverExport / copyExportText：交付层，通过依赖注入接收 navigator/document，
 *     优先走系统分享面板（文件分享 → 文本分享），分享不可用时才退化为剪贴板复制或浏览器下载
 *
 * 安全红线：不导出 AI 密钥、访问密码；场次信息只保留详情页已展示的字段
 * （影院、日期、时间、制式、座位），不导出订单号/票价/姓名/邮箱等票务敏感字段
 * （这些字段在票务解析阶段就已经被脱敏、从未进入 viewing_context）。
 */

import { attitudeLabel, recommendationLabel, formatDate } from "./domain.js";

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
    schema_version: "movie-imprint-export-0.1",
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
    cards: (record.cards || []).map((card) => ({
      type: card.type,
      title: card.title || "",
      content: card.content,
      is_core: !!card.is_core
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
  lines.push("## 原文");
  lines.push("");
  lines.push(payload.raw_text);
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
    }
  }
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
  lines.push("原文：");
  lines.push(payload.raw_text);
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
    }
  }
  return lines.join("\n");
}

// ─── 2. 批量导出（多条记录） ─────────────────────────────────────────────────

/**
 * @param {{record: object, work: object|null, viewingEvents: object[]}[]} entries
 */
export function exportAllJSON(entries = []) {
  return JSON.stringify({
    schema_version: "movie-imprint-export-all-0.1",
    exported_at: new Date().toISOString(),
    count: entries.length,
    records: entries.map(({ record, work, viewingEvents }) => buildExportPayload(record, work, viewingEvents))
  }, null, 2);
}

export function exportAllMarkdown(entries = []) {
  return entries
    .map(({ record, work, viewingEvents }) => exportMarkdown(record, work, viewingEvents))
    .join("\n\n---\n\n");
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

function triggerDownload(content, filename, mimeType, { document: doc, URL: URLRef, Blob: BlobRef }) {
  if (!doc || !URLRef || !BlobRef) throw new Error("download_unavailable");
  const blob = new BlobRef([content], { type: mimeType });
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
 * @param {{content: string, filename: string, mimeType: string, shareTitle?: string}} payload
 * @param {object} [env] 依赖注入，单测用；生产环境省略即可
 * @returns {Promise<{method: "share-file"|"share-text"|"download"|"cancelled"}>}
 */
export async function deliverExport({ content, filename, mimeType, shareTitle = "电影印记" }, env) {
  const { navigator: nav, document: doc, URL: URLRef, Blob: BlobRef, File: FileRef } = resolveEnv(env);

  // 1) 优先：文件分享——目标 App 自己决定文件存到哪，用户不需要再去找“下载”目录
  if (nav?.canShare && FileRef && BlobRef) {
    try {
      const file = new FileRef([content], filename, { type: mimeType });
      if (nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: shareTitle });
          return { method: "share-file" };
        } catch (error) {
          if (error?.name === "AbortError") return { method: "cancelled" };
          // 分享真的失败（非用户取消）→ 继续往下退化
        }
      }
    } catch {
      // File 构造或 canShare 检测失败 → 继续往下退化
    }
  }

  // 2) 次选：纯文本分享——不支持带文件分享，但支持文本分享的浏览器（文本类格式）
  if (nav?.share && (mimeType === "text/markdown" || mimeType === "text/plain")) {
    try {
      await nav.share({ title: shareTitle, text: content });
      return { method: "share-text" };
    } catch (error) {
      if (error?.name === "AbortError") return { method: "cancelled" };
      // 继续退化到下载
    }
  }

  // 3) 兜底：浏览器下载（桌面主路径，也是所有分支都不可用时的最终兜底）
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
  json: "application/json",
  markdown: "text/markdown",
  txt: "text/plain"
};
