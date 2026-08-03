/**
 * R3 · 首页鉴赏履历卡。
 *
 * 纯渲染函数：不读 DOM、不读 localStorage、不查库——所有数据由调用方（app.js 的
 * renderHome()）通过 record / work / event 传入，海报 URL 通过 buildPosterUrl 注入，
 * 这样才能在 Node 测试里直接断言输出的 HTML 字符串。
 *
 * 三种「已完成」卡片形态 + 草稿卡：
 *   - 影院卡（event.location_type === "cinema"）：金属质感描边，制式/活动徽章
 *   - 线上／在家卡：普通描边
 *   - 补充记录卡（record.record_kind === "supplement"）：左侧细竖线，日期弱化
 *   - 草稿卡：维持「继续写」，有 captureContext 时显示海报与作品名
 */

import { attitudeLabel, formatDate } from "./domain.js";
import { formatBadge, eventBadges, isHighSpecFormat } from "./format-badge.js";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

const LOCATION_LABELS = { home: "在家观看", online: "线上观看", other: "其他方式观看" };

// en-CA → "YYYY-MM-DD"（转成 "/" 分隔）；en-GB 24 小时制 → "HH:MM"；
// weekday 用 ja-JP 拿单字（日/月/火…），和票务的日式习惯一致。
const YMD_FMT = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });

function eventDateLabel(event, { withTime = false } = {}) {
  if (!event) return "";
  const raw = event.screening_at || (event.viewed_on ? `${event.viewed_on}T12:00:00+09:00` : null);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const ymd = YMD_FMT.format(date).replace(/-/g, "/");
  if (!withTime) return ymd;
  const weekday = WEEKDAY_FMT.format(date);
  const time = event.screening_at ? TIME_FMT.format(date) : "";
  return time ? `${ymd} (${weekday}) ${time}` : `${ymd} (${weekday})`;
}

function posterMarkup(work, { buildPosterUrl } = {}) {
  const title = work?.title || "";
  const initial = escapeHtml((title.trim() || "?").charAt(0));
  const hasPoster = Boolean(work?.identity_status === "matched" && work?.poster_subject_id && typeof buildPosterUrl === "function");
  const src = hasPoster ? buildPosterUrl(work.poster_subject_id) : "";
  return `<div class="record-poster" data-testid="record-poster">
    <span class="record-poster-fallback" aria-hidden="true">${initial}</span>
    ${hasPoster ? `<img class="record-poster-img" src="${escapeHtml(src)}" alt="" loading="lazy" />` : ""}
  </div>`;
}

function attitudeTagMarkup(record) {
  return `<span class="record-attitude-tag ${record.attitude ? "selected" : "empty"}">${escapeHtml(attitudeLabel(record.attitude))}</span>`;
}

function badgeChipMarkup(badge) {
  return `<span class="format-badge ${badge.style} tone-${badge.tone}" data-badge-key="${escapeHtml(badge.key)}">${badge.icon ? `<i class="format-badge-icon icon-${badge.icon}" aria-hidden="true"></i>` : ""}${escapeHtml(badge.label)}</span>`;
}

function attentionLine(record, work) {
  if (record.status === "raw_only_confirmed") {
    return `<span class="record-status attention" data-testid="work-match-status"><span class="status-dot"></span>${record.analysis_status === "running" ? "正在整理" : "仅保存原文"}</span>`;
  }
  if (work?.match?.status === "needs_confirmation") {
    return `<span class="record-status attention" data-testid="work-match-status"><span class="status-dot"></span>待确认作品</span>`;
  }
  return "<span></span>";
}

function draftCardMarkup(record, { buildPosterUrl } = {}) {
  const ctx = record.captureContext;
  const title = ctx?.workTitle?.trim();
  const posterWork = title ? { title, identity_status: ctx.subjectId ? "matched" : "local_only", poster_subject_id: ctx.subjectId || null } : null;
  return `<article class="record-card draft-card" data-testid="draft-card">
    <button class="record-card-button" type="button" data-action="resume-draft" data-testid="resume-draft">
      <div class="record-card-row">
        ${posterWork ? posterMarkup(posterWork, { buildPosterUrl }) : ""}
        <div class="record-card-main">
          <div class="record-meta"><time>未完成的记录</time><span class="record-draft-label">继续写</span></div>
          <h2>${escapeHtml(title || "继续写")}</h2>
        </div>
      </div>
      <div class="record-card-footer"><span class="record-status" data-testid="draft-status"><span class="status-dot"></span>已自动保存在本机</span><span></span></div>
    </button>
  </article>`;
}

function viewingCardMarkup(record, work, event, { buildPosterUrl } = {}) {
  const title = work?.title || record.title || "未命名的电影";
  const isCinema = event?.location_type === "cinema";
  const rawFormat = event?.viewing_context?.format;
  const fmtBadge = event ? formatBadge(rawFormat) : null;
  const { badges: evBadges, overflow } = event ? eventBadges(event.viewing_context?.event_types || []) : { badges: [], overflow: 0 };
  const watchIndex = event?.watch_index;
  const showRewatch = Number.isInteger(watchIndex) && watchIndex >= 2;
  const highSpec = isCinema && isHighSpecFormat(rawFormat);
  const hasEventBadges = evBadges.length > 0;

  const dateLabel = event ? eventDateLabel(event, { withTime: isCinema }) : formatDate(record.createdAt);
  const locationLabel = isCinema
    ? (event?.viewing_context?.cinema_name || "")
    : (LOCATION_LABELS[event?.location_type] || LOCATION_LABELS.home);

  const badgeChips = [
    fmtBadge ? badgeChipMarkup(fmtBadge) : "",
    ...evBadges.map(badgeChipMarkup),
    overflow > 0 ? `<span class="format-badge outline tone-neutral overflow">+${overflow}</span>` : "",
    showRewatch ? `<span class="rewatch-tag">重看 · 第${watchIndex}次</span>` : ""
  ].filter(Boolean).join("");

  const cardClasses = [
    "record-card",
    isCinema ? "cinema" : "home",
    highSpec ? "high-spec" : "",
    hasEventBadges ? "has-event" : ""
  ].filter(Boolean).join(" ");

  return `<article class="${cardClasses}" data-testid="record-card">
    <button class="record-card-button" type="button" data-action="open-record" data-testid="record-${record.id}" data-record-id="${record.id}">
      <div class="record-card-row">
        ${posterMarkup(work, { buildPosterUrl })}
        <div class="record-card-main">
          <h2>${escapeHtml(title)}</h2>
          <div class="record-card-meta-line">${escapeHtml(dateLabel)}</div>
          ${locationLabel ? `<div class="record-card-meta-line">${escapeHtml(locationLabel)}</div>` : ""}
          ${badgeChips ? `<div class="record-badge-row">${badgeChips}</div>` : ""}
        </div>
      </div>
      <div class="record-card-footer">
        ${attentionLine(record, work)}
        ${attitudeTagMarkup(record)}
      </div>
    </button>
  </article>`;
}

function supplementDistanceLabel(work, record) {
  const first = work?.first_recorded_at;
  if (!first) return "";
  const start = new Date(first);
  const end = new Date(record.createdAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const years = Math.floor((end.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000));
  return years >= 1 ? `${years} 年` : "不到 1 年";
}

function supplementCardMarkup(record, work, { buildPosterUrl } = {}) {
  const title = work?.title || record.title || "未命名的电影";
  const distance = supplementDistanceLabel(work, record);
  return `<article class="record-card supplement" data-testid="record-card">
    <button class="record-card-button" type="button" data-action="open-record" data-testid="record-${record.id}" data-record-id="${record.id}">
      <div class="record-card-row">
        ${posterMarkup(work, { buildPosterUrl })}
        <div class="record-card-main">
          <h2>${escapeHtml(title)}</h2>
          <div class="record-card-meta-line muted">补充记录${distance ? ` · 距首次观看 ${distance}` : ""}</div>
        </div>
      </div>
      <div class="record-card-footer">
        <span></span>
        ${attitudeTagMarkup(record)}
      </div>
    </button>
  </article>`;
}

/**
 * @param {object} record
 * @param {{work?: object|null, event?: object|null, isDraft?: boolean, buildPosterUrl?: (subjectId: string|number) => string}} [options]
 */
export function recordCard(record, options = {}) {
  const { work = null, event = null, isDraft = false, buildPosterUrl = null } = options;
  if (isDraft) return draftCardMarkup(record, { buildPosterUrl });
  if (record.record_kind === "supplement") return supplementCardMarkup(record, work, { buildPosterUrl });
  return viewingCardMarkup(record, work, event, { buildPosterUrl });
}

/** 首页空状态：壁纸移除后必须有的真正空状态，不是只有一个"＋"的白屏。 */
export function emptyHomeStateMarkup() {
  return `<div class="empty-state" data-testid="home-empty">
    <img class="empty-state-illustration" src="/public/icon-character-v2-flat.png" alt="" aria-hidden="true" />
    <p class="empty-state-copy">电影散场以后，<br>先把还没消失的感觉留下来。</p>
    <div class="empty-state-hint"><span>点右下角的</span><span class="empty-state-fab-hint" aria-hidden="true">＋</span><span>开始第一条记录</span></div>
  </div>`;
}
