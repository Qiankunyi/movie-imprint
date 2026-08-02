import { db, clearLocalData } from "./db.js?v=8";
import { parseTicketText, draftViewingEvent } from "./ticket.js";
import { applyBangumiCandidateToWork, buildWorkSearchQuery, chooseDailyWallpaper, chooseNextWallpaper, wallpaperCandidates } from "./bangumi.js?v=10";
import { applyListStyle, continueListOnEnter } from "./editor.js?v=8";
import {
  ATTITUDES,
  ATTITUDE_DESCRIPTIONS,
  allowedRecommendationsForAttitude,
  CARD_TYPES,
  RECOMMENDATIONS,
  RECOMMENDATION_PRESETS,
  attitudeLabel,
  createLocalWork,
  createRawOnlyRecord,
  createId,
  deterministicAnalysis,
  emptyRecommendationDetails,
  formatDate,
  isRecommendationAllowed,
  parseDraft,
  reconcileLocalWorkTitle,
  recommendationLabel
} from "./domain.js?v=11";

const app = document.querySelector("#app");
const liveRegion = document.querySelector("#live-region");
const activeDraftId = "active";

// --- 访问密码封装 ---
// 部署到 Cloudflare 后，如果配置了 ACCESS_PASSWORD 环境变量，
// 所有 /api/* 请求需要携带此密码。密码存在 localStorage 里，一次输入长期有效。
const ACCESS_PASSWORD_KEY = "mi_access_password";

function getAccessPassword() {
  return localStorage.getItem(ACCESS_PASSWORD_KEY) || "";
}

function setAccessPassword(password) {
  if (password) localStorage.setItem(ACCESS_PASSWORD_KEY, password);
}

async function apiFetch(url, options = {}) {
  const password = getAccessPassword();
  const headers = { ...(options.headers || {}) };
  if (password) headers["authorization"] = `Bearer ${password}`;

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // eslint-disable-next-line no-alert
    const newPassword = prompt("请输入访问密码：");
    if (!newPassword) throw new Error("访问被取消");
    setAccessPassword(newPassword);
    const retryHeaders = { ...(options.headers || {}), authorization: `Bearer ${newPassword}` };
    return fetch(url, { ...options, headers: retryHeaders });
  }

  return response;
}

// 带访问密码的图片 URL（壁纸以 URL 形式嵌入，无法加请求头，改用 ?token= 参数）
function apiBangumiImageUrl(subjectId) {
  const base = `/api/bangumi/image?subjectId=${subjectId}`;
  const password = getAccessPassword();
  return password ? `${base}&token=${encodeURIComponent(password)}` : base;
}

const state = {
  view: "home",
  overlay: null,
  records: [],
  works: [],
  wallpaper: null,
  wallpaperPreference: null,
  recordingPreference: null,
  aiPreference: null,
  aiProviders: { active: null, providers: [] },
  draft: null,
  activeRecordId: null,
  activeCardIndex: 0,
  editingCardId: null,
  returnScrollY: 0,
  saveTimer: null,
  saveState: "saved",
  theme: "light",
  // C4：票务粘贴流程
  ticketParseResult: null,   // 解析结果，显示确认卡片
  pendingViewingEvents: [],  // 用户已确认、等待写入 DB 的场次列表
  viewingEvents: []          // 当前详情页关联的已保存场次
};

let carouselGesture = null;

const icons = {
  back: '<path d="m15 5-7 7 7 7"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.2 15.2 4.4 4.4"/>',
  ticket: '<path d="M4 7.5A2.5 2.5 0 0 0 6.5 10 2.5 2.5 0 0 0 4 12.5V17h16v-4.5a2.5 2.5 0 0 0 0-5V3H4z"/><path d="M13 5.5v1M13 9.5v1M13 13.5v1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  match: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  theme: '<path d="M20 15.2A8 8 0 1 1 8.8 4 6.5 6.5 0 0 0 20 15.2Z"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  edit: '<path d="m4 17-.5 3.5L7 20l10.7-10.7-3-3zM13.5 7.5l3 3"/>',
  export: '<path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M5 12v7h14v-7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>'
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ""}</svg>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function announce(message) {
  liveRegion.textContent = "";
  requestAnimationFrame(() => { liveRegion.textContent = message; });
}

function publicSeedRecords() {
  const samples = [
    {
      title: "穿越时空的少女",
      rawText: "#穿越时空的少女 #电影院\n重映这天再看，还是会被最后那句来自未来的约定击中。明暗细节很好，但后排一直说话，有点遗憾。",
      offset: 0,
      attitude: "like",
      recommendation: "depends",
      recommendationNote: "适合喜欢青春动画的人"
    },
    {
      title: "雨中的车站",
      rawText: "#雨中的车站\n像是真的被带进那场雨里。散场以后，脑子里还全是车站和烟花。",
      offset: 86400000 * 3,
      attitude: null,
      recommendation: null,
      recommendationNote: ""
    }
  ];
  return samples.map((sample, index) => {
    const analysis = deterministicAnalysis(sample.rawText);
    const record = {
      id: `record_demo_${index + 1}`,
      schema_version: "0.1-local",
      title: sample.title,
      rawText: sample.rawText,
      tags: analysis.tags,
      inputHints: analysis.inputHints,
      createdAt: new Date(Date.now() - sample.offset).toISOString(),
      updatedAt: new Date(Date.now() - sample.offset).toISOString(),
      status: "confirmed",
      attitudeSuggestion: analysis.attitudeSuggestion,
      attitude: sample.attitude,
      recommendation: sample.recommendation,
      recommendationNote: sample.recommendationNote,
      recommendationDetails: sample.recommendation === "depends"
        ? { ...emptyRecommendationDetails(), audiences: ["喜欢同类题材的人"] }
        : emptyRecommendationDetails(),
      cards: analysis.cards
    };
    record.workId = `work_${record.id}`;
    return { record, work: createLocalWork(record) };
  });
}

async function ensureSeedData() {
  if (new URLSearchParams(location.search).has("clean")) return;
  const records = await db.getAll("records");
  if (records.length) return;
  await Promise.all(publicSeedRecords().map(({ record, work }) => db.putRecordWithWork(record, work)));
}

async function ensureWorkLinks(records) {
  for (const record of records) {
    const workId = record.workId || `work_${record.id}`;
    const existingWork = await db.get("works", workId);
    if (record.workId && existingWork) {
      const reconciled = reconcileLocalWorkTitle(existingWork, record);
      if (reconciled !== existingWork) await db.put("works", reconciled);
      continue;
    }
    record.workId = workId;
    await db.putRecordWithWork(record, existingWork || createLocalWork(record));
  }
}

async function loadState() {
  await ensureSeedData();
  [state.records, state.draft, state.recordingPreference, state.aiPreference, state.aiProviders] = await Promise.all([
    db.getAll("records"),
    db.get("drafts", activeDraftId),
    db.get("meta", "recording-preference"),
    db.get("meta", "ai-preference"),
    apiFetch("/api/ai/providers", { headers: { accept: "application/json" } }).then((response) => response.ok ? response.json() : null).catch(() => null)
  ]);
  state.recordingPreference ||= { id: "recording-preference", autoAnalyze: true };
  state.aiProviders ||= { active: null, providers: [] };
  const configured = state.aiProviders.providers.filter((provider) => provider.configured);
  if (!state.aiPreference || !configured.some((provider) => provider.id === state.aiPreference.provider)) {
    state.aiPreference = { id: "ai-preference", provider: state.aiProviders.active || configured[0]?.id || null };
    await db.put("meta", state.aiPreference);
  }
  await ensureWorkLinks(state.records);
  state.works = await db.getAll("works");
  await resolveDailyWallpaper();
  state.records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const targetId = location.hash.startsWith("#record=") ? decodeURIComponent(location.hash.slice(8)) : null;
  if (targetId && state.records.some((record) => record.id === targetId)) {
    state.view = "detail";
    state.activeRecordId = targetId;
  }
}

function currentRecord() {
  return state.records.find((record) => record.id === state.activeRecordId);
}

function currentWork(record = currentRecord()) {
  return record ? state.works.find((work) => work.id === record.workId) : null;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function resolveDailyWallpaper() {
  const dateKey = localDateKey();
  const preference = state.wallpaperPreference || await db.get("meta", "wallpaper-preference") || { id: "wallpaper-preference", mode: "daily", fixedWorkId: null };
  state.wallpaperPreference = preference;
  if (preference.mode === "off") {
    state.wallpaper = null;
    return;
  }
  const candidates = wallpaperCandidates(state.works);
  if (preference.mode === "fixed") {
    const fixed = candidates.find((candidate) => candidate.workId === preference.fixedWorkId);
    if (fixed) {
      state.wallpaper = { id: "daily-wallpaper", dateKey, ...fixed };
      return;
    }
    state.wallpaperPreference = { id: "wallpaper-preference", mode: "daily", fixedWorkId: null };
    await db.put("meta", state.wallpaperPreference);
  }
  const existing = await db.get("meta", "daily-wallpaper");
  const eligibleWorkIds = new Set(candidates.map((candidate) => candidate.workId));
  if (existing?.dateKey === dateKey && eligibleWorkIds.has(existing.workId)) {
    state.wallpaper = existing;
    return;
  }
  const selected = chooseDailyWallpaper(state.works, dateKey);
  state.wallpaper = selected ? { id: "daily-wallpaper", ...selected } : null;
  if (state.wallpaper) await db.put("meta", state.wallpaper);
  else if (existing) await db.delete("meta", "daily-wallpaper");
}

async function saveWallpaperPreference(mode, fixedWorkId = null) {
  state.wallpaperPreference = { id: "wallpaper-preference", mode, fixedWorkId };
  await db.put("meta", state.wallpaperPreference);
}

async function changeWallpaper() {
  const next = chooseNextWallpaper(state.works, state.wallpaper?.workId, localDateKey());
  if (!next) return;
  state.wallpaper = { id: "daily-wallpaper", ...next };
  await db.put("meta", state.wallpaper);
  if (state.wallpaperPreference?.mode === "fixed") await saveWallpaperPreference("fixed", next.workId);
}

function topBar() {
  return `<header class="top-bar">
    <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><h1>电影印记</h1></div>
    <div class="top-actions">
      <button class="icon-button" type="button" data-action="theme" aria-label="切换到${state.theme === "dark" ? "浅色" : "深色"}主题">${icon(state.theme === "dark" ? "sun" : "theme")}</button>
      <button class="icon-button" type="button" aria-label="搜索（尚未接入）" disabled>${icon("search")}</button>
      <button class="icon-button" type="button" data-action="open-wallpaper-settings" aria-label="偏好设置">${icon("more")}</button>
    </div>
  </header>`;
}

function highlightTags(text) {
  return escapeHtml(text).replace(/(^|\s)(#[^#\s，。！？、；：,.!?;:]+)/gu, "$1<mark>$2</mark>");
}

function seriesHintContent(text) {
  const { seriesPath, workTitleHint } = parseDraft(text);
  if (!seriesPath.length || !workTitleHint) return "";
  return `<span>已识别系列线索（待匹配确认）</span><b>${escapeHtml(seriesPath.join(" / "))}</b><i aria-hidden="true">→</i><b>${escapeHtml(workTitleHint)}</b>`;
}

function updateSeriesHint(text) {
  const hint = document.querySelector("[data-testid='series-hint']");
  if (!hint) return;
  const content = seriesHintContent(text);
  hint.innerHTML = content;
  hint.hidden = !content;
}

function recordCard(record, isDraft = false) {
  const preview = isDraft ? record.text : record.rawText;
  const parsed = parseDraft(preview);
  const work = isDraft ? null : currentWork(record);
  const matchStatus = work?.match?.status;
  const statusLabel = record.status === "raw_only_confirmed"
    ? record.analysis_status === "running" ? "正在整理" : "仅保存原文"
    : matchStatus === "needs_confirmation"
    ? "待确认作品"
    : matchStatus === "searching"
      ? "正在匹配作品"
      : work?.identity_status === "matched"
        ? "已匹配 Bangumi"
        : "本地成品";
  return `<article class="record-card ${isDraft ? "draft-card" : ""}">
    <button class="record-card-button" type="button" data-action="${isDraft ? "resume-draft" : "open-record"}" data-testid="${isDraft ? "resume-draft" : `record-${record.id}`}" ${isDraft ? "" : `data-record-id="${record.id}"`}>
      <div class="record-meta"><time>${isDraft ? "未完成的记录" : formatDate(record.createdAt)}</time><span class="${isDraft ? "record-draft-label" : `record-attitude-tag ${record.attitude ? "selected" : "empty"}`}">${isDraft ? "继续写" : attitudeLabel(record.attitude)}</span></div>
      <h2>${escapeHtml(work?.title || parsed.title)}</h2>
      <p>${highlightTags(preview)}</p>
      <div class="record-status ${matchStatus === "needs_confirmation" ? "attention" : ""}" data-testid="${isDraft ? "draft-status" : "work-match-status"}"><span class="status-dot"></span>${isDraft ? "已自动保存在本机" : statusLabel}</div>
    </button>
  </article>`;
}

function renderHome() {
  const draftCard = state.draft?.text?.trim() ? recordCard(state.draft, true) : "";
  const cards = state.records.map((record) => recordCard(record)).join("");
  const wallpaperUrl = state.wallpaper ? apiBangumiImageUrl(state.wallpaper.subjectId) : "";
  return `<main class="home-view" data-testid="home">
    <div class="wallpaper" aria-hidden="true">${wallpaperUrl ? `<img class="wallpaper-image" data-testid="daily-wallpaper" src="${wallpaperUrl}" alt="" />` : ""}</div>
    <div class="wallpaper-scrim" aria-hidden="true"></div>
    ${topBar()}
    <section class="feed" aria-label="电影记录">
      ${state.wallpaper ? `<div class="wallpaper-credit" data-testid="wallpaper-credit"><span>今日壁纸 · ${escapeHtml(state.wallpaper.title)}</span><a href="${escapeHtml(state.wallpaper.attributionUrl)}" target="_blank" rel="noreferrer">来源 Bangumi</a></div>` : ""}
      ${draftCard}
      ${cards || `<div class="empty-copy"><p>电影散场以后，<br>先把还没消失的感觉留下来。</p></div>`}
    </section>
    <button class="fab" type="button" data-action="open-compose" aria-label="开始记录" data-testid="add-record">＋</button>
  </main>`;
}

function detailHeader(record) {
  return `<header class="detail-header">
    <button class="icon-button inverse" type="button" data-action="go-home" aria-label="返回记录流">${icon("back")}</button>
    <div class="detail-header-actions">
      <button class="icon-button inverse" type="button" aria-label="导出与同步（尚未接入）" disabled>${icon("export")}</button>
      <button class="icon-button inverse" type="button" aria-label="更多（尚未接入）" disabled>${icon("more")}</button>
    </div>
  </header>`;
}

function memoryCard(record) {
  const cards = record.cards || [];
  if (!cards.length) {
    return `<div class="memory-empty"><p>还没有记忆卡片。</p><button class="text-action" type="button" data-action="add-card">＋ 添加第一张</button></div>`;
  }
  state.activeCardIndex = Math.max(0, Math.min(state.activeCardIndex, cards.length - 1));
  const card = cards[state.activeCardIndex];
  const isAiSuggestion = card.provenance === "ai_suggested";
  return `<div class="memory-stage" tabindex="0" role="region" aria-roledescription="轮播" aria-label="记忆卡片，第 ${state.activeCardIndex + 1} 张，共 ${cards.length} 张。左右滑动或使用方向键切换" data-testid="memory-carousel">
    <article class="memory-card ${card.is_core ? "core" : ""}" data-testid="memory-card">
      <div class="memory-card-top"><span>${escapeHtml(card.type)}${isAiSuggestion ? " · 整理建议" : card.provenance === "user_accepted" ? " · 已保留" : ""}</span><button class="text-action" type="button" data-action="edit-card" data-card-id="${card.card_id}">${icon("edit")}编辑</button></div>
      <h3>${escapeHtml(card.title || "没有标题")}</h3>
      <p>${escapeHtml(card.content)}</p>
      ${card.evidence?.length ? `<details class="evidence-details"><summary>查看原文依据</summary>${card.evidence.map((item) => `<blockquote>${escapeHtml(item.excerpt)}</blockquote>`).join("")}</details>` : ""}
      ${isAiSuggestion ? `<div class="suggestion-actions"><button type="button" data-action="accept-ai-card" data-card-id="${card.card_id}">保留这张</button><button type="button" data-action="remove-ai-card" data-card-id="${card.card_id}">删除建议</button></div>` : ""}
    </article>
    <div class="memory-pagination" aria-label="记忆卡片分页">
      <button type="button" data-action="previous-card" ${state.activeCardIndex === 0 ? "disabled" : ""} aria-label="上一张">‹</button>
      <span>${state.activeCardIndex + 1} / ${cards.length}</span>
      <div class="dots" aria-hidden="true">${cards.map((_, index) => `<i class="${index === state.activeCardIndex ? "active" : ""}"></i>`).join("")}</div>
      <button type="button" data-action="next-card" ${state.activeCardIndex === cards.length - 1 ? "disabled" : ""} aria-label="下一张">›</button>
    </div>
    ${cards.length > 1 ? `<div class="swipe-hint">左右滑动切换</div>` : ""}
  </div>`;
}

function normalizedRecommendationDetails(record) {
  return { ...emptyRecommendationDetails(), ...(record.recommendationDetails || {}) };
}

function recommendationPresetValues(recommendation) {
  return (RECOMMENDATION_PRESETS[recommendation] || []).flatMap((group) => group.options);
}

function recommendationSummary(record) {
  if (!record.recommendation) return "还没有判断推荐";
  if (!isRecommendationAllowed(record.attitude, record.recommendation)) return "推荐需要重新确认";
  const details = normalizedRecommendationDetails(record);
  const detail = record.recommendation === "yes"
    ? details.reasons[0] || details.audiences[0]
    : record.recommendation === "depends"
      ? details.audiences[0] || details.reasons[0]
      : details.noReasons[0] || details.issueTypes[0];
  return `${recommendationLabel(record.recommendation)}${detail ? ` · ${detail}` : record.recommendationNote ? ` · ${record.recommendationNote}` : ""}`;
}

function workTypeLabel(type) {
  return type === "anime" ? "动画" : type === "real" ? "真人影视" : "影视作品";
}

function workMatchPanel(record) {
  const work = currentWork(record);
  if (!work) return "";
  const match = work.match || { status: "idle", candidates: [] };
  if (match.status === "confirmed") {
    const reference = work.external_refs?.find((item) => item.source === "bangumi");
    return `<section class="work-match-panel confirmed" data-testid="work-match-panel">
      <div><span>作品已确认</span><b>Bangumi #${escapeHtml(reference?.id || "")}</b></div>
      ${work.original_title ? `<p>${escapeHtml(work.original_title)}${work.release_year ? ` · ${work.release_year}` : ""}</p>` : ""}
      ${match.message ? `<p class="match-message">${escapeHtml(match.message)}</p>` : ""}
      <button type="button" class="work-match-secondary" data-action="rematch-work">修改匹配</button>
    </section>`;
  }
  if (match.status === "needs_confirmation") {
    return `<section class="work-match-panel" data-testid="work-match-panel">
      <div class="work-match-heading"><span class="section-label-icon">${icon("match")}作品匹配</span><b>请选择正确条目</b></div>
      <div class="work-candidates">
        ${(match.candidates || []).map((candidate) => `<button type="button" class="work-candidate" data-action="confirm-work-match" data-subject-id="${candidate.subjectId}">
          <b>${escapeHtml(candidate.title)}</b>
          <span>${escapeHtml(candidate.originalTitle || workTypeLabel(candidate.type))}</span>
          <small>${escapeHtml(workTypeLabel(candidate.type))}${candidate.releaseDate ? ` · ${escapeHtml(candidate.releaseDate)}` : ""}</small>
        </button>`).join("")}
      </div>
      <button type="button" class="work-match-secondary" data-action="dismiss-work-match">${match.correcting ? "保留当前匹配" : "都不是，保留本地作品"}</button>
    </section>`;
  }
  if (match.status === "searching") {
    return `<section class="work-match-panel muted" data-testid="work-match-panel"><span class="match-spinner" aria-hidden="true"></span><p>正在查找正式作品条目…</p></section>`;
  }
  const message = match.status === "no_results"
    ? "没有找到合适条目，本地作品已经保留。"
    : match.status === "dismissed"
      ? "已保留为本地作品。"
      : match.status === "unavailable"
        ? "暂时无法联网匹配，本地记录不受影响。"
        : "作品目前保存在本地，可以查找正式条目。";
  return `<section class="work-match-panel muted" data-testid="work-match-panel">
    <p>${message}</p><button type="button" class="work-match-secondary" data-action="retry-work-match">${match.status === "idle" ? "查找作品" : "重新匹配"}</button>
  </section>`;
}

function viewingEventsSection(events) {
  if (!events || events.length === 0) return "";
  const dtFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" });
  const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
  const rows = events.map((e) => {
    const ctx = e.viewing_context || {};
    const dateStr = e.viewed_on ? dtFmt.format(new Date(e.viewed_on)) : (e.screening_at ? dtFmt.format(new Date(e.screening_at)) : "");
    const startStr = e.screening_at ? timeFmt.format(new Date(e.screening_at)) : "";
    const endStr = e.screening_ends_at ? timeFmt.format(new Date(e.screening_ends_at)) : "";
    const timeRange = startStr && endStr ? `${startStr}–${endStr}` : startStr;
    const seats = ctx.seats?.length ? ctx.seats.join("、") : "";
    return `<div class="viewing-event-card">
      ${ctx.cinema_name ? `<div class="ve-cinema">${escapeHtml(ctx.cinema_name)}</div>` : ""}
      <div class="ve-meta">
        ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ""}
        ${timeRange ? `<span>${escapeHtml(timeRange)}</span>` : ""}
        ${ctx.format ? `<span>${escapeHtml(ctx.format)}</span>` : ""}
        ${seats ? `<span>座位 ${escapeHtml(seats)}</span>` : ""}
      </div>
    </div>`;
  }).join("");
  return `<section class="viewing-events-section" data-testid="viewing-events">
    <h2 class="viewing-events-heading">观影场次</h2>
    ${rows}
  </section>`;
}

function renderDetail() {
  const record = currentRecord();
  if (!record) return renderHome();
  const work = currentWork(record);
  const recommendation = recommendationSummary(record);
  const title = work?.title || record.title;
  const bangumiReference = work?.external_refs?.find((reference) => reference.source === "bangumi");
  const titleMarkup = bangumiReference
    ? `《<a href="https://bangumi.tv/subject/${encodeURIComponent(bangumiReference.id)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>》`
    : `《${escapeHtml(title)}》`;
  return `<main class="detail-view" data-testid="detail">
    <div class="detail-wallpaper" aria-hidden="true"></div>
    ${detailHeader(record)}
    <article class="detail-content">
      <div class="detail-date">${escapeHtml(new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(record.createdAt)))}</div>
      <div class="detail-title-row"><h1>${titleMarkup}</h1><span class="attitude-badge ${record.attitude ? "selected" : "empty"}"><i aria-hidden="true"></i>${escapeHtml(attitudeLabel(record.attitude))}</span></div>
      ${workMatchPanel(record)}
      ${record.aiWarnings?.length ? `<details class="analysis-warnings" ${record.cards?.length ? "" : "open"}><summary>整理提示</summary><ul>${record.aiWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></details>` : ""}
      ${record.status === "raw_only_confirmed" ? `<section class="raw-only-status" data-testid="raw-only-status"><div><b>${record.analysis_status === "running" ? "正在安静整理" : "原文已经保存"}</b><p>${record.analysis_status === "running" ? "可以先离开，完成后会出现在这里。" : record.analysis_status === "failed" ? "上次没有整理完成，原文不受影响。" : "结构整理暂未完成，不影响这条记录。"}</p></div><button type="button" data-action="retry-local-analysis" ${record.analysis_status === "running" ? "disabled" : ""}>${record.analysis_status === "failed" ? "重新整理" : "稍后整理"}</button></section>` : `<button class="judgement-summary" type="button" data-action="open-attitude" data-testid="attitude-summary">
        <span class="judgement-summary-icon" aria-hidden="true">${icon("edit")}</span><span class="judgement-summary-copy"><small>个人态度与推荐 · ${record.attitude ? "点击修改" : "点击选择"}</small><b>${escapeHtml(attitudeLabel(record.attitude))} · ${recommendation}</b></span>${icon("chevron")}
      </button>`}
      <p class="impression">${escapeHtml(record.rawText)}</p>
      ${viewingEventsSection(state.viewingEvents)}
      ${record.status === "raw_only_confirmed" ? "" : `<div class="memory-heading"><h2>留下来的片段</h2><button class="text-action add-card" type="button" data-action="add-card">＋ 添加卡片</button></div>${memoryCard(record)}`}
    </article>
  </main>`;
}

function composerOverlay() {
  const value = state.draft?.text || "";
  const hint = seriesHintContent(value);
  return `<div class="overlay" data-testid="composer">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="收起记录层"></button>
    <section class="bottom-sheet composer" role="dialog" aria-modal="true" aria-labelledby="compose-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 id="compose-title" class="sr-only">随手记录</h2>
      <textarea id="composer-input" data-testid="composer-input" aria-describedby="compose-help" placeholder="用 # 标记作品，再写下看完后的想法\n例如：#穿越时空的少女  #电影院">${escapeHtml(value)}</textarea>
      <div id="compose-help" class="sr-only">输入会即时保存在此设备。使用井号标记作品名。也可以用斜线临时提示系列与作品，或使用列表按钮插入有序和无序清单。</div>
      <div class="series-hint" data-testid="series-hint" ${hint ? "" : "hidden"}>${hint}</div>
      <div class="list-format-menu" data-testid="list-format-menu" hidden>
        <span>列表格式</span>
        <button type="button" data-action="apply-list" data-style="ordered">1. 有序</button>
        <button type="button" data-action="apply-list" data-style="unordered">- 无序</button>
      </div>
      <div class="compose-tools">
        <button type="button" class="tool-button hash-button" data-action="insert-hash" aria-label="插入作品标签">#</button>
        <button type="button" class="tool-button list-button" data-action="toggle-list-menu" aria-label="列表格式" aria-expanded="false">${icon("list")}</button>
        <button type="button" class="tool-button ticket-button ${state.pendingViewingEvents.length ? "has-ticket" : ""}" data-action="open-ticket-paste" aria-label="粘贴票务邮件">${icon("ticket")}${state.pendingViewingEvents.length ? `<span class="ticket-badge">${state.pendingViewingEvents.length}</span>` : ""}</button>
        <span class="save-indicator" data-testid="save-status">${state.saveState === "saving" ? "正在保存…" : "已存于本机"}</span>
        <button type="button" class="finish-button" data-action="finish-compose" ${value.trim() ? "" : "disabled"} data-testid="finish-record">完成</button>
      </div>
    </section>
  </div>`;
}

function wallpaperSettingsOverlay() {
  const mode = state.wallpaperPreference?.mode || "daily";
  const candidates = wallpaperCandidates(state.works);
  const modeLabel = mode === "off" ? "已关闭作品壁纸" : mode === "fixed" ? "已固定当前作品" : "每天稳定轮换一张";
  return `<div class="overlay" data-testid="wallpaper-settings">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭壁纸设置"></button>
    <section class="bottom-sheet wallpaper-settings" role="dialog" aria-modal="true" aria-labelledby="wallpaper-settings-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">首页与记录</span><h2 id="wallpaper-settings-title">偏好设置</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <h3 class="settings-section-title">作品壁纸</h3>
      <p class="wallpaper-mode" data-testid="wallpaper-mode">${modeLabel}</p>
      <div class="settings-actions">
        ${mode !== "off" ? `<button type="button" data-action="change-wallpaper" ${candidates.length < 2 ? "disabled" : ""}><span><b>换一张</b><small>${candidates.length < 2 ? "还需要另一部已匹配作品" : "只改变当前选择"}</small></span>${icon("chevron")}</button>` : ""}
        ${mode === "daily" && state.wallpaper ? `<button type="button" data-action="fix-wallpaper"><span><b>固定这张</b><small>以后继续使用当前作品</small></span>${icon("chevron")}</button>` : ""}
        ${mode === "fixed" ? `<button type="button" data-action="use-daily-wallpaper"><span><b>恢复按日轮换</b><small>同一天仍保持稳定</small></span>${icon("chevron")}</button>` : ""}
        <button type="button" data-action="toggle-wallpaper"><span><b>${mode === "off" ? "开启作品壁纸" : "关闭作品壁纸"}</b><small>${mode === "off" ? "从已匹配作品中按日选择" : "继续使用内置中性背景"}</small></span>${icon("chevron")}</button>
      </div>
      <h3 class="settings-section-title">记录方式</h3>
      <div class="settings-actions">
        <button type="button" data-action="toggle-auto-analysis" aria-pressed="${state.recordingPreference?.autoAnalyze !== false}"><span><b>自动整理新记录</b><small data-testid="recording-mode">${state.recordingPreference?.autoAnalyze === false ? "当前关闭；完成时只保存原文" : "当前开启；原文保存后再后台整理"}</small></span><span class="settings-switch ${state.recordingPreference?.autoAnalyze === false ? "" : "on"}" aria-hidden="true"><i></i></span></button>
      </div>
      <h3 class="settings-section-title">整理服务</h3>
      <div class="provider-options" data-testid="ai-provider-options">
        ${state.aiProviders.providers.map((provider) => `<button type="button" data-action="select-ai-provider" data-provider="${provider.id}" class="provider-option ${state.aiPreference?.provider === provider.id ? "selected" : ""}" ${provider.configured ? "" : "disabled"} aria-pressed="${state.aiPreference?.provider === provider.id}"><span><b>${escapeHtml(provider.label)}</b><small>${provider.configured ? escapeHtml(provider.model) : "尚未配置密钥"}</small></span>${state.aiPreference?.provider === provider.id ? "✓" : ""}</button>`).join("")}
      </div>
      <p class="settings-note">偏好只保存在本机，不会修改已有作品记录。</p>
    </section>
  </div>`;
}

function attitudeOverlay(record) {
  const allowedRecommendations = allowedRecommendationsForAttitude(record.attitude);
  const activeRecommendation = allowedRecommendations.includes(record.recommendation) ? record.recommendation : null;
  const canRecommend = allowedRecommendations.includes("yes");
  const recommendationDetails = normalizedRecommendationDetails(record);
  const presetGroups = activeRecommendation ? RECOMMENDATION_PRESETS[activeRecommendation] : [];
  return `<div class="overlay" data-testid="attitude-sheet">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭选择层"></button>
    <section class="bottom-sheet judgement-sheet" role="dialog" aria-modal="true" aria-labelledby="judgement-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-kicker">个人态度</div>
      <h2 id="judgement-title">这次看完，心里更接近哪一种？</h2>
      ${record.attitudeSuggestion ? `<div class="suggestion"><p>文字倾向：<b>${attitudeLabel(record.attitudeSuggestion)}</b><span>仅作参考</span></p>${record.attitudeSuggestionDetails?.alternative ? `<small>也可能更接近：${escapeHtml(attitudeLabel(record.attitudeSuggestionDetails.alternative))}</small>` : ""}${record.attitudeSuggestionDetails?.evidence?.[0] ? `<blockquote>${escapeHtml(record.attitudeSuggestionDetails.evidence[0].excerpt)}</blockquote>` : ""}</div>` : record.analysis_status === "ai_draft_ready" ? `<p class="suggestion-empty">文字里没有足够明确的总体态度，这一项完全由你判断。</p>` : ""}
      ${record.emotions?.length ? `<div class="emotion-suggestions" aria-label="文字中的情绪">${record.emotions.map((emotion) => `<span>${escapeHtml(emotion.label)}</span>`).join("")}</div>` : ""}
      <div class="attitude-grid" role="group" aria-label="个人态度">
        ${ATTITUDES.map(([value, label]) => `<button type="button" class="choice ${record.attitude === value ? "selected" : ""} ${value === "mixed" ? "mixed" : ""}" data-action="select-attitude" data-value="${value}" aria-pressed="${record.attitude === value}"><i></i><span>${label}</span></button>`).join("")}
      </div>
      ${record.attitude ? `<div class="attitude-description" aria-live="polite"><b>${attitudeLabel(record.attitude)}</b><p>${ATTITUDE_DESCRIPTIONS[record.attitude]}</p></div>` : `<p class="attitude-helper">选择后会显示这一项的判断提示，帮助快速回忆标准。</p>`}
      <div class="recommend-section">
        <div class="section-heading"><h3>会推荐给别人吗？</h3><span>${!record.attitude ? "先判断个人态度" : canRecommend ? "喜欢不等于一定推荐" : "与当前态度保持一致"}</span></div>
        ${!record.attitude
          ? `<p class="recommend-logic-note">先选择上面的个人态度，再继续判断是否推荐。</p>`
          : `<p class="recommend-logic-note ${canRecommend ? "positive" : "constrained"}">${canRecommend ? "你对作品总体是喜欢的，可以继续选择“会／看对象／不会”。" : `你选择了“${attitudeLabel(record.attitude)}”，这里不再提供“会／看对象”；如果符合你的想法，请确认“不会”。`}</p>
            <div class="recommend-grid ${canRecommend ? "" : "single"}" role="group" aria-label="推荐判断">
              ${RECOMMENDATIONS.filter(([value]) => allowedRecommendations.includes(value)).map(([value, label]) => `<button type="button" class="recommend-choice ${activeRecommendation === value ? "selected" : ""}" data-action="select-recommendation" data-value="${value}" aria-pressed="${activeRecommendation === value}">${label}</button>`).join("")}
            </div>`}
        ${activeRecommendation ? `<div class="recommend-fields">
          <div class="recommend-ai-tools">
            <button type="button" data-action="organize-recommendation" ${record.recommendationAnalysisStatus === "running" ? "disabled" : ""}>${record.recommendationAnalysisStatus === "running" ? "正在从原文整理…" : record.recommendationAnalysisStatus === "failed" ? "重新整理原文条件" : "从原文整理条件"}</button>
            <small>只整理条件，不会改变“${recommendationLabel(activeRecommendation)}”</small>
          </div>
          ${record.recommendationAiSuggestions?.length ? `<div class="recommend-ai-suggestions"><p>整理建议 · 点击添加</p>${record.recommendationAiSuggestions.map((suggestion) => `<div class="recommend-ai-item"><button type="button" class="preset-chip ${suggestion.status === "accepted" ? "selected" : ""}" data-action="toggle-ai-recommendation" data-suggestion-id="${suggestion.suggestion_id}" aria-pressed="${suggestion.status === "accepted"}">${suggestion.status === "accepted" ? "✓ " : "+ "}${escapeHtml(suggestion.value)}</button><details><summary>依据</summary>${suggestion.evidence.map((item) => `<blockquote>${escapeHtml(item.excerpt)}</blockquote>`).join("")}</details></div>`).join("")}</div>` : record.recommendationAnalysisStatus === "complete" ? `<p class="recommend-ai-empty">原文里没有足够明确的推荐条件，可以继续使用常用选项或自己填写。</p>` : ""}
          ${presetGroups.map((group) => `<fieldset class="preset-group"><legend>${group.label}</legend><div class="preset-chips">${group.options.map((option) => {
            const selected = recommendationDetails[group.key]?.includes(option);
            return `<button type="button" class="preset-chip ${selected ? "selected" : ""}" data-action="toggle-recommendation-preset" data-field="${group.key}" data-option="${escapeHtml(option)}" aria-pressed="${selected}">${selected ? "✓ " : ""}${escapeHtml(option)}</button>`;
          }).join("")}</div></fieldset>`).join("")}
          <label class="recommend-note"><span>其他补充</span><input data-testid="recommendation-note" value="${escapeHtml(record.recommendationNote || "")}" placeholder="预设没有覆盖时再填写" /></label>
        </div>` : ""}
      </div>
      <button class="sheet-done" type="button" data-action="close-overlay">完成</button>
    </section>
  </div>`;
}

function cardEditorOverlay(record) {
  const editing = record.cards.find((card) => card.card_id === state.editingCardId);
  const card = editing || { type: "被击中的瞬间", title: "", content: "" };
  return `<div class="overlay" data-testid="card-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭卡片编辑"></button>
    <section class="bottom-sheet card-editor" role="dialog" aria-modal="true" aria-labelledby="card-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">记忆卡片</span><h2 id="card-editor-title">${editing ? "编辑这一张" : "添加一张"}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="card-form" data-card-id="${editing?.card_id || ""}">
        <label><span>类型</span><select name="type">${CARD_TYPES.map((type) => `<option ${card.type === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select></label>
        <label><span>标题</span><input name="title" value="${escapeHtml(card.title)}" placeholder="给这个片段一个短标题" /></label>
        <label><span>内容</span><textarea name="content" required placeholder="记住了什么？">${escapeHtml(card.content)}</textarea></label>
        <button class="sheet-done" type="submit">${editing ? "保存修改" : "添加卡片"}</button>
      </form>
    </section>
  </div>`;
}

function ticketPasteOverlay() {
  const result = state.ticketParseResult;

  // 状态一：已解析，显示场次确认卡片
  if (result) {
    const screenings = result.screenings;
    const confirmedIds = new Set(state.pendingViewingEvents.map((e) => e.id));

    const cards = screenings.map((s, index) => {
      const timeStr = s.screeningAt
        ? new Date(s.screeningAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        : null;
      const endStr = s.screeningEndsAt
        ? new Date(s.screeningEndsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        : null;
      const timeRange = timeStr ? (endStr ? `${timeStr}–${endStr}` : timeStr) : null;
      const seatsStr = s.seats.length ? s.seats.join("、") : null;
      const eventId = `ticket_draft_${index}`;
      const confirmed = confirmedIds.has(eventId) ||
        state.pendingViewingEvents.some((e) => e._draftIndex === index);

      return `<div class="ticket-card ${confirmed ? "confirmed" : ""}" data-index="${index}">
        <div class="ticket-card-title">${escapeHtml(s.movieTitle)}</div>
        <div class="ticket-card-meta">
          ${s.viewedOn ? `<span>${escapeHtml(s.viewedOn)}</span>` : ""}
          ${timeRange ? `<span>${escapeHtml(timeRange)}</span>` : ""}
        </div>
        <div class="ticket-card-meta">
          ${s.cinemaName ? `<span>${escapeHtml(s.cinemaName)}</span>` : ""}
          ${s.format ? `<span>${escapeHtml(s.format)}</span>` : ""}
        </div>
        ${seatsStr ? `<div class="ticket-card-seats">座位：${escapeHtml(seatsStr)}</div>` : ""}
        ${confirmed ? `<div class="ticket-confirmed-badge">✓ 已加入</div>` : ""}
      </div>`;
    }).join("");

    const allConfirmed = state.pendingViewingEvents.length >= screenings.length;

    return `<div class="overlay" data-testid="ticket-paste">
      <button class="overlay-backdrop" type="button" data-action="close-ticket-overlay" aria-label="返回记录层"></button>
      <section class="bottom-sheet ticket-sheet" role="dialog" aria-modal="true" aria-labelledby="ticket-sheet-title">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-title-row">
          <div>
            <span class="sheet-kicker">票务导入</span>
            <h2 id="ticket-sheet-title">识别到 ${screenings.length} 个场次</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-ticket-overlay" aria-label="返回">${icon("close")}</button>
        </div>
        <p class="ticket-privacy-note">敏感信息已本地移除：姓名、邮箱、QR 取票码<br>原始邮件不保存</p>
        <div class="ticket-cards">${cards}</div>
        <div class="ticket-actions">
          ${!allConfirmed
            ? `<button type="button" class="sheet-done" data-action="confirm-all-tickets">确认全部加入</button>`
            : `<button type="button" class="sheet-done" data-action="close-ticket-overlay">完成</button>`}
          <button type="button" class="text-action" data-action="repaste-ticket">重新粘贴</button>
        </div>
      </section>
    </div>`;
  }

  // 状态零：粘贴输入界面
  return `<div class="overlay" data-testid="ticket-paste">
    <button class="overlay-backdrop" type="button" data-action="close-ticket-overlay" aria-label="返回记录层"></button>
    <section class="bottom-sheet ticket-sheet" role="dialog" aria-modal="true" aria-labelledby="ticket-sheet-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row">
        <div>
          <span class="sheet-kicker">票务导入</span>
          <h2 id="ticket-sheet-title">粘贴购票邮件</h2>
        </div>
        <button class="icon-button" type="button" data-action="close-ticket-overlay" aria-label="返回">${icon("close")}</button>
      </div>
      <p class="ticket-hint">支持一次粘贴多封邮件。<br>姓名、邮箱、QR 码和票价将在本地自动移除，不会发给任何服务器。</p>
      <textarea id="ticket-input" class="ticket-textarea" placeholder="在这里粘贴购票确认邮件的全文…" rows="8"></textarea>
      <div class="ticket-actions">
        <button type="button" class="sheet-done" data-action="parse-ticket" data-testid="parse-ticket">识别场次</button>
      </div>
    </section>
  </div>`;
}

function render() {
  const base = state.view === "detail" ? renderDetail() : renderHome();
  const record = currentRecord();
  const overlay = state.overlay === "compose"
    ? composerOverlay()
    : state.overlay === "ticket"
      ? ticketPasteOverlay()
    : state.overlay === "wallpaper"
      ? wallpaperSettingsOverlay()
    : state.overlay === "attitude" && record
      ? attitudeOverlay(record)
      : state.overlay === "card" && record
        ? cardEditorOverlay(record)
        : "";
  app.innerHTML = `${base}${overlay}`;
  document.body.classList.toggle("overlay-open", Boolean(state.overlay));
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("movie-imprint-theme", theme);
}

function focusComposer() {
  requestAnimationFrame(() => {
    const input = document.querySelector("#composer-input");
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function applyComposerEdit(input, edit) {
  if (!input || !edit) return;
  input.value = edit.text;
  input.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus({ preventScroll: true });
}

async function saveDraft(text, immediate = false) {
  clearTimeout(state.saveTimer);
  state.saveState = "saving";
  document.querySelector("[data-testid='save-status']")?.replaceChildren("正在保存…");
  const persist = async () => {
    const previousRevision = state.draft?.revision || 0;
    state.draft = { id: activeDraftId, text, revision: previousRevision + 1, updatedAt: new Date().toISOString() };
    try {
      await db.put("drafts", state.draft);
      state.saveState = "saved";
      document.querySelector("[data-testid='save-status']")?.replaceChildren("已存于本机");
    } catch (error) {
      state.saveState = "error";
      document.querySelector("[data-testid='save-status']")?.replaceChildren("保存失败，请勿关闭");
      announce(error.message);
    }
  };
  if (immediate) await persist();
  else state.saveTimer = setTimeout(persist, 120);
}

async function finishCompose() {
  const input = document.querySelector("#composer-input");
  const text = input?.value || state.draft?.text || "";
  if (!text.trim()) return;
  await saveDraft(text, true);
  const now = new Date().toISOString();
  const record = createRawOnlyRecord(text, now);
  record.workId = `work_${record.id}`;
  const work = createLocalWork(record);
  await db.putRecordWithWork(record, work);
  if (state.pendingViewingEvents.length > 0) {
    const confirmedAt = new Date().toISOString();
    const eventsToSave = state.pendingViewingEvents.map((e) => ({
      ...e,
      work_id: work.id,
      record_id: record.id,
      confirmed_at: e.confirmed_at || confirmedAt,
      status: "confirmed"
    }));
    await db.putViewingEvents(eventsToSave);
    state.viewingEvents = eventsToSave;
    state.pendingViewingEvents = [];
  }
  await db.delete("drafts", activeDraftId);
  state.draft = null;
  state.records.unshift(record);
  state.works.push(work);
  state.overlay = null;
  render();
  requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
  announce("原文已保存在本机");
  void requestWorkMatch(record.id);
  if (state.recordingPreference?.autoAnalyze !== false) void runAiAnalysis(record.id);
}

async function runAiAnalysis(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record || record.status !== "raw_only_confirmed" || record.analysis_status === "running") return;
  record.analysis_status = "running";
  record.analysis_error = null;
  await db.put("records", record);
  renderPreservingScroll();
  try {
    const response = await apiFetch("/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ provider: state.aiPreference?.provider, title: currentWork(record)?.title || record.title, rawText: record.rawText })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "整理暂时没有完成");
    const analysis = payload.analysis;
    Object.assign(record, {
      attitudeSuggestion: analysis.attitude?.suggested || null,
      attitudeSuggestionDetails: analysis.attitude || null,
      emotions: analysis.emotions || [],
      cards: analysis.memory_cards || [],
      aiWarnings: analysis.warnings || [],
      analysisMetadata: payload.metadata,
      status: "confirmed",
      analysis_status: "ai_draft_ready",
      updatedAt: new Date().toISOString()
    });
    await db.put("records", record);
    renderPreservingScroll();
  } catch (error) {
    record.analysis_status = "failed";
    record.analysis_error = error.message;
    await db.put("records", record);
    renderPreservingScroll();
    announce("原文已保存，整理可以稍后重试");
  }
}

async function runRecommendationAnalysis(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record?.recommendation || record.recommendationAnalysisStatus === "running") return;
  record.recommendationAnalysisStatus = "running";
  record.recommendationAnalysisError = null;
  await db.put("records", record);
  renderPreservingScroll();
  try {
    const response = await apiFetch("/api/ai/recommendation", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        provider: state.aiPreference?.provider,
        title: currentWork(record)?.title || record.title,
        rawText: record.rawText,
        recommendation: record.recommendation,
        presets: recommendationPresetValues(record.recommendation)
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "推荐条件暂时没有整理完成");
    record.recommendationAiSuggestions = payload.recommendation?.suggestions || [];
    record.recommendationAnalysisWarnings = payload.recommendation?.warnings || [];
    record.recommendationAnalysisMetadata = payload.metadata;
    record.recommendationAnalysisStatus = "complete";
    record.updatedAt = new Date().toISOString();
    await db.put("records", record);
    renderPreservingScroll();
  } catch (error) {
    record.recommendationAnalysisStatus = "failed";
    record.recommendationAnalysisError = error.message;
    await db.put("records", record);
    renderPreservingScroll();
    announce("原文和推荐选择都已保留，可以稍后重试整理条件");
  }
}

function renderPreservingScroll() {
  const previousScroll = scrollY;
  render();
  requestAnimationFrame(() => scrollTo({ top: previousScroll, behavior: "instant" }));
}

async function requestWorkMatch(recordId, { force = false } = {}) {
  const record = state.records.find((item) => item.id === recordId);
  const work = currentWork(record);
  if (!record || !work || work.match?.status === "searching" || (work.identity_status === "matched" && !force)) return;
  const query = buildWorkSearchQuery(record);
  work.match = { status: "searching", query, candidates: [], message: null, correcting: force };
  await db.put("works", work);
  renderPreservingScroll();
  try {
    const response = await apiFetch(`/api/bangumi/search?q=${encodeURIComponent(query)}`, { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "作品匹配暂不可用");
    work.match = payload.candidates?.length
      ? { status: "needs_confirmation", query, candidates: payload.candidates, message: null, correcting: force }
      : force
        ? { status: "confirmed", query, candidates: [], message: "没有找到新的候选，已保留当前匹配。", correcting: false }
        : { status: "no_results", query, candidates: [], message: null, correcting: false };
  } catch (error) {
    work.match = force
      ? { status: "confirmed", query, candidates: [], message: "暂时无法重新匹配，已保留当前作品。", correcting: false }
      : { status: "unavailable", query, candidates: [], message: error.message, correcting: false };
  }
  await db.put("works", work);
  renderPreservingScroll();
}

async function confirmWorkMatch(subjectId) {
  const record = currentRecord();
  const work = currentWork(record);
  const candidate = work?.match?.candidates?.find((item) => item.subjectId === subjectId);
  if (!record || !work || !candidate) return;
  Object.assign(work, applyBangumiCandidateToWork(work, candidate));
  await db.put("works", work);
  await resolveDailyWallpaper();
  render();
  announce(`已确认作品：${work.title}`);
}

async function dismissWorkMatch() {
  const work = currentWork();
  if (!work) return;
  const keepConfirmed = work.identity_status === "matched";
  work.match = { ...work.match, status: keepConfirmed ? "confirmed" : "dismissed", candidates: [], message: null, correcting: false };
  await db.put("works", work);
  render();
  announce(keepConfirmed ? "已保留当前作品匹配" : "已保留为本地作品");
}

async function updateRecord(mutator) {
  const record = currentRecord();
  if (!record) return;
  mutator(record);
  record.updatedAt = new Date().toISOString();
  await db.put("records", record);
}

async function openRecord(recordId) {
  state.returnScrollY = scrollY;
  state.activeRecordId = recordId;
  state.activeCardIndex = 0;
  state.view = "detail";
  state.viewingEvents = [];
  history.pushState({ recordId }, "", `#record=${encodeURIComponent(recordId)}`);
  render();
  scrollTo(0, 0);
  // 异步加载该记录关联的观影场次，加载完成后刷新详情页
  const record = state.records.find((r) => r.id === recordId);
  if (record?.workId) {
    try {
      const events = await db.getViewingEventsByWork(record.workId);
      if (state.activeRecordId === recordId && state.view === "detail") {
        state.viewingEvents = events;
        if (events.length > 0) renderPreservingScroll();
      }
    } catch (_) { /* 场次加载失败不影响详情页其他内容 */ }
  }
}

function goHome({ replace = false } = {}) {
  state.view = "home";
  state.activeRecordId = null;
  state.overlay = null;
  state.viewingEvents = [];
  if (replace) history.replaceState({}, "", location.pathname + location.search);
  else history.pushState({}, "", location.pathname + location.search);
  render();
  requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
}

function showMemoryCard(index, { focus = false } = {}) {
  const previousScroll = scrollY;
  state.activeCardIndex = index;
  render();
  requestAnimationFrame(() => {
    scrollTo({ top: previousScroll, behavior: "instant" });
    if (focus) document.querySelector(".memory-stage")?.focus({ preventScroll: true });
  });
}

app.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const { action } = trigger.dataset;
  if (action === "theme") {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    render();
  } else if (action === "open-wallpaper-settings") {
    state.overlay = "wallpaper";
    render();
  } else if (action === "change-wallpaper") {
    await changeWallpaper();
    render();
    announce(`已换成${state.wallpaper?.title || "新的"}壁纸`);
  } else if (action === "fix-wallpaper") {
    if (state.wallpaper) await saveWallpaperPreference("fixed", state.wallpaper.workId);
    render();
    announce("已固定当前壁纸");
  } else if (action === "use-daily-wallpaper") {
    await saveWallpaperPreference("daily");
    await resolveDailyWallpaper();
    render();
    announce("已恢复按日轮换");
  } else if (action === "toggle-wallpaper") {
    if (state.wallpaperPreference?.mode === "off") {
      await saveWallpaperPreference("daily");
      await resolveDailyWallpaper();
      announce("已开启作品壁纸");
    } else {
      await saveWallpaperPreference("off");
      state.wallpaper = null;
      announce("已关闭作品壁纸");
    }
    render();
  } else if (action === "toggle-auto-analysis") {
    state.recordingPreference = {
      id: "recording-preference",
      autoAnalyze: state.recordingPreference?.autoAnalyze === false
    };
    await db.put("meta", state.recordingPreference);
    render();
    announce(state.recordingPreference.autoAnalyze ? "已开启自动整理" : "新记录将只保存原文");
  } else if (action === "select-ai-provider") {
    state.aiPreference = { id: "ai-preference", provider: trigger.dataset.provider };
    await db.put("meta", state.aiPreference);
    render();
    announce(`已选择${trigger.textContent.trim()}作为整理服务`);
  } else if (action === "open-ticket-paste") {
    // 保存当前 composer 草稿文字，再切换到票务层
    const composerInput = document.querySelector("#composer-input");
    if (composerInput) await saveDraft(composerInput.value, true);
    state.overlay = "ticket";
    render();
    requestAnimationFrame(() => document.querySelector("#ticket-input")?.focus());
  } else if (action === "close-ticket-overlay") {
    state.overlay = "compose";
    render();
    focusComposer();
  } else if (action === "repaste-ticket") {
    state.ticketParseResult = null;
    render();
    requestAnimationFrame(() => document.querySelector("#ticket-input")?.focus());
  } else if (action === "parse-ticket") {
    const raw = document.querySelector("#ticket-input")?.value || "";
    if (!raw.trim()) {
      announce("请先粘贴购票邮件内容");
      return;
    }
    try {
      state.ticketParseResult = parseTicketText(raw);
      if (state.ticketParseResult.screenings.length === 0) {
        announce("未能识别出场次，请检查粘贴内容");
        state.ticketParseResult = null;
      }
    } catch {
      announce("解析失败，请检查粘贴内容");
    }
    render();
  } else if (action === "confirm-all-tickets") {
    const result = state.ticketParseResult;
    if (!result) return;
    // 用当前 draft 对应的 work（尚未确认的记录先用占位 ID）
    const workId = state.draft ? `work_draft_${state.draft.id}` : `work_temp_${Date.now()}`;
    const events = result.screenings.map((s, index) => {
      const event = draftViewingEvent(s, workId);
      event._draftIndex = index;
      event.confirmed_at = new Date().toISOString();
      event.status = "confirmed";
      return event;
    });
    state.pendingViewingEvents = events;
    try {
      await db.putViewingEvents(events);
      announce(`已加入 ${events.length} 个观影场次`);
    } catch (err) {
      announce("场次保存失败：" + err.message);
    }
    render();
  } else if (action === "open-compose" || action === "resume-draft") {
    state.returnScrollY = scrollY;
    state.overlay = "compose";
    render();
    focusComposer();
  } else if (action === "close-overlay") {
    if (state.overlay === "compose") {
      const text = document.querySelector("#composer-input")?.value || "";
      await saveDraft(text, true);
    }
    state.overlay = null;
    render();
  } else if (action === "insert-hash") {
    const input = document.querySelector("#composer-input");
    if (input) {
      const start = input.selectionStart;
      input.setRangeText("#", start, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
  } else if (action === "toggle-list-menu") {
    const menu = document.querySelector("[data-testid='list-format-menu']");
    if (menu) {
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
    }
  } else if (action === "apply-list") {
    const input = document.querySelector("#composer-input");
    if (input) {
      applyComposerEdit(input, applyListStyle(input.value, input.selectionStart, input.selectionEnd, trigger.dataset.style));
      const menu = document.querySelector("[data-testid='list-format-menu']");
      if (menu) menu.hidden = true;
      document.querySelector("[data-action='toggle-list-menu']")?.setAttribute("aria-expanded", "false");
      announce(trigger.dataset.style === "ordered" ? "已开始有序列表" : "已开始无序列表");
    }
  } else if (action === "finish-compose") {
    await finishCompose();
  } else if (action === "open-record") {
    openRecord(trigger.dataset.recordId);
  } else if (action === "go-home") {
    goHome();
  } else if (action === "confirm-work-match") {
    await confirmWorkMatch(Number(trigger.dataset.subjectId));
  } else if (action === "dismiss-work-match") {
    await dismissWorkMatch();
  } else if (action === "retry-work-match") {
    await requestWorkMatch(currentRecord()?.id);
  } else if (action === "rematch-work") {
    await requestWorkMatch(currentRecord()?.id, { force: true });
  } else if (action === "retry-local-analysis") {
    await runAiAnalysis(currentRecord()?.id);
  } else if (action === "open-attitude") {
    state.overlay = "attitude";
    render();
  } else if (action === "select-attitude") {
    await updateRecord((record) => {
      const next = record.attitude === trigger.dataset.value ? null : trigger.dataset.value;
      record.attitude = next;
      record.attitudeProvenance = next ? (next === record.attitudeSuggestion ? "ai_accepted" : "user_selected") : null;
      if (!isRecommendationAllowed(next, record.recommendation)) {
        record.recommendation = null;
        record.recommendationNote = "";
        record.recommendationDetails = emptyRecommendationDetails();
        record.recommendationAiSuggestions = [];
        record.recommendationAnalysisStatus = null;
        record.recommendationAnalysisError = null;
        record.recommendationAnalysisWarnings = [];
        record.recommendationAnalysisMetadata = null;
      }
    });
    render();
  } else if (action === "select-recommendation") {
    await updateRecord((record) => {
      const requested = trigger.dataset.value;
      if (!isRecommendationAllowed(record.attitude, requested)) return;
      const next = record.recommendation === requested ? null : requested;
      const changed = next !== record.recommendation;
      record.recommendation = next;
      if (!record.recommendationDetails) record.recommendationDetails = emptyRecommendationDetails();
      if (changed) {
        record.recommendationAiSuggestions = [];
        record.recommendationAnalysisStatus = null;
        record.recommendationAnalysisError = null;
      }
      if (!next) {
        record.recommendationNote = "";
        record.recommendationDetails = emptyRecommendationDetails();
      }
    });
    render();
  } else if (action === "organize-recommendation") {
    const sheetScroll = trigger.closest(".judgement-sheet")?.scrollTop || 0;
    await runRecommendationAnalysis(currentRecord()?.id);
    requestAnimationFrame(() => {
      const sheet = document.querySelector(".judgement-sheet");
      if (sheet) sheet.scrollTop = sheetScroll;
    });
  } else if (action === "toggle-ai-recommendation") {
    const sheetScroll = trigger.closest(".judgement-sheet")?.scrollTop || 0;
    await updateRecord((record) => {
      const suggestion = record.recommendationAiSuggestions?.find((item) => item.suggestion_id === trigger.dataset.suggestionId);
      if (!suggestion) return;
      const details = normalizedRecommendationDetails(record);
      const values = details[suggestion.field] || [];
      const accepting = suggestion.status !== "accepted";
      details[suggestion.field] = accepting
        ? values.includes(suggestion.value) ? values : [...values, suggestion.value]
        : values.filter((value) => value !== suggestion.value);
      suggestion.status = accepting ? "accepted" : "pending";
      suggestion.provenance = accepting ? "user_accepted" : "ai_suggested";
      record.recommendationDetails = details;
    });
    render();
    requestAnimationFrame(() => {
      const sheet = document.querySelector(".judgement-sheet");
      if (sheet) sheet.scrollTop = sheetScroll;
    });
  } else if (action === "toggle-recommendation-preset") {
    const sheetScroll = trigger.closest(".judgement-sheet")?.scrollTop || 0;
    await updateRecord((record) => {
      const details = normalizedRecommendationDetails(record);
      const values = details[trigger.dataset.field] || [];
      details[trigger.dataset.field] = values.includes(trigger.dataset.option)
        ? values.filter((value) => value !== trigger.dataset.option)
        : [...values, trigger.dataset.option];
      record.recommendationDetails = details;
    });
    render();
    requestAnimationFrame(() => {
      const sheet = document.querySelector(".judgement-sheet");
      if (sheet) sheet.scrollTop = sheetScroll;
    });
  } else if (action === "accept-ai-card") {
    await updateRecord((record) => {
      const card = record.cards.find((item) => item.card_id === trigger.dataset.cardId);
      if (!card || card.provenance !== "ai_suggested") return;
      record.aiSuggestionHistory ||= [];
      record.aiSuggestionHistory.push({ suggestionType: "memory_card", suggestionId: card.card_id, action: "user_accepted", at: new Date().toISOString() });
      card.provenance = "user_accepted";
    });
    renderPreservingScroll();
    announce("这张记忆卡片已保留");
  } else if (action === "remove-ai-card") {
    await updateRecord((record) => {
      const index = record.cards.findIndex((item) => item.card_id === trigger.dataset.cardId);
      if (index < 0) return;
      const [card] = record.cards.splice(index, 1);
      record.aiSuggestionHistory ||= [];
      record.aiSuggestionHistory.push({ suggestionType: "memory_card", suggestionId: card.card_id, action: "user_removed", snapshot: card, at: new Date().toISOString() });
      record.cards.forEach((item, cardIndex) => { item.order = cardIndex; });
      state.activeCardIndex = Math.max(0, Math.min(state.activeCardIndex, record.cards.length - 1));
    });
    renderPreservingScroll();
    announce("这条整理建议已删除，原文没有改变");
  } else if (action === "add-card") {
    state.editingCardId = null;
    state.overlay = "card";
    render();
  } else if (action === "edit-card") {
    state.editingCardId = trigger.dataset.cardId;
    state.overlay = "card";
    render();
  } else if (action === "previous-card") {
    showMemoryCard(state.activeCardIndex - 1);
  } else if (action === "next-card") {
    showMemoryCard(state.activeCardIndex + 1);
  }
});

app.addEventListener("keydown", (event) => {
  if (event.target.id !== "composer-input" || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  const input = event.target;
  const edit = continueListOnEnter(input.value, input.selectionStart, input.selectionEnd);
  if (!edit) return;
  event.preventDefault();
  applyComposerEdit(input, edit);
});

app.addEventListener("input", (event) => {
  if (event.target.id === "composer-input") {
    saveDraft(event.target.value);
    updateSeriesHint(event.target.value);
    const finish = document.querySelector("[data-testid='finish-record']");
    if (finish) finish.disabled = !event.target.value.trim();
  } else if (event.target.matches("[data-testid='recommendation-note']")) {
    updateRecord((record) => { record.recommendationNote = event.target.value; });
  }
});

app.addEventListener("error", (event) => {
  if (!event.target.matches?.(".wallpaper-image")) return;
  event.target.hidden = true;
  document.querySelector(".wallpaper-credit")?.setAttribute("hidden", "");
}, true);

app.addEventListener("change", async (event) => {
  if (event.target.matches("[data-testid='recommendation-note']")) {
    await updateRecord((record) => { record.recommendationNote = event.target.value.trim(); });
    announce("推荐说明已保存");
  }
});

app.addEventListener("submit", async (event) => {
  if (event.target.id !== "card-form") return;
  event.preventDefault();
  const data = new FormData(event.target);
  const content = String(data.get("content") || "").trim();
  if (!content) return;
  const id = event.target.dataset.cardId;
  await updateRecord((record) => {
    if (id) {
      const card = record.cards.find((item) => item.card_id === id);
      if (card?.provenance === "ai_suggested") {
        record.aiSuggestionHistory ||= [];
        record.aiSuggestionHistory.push({ suggestionType: "memory_card", suggestionId: card.card_id, action: "user_modified", snapshot: { ...card }, at: new Date().toISOString() });
        card.provenance = "user_modified";
      }
      Object.assign(card, { type: data.get("type"), title: String(data.get("title") || "").trim(), content });
    } else {
      record.cards.push({
        card_id: createId("card"),
        type: data.get("type"),
        title: String(data.get("title") || "").trim(),
        content,
        is_core: false,
        order: record.cards.length,
        provenance: "user_added"
      });
      state.activeCardIndex = record.cards.length - 1;
    }
  });
  state.overlay = null;
  render();
  announce(id ? "记忆卡片已更新" : "记忆卡片已添加");
});

app.addEventListener("pointerdown", (event) => {
  const stage = event.target.closest(".memory-stage");
  if (!stage || event.target.closest("button")) return;
  carouselGesture = { x: event.clientX, y: event.clientY, at: performance.now(), stage };
  stage.classList.add("dragging");
});

app.addEventListener("pointermove", (event) => {
  if (!carouselGesture) return;
  const dx = Math.max(-72, Math.min(72, event.clientX - carouselGesture.x));
  const card = carouselGesture.stage.querySelector(".memory-card");
  if (card) card.style.transform = `translateX(${dx}px)`;
});

app.addEventListener("pointerup", (event) => {
  if (!carouselGesture) return;
  const { x, y, stage } = carouselGesture;
  const dx = event.clientX - x;
  const dy = event.clientY - y;
  const record = currentRecord();
  carouselGesture = null;
  stage.classList.remove("dragging");
  if (!record || Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.2) {
    const card = stage.querySelector(".memory-card");
    if (card) card.style.transform = "";
    return;
  }
  const nextIndex = dx < 0 ? state.activeCardIndex + 1 : state.activeCardIndex - 1;
  if (nextIndex < 0 || nextIndex >= record.cards.length) {
    const card = stage.querySelector(".memory-card");
    if (card) card.style.transform = "";
    return;
  }
  showMemoryCard(nextIndex, { focus: true });
  announce(`第 ${nextIndex + 1} 张记忆卡片`);
});

app.addEventListener("pointercancel", () => {
  if (!carouselGesture) return;
  const card = carouselGesture.stage.querySelector(".memory-card");
  if (card) card.style.transform = "";
  carouselGesture.stage.classList.remove("dragging");
  carouselGesture = null;
});

window.addEventListener("popstate", () => {
  const recordId = location.hash.startsWith("#record=") ? decodeURIComponent(location.hash.slice(8)) : null;
  state.overlay = null;
  if (recordId && state.records.some((record) => record.id === recordId)) {
    state.view = "detail";
    state.activeRecordId = recordId;
  } else {
    state.view = "home";
    state.activeRecordId = null;
  }
  render();
});

window.addEventListener("keydown", async (event) => {
  if (event.target.closest?.(".memory-stage") && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    const record = currentRecord();
    if (!record) return;
    const nextIndex = event.key === "ArrowRight" ? state.activeCardIndex + 1 : state.activeCardIndex - 1;
    if (nextIndex < 0 || nextIndex >= record.cards.length) return;
    event.preventDefault();
    showMemoryCard(nextIndex, { focus: true });
    announce(`第 ${nextIndex + 1} 张记忆卡片`);
    return;
  }
  if (event.key !== "Escape" || !state.overlay) return;
  if (state.overlay === "compose") await saveDraft(document.querySelector("#composer-input")?.value || "", true);
  state.overlay = null;
  render();
});

let fullViewportHeight = window.visualViewport?.height || innerHeight;

function updateVisualViewport() {
  const viewport = window.visualViewport;
  const visibleHeight = viewport?.height || innerHeight;
  const keyboardInset = Math.max(0, innerHeight - visibleHeight - (viewport?.offsetTop || 0));
  const composerFocused = document.activeElement?.id === "composer-input";
  fullViewportHeight = Math.max(fullViewportHeight, visibleHeight);
  const keyboardOpen = composerFocused && fullViewportHeight - visibleHeight > Math.min(120, fullViewportHeight * 0.18);
  document.documentElement.style.setProperty("--visible-height", `${visibleHeight}px`);
  document.documentElement.style.setProperty("--keyboard-inset", `${keyboardInset}px`);
  document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
}

window.visualViewport?.addEventListener("resize", updateVisualViewport);
window.visualViewport?.addEventListener("scroll", updateVisualViewport);
document.addEventListener("focusin", updateVisualViewport);
document.addEventListener("focusout", () => setTimeout(updateVisualViewport, 180));
window.addEventListener("pagehide", () => {
  const input = document.querySelector("#composer-input");
  if (input) db.put("drafts", { id: activeDraftId, text: input.value, revision: (state.draft?.revision || 0) + 1, updatedAt: new Date().toISOString() });
});

const serviceWorkerOriginAllowed = location.protocol === "https:"
  || (location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname));
if ("serviceWorker" in navigator && serviceWorkerOriginAllowed) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const storedTheme = localStorage.getItem("movie-imprint-theme");
applyTheme(storedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
updateVisualViewport();

if (new URLSearchParams(location.search).has("reset")) {
  await clearLocalData();
  history.replaceState({}, "", location.pathname);
}

try {
  await loadState();
  render();
} catch (error) {
  app.innerHTML = `<main class="fatal-error"><h1>无法打开本地记录</h1><p>${escapeHtml(error.message)}</p><p>请确认浏览器允许使用本地存储后再重试。</p></main>`;
}
