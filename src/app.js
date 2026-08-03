import { db, clearLocalData, migrateLocalToCloud } from "./db.js?v=12";
import { parseTicketText, draftViewingEvent } from "./ticket.js";
import { buildWorkSearchQuery } from "./bangumi.js?v=11";
import { applyListStyle, continueListOnEnter } from "./editor.js?v=8";
import { runMigrationIfNeeded } from "./migrate.js?v=1";
import { EVENT_TYPES } from "./event-types.js?v=1";
import { readClipboardTicketHint } from "./clipboard.js?v=1";
import { recordCard, emptyHomeStateMarkup } from "./record-card.js?v=1";
import { memoryListMarkup } from "./memory-list.js?v=1";
import {
  captureTransition,
  toggleEventType,
  updateEventTicketTags,
  updateBonusNote,
  tentativeViewingRelation,
  buildManualViewingEvent,
  captureWorkTitle,
  finalizeCaptureRecord,
  toggleEventSelection,
  selectAllEvents,
  selectedPendingEvents
} from "./capture.js?v=2";
import {
  ATTITUDES,
  ATTITUDE_DESCRIPTIONS,
  allowedRecommendationsForAttitude,
  CARD_TYPES,
  RECOMMENDATIONS,
  RECOMMENDATION_PRESETS,
  assignViewingRelations,
  attitudeLabel,
  createId,
  deterministicAnalysis,
  emptyRecommendationDetails,
  isRecommendationAllowed,
  mergeWorks,
  parseDraft,
  promoteWorkToMatched,
  reconcileLocalWorkTitle,
  recommendationLabel,
  resolveWork
} from "./domain.js?v=12";
import {
  MIME_TYPES,
  copyExportText,
  deliverExport,
  downloadExport,
  exportAllFilename,
  exportAllJSON,
  exportAllMarkdown,
  exportFilename,
  exportJSON,
  exportMarkdown,
  exportTXT
} from "./export.js?v=2";

const app = document.querySelector("#app");
const liveRegion = document.querySelector("#live-region");
const toastRegion = document.querySelector("#toast-region");
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
    throw new Error("密码错误，请在偏好设置中重新配置访问密码");
  }

  return response;
}

// 带访问密码的图片 URL（海报以 URL 形式嵌入 <img src>，无法加请求头，改用 ?token= 参数）
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
  worksById: new Map(),        // R3：work_id → work，首页卡片渲染 O(1) 查表
  recordEventById: new Map(),  // R3：record_id → 该记录关联的 ViewingEvent，首页卡片渲染 O(1) 查表
  recordingPreference: null,
  aiPreference: null,
  aiProviders: { active: null, providers: [] },
  draft: null,
  activeRecordId: null,
  editingCardId: null,
  returnScrollY: 0,
  saveTimer: null,
  saveState: "saved",
  theme: "light",
  // R2：记录入口重排——先认场景再写。
  // captureFlowState 是 docs/handoff/R2_CAPTURE_FLOW.md 状态机里的抽象状态名
  // （idle / capture:entry / capture:ticket-confirm / capture:scene-choice / capture:compose），
  // 由 src/capture.js 的 captureTransition 纯函数驱动；state.overlay 是它在 UI 层的具体呈现。
  captureFlowState: "idle",
  captureContext: null,          // 与 state.draft 一起持久化；Step 3 中断后据此恢复
  clipboardTicketDetected: false, // 只存"是否命中"，不存剪贴板原文
  captureTagsExpanded: new Set(), // 运行时 UI 态：哪些卡片的活动标签行已展开，不持久化
  viewingEvents: [],         // 当前详情页关联的已保存场次
  syncMigrateStatus: null   // "running" | "done" | "error" | null
};

let toastTimer = null;

// ─── R2：捕获流程状态机的 UI 呈现 ─────────────────────────────────────────────
// state.captureFlowState 用的是 captureTransition 里的抽象状态名；
// state.overlay 是渲染 render() 时实际读取的具体层名。两者用这张表对应起来，
// 这样状态机的转移规则始终只在 capture.js 里定义一份，app.js 不重新发明判断逻辑。
const CAPTURE_STATE_TO_OVERLAY = {
  idle: null,
  "capture:entry": "capture-entry",
  "capture:ticket-confirm": "ticket-confirm",
  "capture:scene-choice": "scene-choice",
  "capture:compose": "compose"
};

function applyCaptureTransition(action) {
  state.captureFlowState = captureTransition(state.captureFlowState, action, { source: state.captureContext?.source || null });
  state.overlay = CAPTURE_STATE_TO_OVERLAY[state.captureFlowState] ?? null;
}

// 剪贴板原文只放在内存里，绝不写入 state（避免被渲染或被草稿持久化捕获到原文）。
let pendingClipboardText = null;
let sceneTitleMatchTimer = null;

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
  chevron: '<path d="m9 5 7 7-7 7"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
};

// 单条记录导出：文件扩展名与 MIME 类型映射
const EXPORT_EXT = { json: "json", markdown: "md", txt: "txt" };

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

// announce() 只写屏幕阅读器才能听到的隐藏区域；复制/分享/下载这类没有其他可见状态变化的
// 操作，需要一个真正显示出来的轻提示，否则看得见屏幕的用户完全不知道操作有没有生效。
// 直接操作这个独立节点、不走 render()，这样不会打断正打开的 bottom-sheet 的滚动位置或焦点。
function showToast(message) {
  if (!toastRegion) return;
  toastRegion.textContent = message;
  toastRegion.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastRegion.classList.remove("visible"), 2200);
}

function notify(message) {
  announce(message);
  showToast(message);
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
  // R1：种子数据也走 resolveWork 去重，不再无条件给每条记录建一张独立档案卡——
  // 这批演示数据目前彼此都是不同电影，实际不会触发合并，但保持路径一致，
  // 避免留一条"仍在用旧建卡方式"的代码分支。
  const works = [];
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
    const { work, isNew } = resolveWork(works, {
      title: analysis.inputHints?.workTitle || sample.title,
      subjectId: null,
      aliases: []
    });
    if (isNew) works.push(work);
    record.work_id = work.id;
    record.workId = work.id;
    record.record_kind = "viewing";
    return { record, work };
  });
}

async function ensureSeedData() {
  if (new URLSearchParams(location.search).has("clean")) return;
  const records = await db.getAll("records");
  if (records.length) return;
  await Promise.all(publicSeedRecords().map(({ record, work }) => db.putRecordWithWork(record, work)));
}

async function ensureWorkLinks(records) {
  // R1：只有"记录还没有关联到任何 Work"（旧数据缺口）才会走到新建这一步，
  // 且新建统一通过 resolveWork 去重，不再无条件按 1:1 建一张新档案卡——
  // 否则一旦这条路径被触发，会重新制造"一部电影多张档案卡"的老问题。
  const works = await db.getAll("works");
  for (const record of records) {
    const linkedId = record.work_id || record.workId;
    const existingWork = linkedId ? works.find((item) => item.id === linkedId) : null;
    if (linkedId && existingWork) {
      const reconciled = reconcileLocalWorkTitle(existingWork, record);
      if (reconciled !== existingWork) {
        await db.put("works", reconciled);
        Object.assign(existingWork, reconciled);
      }
      if (record.work_id !== existingWork.id || record.workId !== existingWork.id) {
        record.work_id = existingWork.id;
        record.workId = existingWork.id;
        await db.put("records", record);
      }
      continue;
    }
    const { work, isNew } = resolveWork(works, {
      title: record.inputHints?.workTitle || record.title,
      subjectId: null,
      aliases: []
    });
    if (isNew) works.push(work);
    record.work_id = work.id;
    record.workId = work.id;
    await db.putRecordWithWork(record, work);
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
  await indexHomeCardData();
  state.records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // R2：草稿必须连同 captureContext 一起恢复——Step 3 中断后再打开 App，
  // 应该能直接从"继续写"回到 Step 3，而不是重走 Step 1/2。
  state.captureContext = state.draft?.captureContext || null;
  state.captureFlowState = state.captureContext ? "capture:compose" : "idle";
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
  if (!record) return null;
  return state.worksById.get(record.workId) || state.works.find((work) => work.id === record.workId) || null;
}

/**
 * R3：首页鉴赏履历卡需要每条 record 同时拿到 work（海报、标题）与 viewingEvent
 * （日期、影院、制式、初看重看）。这里一次性加载全量 viewingEvents 并建立索引，
 * 渲染时 O(1) 查表，不在 renderHome() 里逐条查库。
 */
async function indexHomeCardData() {
  state.worksById = new Map(state.works.map((work) => [work.id, work]));
  const allEvents = await db.getAll("viewingEvents");
  const eventsById = new Map((allEvents || []).map((event) => [event.id, event]));
  state.recordEventById = new Map();
  for (const record of state.records) {
    const event = record.viewing_event_id ? eventsById.get(record.viewing_event_id) : null;
    if (event) state.recordEventById.set(record.id, event);
  }
}

function topBar() {
  return `<header class="top-bar">
    <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><h1>电影印记</h1></div>
    <div class="top-actions">
      <button class="icon-button" type="button" data-action="theme" aria-label="切换到${state.theme === "dark" ? "浅色" : "深色"}主题">${icon(state.theme === "dark" ? "sun" : "theme")}</button>
      <button class="icon-button" type="button" aria-label="搜索（尚未接入）" disabled>${icon("search")}</button>
      <button class="icon-button" type="button" data-action="open-settings" aria-label="偏好设置">${icon("more")}</button>
    </div>
  </header>`;
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

function renderHome() {
  const draftCard = state.draft?.text?.trim() ? recordCard(state.draft, { isDraft: true, buildPosterUrl: apiBangumiImageUrl }) : "";
  const cards = state.records.map((record) => recordCard(record, {
    work: currentWork(record),
    event: state.recordEventById.get(record.id) || null,
    buildPosterUrl: apiBangumiImageUrl
  })).join("");
  const hasAnyCard = Boolean(draftCard || cards);
  return `<main class="home-view" data-testid="home">
    ${topBar()}
    <section class="feed" aria-label="电影记录">
      ${draftCard}
      ${cards}
      ${hasAnyCard ? "" : emptyHomeStateMarkup()}
    </section>
    <button class="fab" type="button" data-action="open-capture" aria-label="开始记录" data-testid="add-record">＋</button>
  </main>`;
}

function detailHeader(record) {
  return `<header class="detail-header">
    <button class="icon-button" type="button" data-action="go-home" aria-label="返回记录流">${icon("back")}</button>
    <div class="detail-header-actions">
      <button class="icon-button" type="button" data-action="open-export" aria-label="导出这条记录">${icon("export")}</button>
      <button class="icon-button" type="button" aria-label="更多（尚未接入）" disabled>${icon("more")}</button>
    </div>
  </header>`;
}

function exportOverlay(record) {
  const work = currentWork(record);
  const title = work?.title || record.title;
  return `<div class="overlay" data-testid="export-sheet">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭导出面板"></button>
    <section class="bottom-sheet export-sheet" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(title)}》</span><h2 id="export-title">导出这条记录</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>

      <button class="export-primary" type="button" data-action="export-share" data-testid="export-share">
        <span class="export-primary-icon" aria-hidden="true">${icon("share")}</span>
        <span class="export-primary-copy"><b>分享…</b><small>发到微信、备忘录、文件 App 等，比"下载"更容易找到</small></span>
        ${icon("chevron")}
      </button>

      <h3 class="settings-section-title">复制文本</h3>
      <div class="settings-actions">
        <button type="button" data-action="export-copy" data-format="markdown" data-testid="export-copy-markdown"><span><b>复制 Markdown</b><small>带标题与分节格式</small></span>${icon("copy")}</button>
        <button type="button" data-action="export-copy" data-format="txt" data-testid="export-copy-txt"><span><b>复制纯文本</b><small>适合直接粘贴阅读</small></span>${icon("copy")}</button>
      </div>

      <h3 class="settings-section-title">下载文件</h3>
      <div class="settings-actions">
        <button type="button" data-action="export-download" data-format="markdown" data-testid="export-download-markdown"><span><b>Markdown</b><small>.md 文件</small></span>${icon("export")}</button>
        <button type="button" data-action="export-download" data-format="txt" data-testid="export-download-txt"><span><b>纯文本</b><small>.txt 文件</small></span>${icon("export")}</button>
        <button type="button" data-action="export-download" data-format="json" data-testid="export-download-json"><span><b>JSON</b><small>完整结构化数据，适合备份</small></span>${icon("export")}</button>
      </div>
      <p class="settings-note">不含 AI 密钥或票务敏感字段。</p>
    </section>
  </div>`;
}

function memoryCard(record) {
  return memoryListMarkup(record.cards || [], { icon });
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

/**
 * R2 Step 3 顶部上下文条：不可编辑，弱化灰字，点击回到 Step 2（ticket-confirm 或 scene-choice）。
 * 没有 captureContext 的旧草稿（兼容期）不展示这一行。
 */
function captureContextBar(ctx) {
  if (!ctx) return "";
  const firstEvent = ctx.pendingEvents?.[0];
  const dateStr = firstEvent?.viewed_on
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(firstEvent.viewed_on))
    : "";
  const parts = [`《${ctx.workTitle?.trim() || "未命名作品"}》`];
  if (dateStr) parts.push(dateStr);
  if (ctx.locationType === "home") {
    parts.push("在家观看");
  } else {
    if (ctx.cinemaName) parts.push(ctx.cinemaName);
    if (ctx.format) parts.push(ctx.format);
  }
  return `<button type="button" class="capture-context-bar" data-action="edit-capture-context" data-testid="capture-context-bar">${parts.map(escapeHtml).join(" · ")}</button>`;
}

function composerOverlay() {
  const value = state.draft?.text || "";
  const hint = seriesHintContent(value);
  return `<div class="overlay" data-testid="composer">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="收起记录层"></button>
    <section class="bottom-sheet composer" role="dialog" aria-modal="true" aria-labelledby="compose-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 id="compose-title" class="sr-only">随手记录</h2>
      ${captureContextBar(state.captureContext)}
      <textarea id="composer-input" data-testid="composer-input" aria-describedby="compose-help" placeholder="看完之后，先把还没消失的感觉写下来">${escapeHtml(value)}</textarea>
      <div id="compose-help" class="sr-only">输入会即时保存在此设备。也可以用斜线临时提示系列与作品，或使用列表按钮插入有序和无序清单。</div>
      <div class="series-hint" data-testid="series-hint" ${hint ? "" : "hidden"}>${hint}</div>
      <div class="list-format-menu" data-testid="list-format-menu" hidden>
        <span>列表格式</span>
        <button type="button" data-action="apply-list" data-style="ordered">1. 有序</button>
        <button type="button" data-action="apply-list" data-style="unordered">- 无序</button>
      </div>
      <div class="compose-tools">
        <button type="button" class="tool-button hash-button" data-action="insert-hash" aria-label="插入强调标记">#</button>
        <button type="button" class="tool-button list-button" data-action="toggle-list-menu" aria-label="列表格式" aria-expanded="false">${icon("list")}</button>
        <span class="save-indicator" data-testid="save-status">${state.saveState === "saving" ? "正在保存…" : "已存于本机"}</span>
        <button type="button" class="finish-button" data-action="finish-compose" ${value.trim() ? "" : "disabled"} data-testid="finish-record">完成</button>
      </div>
    </section>
  </div>`;
}

function syncSettingsSection() {
  const enabled = !!(localStorage.getItem(ACCESS_PASSWORD_KEY));
  if (enabled) {
    const migrateStatus = state.syncMigrateStatus || "";
    return `<div class="settings-actions">
      <button type="button" data-action="test-sync-connection"><span><b>测试连接</b><small>验证云端数据库是否可用</small></span>${icon("chevron")}</button>
      <button type="button" data-action="migrate-to-cloud" ${migrateStatus === "running" ? "disabled" : ""}><span><b>上传本机数据到云端</b><small>${migrateStatus === "running" ? "上传中…" : migrateStatus === "done" ? "上传完成，刷新页面生效" : migrateStatus === "error" ? "上传失败，请重试" : "将本机已有记录同步到云端（一次性操作）"}</small></span>${icon("chevron")}</button>
      <button type="button" data-action="disconnect-sync"><span><b>断开云端同步</b><small>断开后数据只保存在本机</small></span>${icon("chevron")}</button>
    </div>`;
  }
  return `<div class="settings-sync-row">
    <input id="sync-password-input" type="password" placeholder="输入访问密码" autocomplete="current-password" />
    <button type="button" data-action="save-sync-password">开启同步</button>
  </div>
  <p class="settings-note" style="margin-top:var(--space-2)">输入部署时设置的访问密码，开启后数据跨设备同步。无密码时数据仅保存在本机。</p>`;
}

function settingsOverlay() {
  return `<div class="overlay" data-testid="settings">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭偏好设置"></button>
    <section class="bottom-sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">首页与记录</span><h2 id="settings-title">偏好设置</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <h3 class="settings-section-title">记录方式</h3>
      <div class="settings-actions">
        <button type="button" data-action="toggle-auto-analysis" aria-pressed="${state.recordingPreference?.autoAnalyze !== false}"><span><b>自动整理新记录</b><small data-testid="recording-mode">${state.recordingPreference?.autoAnalyze === false ? "当前关闭；完成时只保存原文" : "当前开启；原文保存后再后台整理"}</small></span><span class="settings-switch ${state.recordingPreference?.autoAnalyze === false ? "" : "on"}" aria-hidden="true"><i></i></span></button>
      </div>
      <h3 class="settings-section-title">整理服务</h3>
      <div class="provider-options" data-testid="ai-provider-options">
        ${state.aiProviders.providers.map((provider) => `<button type="button" data-action="select-ai-provider" data-provider="${provider.id}" class="provider-option ${state.aiPreference?.provider === provider.id ? "selected" : ""}" ${provider.configured ? "" : "disabled"} aria-pressed="${state.aiPreference?.provider === provider.id}"><span><b>${escapeHtml(provider.label)}</b><small>${provider.configured ? escapeHtml(provider.model) : "尚未配置密钥"}</small></span>${state.aiPreference?.provider === provider.id ? "✓" : ""}</button>`).join("")}
      </div>
      <h3 class="settings-section-title">云端同步</h3>
      ${syncSettingsSection()}
      <h3 class="settings-section-title">数据导出</h3>
      <div class="settings-actions">
        <button type="button" data-action="export-all-share" ${state.records.length ? "" : "disabled"}><span><b>分享全部记录（Markdown 合集）</b><small>${state.records.length ? `共 ${state.records.length} 条，一次分享` : "还没有可导出的记录"}</small></span>${icon("share")}</button>
        <button type="button" data-action="export-all-download" ${state.records.length ? "" : "disabled"}><span><b>下载全部记录（JSON 备份）</b><small>结构化数据，适合长期存档</small></span>${icon("export")}</button>
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

/**
 * R2 活动标签行：解析出的活动预选展示；没有任何活动时收起为一个「＋ 添加活动」小按钮。
 * @param {string[]} selected 当前已选中的 event_types
 * @param {string|number} key 用于区分是票务确认卡的第几场（"event-0"…）还是场景二选一（"scene"），
 *   既是展开状态的 key，也写进 data-tag-key 供点击处理定位
 */
function eventTypeTagsRow(selected, key) {
  const expanded = state.captureTagsExpanded.has(key) || selected.length > 0;
  if (!expanded) {
    return `<button type="button" class="add-event-tag" data-action="expand-event-tags" data-tag-key="${key}">＋ 添加活动</button>`;
  }
  return `<div class="event-tags-row" role="group" aria-label="活动类型">
    ${EVENT_TYPES.map(([typeKey, label]) => `<button type="button" class="event-tag-chip ${selected.includes(typeKey) ? "selected" : ""}" data-action="toggle-event-tag" data-tag-key="${key}" data-key="${typeKey}" aria-pressed="${selected.includes(typeKey)}">${selected.includes(typeKey) ? "✓ " : ""}${escapeHtml(label)}</button>`).join("")}
  </div>`;
}

/**
 * R2 Step 1 · 场景识别层。替换旧的「点＋直接进 composer」。
 * 剪贴板命中时才出现横幅（不展示原文）；大面积粘贴区；「没有票，直接写」次要入口。
 * W13 的截图 OCR 在这里预留位置，本窗口不实现、也不显示占位按钮。
 */
function captureEntryOverlay() {
  return `<div class="overlay" data-testid="capture-entry">
    <button class="overlay-backdrop" type="button" data-action="close-capture" aria-label="收起"></button>
    <section class="bottom-sheet capture-entry" role="dialog" aria-modal="true" aria-labelledby="capture-entry-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 id="capture-entry-title" class="sr-only">这次看的是什么</h2>
      ${state.clipboardTicketDetected ? `<button type="button" class="clipboard-hint-banner" data-action="use-clipboard-ticket" data-testid="clipboard-ticket-banner">
        <span>检测到票务信息 · 一键使用</span>${icon("chevron")}
      </button>` : ""}
      <label class="capture-paste-area" for="capture-paste-input">
        <textarea id="capture-paste-input" data-testid="capture-paste-input" placeholder="粘贴票务信息" rows="4"></textarea>
      </label>
      <button type="button" class="capture-skip-link" data-action="skip-to-scene" data-testid="skip-to-scene">没有票，直接写 →</button>
    </section>
  </div>`;
}

/**
 * R2 Step 2A · 票务确认卡（粘贴分支）。一屏一个「确认」按钮，不是工作台。
 * 海报／作品匹配、活动标签、初看重看都在这一层内联编辑，不设独立的「检查场次」页。
 */
function ticketConfirmOverlay() {
  const ctx = state.captureContext;
  if (!ctx) return "";
  const match = ctx.bangumiMatch || { status: "idle", candidates: [] };
  const dateFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
  const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });

  const posterBlock = match.status === "searching"
    ? `<div class="ticket-confirm-poster skeleton" aria-hidden="true" data-testid="capture-match-skeleton"></div>`
    : ctx.subjectId
      ? `<img class="ticket-confirm-poster" src="${apiBangumiImageUrl(ctx.subjectId)}" alt="" data-testid="capture-match-poster" onerror="this.hidden=true" />`
      : "";

  const candidatesBlock = ctx.showMatchCandidates ? `<div class="work-candidates" data-testid="capture-match-candidates">
    ${(match.candidates || []).slice(0, 3).map((c) => `<button type="button" class="work-candidate" data-action="select-capture-candidate" data-subject-id="${c.subjectId}">
      <b>${escapeHtml(c.title)}</b><span>${escapeHtml(c.originalTitle || "")}</span>
    </button>`).join("")}
    <label class="manual-title-fallback"><span>都不是，手动输入片名</span><input type="text" id="capture-manual-title-input" data-testid="capture-manual-title-input" value="${escapeHtml(ctx.workTitle || "")}" /></label>
  </div>` : "";

  const allEvents = ctx.pendingEvents || [];
  const selectedCount = selectedPendingEvents(allEvents).length;
  const allSelected = selectedCount >= allEvents.length;

  const cards = allEvents.map((event, index) => {
    const selected = event.selected !== false;
    const ec = event.viewing_context || {};
    const dateStr = event.viewed_on ? dateFmt.format(new Date(`${event.viewed_on}T00:00:00`)) : "";
    const startStr = event.screening_at ? timeFmt.format(new Date(event.screening_at)) : "";
    const endStr = event.screening_ends_at ? timeFmt.format(new Date(event.screening_ends_at)) : "";
    const timeRange = startStr ? (endStr ? `${startStr}–${endStr}` : startStr) : "";
    const seatsStr = ec.seats?.length ? ec.seats.join("、") : "";
    const priceStr = event.ticket_price?.amount ? `￥${Number(event.ticket_price.amount).toLocaleString("ja-JP")}` : "";
    const tentative = tentativeViewingRelation(ctx.existingHistoryCount || 0, index);
    const currentRelation = event.viewing_relation || tentative;

    // 场次数量 > 1 时才需要"是否采纳这一场"的开关——只有一场时没有可排除的对象。
    const selectionToggle = allEvents.length > 1 ? `<button type="button" class="ticket-confirm-select ${selected ? "selected" : ""}" data-action="toggle-ticket-event-selection" data-event-index="${index}" aria-pressed="${selected}">
      <span class="ticket-confirm-select-indicator" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span>${selected ? "已加入" : "不使用这场"}</span>
    </button>` : "";

    return `<div class="ticket-confirm-card ${selected ? "" : "excluded"}" data-testid="ticket-confirm-card" data-event-index="${index}">
      ${selectionToggle}
      <div class="ticket-confirm-meta">
        ${ec.cinema_name ? `<span>${escapeHtml(ec.cinema_name)}</span>` : ""}
        ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ""}
        ${timeRange ? `<span>${escapeHtml(timeRange)}</span>` : ""}
      </div>
      <div class="ticket-confirm-meta secondary">
        ${ec.format ? `<span>${escapeHtml(ec.format)}</span>` : ""}
        ${event.duration_minutes ? `<span>${event.duration_minutes}分</span>` : ""}
        ${seatsStr ? `<span>座位 ${escapeHtml(seatsStr)}</span>` : ""}
        ${priceStr ? `<span>${escapeHtml(priceStr)}</span>` : ""}
      </div>
      ${selected ? `${eventTypeTagsRow(ec.event_types || [], `event-${index}`)}
      ${(ec.event_types || []).includes("bonus_distribution") ? `<label class="bonus-note-input"><span>特典</span><input type="text" data-field="bonus-note" data-event-index="${index}" value="${escapeHtml(ec.bonus_note || "")}" placeholder="如：第3週 色紙" /></label>` : ""}
      ${ctx.hasHistory ? `<div class="relation-toggle" role="group" aria-label="初看或重看">
        <button type="button" class="relation-choice ${currentRelation === "first" ? "selected" : ""}" data-action="set-relation" data-event-index="${index}" data-value="first">初看</button>
        <button type="button" class="relation-choice ${currentRelation === "rewatch" ? "selected" : ""}" data-action="set-relation" data-event-index="${index}" data-value="rewatch">重看 · 第 ${(ctx.existingHistoryCount || 0) + index + 1} 次</button>
      </div>` : ""}` : ""}
    </div>`;
  }).join("");

  const ctaLabel = allEvents.length > 1
    ? (selectedCount > 0 ? `确认（${selectedCount} 个场次）` : "请至少选择一个场次")
    : "确认";

  return `<div class="overlay" data-testid="ticket-confirm">
    <button class="overlay-backdrop" type="button" data-action="close-capture" aria-label="关闭"></button>
    <section class="bottom-sheet ticket-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="ticket-confirm-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      ${posterBlock}
      <div class="ticket-confirm-title-row">
        <h2 id="ticket-confirm-title">《${escapeHtml(ctx.workTitle || "未命名作品")}》</h2>
        <button type="button" class="text-action" data-action="toggle-capture-match-candidates" data-testid="change-capture-match">更换</button>
      </div>
      ${candidatesBlock}
      <div class="ticket-confirm-cards">${cards}</div>
      ${!allSelected && allEvents.length > 1 ? `<button type="button" class="text-action" data-action="select-all-ticket-events" data-testid="select-all-ticket-events">全选</button>` : ""}
      <p class="ticket-privacy-note">姓名、邮箱、取票码已本地移除，原始邮件不保存</p>
      <div class="ticket-actions">
        <button type="button" class="sheet-done" data-action="confirm-ticket-capture" data-testid="confirm-ticket-capture" ${selectedCount === 0 ? "disabled" : ""}>${escapeHtml(ctaLabel)}</button>
        <button type="button" class="text-action" data-action="repaste-ticket-capture">重新粘贴</button>
      </div>
    </section>
  </div>`;
}

const CINEMA_FORMAT_OPTIONS = ["2D", "3D", "IMAX", "IMAXレーザー", "Dolby Cinema", "4DX", "MX4D", "ScreenX", "其他"];

/**
 * R2 Step 2B · 场景二选一（跳过分支）。初看／重看与观看地点完全正交——
 * 两条分支共用同一套「该作品已有历史才显示选择器」逻辑，不做「影院＝初看」之类的假设。
 */
function sceneChoiceOverlay() {
  const ctx = state.captureContext || {};
  const locationType = ctx.locationType || null;
  const match = ctx.bangumiMatch || { status: "idle", candidates: [] };
  const eventTypes = ctx.eventTypes || [];
  const canConfirm = Boolean(locationType) && Boolean(ctx.workTitle?.trim());
  return `<div class="overlay" data-testid="scene-choice">
    <button class="overlay-backdrop" type="button" data-action="close-capture" aria-label="关闭"></button>
    <section class="bottom-sheet scene-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="scene-choice-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 id="scene-choice-title">这次是在哪看的？</h2>
      <div class="location-choice" role="group" aria-label="观看地点">
        <button type="button" class="location-option ${locationType === "home" ? "selected" : ""}" data-action="select-location" data-value="home" data-testid="location-home">在家／线上</button>
        <button type="button" class="location-option ${locationType === "cinema" ? "selected" : ""}" data-action="select-location" data-value="cinema" data-testid="location-cinema">在影院</button>
      </div>
      ${locationType === "cinema" ? `<div class="cinema-fields">
        <label><span>影院名</span><input type="text" id="scene-cinema-name-input" data-testid="scene-cinema-name-input" value="${escapeHtml(ctx.cinemaName || "")}" placeholder="影院名称" /></label>
        <label><span>制式</span><select id="scene-format-select" data-testid="scene-format-select">
          ${CINEMA_FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${ctx.format === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
        </select></label>
        ${eventTypeTagsRow(eventTypes, "scene")}
        ${eventTypes.includes("bonus_distribution") ? `<label class="bonus-note-input"><span>特典</span><input type="text" data-field="bonus-note" data-event-index="scene" value="${escapeHtml(ctx.bonusNote || "")}" placeholder="如：第3週 色紙" /></label>` : ""}
      </div>` : ""}
      <label class="scene-work-title"><span>作品</span><input type="text" id="scene-work-title-input" data-testid="scene-work-title-input" value="${escapeHtml(ctx.workTitle || "")}" placeholder="作品名" /></label>
      ${match.status === "candidates" ? `<div class="work-candidates" data-testid="scene-match-candidates">
        ${match.candidates.slice(0, 3).map((c) => `<button type="button" class="work-candidate" data-action="select-scene-candidate" data-subject-id="${c.subjectId}"><b>${escapeHtml(c.title)}</b><span>${escapeHtml(c.originalTitle || "")}</span></button>`).join("")}
      </div>` : ""}
      ${ctx.hasHistory ? `<div class="relation-toggle" role="group" aria-label="初看或重看">
        <button type="button" class="relation-choice ${(ctx.relationOverride || tentativeViewingRelation(ctx.existingHistoryCount || 0, 0)) === "first" ? "selected" : ""}" data-action="set-scene-relation" data-value="first">初看</button>
        <button type="button" class="relation-choice ${(ctx.relationOverride || tentativeViewingRelation(ctx.existingHistoryCount || 0, 0)) === "rewatch" ? "selected" : ""}" data-action="set-scene-relation" data-value="rewatch">重看 · 第 ${(ctx.existingHistoryCount || 0) + 1} 次</button>
      </div>` : ""}
      <button type="button" class="sheet-done" data-action="confirm-scene-choice" data-testid="confirm-scene-choice" ${canConfirm ? "" : "disabled"}>确认</button>
    </section>
  </div>`;
}

function render() {
  const base = state.view === "detail" ? renderDetail() : renderHome();
  const record = currentRecord();
  const overlay = state.overlay === "capture-entry"
    ? captureEntryOverlay()
    : state.overlay === "ticket-confirm"
      ? ticketConfirmOverlay()
    : state.overlay === "scene-choice"
      ? sceneChoiceOverlay()
    : state.overlay === "compose"
      ? composerOverlay()
    : state.overlay === "settings"
      ? settingsOverlay()
    : state.overlay === "attitude" && record
      ? attitudeOverlay(record)
      : state.overlay === "card" && record
        ? cardEditorOverlay(record)
      : state.overlay === "export" && record
        ? exportOverlay(record)
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
    state.draft = {
      id: activeDraftId,
      text,
      revision: previousRevision + 1,
      updatedAt: new Date().toISOString(),
      captureContext: state.captureContext || null // R2：草稿必须连同 captureContext 一起持久化
    };
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
  const record = finalizeCaptureRecord(text, now);

  // R2：作品标题来自 captureContext（票务解析出的片名，或场景二选一里手填/匹配的标题），
  // 不再要求用户输入 #；仍兼容没有 captureContext 的旧草稿（回退到 # 解析）。
  const resolvedTitle = captureWorkTitle(text, state.captureContext);
  record.title = resolvedTitle;
  record.inputHints = { ...(record.inputHints || {}), workTitle: resolvedTitle };

  // R1：同一部电影无论写几条感想，只解析出一个 Work（按标题/别名查重，不新建 1:1 Work）
  const { work } = resolveWork(state.works, {
    title: resolvedTitle,
    subjectId: state.captureContext?.subjectId ?? null,
    aliases: []
  });
  record.work_id = work.id;
  record.workId = work.id;              // 兼容期保留，供旧读取点过渡
  record.record_kind = "viewing";
  record.viewing_event_id = null;       // 有 Event 时下方回填

  await db.putRecordWithWork(record, work);

  const pendingEvents = state.captureContext?.pendingEvents || [];
  if (pendingEvents.length > 0) {
    const confirmedAt = new Date().toISOString();
    const newEvents = pendingEvents.map((e) => ({
      ...e,
      work_id: work.id,
      record_id: record.id,
      confirmed_at: e.confirmed_at || confirmedAt,
      status: "confirmed"
    }));
    // 每次写入 ViewingEvent 后，都要对该 work 下全部事件重跑初看/重看推定并整体回写，
    // 不能只给新事件递增编号——补录更早的一次观看时，原来的"初看"要正确变成"重看"。
    let existingEvents = [];
    try { existingEvents = await db.getViewingEventsByWork(work.id); } catch (_) { /* 首次记录该作品，允许为空 */ }
    const newEventIds = new Set(newEvents.map((e) => e.id));
    const allEvents = assignViewingRelations([...existingEvents.filter((e) => !newEventIds.has(e.id)), ...newEvents]);
    await db.putViewingEvents(allEvents);
    state.viewingEvents = allEvents;
    // 票务粘贴通常一次确认一场；多场时取第一场回填到 record.viewing_event_id
    const firstNew = allEvents.find((e) => newEventIds.has(e.id));
    if (firstNew) {
      record.viewing_event_id = firstNew.id;
      await db.put("records", record);
    }
  }

  applyCaptureTransition("finish");
  state.captureContext = null;
  state.captureTagsExpanded = new Set();
  await db.delete("drafts", activeDraftId);
  state.draft = null;
  state.records.unshift(record);
  if (!state.works.some((item) => item.id === work.id)) state.works.push(work);
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

  // R1：local work 匹配到 Bangumi 后升格；若升格后的 id 与某个已存在的 work 冲突
  // （同一部电影之前已有另一条已匹配记录），合并二者，并把所有指向旧 id 的
  // record 与 viewing event 改指到合并后的 id——保证"同一部电影只有一个 Work"。
  const promoted = promoteWorkToMatched(work, subjectId, {
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    type: candidate.type,
    releaseDate: candidate.releaseDate
  });
  const oldId = work.id;
  const conflictingWork = promoted.id !== oldId
    ? state.works.find((item) => item.id === promoted.id)
    : null;
  const finalWork = conflictingWork ? mergeWorks(conflictingWork, [promoted]) : promoted;

  await db.put("works", finalWork);

  const staleIds = [...new Set([oldId, conflictingWork?.id].filter((id) => id && id !== finalWork.id))];
  if (staleIds.length) {
    for (const item of state.records) {
      if (staleIds.includes(item.work_id || item.workId)) {
        item.work_id = finalWork.id;
        item.workId = finalWork.id;
        await db.put("records", item);
      }
    }
    const staleEventGroups = await Promise.all(
      staleIds.map((id) => db.getViewingEventsByWork(id).catch(() => []))
    );
    const staleEvents = staleEventGroups.flat().map((event) => ({ ...event, work_id: finalWork.id }));
    if (staleEvents.length) {
      let currentEvents = [];
      try { currentEvents = await db.getViewingEventsByWork(finalWork.id); } catch (_) { /* 忽略 */ }
      const currentIds = new Set(currentEvents.map((event) => event.id));
      const merged = assignViewingRelations([...currentEvents, ...staleEvents.filter((event) => !currentIds.has(event.id))]);
      await db.putViewingEvents(merged);
      if (state.activeRecordId) state.viewingEvents = merged.filter((event) => event.work_id === finalWork.id);
    }
  }

  state.works = state.works.filter((item) => item.id !== oldId && item.id !== conflictingWork?.id);
  state.works.push(finalWork);

  await resolveDailyWallpaper();
  render();
  announce(`已确认作品：${finalWork.title}`);
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

// ─── R2：捕获流程的异步辅助函数（剪贴板、票务解析、Bangumi 匹配、历史判断）─────

/**
 * 打开 Step 1 时静默尝试读取剪贴板。权限被拒或不支持时 readClipboardTicketHint
 * 已经处理为返回 null，这里不弹任何提示、不影响流程。命中后只记一个布尔值，
 * 原文缓存在模块级变量里，绝不写入 state（state 会被渲染，也可能被草稿持久化）。
 */
async function peekClipboardForTicket() {
  const hint = await readClipboardTicketHint();
  if (!hint || !hint.looksLikeTicket) return;
  if (state.overlay !== "capture-entry") return; // 用户已经离开这一层，不再打扰
  pendingClipboardText = hint.text;
  state.clipboardTicketDetected = true;
  render();
}

/**
 * 解析粘贴的票务文本，成功则转入 Step 2A（ticket-confirm）。
 * 失败或没有识别到场次时只提示，不影响用户已经打的字（此时还没有任何文字输入）。
 */
function handleCapturePaste(rawText) {
  if (!rawText || !rawText.trim()) return;
  let result;
  try {
    result = parseTicketText(rawText);
  } catch (_) {
    announce("解析失败，请检查粘贴内容");
    return;
  }
  if (!result.screenings.length) {
    announce("未能识别出场次，请检查粘贴内容");
    return;
  }
  // 默认全选，但每场都保留 selected 标记——用户可以单独排除误识别的场次，
  // 不必因为一场解析错了就整体重新粘贴。
  const pendingEvents = result.screenings.map((s) => ({ ...draftViewingEvent(s, "work_capture_pending"), selected: true }));
  const workTitle = result.screenings[0]?.movieTitle || "";
  state.captureContext = {
    source: "ticket_paste",
    locationType: "cinema",
    workTitle,
    subjectId: null,
    showMatchCandidates: false,
    bangumiMatch: { status: "idle", candidates: [], query: workTitle },
    hasHistory: false,
    existingHistoryCount: 0,
    pendingEvents
  };
  state.captureTagsExpanded = new Set();
  applyCaptureTransition("paste-ticket");
  render();
  void runCaptureBangumiMatch(workTitle);
  void refreshCaptureHistoryFlag();
}

/**
 * 用捕获上下文当前的作品标题去搜 Bangumi，结果写进 captureContext.bangumiMatch。
 * 与 requestWorkMatch 的区别：这里操作的是还没有落库的 Work，只是给确认卡展示用。
 */
async function runCaptureBangumiMatch(query) {
  const ctx = state.captureContext;
  if (!ctx || !query?.trim()) return;
  ctx.bangumiMatch = { status: "searching", candidates: [], query };
  render();
  try {
    const response = await apiFetch(`/api/bangumi/search?q=${encodeURIComponent(query)}`, { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "作品匹配暂不可用");
    if (state.captureContext !== ctx) return; // 用户已经离开或重新开始
    ctx.bangumiMatch = payload.candidates?.length
      ? { status: "candidates", candidates: payload.candidates, query }
      : { status: "none", candidates: [], query };
  } catch (error) {
    if (state.captureContext !== ctx) return;
    ctx.bangumiMatch = { status: "unavailable", candidates: [], query, message: error.message };
  }
  render();
}

/**
 * 判断当前捕获上下文对应的作品是否已有历史观影记录——只有这样才展示初看/重看选择器。
 * 用 resolveWork 做只读试探（不落库），不新建 work，也不影响 state.works。
 */
async function refreshCaptureHistoryFlag() {
  const ctx = state.captureContext;
  if (!ctx) return;
  const title = ctx.workTitle;
  if (!title?.trim()) { ctx.hasHistory = false; ctx.existingHistoryCount = 0; render(); return; }
  const { work, isNew } = resolveWork(state.works, { title, subjectId: ctx.subjectId, aliases: [] });
  if (isNew) { ctx.hasHistory = false; ctx.existingHistoryCount = 0; render(); return; }
  try {
    const events = await db.getViewingEventsByWork(work.id);
    if (state.captureContext !== ctx) return;
    ctx.hasHistory = events.length > 0;
    ctx.existingHistoryCount = events.length;
  } catch (_) {
    ctx.hasHistory = false;
    ctx.existingHistoryCount = 0;
  }
  render();
}

async function updateRecord(mutator) {
  const record = currentRecord();
  if (!record) return;
  mutator(record);
  record.updatedAt = new Date().toISOString();
  await db.put("records", record);
}

async function buildAllExportEntries() {
  return Promise.all(state.records.map(async (record) => {
    const work = state.works.find((item) => item.id === record.workId) || null;
    let viewingEvents = [];
    if (record.workId) {
      try { viewingEvents = await db.getViewingEventsByWork(record.workId); } catch (_) { /* 单条场次加载失败不影响整体导出 */ }
    }
    return { record, work, viewingEvents };
  }));
}

async function openRecord(recordId) {
  state.returnScrollY = scrollY;
  state.activeRecordId = recordId;
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

app.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const { action } = trigger.dataset;
  if (action === "theme") {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    render();
  } else if (action === "open-settings") {
    state.overlay = "settings";
    render();
  } else if (action === "toggle-auto-analysis") {
    state.recordingPreference = {
      id: "recording-preference",
      autoAnalyze: state.recordingPreference?.autoAnalyze === false
    };
    await db.put("meta", state.recordingPreference);
    render();
    announce(state.recordingPreference.autoAnalyze ? "已开启自动整理" : "新记录将只保存原文");
  } else if (action === "test-sync-connection") {
    try {
      const res = await apiFetch("/api/sync/status");
      const data = await res.json();
      // eslint-disable-next-line no-alert
      alert(data.ok ? "✅ 云端数据库连接正常！" : `❌ 连接失败：${data.error}`);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`❌ 请求失败：${e.message}`);
    }
  } else if (action === "migrate-to-cloud") {
    state.syncMigrateStatus = "running";
    render();
    try {
      await migrateLocalToCloud((msg) => announce(msg));
      state.syncMigrateStatus = "done";
      announce("本机数据已上传到云端，刷新页面可看到最新数据");
    } catch (e) {
      state.syncMigrateStatus = "error";
      console.error("[migrate]", e);
      announce(`上传失败：${e.message}`);
    }
    render();
  } else if (action === "save-sync-password") {
    const input = document.querySelector("#sync-password-input");
    const password = input?.value.trim() || "";
    if (password) {
      setAccessPassword(password);
      render();
      announce("云端同步已开启");
    }
  } else if (action === "disconnect-sync") {
    localStorage.removeItem(ACCESS_PASSWORD_KEY);
    render();
    announce("已断开云端同步，数据保存在本机");
  } else if (action === "select-ai-provider") {
    state.aiPreference = { id: "ai-preference", provider: trigger.dataset.provider };
    await db.put("meta", state.aiPreference);
    render();
    announce(`已选择${trigger.textContent.trim()}作为整理服务`);
  } else if (action === "open-capture") {
    // R2 Step 1：点＋不再直接进 composer，先认场景。
    state.returnScrollY = scrollY;
    state.captureContext = null;
    state.captureTagsExpanded = new Set();
    state.clipboardTicketDetected = false;
    pendingClipboardText = null;
    applyCaptureTransition("open-capture");
    render();
    void peekClipboardForTicket();
  } else if (action === "resume-draft") {
    // 继续写：captureContext 已在 loadState() 时从草稿里恢复，直接回到 Step 3。
    state.returnScrollY = scrollY;
    state.captureFlowState = state.captureContext ? "capture:compose" : "idle";
    state.overlay = "compose";
    render();
    focusComposer();
  } else if (action === "close-capture") {
    // Step 1/2A/2B 的背景点击：还没有产生任何记录，直接丢弃这次捕获上下文。
    state.captureContext = null;
    state.captureTagsExpanded = new Set();
    applyCaptureTransition("close");
    render();
  } else if (action === "use-clipboard-ticket") {
    handleCapturePaste(pendingClipboardText || "");
  } else if (action === "skip-to-scene") {
    state.captureContext = {
      source: "manual",
      locationType: null,
      workTitle: "",
      cinemaName: null,
      format: null,
      eventTypes: [],
      bonusNote: null,
      subjectId: null,
      bangumiMatch: { status: "idle", candidates: [] },
      hasHistory: false,
      existingHistoryCount: 0,
      relationOverride: null,
      relationLocked: false
    };
    state.captureTagsExpanded = new Set();
    applyCaptureTransition("skip");
    render();
  } else if (action === "repaste-ticket-capture") {
    state.captureContext = null;
    state.captureTagsExpanded = new Set();
    applyCaptureTransition("repaste");
    render();
  } else if (action === "toggle-capture-match-candidates") {
    if (!state.captureContext) return;
    state.captureContext.showMatchCandidates = !state.captureContext.showMatchCandidates;
    render();
  } else if (action === "select-capture-candidate") {
    const ctx = state.captureContext;
    if (!ctx) return;
    const candidate = ctx.bangumiMatch?.candidates?.find((c) => c.subjectId === Number(trigger.dataset.subjectId));
    if (!candidate) return;
    ctx.workTitle = candidate.title;
    ctx.subjectId = candidate.subjectId;
    ctx.showMatchCandidates = false;
    render();
    void refreshCaptureHistoryFlag();
  } else if (action === "toggle-event-tag") {
    const ctx = state.captureContext;
    if (!ctx) return;
    const tagKey = trigger.dataset.tagKey;
    const eventTypeKey = trigger.dataset.key;
    if (tagKey === "scene") {
      ctx.eventTypes = toggleEventType(ctx.eventTypes, eventTypeKey);
      ctx.bonusNote = ctx.eventTypes.includes("bonus_distribution") ? ctx.bonusNote : null;
    } else {
      const index = Number(tagKey.replace("event-", ""));
      const nextTypes = toggleEventType(ctx.pendingEvents[index].viewing_context.event_types, eventTypeKey);
      ctx.pendingEvents[index] = updateEventTicketTags(ctx.pendingEvents[index], nextTypes);
    }
    render();
  } else if (action === "expand-event-tags") {
    state.captureTagsExpanded.add(trigger.dataset.tagKey);
    render();
  } else if (action === "set-relation") {
    const ctx = state.captureContext;
    const index = Number(trigger.dataset.eventIndex);
    if (!ctx?.pendingEvents?.[index]) return;
    ctx.pendingEvents[index] = { ...ctx.pendingEvents[index], viewing_relation: trigger.dataset.value, relation_locked: true };
    render();
  } else if (action === "toggle-ticket-event-selection") {
    // 用户逐场次排除误识别的场次——不强制采纳解析出的全部内容，也不必整体重新粘贴。
    const ctx = state.captureContext;
    const index = Number(trigger.dataset.eventIndex);
    if (!ctx?.pendingEvents) return;
    ctx.pendingEvents = toggleEventSelection(ctx.pendingEvents, index);
    render();
  } else if (action === "select-all-ticket-events") {
    const ctx = state.captureContext;
    if (!ctx?.pendingEvents) return;
    ctx.pendingEvents = selectAllEvents(ctx.pendingEvents);
    render();
  } else if (action === "set-scene-relation") {
    if (!state.captureContext) return;
    state.captureContext.relationOverride = trigger.dataset.value;
    state.captureContext.relationLocked = true;
    render();
  } else if (action === "confirm-ticket-capture") {
    const ctx = state.captureContext;
    const selected = selectedPendingEvents(ctx?.pendingEvents);
    if (!selected.length) return;
    ctx.pendingEvents = selected; // 只把用户勾选的场次带进 compose，排除的场次彻底丢弃
    applyCaptureTransition("confirm");
    await saveDraft(state.draft?.text || "", true);
    render();
    focusComposer();
  } else if (action === "select-location") {
    if (!state.captureContext) return;
    state.captureContext.locationType = trigger.dataset.value;
    render();
  } else if (action === "select-scene-candidate") {
    const ctx = state.captureContext;
    if (!ctx) return;
    const candidate = ctx.bangumiMatch?.candidates?.find((c) => c.subjectId === Number(trigger.dataset.subjectId));
    if (!candidate) return;
    ctx.workTitle = candidate.title;
    ctx.subjectId = candidate.subjectId;
    render();
    void refreshCaptureHistoryFlag();
  } else if (action === "confirm-scene-choice") {
    const ctx = state.captureContext;
    if (!ctx?.locationType || !ctx.workTitle?.trim()) return;
    const event = buildManualViewingEvent({
      locationType: ctx.locationType,
      cinemaName: ctx.cinemaName,
      format: ctx.format,
      eventTypes: ctx.eventTypes,
      bonusNote: ctx.bonusNote
    });
    if (ctx.relationLocked && ctx.relationOverride) {
      event.viewing_relation = ctx.relationOverride;
      event.relation_locked = true;
    }
    ctx.pendingEvents = [event];
    applyCaptureTransition("confirm");
    await saveDraft(state.draft?.text || "", true);
    render();
    focusComposer();
  } else if (action === "edit-capture-context") {
    applyCaptureTransition("edit-context");
    render();
  } else if (action === "close-overlay") {
    if (state.overlay === "compose") {
      const text = document.querySelector("#composer-input")?.value || "";
      await saveDraft(text, true);
      applyCaptureTransition("close");
    } else {
      state.overlay = null;
    }
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
  } else if (action === "open-export") {
    state.overlay = "export";
    render();
  } else if (action === "export-share") {
    const record = currentRecord();
    if (!record) return;
    const work = currentWork(record);
    const content = exportMarkdown(record, work, state.viewingEvents);
    const filename = exportFilename(work, record, "md");
    try {
      const result = await deliverExport({ content, filename, mimeType: MIME_TYPES.markdown, shareTitle: work?.title || record.title });
      if (result.method === "cancelled") return;
      notify(result.method === "download" ? "这个浏览器不支持分享，已改为下载文件" : "已分享");
    } catch (error) {
      notify(`分享失败：${error.message}`);
    }
  } else if (action === "export-copy") {
    const record = currentRecord();
    if (!record) return;
    const work = currentWork(record);
    const format = trigger.dataset.format;
    const content = format === "txt" ? exportTXT(record, work, state.viewingEvents) : exportMarkdown(record, work, state.viewingEvents);
    try {
      await copyExportText(content);
      notify("已复制到剪贴板");
    } catch (_) {
      notify("复制失败，这个浏览器可能不支持剪贴板权限");
    }
  } else if (action === "export-download") {
    const record = currentRecord();
    if (!record) return;
    const work = currentWork(record);
    const format = trigger.dataset.format;
    const content = format === "json" ? exportJSON(record, work, state.viewingEvents)
      : format === "txt" ? exportTXT(record, work, state.viewingEvents)
      : exportMarkdown(record, work, state.viewingEvents);
    downloadExport(content, exportFilename(work, record, EXPORT_EXT[format]), MIME_TYPES[format]);
    notify("已下载文件");
  } else if (action === "export-all-share") {
    if (!state.records.length) { notify("还没有可导出的记录"); return; }
    const entries = await buildAllExportEntries();
    const content = exportAllMarkdown(entries);
    try {
      const result = await deliverExport({ content, filename: exportAllFilename("md"), mimeType: MIME_TYPES.markdown, shareTitle: "电影印记 · 全部记录" });
      if (result.method === "cancelled") return;
      notify(result.method === "download" ? "这个浏览器不支持分享，已改为下载文件" : "已分享");
    } catch (error) {
      notify(`分享失败：${error.message}`);
    }
  } else if (action === "export-all-download") {
    if (!state.records.length) { notify("还没有可导出的记录"); return; }
    const entries = await buildAllExportEntries();
    downloadExport(exportAllJSON(entries), exportAllFilename("json"), MIME_TYPES.json);
    notify("已下载全部记录的 JSON 备份");
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
  } else if (event.target.id === "scene-work-title-input" || event.target.id === "capture-manual-title-input") {
    // R2：作品标题输入是"受控但不整页重渲染"——保留光标，只手动同步按钮可用态与防抖匹配。
    if (!state.captureContext) return;
    state.captureContext.workTitle = event.target.value;
    const confirmButton = document.querySelector("[data-testid='confirm-scene-choice']");
    if (confirmButton) confirmButton.disabled = !(state.captureContext.locationType && event.target.value.trim());
    clearTimeout(sceneTitleMatchTimer);
    const query = event.target.value.trim();
    if (query.length >= 2) {
      sceneTitleMatchTimer = setTimeout(() => {
        void runCaptureBangumiMatch(query);
        void refreshCaptureHistoryFlag();
      }, 400);
    }
  } else if (event.target.id === "scene-cinema-name-input") {
    if (state.captureContext) state.captureContext.cinemaName = event.target.value;
  } else if (event.target.matches("[data-field='bonus-note']")) {
    const ctx = state.captureContext;
    if (!ctx) return;
    const eventIndex = event.target.dataset.eventIndex;
    if (eventIndex === "scene") {
      ctx.bonusNote = event.target.value;
    } else {
      const idx = Number(eventIndex);
      if (ctx.pendingEvents?.[idx]) ctx.pendingEvents[idx] = updateBonusNote(ctx.pendingEvents[idx], event.target.value);
    }
  }
});

// R2 Step 1：大面积粘贴区不需要显式"识别"按钮——粘贴动作本身触发解析。
// 用 paste 事件而非 input，避免用户手打文字时被误当票务文本解析。
app.addEventListener("paste", (event) => {
  if (event.target.id !== "capture-paste-input") return;
  const fromClipboardData = event.clipboardData?.getData("text") || "";
  if (fromClipboardData) {
    handleCapturePaste(fromClipboardData);
    return;
  }
  // 部分移动端浏览器的 paste 事件里读不到 clipboardData，退一步等默认粘贴动作完成后读取 value。
  setTimeout(() => handleCapturePaste(event.target.value), 0);
});

app.addEventListener("error", (event) => {
  if (!event.target.matches?.(".record-poster-img")) return;
  event.target.hidden = true;
}, true);

app.addEventListener("change", async (event) => {
  if (event.target.matches("[data-testid='recommendation-note']")) {
    await updateRecord((record) => { record.recommendationNote = event.target.value.trim(); });
    announce("推荐说明已保存");
  } else if (event.target.id === "scene-format-select") {
    if (state.captureContext) state.captureContext.format = event.target.value;
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
    }
  });
  state.overlay = null;
  render();
  announce(id ? "记忆卡片已更新" : "记忆卡片已添加");
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
  if (event.key !== "Escape" || !state.overlay) return;
  if (state.overlay === "compose") {
    await saveDraft(document.querySelector("#composer-input")?.value || "", true);
    applyCaptureTransition("close");
  } else if (state.overlay === "capture-entry" || state.overlay === "ticket-confirm" || state.overlay === "scene-choice") {
    state.captureContext = null;
    state.captureTagsExpanded = new Set();
    applyCaptureTransition("close");
  } else {
    state.overlay = null;
  }
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
  if (input) {
    db.put("drafts", {
      id: activeDraftId,
      text: input.value,
      revision: (state.draft?.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
      captureContext: state.captureContext || null // R2：切后台/刷新也要保住 captureContext
    });
  }
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
  // R1：三层数据模型迁移必须在任何数据读取之前完成一次。不新增界面元素——
  // 迁移发生在首次 render() 之前，页面本来就还是空白，天然阻塞用户操作；
  // 迁移失败时复用下方已有的 fatal-error 兜底文案，不引入新组件。
  const migration = await runMigrationIfNeeded(db, {
    exportBackup: async (payload, filename) => {
      downloadExport(JSON.stringify(payload, null, 2), filename, MIME_TYPES.json);
    }
  });
  if (!migration.ok) throw new Error(`数据整理未完成：${migration.error}`);

  await loadState();
  render();
} catch (error) {
  app.innerHTML = `<main class="fatal-error"><h1>无法打开本地记录</h1><p>${escapeHtml(error.message)}</p><p>请确认浏览器允许使用本地存储后再重试。</p></main>`;
}
