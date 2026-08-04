import { db, clearLocalData, migrateLocalToCloud } from "./db.js?v=13";
import { parseTicketText, draftViewingEvent } from "./ticket.js";
import { buildWorkSearchQuery } from "./bangumi.js?v=12";
import { applyListStyle, continueListOnEnter } from "./editor.js?v=8";
import { runMigrationIfNeeded } from "./migrate.js?v=3";
import { EVENT_TYPES } from "./event-types.js?v=1";
import { readClipboardTicketHint } from "./clipboard.js?v=1";
import { recordCard, emptyHomeStateMarkup, eventDateLabel, badgeChipMarkup, supplementDistanceLabel } from "./record-card.js?v=5";
import { memoryListMarkup } from "./memory-list.js?v=1";
import { formatBadge, eventBadges } from "./format-badge.js";
import {
  enterShelf as routeEnterShelf,
  exitShelf as routeExitShelf,
  enterWork as routeEnterWork,
  exitWork as routeExitWork,
  enterRecord as routeEnterRecord,
  exitRecord as routeExitRecord,
  goHome as routeGoHome
} from "./routing.js?v=1";
import {
  buildWorkView,
  findWorkById,
  summarizeWorksForShelf,
  filterShelfEntries,
  sortShelfEntries
} from "./work-view.js?v=1";
import {
  RELEASE_REGIONS,
  SERIES_RELATION_TYPES,
  addReleaseDate,
  addWorkToCollection,
  addWorkToSeries,
  buildTagline,
  collectionWorks,
  collectionsForWork,
  createCollection,
  createSeries,
  findSeriesForWork,
  moveWorkInSeries,
  normalizeReleaseDates,
  orderedSeriesMembers,
  releaseRegionLabel,
  releaseYearOf,
  removeReleaseDate,
  removeSeriesRelation,
  removeWorkFromCollection,
  removeWorkFromSeries,
  seriesRelationLabel,
  setReleaseDateRegion,
  setSeriesRelation,
  taglineFromSummary,
  taglineSourceLabel
} from "./library.js?v=2";
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
} from "./domain.js?v=14";
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
  // R4：view 扩展为四值 —— home（时间线）/ shelf（作品书架）/ work（作品页）/ detail（感想详情）。
  // 返回路径 detail ← work ← shelf ← home，具体转移规则在 src/routing.js（纯函数，见 tests/routing.test.mjs）。
  view: "home",
  overlay: null,
  records: [],
  works: [],
  worksById: new Map(),        // R3：work_id → work，首页卡片渲染 O(1) 查表
  recordEventById: new Map(),  // R3：record_id → 该记录关联的 ViewingEvent，首页卡片渲染 O(1) 查表
  allViewingEvents: [],        // R4：全量 ViewingEvent，供书架按作品聚合观看次数/最近观看/是否有活动场次
  currentWorkId: null,         // R4：作品页当前显示的 work id
  currentWorkEvents: [],       // R4：作品页当前 work 的全部 ViewingEvent（含 merged_from 旧 id 下的）
  detailReturnView: "home",    // R4："home" | "work" —— 详情页从哪个视图进入，决定返回去哪
  returnScrollY: 0,            // 时间线离开时的滚动位置（R3 已有字段，R4 沿用同一套约定）
  shelfScrollY: 0,             // R4：作品书架离开时的滚动位置
  workScrollY: 0,              // R4：作品页离开时的滚动位置
  shelfFilter: { workType: "all", eventsOnly: false, sort: "recent" }, // R4：书架筛选/排序，运行时状态，不持久化
  editingHistoryEventId: null, // R4：正在编辑/补充信息的 ViewingEvent id
  recordingPreference: null,
  aiPreference: null,
  aiProviders: { active: null, providers: [] },
  draft: null,
  activeRecordId: null,
  editingCardId: null,
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
  syncMigrateStatus: null,   // "running" | "done" | "error" | null
  // R5：系列实体与用户片单。系列描述"作品客观属于哪个系列"（一部作品只属于一个），
  // 片单描述"我出于自己的用途把哪些作品归在一起"（一部作品可属于多个），两者正交。
  series: [],
  collections: [],
  currentSeriesId: null,      // R5：系列页当前显示的系列
  currentCollectionId: null,  // R5：片单详情页当前显示的片单
  seriesReturnView: "work",   // R5：系列页从哪进来的，决定返回去哪
  taglineBusy: false,         // R5：AI 概括一句话简介进行中
  taglineSummary: "",         // R5：当前作品抓回来的完整简介原文（AI 概括的输入）
  taglineSummaryState: "idle" // "idle" | "loading" | "ready" | "missing"
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

// ─── R4：四视图路由 ───────────────────────────────────────────────────────────
// src/routing.js 是纯函数模块，只算"下一个 route 长什么样"；这里把它跟 state 的
// 扁平字段（state.view / currentWorkId / activeRecordId / detailReturnView / 三个
// 滚动位置）互相同步，历史记录（pushState）与实际滚动交给具体的 nav* 函数处理，
// 这样既复用了一份可测试的转移规则，又不用把已有代码里大量读取 state.view 的地方
// 都改成读嵌套对象。
function routeSnapshot() {
  return {
    view: state.view,
    currentWorkId: state.currentWorkId,
    activeRecordId: state.activeRecordId,
    detailReturnView: state.detailReturnView,
    scroll: { home: state.returnScrollY, shelf: state.shelfScrollY, work: state.workScrollY }
  };
}

function applyRoute(route) {
  state.view = route.view;
  state.currentWorkId = route.currentWorkId;
  state.activeRecordId = route.activeRecordId;
  state.detailReturnView = route.detailReturnView;
  state.returnScrollY = route.scroll.home;
  state.shelfScrollY = route.scroll.shelf;
  state.workScrollY = route.scroll.work;
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
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  timeline: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.5"/>',
  shelf: '<path d="M4 4v16M20 4v16M4 9h16M4 15h16"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v3.5M16 3.5v3.5M4 10h16"/>'
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
  // R5：系列与片单。两个 store 都是 R5 才建的，老库/旧云端可能还没有，读失败一律当空。
  [state.series, state.collections] = await Promise.all([
    db.getAll("series").catch(() => []),
    db.getAll("collections").catch(() => [])
  ]);
  state.series ||= [];
  state.collections ||= [];
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
  state.allViewingEvents = allEvents || []; // R4：书架按作品聚合观看次数/最近观看/有无活动场次要用到全量
  const eventsById = new Map(state.allViewingEvents.map((event) => [event.id, event]));
  state.recordEventById = new Map();
  for (const record of state.records) {
    const event = record.viewing_event_id ? eventsById.get(record.viewing_event_id) : null;
    if (event) state.recordEventById.set(record.id, event);
  }
}

/** R4：work.id（含 merged_from 里的旧 id）对应的全部 record，供作品页聚合。 */
function recordsForWork(work) {
  if (!work) return [];
  const ids = new Set([work.id, ...(work.merged_from || [])]);
  return state.records.filter((record) => ids.has(record.work_id || record.workId));
}

/**
 * R4：按 work id（含 merged_from）拉取全部 ViewingEvent。db.getViewingEventsByWork
 * 只按精确 work_id 匹配，不感知 merged_from（这与 db.getRecordsByWork 不同）——
 * 任何要"这部作品全部观影事件"的地方都要过这个函数，不能直接调 db.getViewingEventsByWork(work.id)，
 * 否则合并过的旧作品（升格匹配 Bangumi 后 id 变了）会漏掉合并前的场次，
 * 初看/重看推定会算错（见 assignViewingRelations 的输入必须是"该作品全部事件"这条前提）。
 * 纯粹只读，不碰 state，方便在写入路径（finishCompose 等）里复用。
 * @param {string} workId
 * @returns {Promise<object[]>}
 */
async function fetchWorkEvents(workId) {
  const canonical = findWorkById(state.works, workId) || { id: workId, merged_from: [] };
  const ids = [canonical.id, ...(canonical.merged_from || [])];
  try {
    const groups = await Promise.all(ids.map((id) => db.getViewingEventsByWork(id).catch(() => [])));
    return groups.flat();
  } catch (_) {
    return [];
  }
}

/** 作品页专用：拉取后直接写回 state.currentWorkEvents 并重渲染（仅当仍在看这个作品页时）。 */
async function loadWorkEventsFor(workId) {
  const events = await fetchWorkEvents(workId);
  if (state.view === "work" && state.currentWorkId === workId) {
    state.currentWorkEvents = events;
    renderPreservingScroll();
  }
  return events;
}

function topBar() {
  return `<header class="top-bar">
    <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><h1>电影印记</h1></div>
    <div class="top-actions">
      <button class="icon-button" type="button" data-action="theme" aria-label="切换到${state.theme === "dark" ? "浅色" : "深色"}主题">${icon(state.theme === "dark" ? "sun" : "theme")}</button>
      <button class="icon-button" type="button" aria-label="搜索（尚未接入）" disabled>${icon("search")}</button>
      <button class="icon-button" type="button" data-action="open-sidebar" aria-label="打开菜单" data-testid="open-sidebar">${icon("menu")}</button>
    </div>
  </header>`;
}

/**
 * R4 · 侧边栏抽屉：时间线 / 作品书架 / 偏好设置 + 统计行。
 * 只挂在首页顶栏（与 R4_WORK_SHELF.md 描述一致）；从左侧滑入，点遮罩或右滑关闭。
 */
function sidebarDrawer() {
  const recordCount = state.records.length;
  const workCount = state.works.length;
  return `<div class="overlay sidebar-overlay" data-testid="sidebar">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭菜单"></button>
    <nav class="sidebar-drawer" aria-label="主菜单" data-testid="sidebar-drawer">
      <div class="sidebar-brand"><span class="brand-mark" aria-hidden="true"></span><h2>电影印记</h2></div>
      <button type="button" class="sidebar-item ${state.view === "home" ? "active" : ""}" data-action="go-home" data-testid="sidebar-home">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("timeline")}</span><span>时间线</span>
      </button>
      <button type="button" class="sidebar-item ${state.view === "shelf" || state.view === "work" ? "active" : ""}" data-action="open-shelf" data-testid="sidebar-shelf">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("shelf")}</span><span>作品书架</span>
      </button>
      <button type="button" class="sidebar-item ${state.view === "collections" || state.view === "collection" ? "active" : ""}" data-action="open-collections" data-testid="sidebar-collections">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("shelf")}</span><span>片单</span>
      </button>
      <div class="sidebar-divider" role="separator"></div>
      <button type="button" class="sidebar-item" data-action="open-settings" data-testid="sidebar-settings">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("more")}</span><span>偏好设置</span>
      </button>
      <div class="sidebar-stats" data-testid="sidebar-stats">
        <span>已记录 ${recordCount} 条</span>
        <span>${workCount} 部作品</span>
      </div>
    </nav>
  </div>`;
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
  // R4：详情页可能从时间线或作品页进入，返回按钮要回到正确的上一级（见 src/routing.js）。
  const backLabel = state.detailReturnView === "work" ? "返回作品页" : "返回记录流";
  return `<header class="detail-header">
    <button class="icon-button" type="button" data-action="close-detail" aria-label="${backLabel}" data-testid="detail-back">${icon("back")}</button>
    <div class="detail-header-actions">
      <button class="icon-button" type="button" data-action="open-export" aria-label="导出这条记录">${icon("export")}</button>
      <button class="icon-button" type="button" data-action="open-record-menu" aria-label="更多操作" data-testid="open-record-menu">${icon("more")}</button>
    </div>
  </header>`;
}

// ═══ R4 · 作品书架 ══════════════════════════════════════════════════════════

// 用户反馈：「其他」和「未分类」两个筛选几乎重复——查代码后确认原因是目前没有任何
// 手动设置作品类型的入口，「其他」是个筛不出任何东西的死标签。补上手动选类型的入口
// （见下 WORK_TYPE_OPTIONS / workTypeEditorOverlay）后，浏览筛选栏里两者合并显示成
// 一个「未分类」chip（filterShelfEntries 里 unspecified 同时匹配 other 与 unspecified），
// 但底层 work_type 仍保留 R1 冻结的五个取值，用户在作品页仍可以精确选到「其他」。
const SHELF_TYPE_FILTERS = [
  ["all", "全部"],
  ["animation_film", "动画电影"],
  ["live_action_film", "真人电影"],
  ["event", "活动"],
  ["unspecified", "未分类"]
];

// 标签用用户自己的说法（最近观看 / 最多观看 / 首次记录），既贴近他的原话，
// 也比"观看次数""首次记录时间"短，第二行在窄屏上才塞得下全部标签。
const SHELF_SORTS = [
  ["recent", "最近观看"],
  ["count", "最多观看"],
  ["first", "首次记录"]
];

function shelfHeader() {
  return `<header class="detail-header">
    <button class="icon-button" type="button" data-action="close-shelf" aria-label="返回时间线" data-testid="shelf-back">${icon("back")}</button>
    <h1 class="shelf-title">作品书架</h1>
    <span class="detail-header-actions"></span>
  </header>`;
}

function shelfPosterMarkup(work) {
  const title = work?.title || "";
  const initial = escapeHtml((title.trim() || "?").charAt(0));
  const hasPoster = Boolean(work?.identity_status === "matched" && work?.poster_subject_id);
  const src = hasPoster ? apiBangumiImageUrl(work.poster_subject_id) : "";
  return `<div class="shelf-poster">
    <span class="shelf-poster-fallback" aria-hidden="true">${initial}</span>
    ${hasPoster ? `<img class="shelf-poster-img" src="${escapeHtml(src)}" alt="" loading="lazy" />` : ""}
  </div>`;
}

function renderShelf() {
  const filter = state.shelfFilter;
  const summaries = summarizeWorksForShelf(state.works, state.allViewingEvents);
  const entries = sortShelfEntries(filterShelfEntries(summaries, filter), filter.sort);

  const grid = entries.map(({ work, watchCount }) => `<button type="button" class="shelf-item" data-action="open-work" data-work-id="${escapeHtml(work.id)}" data-testid="shelf-item-${escapeHtml(work.id)}">
    <span class="shelf-poster-wrap">
      ${shelfPosterMarkup(work)}
      ${watchCount > 1 ? `<span class="shelf-count-badge" data-testid="shelf-count-${escapeHtml(work.id)}">${watchCount}</span>` : ""}
    </span>
    <span class="shelf-item-title">${escapeHtml(work.title || "未命名作品")}</span>
  </button>`).join("");

  // 用户反馈：两排筛选要按"是什么"和"怎么看"分开——第一排只回答"这是哪种作品"
  // （work_type），第二排是排序 + "特别场次"（挂在具体某次观影上的舞台挨拶/应援上映
  // 等，和作品类型的"活动"是完全不同的两个维度，不能放在同一排造成混淆）。
  return `<main class="shelf-view" data-testid="shelf">
    ${shelfHeader()}
    <div class="shelf-filters" data-testid="shelf-filters">
      <div class="shelf-chip-row" role="group" aria-label="按作品类型筛选">
        ${SHELF_TYPE_FILTERS.map(([value, label]) => `<button type="button" class="shelf-chip ${filter.workType === value ? "selected" : ""}" data-action="set-shelf-type-filter" data-value="${value}" aria-pressed="${filter.workType === value}">${label}</button>`).join("")}
      </div>
      <div class="shelf-sort-row" role="group" aria-label="排序与特别场次筛选">
        ${SHELF_SORTS.map(([value, label]) => `<button type="button" class="shelf-sort ${filter.sort === value ? "selected" : ""}" data-action="set-shelf-sort" data-value="${value}" aria-pressed="${filter.sort === value}">${label}</button>`).join("")}
        <span class="shelf-row-divider" aria-hidden="true"></span>
        <button type="button" class="shelf-sort ${filter.eventsOnly ? "selected" : ""}" data-action="toggle-shelf-events-filter" aria-pressed="${filter.eventsOnly}" data-testid="shelf-events-only">特别场次</button>
      </div>
    </div>
    <section class="shelf-grid" aria-label="作品书架" data-testid="shelf-grid">
      ${grid || `<p class="shelf-empty" data-testid="shelf-empty">这个筛选下还没有作品</p>`}
    </section>
  </main>`;
}

// ═══ R4 · 作品页 ════════════════════════════════════════════════════════════

const WORK_TYPE_LABELS = {
  animation_film: "动画电影",
  live_action_film: "真人电影",
  event: "活动",
  other: "其他",
  unspecified: "未分类"
};

// 用户反馈：之前完全没有手动设置作品类型的入口，只有 Bangumi 自动判断出动画/真人
// 电影，其余全部停在"未分类"——"活动"与"其他"因此是两个永远筛不出东西的死标签。
// 这里补一个作品页可编辑的入口。"活动"专门配一句说明，区分它和"这一次观看带有
// 舞台挨拶/应援上映"完全是两回事：前者是作品本身的性质，后者是某一次观影的属性。
const WORK_TYPE_OPTIONS = [
  ["animation_film", "动画电影", ""],
  ["live_action_film", "真人电影", ""],
  ["event", "活动", "作品本身就是一场活动——比如 TV 动画的先行上映、剧场先行版、Live Viewing 演唱会。和某一次观影带的「舞台挨拶」「应援上映」不是一回事，那些属于场次的特别场次标签，不影响这里的作品类型。"],
  ["other", "其他", "不属于以上任何一类，比如纪录片、舞台剧录像。"],
  ["unspecified", "未分类", "还没想好，先不选。"]
];

const WORK_LOCATION_LABELS = { home: "在家观看", online: "线上观看", other: "其他方式观看" };

function formatShortDate(isoLike) {
  if (!isoLike) return "";
  const datePart = String(isoLike).slice(0, 10);
  const [y, m, d] = datePart.split("-");
  return y && m && d ? `${y}/${m}/${d}` : datePart;
}

// 用户反馈：原来的"通栏大图 hero + 负边距把标题拉上去叠在图片底部"这套排版，
// 手机上海报把标题信息页挤没了，PC 宽视口下 aspect-ratio 撑不满容器宽度、
// 内容却按 max-width 独立居中，两块对不上，直接读成"海报定在左上角、正文错位"。
// 现在没有单独的横版剧照素材可用（Bangumi 只给竖版封面），改成海报当一张
// 固定尺寸的缩略图，摆在标题信息区左边、合并进同一个 .work-panel 网格里，
// 和下面 .work-content 共用同一条左右内边距，宽窄屏都不用另起一套结构。
function workHeroMarkup(work) {
  const hasPoster = Boolean(work.identity_status === "matched" && work.poster_subject_id);
  const src = hasPoster ? apiBangumiImageUrl(work.poster_subject_id) : "";
  return `<div class="work-hero" data-testid="work-hero">
    ${hasPoster
      ? `<img class="work-hero-img" src="${escapeHtml(src)}" alt="" />`
      : `<div class="work-hero-fallback" aria-hidden="true">${escapeHtml((work.title || "?").trim().charAt(0) || "?")}</div>`}
  </div>`;
}

function workMetaLine(work) {
  // R5：年份取最早的一条上映日（不管是哪个地区），不再从写死的 release_dates.jp 读
  const year = releaseYearOf(work);
  const typeLabel = WORK_TYPE_LABELS[work.work_type] || WORK_TYPE_LABELS.unspecified;
  const bangumiRef = (work.external_refs || []).find((ref) => ref.source === "bangumi");
  const bangumiLink = bangumiRef ? `<a href="https://bangumi.tv/subject/${encodeURIComponent(bangumiRef.id)}" target="_blank" rel="noreferrer">Bangumi ↗</a>` : "";
  const typeChip = `<button type="button" class="work-type-chip" data-action="edit-work-type" data-testid="edit-work-type">${escapeHtml(typeLabel)}${icon("edit")}</button>`;
  const parts = [year ? `<span>${escapeHtml(String(year))}</span>` : "", typeChip, bangumiLink].filter(Boolean);
  return `<div class="work-meta-line">${parts.join('<span class="meta-dot" aria-hidden="true">·</span>')}</div>`;
}

function workTypeEditorOverlay(work) {
  const current = work.work_type || "unspecified";
  return `<div class="overlay" data-testid="work-type-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet work-type-editor" role="dialog" aria-modal="true" aria-labelledby="work-type-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="work-type-title">这是哪种作品？</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <div class="work-type-options" role="group" aria-label="作品类型">
        ${WORK_TYPE_OPTIONS.map(([value, label, hint]) => `<button type="button" class="work-type-option ${current === value ? "selected" : ""}" data-action="select-work-type" data-value="${value}" aria-pressed="${current === value}" data-testid="work-type-option-${value}">
          <span class="work-type-option-label">${escapeHtml(label)}</span>
          ${hint ? `<span class="work-type-option-hint">${escapeHtml(hint)}</span>` : ""}
        </button>`).join("")}
      </div>
    </section>
  </div>`;
}

/**
 * R5：上映日不再是"日本/中国"两个写死的槽位。用户反馈《蜘蛛侠：崭新之日》被错标成
 * 日本上映——实际是 Bangumi 上标的中国上映日，而旧代码假设抓到的都是日本上映日。
 * 现在每条上映日都自带地区，抓取回来的一律是"未标注地区"，在这一行高亮提示用户认领。
 */
function releaseDateRow(work) {
  const { entries } = normalizeReleaseDates(work.release_dates);
  const chips = entries.map((entry) => {
    const unknown = entry.region === "unknown";
    return `<button type="button" class="release-chip ${unknown ? "unclaimed" : ""}" data-action="edit-release-dates" data-testid="release-chip-${escapeHtml(entry.id)}">
      <span class="release-chip-region">${escapeHtml(releaseRegionLabel(entry.region))}</span>
      <span class="release-chip-date">${escapeHtml(formatShortDate(entry.date))}</span>
      ${unknown ? `<span class="release-chip-hint">待认领</span>` : ""}
    </button>`;
  }).join("");
  return `<div class="work-release-row" data-testid="work-release-row">
    ${chips}
    <button type="button" class="release-chip add" data-action="edit-release-dates" data-testid="edit-release-dates">＋ 上映日</button>
  </div>`;
}

/** R5：一句话简介。抓取优先 → AI 兜底 → 手动可改，三种来源在 UI 上要能分辨。 */
function taglineRow(work) {
  const tagline = work.tagline;
  if (!tagline?.text) {
    return `<button type="button" class="work-tagline empty" data-action="edit-tagline" data-testid="edit-tagline">
      <span class="work-tagline-placeholder">＋ 一句话简介</span>
    </button>`;
  }
  return `<button type="button" class="work-tagline" data-action="edit-tagline" data-testid="edit-tagline">
    <span class="work-tagline-text">${escapeHtml(tagline.text)}</span>
    <span class="work-tagline-source">${escapeHtml(taglineSourceLabel(tagline.source))}</span>
  </button>`;
}

// 用户反馈：系列和片单两行"上下没对齐"。原因是系列那行的值是纯文本、片单那行的值是
// 带边框内边距的 chip，两者文字起点自然差了一截。现在两行用同一个网格
// （`.work-relation-row` 固定的标签列 + 值列），值也统一成同一种 chip，视觉上严格对齐。

/** R5：所属系列 + 系列内位置。点进去是系列页。 */
function seriesRow(work) {
  const series = findSeriesForWork(state.series, work.id);
  const index = series ? (series.member_ids || []).indexOf(work.id) : -1;
  const value = series
    ? `<button type="button" class="collection-chip" data-action="open-series" data-series-id="${escapeHtml(series.id)}" data-testid="open-series">
        ${escapeHtml(series.title)}${index >= 0 ? `<span class="work-relation-index">第 ${index + 1} 部</span>` : ""}
      </button>
      <button type="button" class="collection-chip add" data-action="edit-series" data-testid="edit-series">改</button>`
    : `<button type="button" class="collection-chip add" data-action="edit-series" data-testid="edit-series">＋ 归入一个系列</button>`;
  return `<div class="work-relation-row" data-testid="work-series-row">
    <span class="work-relation-label">系列</span>
    <span class="work-relation-values">${value}</span>
  </div>`;
}

/** R5：片单归属。一部作品可以同时在多个片单里，所以这里是一排 chip 而不是单值。 */
function collectionsRow(work) {
  const mine = collectionsForWork(state.collections, work.id);
  const chips = mine.map((collection) => `<button type="button" class="collection-chip" data-action="open-collection" data-collection-id="${escapeHtml(collection.id)}" data-testid="work-collection-${escapeHtml(collection.id)}">${escapeHtml(collection.title)}</button>`).join("");
  return `<div class="work-relation-row" data-testid="work-collections-row">
    <span class="work-relation-label">片单</span>
    <span class="work-relation-values">${chips}<button type="button" class="collection-chip add" data-action="edit-collections" data-testid="edit-collections">＋ 加入片单</button></span>
  </div>`;
}

function workHistoryRow(item, index) {
  const ctx = item.viewing_context || {};
  const isCinema = item.location_type === "cinema";
  const dateLabel = eventDateLabel(item, { withTime: isCinema }) || formatShortDate(item.viewed_on);
  const locationLabel = isCinema ? (ctx.cinema_name || "影院观看") : (WORK_LOCATION_LABELS[item.location_type] || WORK_LOCATION_LABELS.home);
  const fmtBadge = isCinema ? formatBadge(ctx.format) : null;
  const { badges: evBadges } = eventBadges(ctx.event_types || [], { max: 99 }); // 作品页不做首页的截断，全部显示
  const relationLabel = item.viewing_relation === "first" ? "初看" : item.viewing_relation === "rewatch" ? "重看" : "";
  const metaBits = [
    item.duration_minutes ? `${item.duration_minutes}分` : "",
    ctx.seats?.length ? `座位 ${ctx.seats.join("、")}` : "",
    item.ticket_price?.amount ? `￥${Number(item.ticket_price.amount).toLocaleString("ja-JP")}` : ""
  ].filter(Boolean);
  const badgeRow = fmtBadge || evBadges.length
    ? `<div class="record-badge-row">${[fmtBadge ? badgeChipMarkup(fmtBadge) : "", ...evBadges.map(badgeChipMarkup)].join("")}</div>`
    : "";

  return `<article class="work-history-row" data-testid="work-history-row">
    <div class="work-history-index" aria-hidden="true">${index + 1}</div>
    <div class="work-history-body">
      <div class="work-history-top">
        <div class="work-history-top-labels">
          <span class="work-history-date">${escapeHtml(dateLabel)}</span>
          ${relationLabel ? `<span class="work-history-relation">${relationLabel}</span>` : ""}
        </div>
        <button type="button" class="icon-button" data-action="edit-history-event" data-event-id="${escapeHtml(item.id)}" aria-label="编辑这次观影" data-testid="edit-history-${escapeHtml(item.id)}">${icon("edit")}</button>
      </div>
      <div class="work-history-location">${escapeHtml(locationLabel)}</div>
      ${metaBits.length ? `<div class="work-history-meta">${metaBits.map(escapeHtml).join(" · ")}</div>` : ""}
      ${badgeRow}
      ${ctx.bonus_note ? `<div class="work-history-bonus">特典：${escapeHtml(ctx.bonus_note)}</div>` : ""}
      ${item.relation_conflict ? `<div class="work-history-conflict" data-testid="relation-conflict-${escapeHtml(item.id)}">
        <p>这次被标为${item.viewing_relation === "first" ? "初看" : "重看"}，但时间上不是最早的一次</p>
        <div class="work-history-conflict-actions">
          <button type="button" class="text-action" data-action="clear-relation-lock" data-event-id="${escapeHtml(item.id)}">改回按时间判断</button>
          <button type="button" class="text-action" data-action="keep-relation-choice" data-event-id="${escapeHtml(item.id)}">保持我的选择</button>
        </div>
      </div>` : ""}
      ${item.needs_review ? `<div class="work-history-review" data-testid="needs-review-${escapeHtml(item.id)}">
        <p>这次观看的场景待确认</p>
        <button type="button" class="text-action" data-action="review-history-event" data-event-id="${escapeHtml(item.id)}">补充信息</button>
      </div>` : ""}
    </div>
  </article>`;
}

function attitudeTimelineMarkup(timeline) {
  if (!timeline.length) return "";
  const nodes = timeline.map((node, i) => `<div class="attitude-timeline-node"><span class="attitude-timeline-date">${escapeHtml(formatShortDate(node.date))}</span><span class="attitude-timeline-value">${escapeHtml(attitudeLabel(node.attitude))}</span></div>${i < timeline.length - 1 ? `<span class="attitude-timeline-arrow" aria-hidden="true">→</span>` : ""}`).join("");
  return `<section class="work-section" data-testid="attitude-timeline">
    <h2 class="work-section-title">评价变迁</h2>
    <div class="attitude-timeline-track">${nodes}</div>
  </section>`;
}

function impressionsListMarkup(impressions) {
  if (!impressions.length) return "";
  const rows = impressions.map((item) => `<button type="button" class="work-impression-row" data-action="open-record" data-record-id="${escapeHtml(item.recordId)}" data-testid="work-impression-${escapeHtml(item.recordId)}">
    <span class="work-impression-date">${escapeHtml(formatShortDate(item.date))}</span>
    <span class="work-impression-kind">${escapeHtml(item.kindLabel)}</span>
    ${item.cardCount ? `<span class="work-impression-count">${item.cardCount} 张卡片</span>` : ""}
  </button>`).join("");
  return `<section class="work-section" data-testid="work-impressions">
    <h2 class="work-section-title">感想</h2>
    <div class="work-impressions-list">${rows}</div>
  </section>`;
}

function renderWork() {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return renderShelf();
  const view = buildWorkView(work, recordsForWork(work), state.currentWorkEvents);
  return `<main class="work-view" data-testid="work">
    <header class="detail-header work-header">
      <button class="icon-button" type="button" data-action="close-work" aria-label="返回作品书架" data-testid="work-back">${icon("back")}</button>
      <span class="detail-header-actions"></span>
    </header>
    <div class="work-panel" data-testid="work-panel">
      <div class="work-poster-col">${workHeroMarkup(work)}</div>
      <div class="work-info-col">
        <h1 class="work-title">《${escapeHtml(work.title || "未命名作品")}》</h1>
        ${workMetaLine(work)}
        ${taglineRow(work)}
      </div>
    </div>
    <article class="work-content">
      <section class="work-facts" data-testid="work-facts">
        ${releaseDateRow(work)}
        ${seriesRow(work)}
        ${collectionsRow(work)}
      </section>
      <section class="work-section" data-testid="work-history">
        <h2 class="work-section-title">观影履历</h2>
        ${view.history.length ? view.history.map((item, i) => workHistoryRow(item, i)).join("") : `<p class="work-section-empty">还没有观影场次</p>`}
      </section>
      ${attitudeTimelineMarkup(view.attitudeTimeline)}
      ${impressionsListMarkup(view.impressions)}
      <button type="button" class="sheet-done work-supplement-button" data-action="open-supplement" data-testid="open-supplement">＋ 补充记录</button>
    </article>
  </main>`;
}

// ─── R5：系列页与片单页 ───────────────────────────────────────────────────────

function workGridMarkup(works, emptyCopy) {
  if (!works.length) return `<p class="shelf-empty">${escapeHtml(emptyCopy)}</p>`;
  return `<section class="shelf-grid" aria-label="作品列表">${works.map((work) => `<button type="button" class="shelf-item" data-action="open-work" data-work-id="${escapeHtml(work.id)}">
    <span class="shelf-poster-wrap">${shelfPosterMarkup(work)}</span>
    <span class="shelf-item-title">${escapeHtml(work.title || "未命名作品")}</span>
  </button>`).join("")}</section>`;
}

/**
 * 系列页：系列内成员按手动顺序排列（可上下调整），下面是作品之间的关系连线。
 * 关系全部由用户手动指定——抓取只提供"这两部有关联"的锚点，不猜具体关系类型。
 */
function renderSeries() {
  const series = state.series.find((item) => item.id === state.currentSeriesId);
  if (!series) return renderShelf();
  const members = orderedSeriesMembers(series, state.works);
  const titleById = new Map(state.works.map((work) => [work.id, work.title || "未命名作品"]));

  const memberRows = members.map((work, index) => `<div class="series-member" data-testid="series-member-${escapeHtml(work.id)}">
    <span class="series-member-index" aria-hidden="true">${index + 1}</span>
    <button type="button" class="series-member-title" data-action="open-work" data-work-id="${escapeHtml(work.id)}">${escapeHtml(work.title || "未命名作品")}</button>
    <span class="series-member-actions">
      <button type="button" class="icon-button small" data-action="move-series-member" data-work-id="${escapeHtml(work.id)}" data-direction="up" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="icon-button small" data-action="move-series-member" data-work-id="${escapeHtml(work.id)}" data-direction="down" aria-label="下移" ${index === members.length - 1 ? "disabled" : ""}>↓</button>
    </span>
  </div>`).join("");

  const relationRows = (series.relations || []).map((rel) => `<div class="series-relation" data-testid="series-relation-${escapeHtml(rel.from_work_id)}-${escapeHtml(rel.to_work_id)}">
    <span class="series-relation-copy">《${escapeHtml(titleById.get(rel.from_work_id) || rel.from_work_id)}》的${escapeHtml(seriesRelationLabel(rel.type))}是《${escapeHtml(titleById.get(rel.to_work_id) || rel.to_work_id)}》</span>
    <button type="button" class="icon-button small" data-action="remove-series-relation" data-from="${escapeHtml(rel.from_work_id)}" data-to="${escapeHtml(rel.to_work_id)}" aria-label="删除这条关系">${icon("trash")}</button>
  </div>`).join("");

  const memberOptions = members.map((work) => `<option value="${escapeHtml(work.id)}">${escapeHtml(work.title || "未命名作品")}</option>`).join("");

  return `<main class="series-view" data-testid="series">
    <header class="detail-header">
      <button class="icon-button" type="button" data-action="close-series" aria-label="返回" data-testid="series-back">${icon("back")}</button>
      <h1 class="shelf-title">${escapeHtml(series.title)}</h1>
      <span class="detail-header-actions"></span>
    </header>
    <article class="work-content">
      <section class="work-section">
        <h2 class="work-section-title">系列作品 · ${members.length} 部</h2>
        <p class="settings-note">顺序由你手动排定——上映顺序、观看顺序、故事时间线顺序，取决于你想怎么看这个系列。</p>
        <div class="series-members">${memberRows || `<p class="work-section-empty">这个系列还没有作品</p>`}</div>
      </section>
      <section class="work-section" data-testid="series-relations">
        <h2 class="work-section-title">作品之间的关系</h2>
        <p class="settings-note">Bangumi 的关联条目只作为锚点抓回来，具体是前作、外传还是平行世界，由你自己标注——自动解析这类关系很容易出错。</p>
        <div class="series-relations">${relationRows || `<p class="work-section-empty">还没有标注任何关系</p>`}</div>
        ${members.length >= 2 ? `<form id="series-relation-form" class="series-relation-form">
          <label><span>作品</span><select name="fromWorkId">${memberOptions}</select></label>
          <label><span>关系</span><select name="type">${SERIES_RELATION_TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
          <label><span>指向</span><select name="toWorkId">${memberOptions}</select></label>
          <button class="sheet-done" type="submit" data-testid="add-series-relation">添加关系</button>
        </form>` : `<p class="settings-note">系列里至少要有两部作品，才能标注它们之间的关系。</p>`}
      </section>
    </article>
  </main>`;
}

/** 片单列表页（侧边栏入口）。 */
function renderCollections() {
  const rows = state.collections.map((collection) => `<button type="button" class="collection-row" data-action="open-collection" data-collection-id="${escapeHtml(collection.id)}" data-testid="collection-row-${escapeHtml(collection.id)}">
    <span class="collection-row-main">
      <b>${escapeHtml(collection.title)}</b>
      ${collection.description ? `<small>${escapeHtml(collection.description)}</small>` : ""}
    </span>
    <span class="collection-row-count">${(collection.work_ids || []).length} 部</span>
  </button>`).join("");

  return `<main class="shelf-view" data-testid="collections">
    <header class="detail-header">
      <button class="icon-button" type="button" data-action="go-home" aria-label="返回时间线">${icon("back")}</button>
      <h1 class="shelf-title">片单</h1>
      <span class="detail-header-actions"></span>
    </header>
    <article class="work-content">
      <p class="settings-note">片单是你自己定义的主题列表：想怎么归类都可以，和作品客观所属的「系列」互不影响。</p>
      <div class="collection-rows">${rows || `<p class="work-section-empty">还没有片单，先建一个吧</p>`}</div>
      <form id="collection-create-form">
        <label><span>新建片单</span><input type="text" name="title" maxlength="60" placeholder="例如：重看过三次以上" data-testid="new-collection-input" required /></label>
        <button class="sheet-done" type="submit">创建</button>
      </form>
    </article>
  </main>`;
}

/** 片单详情页。 */
function renderCollection() {
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);
  if (!collection) return renderCollections();
  const works = collectionWorks(collection, state.works);
  return `<main class="shelf-view" data-testid="collection">
    <header class="detail-header">
      <button class="icon-button" type="button" data-action="open-collections" aria-label="返回片单列表" data-testid="collection-back">${icon("back")}</button>
      <h1 class="shelf-title">${escapeHtml(collection.title)}</h1>
      <span class="detail-header-actions">
        <button class="icon-button" type="button" data-action="delete-collection" aria-label="删除这个片单" data-testid="delete-collection">${icon("trash")}</button>
      </span>
    </header>
    <article class="work-content">
      ${workGridMarkup(works, "这个片单还没有作品——到作品页点「＋ 加入片单」把它放进来")}
    </article>
  </main>`;
}

/** R3 补丁 4：之前「更多」按钮完全没有接入，唯一能做的操作是删除这条记录。 */
function recordMenuOverlay(record) {
  const work = currentWork(record);
  const title = work?.title || record.title || "这条记录";
  return `<div class="overlay" data-testid="record-menu-sheet">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet record-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="record-menu-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(title)}》</span><h2 id="record-menu-title">更多操作</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <button class="danger-action" type="button" data-action="confirm-delete-record" data-testid="delete-record">
        <span class="danger-action-icon" aria-hidden="true">${icon("trash")}</span>
        <span class="danger-action-copy"><b>删除这条记录</b><small>原文、记忆卡片与关联的观影场次都会一并删除，且无法恢复</small></span>
      </button>
    </section>
  </div>`;
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
      ${record.status === "raw_only_confirmed" ? `<section class="raw-only-status" data-testid="raw-only-status"><div><b>${record.analysis_status === "running" ? "正在安静整理" : "原文已经保存"}</b><p>${record.analysis_status === "running" ? "可以先离开，完成后会出现在这里。" : record.analysis_status === "failed" ? "上次没有整理完成，原文不受影响。" : "结构整理暂未完成，不影响这条记录。"}</p>${record.analysis_status === "failed" && record.analysis_error ? `<small class="raw-only-error" data-testid="analysis-error">原因：${escapeHtml(record.analysis_error)}</small>` : ""}</div><div class="raw-only-actions"><button type="button" data-action="retry-local-analysis" ${record.analysis_status === "running" ? "disabled" : ""}>${record.analysis_status === "failed" ? "重新整理" : "稍后整理"}</button>${record.analysis_status !== "running" ? `<button type="button" class="text-action" data-action="skip-to-manual" data-testid="skip-to-manual">不等了，我自己选</button>` : ""}</div></section>` : `<button class="judgement-summary" type="button" data-action="open-attitude" data-testid="attitude-summary">
        <span class="judgement-summary-icon" aria-hidden="true">${icon("edit")}</span><span class="judgement-summary-copy"><small>个人态度与推荐 · ${record.attitude ? "点击修改" : "点击选择"}</small><b>${escapeHtml(attitudeLabel(record.attitude))} · ${recommendation}</b></span>${icon("chevron")}
      </button>`}
      <div class="impression-actions"><button class="text-action" type="button" data-action="edit-impression" data-testid="edit-impression">${icon("edit")}编辑原文</button></div>
      <p class="impression">${escapeHtml(record.rawText)}</p>
      ${viewingEventsSection(state.viewingEvents)}
      ${record.status === "raw_only_confirmed" ? "" : `<div class="memory-heading"><h2>留下来的片段</h2><div class="memory-heading-actions"><button class="text-action" type="button" data-action="request-ai-cards" data-testid="request-ai-cards" ${record.cardSuggestionStatus === "running" ? "disabled" : ""}>${record.cardSuggestionStatus === "running" ? "AI 整理中…" : "AI 建议卡片"}</button><button class="text-action add-card" type="button" data-action="add-card">＋ 添加卡片</button></div></div>${record.cardSuggestionStatus === "failed" && record.cardSuggestionError ? `<p class="card-suggestion-error" data-testid="card-suggestion-error">AI 建议没有完成：${escapeHtml(record.cardSuggestionError)}</p>` : ""}${memoryCard(record)}`}
    </article>
  </main>`;
}

/**
 * R2 Step 3 顶部上下文条：不可编辑，弱化灰字，点击回到 Step 2（ticket-confirm 或 scene-choice）。
 * 没有 captureContext 的旧草稿（兼容期）不展示这一行。
 */
function captureContextBar(ctx) {
  if (!ctx) return "";
  if (ctx.mode === "supplement") {
    // R4 §3.4：补充记录场景已由作品页明确，这一行不可点击回退到 Step 2（没有对应的场景层）。
    const work = findWorkById(state.works, ctx.workId);
    const distance = work ? supplementDistanceLabel(work, { createdAt: new Date().toISOString() }) : "";
    const parts = [`《${ctx.workTitle?.trim() || work?.title || "未命名作品"}》`, "补充记录"];
    if (distance) parts.push(`距首次观看 ${distance}`);
    return `<div class="capture-context-bar" data-testid="capture-context-bar">${parts.map(escapeHtml).join(" · ")}</div>`;
  }
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
  // 用户反馈第二轮：删除不摆在卡片正面，走"编辑"这个二级入口——只有已存在、
  // 不是待审 AI 建议（那类有自己的"保留/删除建议"流程）的卡片才带删除。
  const canDelete = Boolean(editing) && editing.provenance !== "ai_suggested";
  return `<div class="overlay" data-testid="card-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭卡片编辑"></button>
    <section class="bottom-sheet card-editor" role="dialog" aria-modal="true" aria-labelledby="card-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">记忆卡片</span><h2 id="card-editor-title">${editing ? "编辑这一张" : "添加一张"}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="card-form" data-card-id="${editing?.card_id || ""}">
        <label><span>类型</span><select name="type">${CARD_TYPES.map((type) => `<option ${card.type === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select></label>
        <label><span>标题</span><input name="title" value="${escapeHtml(card.title)}" placeholder="给这个片段一个短标题" /></label>
        <label><span>内容</span><textarea name="content" required placeholder="记住了什么？">${escapeHtml(card.content)}</textarea></label>
        <div class="card-editor-actions">
          ${canDelete ? `<button type="button" class="danger-text-action" data-action="delete-card" data-card-id="${escapeHtml(editing.card_id)}" data-testid="delete-card">删除</button>` : "<span></span>"}
          <button class="sheet-done" type="submit">${editing ? "保存修改" : "添加卡片"}</button>
        </div>
      </form>
    </section>
  </div>`;
}

/**
 * 用户反馈：卡片生成之后，原文完全是静态文字，没有任何入口能回去补几句话——
 * 这份记录的核心资产是原文本身，写完之后应该还能回来改，不该是一次性的。
 * 编辑原文不会动 attitude/recommendation/cards——这些是分开、用户自己确认过的字段，
 * 改几句原文不会连带把它们清空；如果这次改动比较大，可以再点一次「AI 建议卡片」
 * 让 AI 看一遍新原文，重新给建议（不会覆盖已有卡片，见 requestAiCards()）。
 */
function impressionEditorOverlay(record) {
  return `<div class="overlay" data-testid="impression-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭编辑"></button>
    <section class="bottom-sheet impression-editor" role="dialog" aria-modal="true" aria-labelledby="impression-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">感想原文</span><h2 id="impression-editor-title">改几句话</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="impression-form">
        <textarea name="rawText" required placeholder="看完之后，先把还没消失的感觉写下来">${escapeHtml(record.rawText)}</textarea>
        <p class="impression-editor-hint">已经生成的态度、推荐和记忆卡片不会被这次修改清空；如果这次改动比较大，保存后可以再点一次"AI 建议卡片"重新看一遍。</p>
        <button class="sheet-done" type="submit">保存修改</button>
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

// ═══ R4 · 作品页：观影场次编辑 / 中国上映日 ══════════════════════════════════════

/** "YYYY-MM-DDTHH:mm:ss+09:00" → <input type="datetime-local"> 需要的 "YYYY-MM-DDTHH:mm"（按日本时间）。 */
function isoToLocalDateTimeInputValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
  return fmt.format(date).replace(" ", "T");
}

/**
 * <input type="datetime-local"> 给出的是不带时区的裸字符串；这个 App 面向日本观影场景，
 * 统一按日本时间（+09:00）解释，与其余展示逻辑（Asia/Tokyo）保持一致。
 */
function localDateTimeInputToIso(value) {
  if (!value) return null;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}+09:00`;
}

/**
 * R4 §3.1「每一行都要有编辑入口，可改地点、时间、影院、制式、活动、初看／重看」，
 * 同一个表单也承担 needs_review 场次的「补充信息」——两者本质是同一件事：把这场
 * ViewingEvent 的字段补全或改对。
 */
function historyEventEditorOverlay(event) {
  const ctx = event.viewing_context || {};
  const isCinema = event.location_type === "cinema";
  // 只有真的有 screening_at 才回填时间——event.viewed_on 只是"哪一天"，没有具体时刻。
  // 如果把 "00:00" 塞进 <input type="datetime-local"> 当默认值，用户不碰这个字段直接保存，
  // 就会把一个"只知道日期、不知道时间"的场次悄悄写成"零点场"，这是假数据，不是缺省值。
  const localDateTime = event.screening_at ? isoToLocalDateTimeInputValue(event.screening_at) : "";
  const knownDateOnly = !event.screening_at && event.viewed_on ? formatShortDate(event.viewed_on) : "";
  const isReview = Boolean(event.needs_review);
  return `<div class="overlay" data-testid="history-event-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭编辑"></button>
    <section class="bottom-sheet history-editor" role="dialog" aria-modal="true" aria-labelledby="history-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">观影场次</span><h2 id="history-editor-title">${isReview ? "补充这次观看的信息" : "编辑这次观影"}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="history-event-form" data-event-id="${escapeHtml(event.id)}">
        <div class="location-choice" role="group" aria-label="观看地点">
          <label class="location-option ${!isCinema ? "selected" : ""}"><input type="radio" name="locationType" value="home" ${!isCinema ? "checked" : ""} data-testid="history-location-home" />在家／线上</label>
          <label class="location-option ${isCinema ? "selected" : ""}"><input type="radio" name="locationType" value="cinema" ${isCinema ? "checked" : ""} data-testid="history-location-cinema" />在影院</label>
        </div>
        <label><span>观看时间${knownDateOnly ? `（当前只记了日期：${escapeHtml(knownDateOnly)}，没有具体时刻）` : ""}</span><input type="datetime-local" name="screeningAt" value="${escapeHtml(localDateTime)}" data-testid="history-datetime" /></label>
        <div class="cinema-only-fields" data-testid="history-cinema-fields" ${isCinema ? "" : "hidden"}>
          <label><span>影院名</span><input type="text" name="cinemaName" value="${escapeHtml(ctx.cinema_name || "")}" placeholder="影院名称" /></label>
          <label><span>制式</span><select name="format">
            <option value="">未填写</option>
            ${CINEMA_FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${ctx.format === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
          </select></label>
          <fieldset class="event-tags-row" aria-label="活动类型">
            ${EVENT_TYPES.map(([key, label]) => `<label class="event-tag-chip ${(ctx.event_types || []).includes(key) ? "selected" : ""}"><input type="checkbox" name="eventTypes" value="${key}" ${(ctx.event_types || []).includes(key) ? "checked" : ""} />${escapeHtml(label)}</label>`).join("")}
          </fieldset>
          <label><span>特典备注（选了"入場者特典"才会保留）</span><input type="text" name="bonusNote" value="${escapeHtml(ctx.bonus_note || "")}" placeholder="如：第3週 色紙" /></label>
        </div>
        <div class="relation-toggle" role="group" aria-label="初看或重看">
          <label class="relation-choice ${event.viewing_relation === "first" ? "selected" : ""}"><input type="radio" name="relation" value="first" ${event.viewing_relation === "first" ? "checked" : ""} />初看</label>
          <label class="relation-choice ${event.viewing_relation === "rewatch" ? "selected" : ""}"><input type="radio" name="relation" value="rewatch" ${event.viewing_relation === "rewatch" ? "checked" : ""} />重看</label>
        </div>
        <button class="sheet-done" type="submit">保存</button>
      </form>
    </section>
  </div>`;
}

/**
 * R5：上映日编辑。每条都是「地区 + 日期」，可以有任意多条（同一部片在不同地区
 * 上映日不同是常态）。抓取回来的条目地区是"未标注地区"，这里给一个下拉让用户认领。
 */
function releaseDateEditorOverlay(work) {
  const { entries } = normalizeReleaseDates(work.release_dates);
  // 地区和日期都可改（抓错的日期本身也要能改，不能只让改地区），删除按钮独立成行尾。
  const rows = entries.map((entry) => `<div class="release-row" data-testid="release-row-${escapeHtml(entry.id)}">
    <select data-action="set-release-region" data-entry-id="${escapeHtml(entry.id)}" aria-label="上映地区">
      ${RELEASE_REGIONS.map(([value, label]) => `<option value="${value}" ${entry.region === value ? "selected" : ""}>${label}</option>`).join("")}
    </select>
    <input type="date" class="release-row-date" value="${escapeHtml(entry.date)}" data-action="set-release-date" data-entry-id="${escapeHtml(entry.id)}" aria-label="上映日期" />
    <button type="button" class="icon-button small danger" data-action="remove-release-date" data-entry-id="${escapeHtml(entry.id)}" aria-label="删除这条上映日" data-testid="remove-release-${escapeHtml(entry.id)}">${icon("trash")}</button>
  </div>`).join("");

  return `<div class="overlay" data-testid="release-date-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet release-date-editor" role="dialog" aria-modal="true" aria-labelledby="release-date-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="release-date-title">上映日期</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">从 Bangumi 抓回来的日期不带地区信息，会先记成「未标注地区」——它可能是日本上映日，也可能是中国上映日，需要你确认。</p>
      <div class="release-rows">${rows || `<p class="work-section-empty">还没有记录上映日</p>`}</div>
      <form id="release-date-form" class="release-add-form">
        <label><span>新增日期</span><input type="date" name="date" required data-testid="release-date-input" /></label>
        <label><span>地区</span>
          <select name="region" data-testid="release-region-input">
            ${RELEASE_REGIONS.map(([value, label]) => `<option value="${value}" ${value === "jp" ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <button class="sheet-done" type="submit">添加</button>
      </form>
    </section>
  </div>`;
}

/**
 * R5 补丁：一句话简介编辑。
 *
 * 上一版把这里做错了——AI 只收到片名，等于让模型凭印象自己编一句介绍，而用户要的是
 * "把抓回来的完整简介压缩成一句话"。现在面板里会明确显示抓到的完整简介原文，
 * AI 概括就是对着这段原文做压缩；抓不到原文时按钮直接禁用并说明原因，
 * 不再出现"点了没反应"。
 */
function taglineEditorOverlay(work) {
  const tagline = work.tagline;
  const aiReady = Boolean(state.aiPreference?.provider);
  const summary = state.taglineSummary;
  const loading = state.taglineSummaryState === "loading";
  const hasSummary = Boolean(summary && summary.trim());
  const disabledReason = !aiReady
    ? "未配置 AI —— 先在偏好设置里选一个服务商"
    : loading
      ? "正在取简介原文…"
      : !hasSummary
        ? "没有抓到简介原文，无法概括——可以自己写一句"
        : "";

  const summaryBlock = loading
    ? `<p class="tagline-summary loading">正在从 Bangumi 取完整简介…</p>`
    : hasSummary
      ? `<details class="tagline-summary" data-testid="tagline-summary">
          <summary>抓到的完整简介（AI 会对着它概括）</summary>
          <p>${escapeHtml(summary)}</p>
        </details>`
      : `<p class="tagline-summary empty">没有抓到这部作品的简介原文。</p>`;

  return `<div class="overlay" data-testid="tagline-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet tagline-editor" role="dialog" aria-modal="true" aria-labelledby="tagline-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="tagline-title">一句话简介</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">最能代表这部作品的一句话。简介原文本来就只有一句、或者第一句已经够用时，会直接填好，不需要动用 AI。</p>
      ${summaryBlock}
      <form id="tagline-form">
        <label><span>正文</span><textarea name="text" rows="3" maxlength="120" data-testid="tagline-input" placeholder="例如：少女们签下契约，换取一个愿望">${escapeHtml(tagline?.text || "")}</textarea></label>
        <div class="tagline-actions">
          <button type="button" class="text-action" data-action="generate-tagline" ${aiReady && hasSummary && !state.taglineBusy && !loading ? "" : "disabled"} data-testid="generate-tagline">
            ${state.taglineBusy ? "AI 概括中…" : "让 AI 概括一句"}
          </button>
          ${disabledReason ? `<span class="settings-note inline">${escapeHtml(disabledReason)}</span>` : ""}
        </div>
        <button class="sheet-done" type="submit">保存</button>
      </form>
    </section>
  </div>`;
}

/**
 * R5：系列编辑。系列是独立实体——这里既能把作品归入已有系列，也能新建一个。
 * 关系（前作/续作/外传…）在系列页上连线，不在这里，避免这个面板变成大杂烩。
 */
function seriesEditorOverlay(work) {
  const current = findSeriesForWork(state.series, work.id);
  const options = state.series.map((series) => `<button type="button" class="series-option ${current?.id === series.id ? "selected" : ""}" data-action="assign-series" data-series-id="${escapeHtml(series.id)}" data-testid="assign-series-${escapeHtml(series.id)}">
    <span class="series-option-title">${escapeHtml(series.title)}</span>
    <span class="series-option-count">${(series.member_ids || []).length} 部</span>
  </button>`).join("");

  return `<div class="overlay" data-testid="series-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet series-editor" role="dialog" aria-modal="true" aria-labelledby="series-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="series-editor-title">归入系列</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      ${current ? `<button type="button" class="text-action danger" data-action="leave-series" data-testid="leave-series">移出《${escapeHtml(current.title)}》</button>` : ""}
      <div class="series-options">${options || `<p class="work-section-empty">还没有任何系列</p>`}</div>
      <form id="series-form">
        <label><span>新建系列</span><input type="text" name="title" maxlength="60" placeholder="例如：蜘蛛侠" data-testid="series-title-input" /></label>
        <button class="sheet-done" type="submit">新建并归入</button>
      </form>
    </section>
  </div>`;
}

/** R5：片单归属编辑。多选——一部作品可以同时属于多个片单。 */
function collectionsEditorOverlay(work) {
  const mine = new Set(collectionsForWork(state.collections, work.id).map((item) => item.id));
  const options = state.collections.map((collection) => `<button type="button" class="series-option ${mine.has(collection.id) ? "selected" : ""}" data-action="toggle-collection" data-collection-id="${escapeHtml(collection.id)}" data-testid="toggle-collection-${escapeHtml(collection.id)}">
    <span class="series-option-title">${escapeHtml(collection.title)}</span>
    <span class="series-option-count">${(collection.work_ids || []).length} 部</span>
  </button>`).join("");

  return `<div class="overlay" data-testid="collections-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet series-editor" role="dialog" aria-modal="true" aria-labelledby="collections-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="collections-editor-title">加入片单</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">片单是你自己定义的主题列表——和「系列」不同，它不描述作品客观上的归属，只描述你想怎么把它们放在一起。</p>
      <div class="series-options">${options || `<p class="work-section-empty">还没有任何片单</p>`}</div>
      <form id="collection-form">
        <label><span>新建片单</span><input type="text" name="title" maxlength="60" placeholder="例如：一个人在影院哭过的" data-testid="collection-title-input" /></label>
        <button class="sheet-done" type="submit">新建并加入</button>
      </form>
    </section>
  </div>`;
}

function render() {
  const base = state.view === "detail" ? renderDetail()
    : state.view === "shelf" ? renderShelf()
    : state.view === "work" ? renderWork()
    : state.view === "series" ? renderSeries()
    : state.view === "collections" ? renderCollections()
    : state.view === "collection" ? renderCollection()
    : renderHome();
  const record = currentRecord();
  const currentWorkForOverlay = state.view === "work" ? findWorkById(state.works, state.currentWorkId) : null;
  const editingHistoryEvent = state.currentWorkEvents.find((event) => event.id === state.editingHistoryEventId) || null;
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
    : state.overlay === "sidebar"
      ? sidebarDrawer()
    : state.overlay === "attitude" && record
      ? attitudeOverlay(record)
      : state.overlay === "card" && record
        ? cardEditorOverlay(record)
      : state.overlay === "export" && record
        ? exportOverlay(record)
      : state.overlay === "record-menu" && record
        ? recordMenuOverlay(record)
      : state.overlay === "impression" && record
        ? impressionEditorOverlay(record)
      : state.overlay === "history-event" && editingHistoryEvent
        ? historyEventEditorOverlay(editingHistoryEvent)
      : state.overlay === "release-dates" && currentWorkForOverlay
        ? releaseDateEditorOverlay(currentWorkForOverlay)
      : state.overlay === "work-type" && currentWorkForOverlay
        ? workTypeEditorOverlay(currentWorkForOverlay)
      : state.overlay === "tagline" && currentWorkForOverlay
        ? taglineEditorOverlay(currentWorkForOverlay)
      : state.overlay === "series" && currentWorkForOverlay
        ? seriesEditorOverlay(currentWorkForOverlay)
      : state.overlay === "collections" && currentWorkForOverlay
        ? collectionsEditorOverlay(currentWorkForOverlay)
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

  // R4 §3.4：补充记录从作品页发起，作品已经明确——直接用 captureContext.workId 对应的
  // work，不再走 resolveWork 的标题模糊匹配（避免撞到另一部同名作品）。
  const isSupplement = state.captureContext?.mode === "supplement";
  let work;
  if (isSupplement && state.captureContext.workId) {
    work = findWorkById(state.works, state.captureContext.workId);
  }
  if (!work) {
    // R1：同一部电影无论写几条感想，只解析出一个 Work（按标题/别名查重，不新建 1:1 Work）
    ({ work } = resolveWork(state.works, {
      title: resolvedTitle,
      subjectId: state.captureContext?.subjectId ?? null,
      aliases: []
    }));
  }
  record.work_id = work.id;
  record.workId = work.id;              // 兼容期保留，供旧读取点过渡
  record.record_kind = isSupplement ? "supplement" : "viewing";
  record.viewing_event_id = null;       // 有 Event 时下方回填（补充记录永远不产生 ViewingEvent）

  await db.putRecordWithWork(record, work);

  const pendingEvents = isSupplement ? [] : (state.captureContext?.pendingEvents || []);
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
    // 用 fetchWorkEvents 而不是直接查 db（见该函数注释）：这个 work 如果之前升格匹配过
    // Bangumi、id 变过，合并前的场次挂在 merged_from 里的旧 id 下，直接查会漏掉，
    // 导致这次重新推定漏掉历史场次、把不该是"初看"的一场错判成"初看"。
    const existingEvents = await fetchWorkEvents(work.id);
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
  await indexHomeCardData();
  if (isSupplement) {
    // 补充记录从作品页发起，完成后停留在作品页（state.view 全程没变过），
    // 只需要把新记录反映到画面上，不做首页那套滚动位置恢复。
    renderPreservingScroll();
    announce("补充记录已保存在本机");
  } else {
    render();
    requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
    announce("原文已保存在本机");
  }
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

/**
 * 用户反馈：记录一旦离开 raw_only_confirmed（AI 首次整理成功，或用户点了「不等了，
 * 我自己选」跳过），就再也没有入口能让 AI 重新看一遍原文、建议新的记忆卡片——
 * 只能一张一张手动加。这里补一个可以反复安全调用的入口：
 *   - 不会动 runAiAnalysis() 那条首次整理的逻辑（避免影响已经测试过的首次整理路径）；
 *   - 新的建议追加在已有卡片后面（order 接着算），不覆盖/删除用户已经写好、保留、
 *     接受过的卡片——用户还是照常通过每张卡的「保留这张／删除建议」去处理这批新建议；
 *   - 只有在用户还没有手动确认过态度（attitudeProvenance 为空）时，才用这次 AI 的
 *     态度建议去刷新"建议"字段；用户已经自己选过的 attitude/recommendation 不会被动。
 */
async function requestAiCards(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record || record.cardSuggestionStatus === "running") return;
  record.cardSuggestionStatus = "running";
  record.cardSuggestionError = null;
  await db.put("records", record);
  renderPreservingScroll();
  try {
    const response = await apiFetch("/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ provider: state.aiPreference?.provider, title: currentWork(record)?.title || record.title, rawText: record.rawText })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "AI 建议暂时没有完成");
    const analysis = payload.analysis;
    const baseOrder = record.cards.length;
    const newCards = (analysis.memory_cards || []).map((card, index) => ({ ...card, order: baseOrder + index }));
    record.cards = [...record.cards, ...newCards];
    if (!record.attitudeProvenance) {
      record.attitudeSuggestion = analysis.attitude?.suggested || record.attitudeSuggestion || null;
      record.attitudeSuggestionDetails = analysis.attitude || record.attitudeSuggestionDetails || null;
    }
    record.emotions = analysis.emotions?.length ? analysis.emotions : record.emotions;
    record.aiWarnings = analysis.warnings || [];
    record.analysisMetadata = payload.metadata;
    record.cardSuggestionStatus = "done";
    record.updatedAt = new Date().toISOString();
    await db.put("records", record);
    renderPreservingScroll();
    announce(newCards.length ? `AI 建议了 ${newCards.length} 张新卡片，一起放在下面等你确认` : "AI 这次没有给出新的建议卡片");
  } catch (error) {
    record.cardSuggestionStatus = "failed";
    record.cardSuggestionError = error.message;
    await db.put("records", record);
    renderPreservingScroll();
    announce("AI 建议暂时没有完成，可以再试一次");
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
    releaseDate: candidate.releaseDate,
    // R5：Bangumi 的 summary 用来抽"一句话简介"的首句；抽不出（太长/没有）时
    // tagline 会留空，由用户在作品页手写或点「让 AI 概括一句」。
    summary: candidate.summary || null
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
    // 用户反馈：书架里同一部电影出现两个条目——一个正常（有海报有记录），另一个只有
    // 标题、没有海报没有记录。原因是这里只把旧 id 从内存 state.works 里过滤掉
    // （见下），从来没有从数据库里删掉——下次加载又会把旧的本地 work 文档重新读回来。
    // src/migrate.js 的一次性迁移里其实已经有同样的删除步骤（那条注释原话就是
    // "否则会在 works store 里留下幽灵重复条目"），这里的实时匹配流程漏了同一步，
    // 现在补上。
    await Promise.all(staleIds.map((id) => db.delete("works", id).catch(() => {})));
  }

  state.works = state.works.filter((item) => item.id !== oldId && item.id !== conflictingWork?.id);
  state.works.push(finalWork);
  if (state.currentWorkId === oldId || state.currentWorkId === conflictingWork?.id) state.currentWorkId = finalWork.id;

  // R3 移除轮换壁纸后这里曾遗留一处对已删除函数 resolveDailyWallpaper() 的调用——
  // 顺手清掉；改成刷新首页/书架都要用到的全量 ViewingEvent 索引，因为上面可能合并了场次。
  await indexHomeCardData();
  if (state.view === "work" && state.currentWorkId === finalWork.id) {
    void loadWorkEventsFor(finalWork.id);
  }
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
  const events = await fetchWorkEvents(work.id); // 含 merged_from——否则合并过的作品会被误判成"第一次看"
  if (state.captureContext !== ctx) return;
  ctx.hasHistory = events.length > 0;
  ctx.existingHistoryCount = events.length;
  render();
}

async function updateRecord(mutator) {
  const record = currentRecord();
  if (!record) return;
  mutator(record);
  record.updatedAt = new Date().toISOString();
  await db.put("records", record);
}

/**
 * R3 补丁 4：之前完全没有删除记录的入口。删除记录本身的同时，也要删掉它关联的那一场
 * ViewingEvent（如果有），并对同一 work 下剩余的场次重新跑一遍初看/重看推定——否则
 * 删掉「第 1 次」会让后面的场次错位，编号对不上。
 */
async function deleteRecord(record) {
  const workId = record.work_id || record.workId;
  const siblingEvents = workId ? await fetchWorkEvents(workId) : [];
  await db.delete("records", record.id);
  if (record.viewing_event_id) {
    await db.delete("viewingEvents", record.viewing_event_id);
    const remaining = siblingEvents.filter((event) => event.id !== record.viewing_event_id);
    if (remaining.length) await db.putViewingEvents(assignViewingRelations(remaining));
    if (workId === state.currentWorkId) state.currentWorkEvents = state.currentWorkEvents.filter((event) => event.id !== record.viewing_event_id);
  }
  state.records = state.records.filter((item) => item.id !== record.id);
  await indexHomeCardData();
  state.overlay = null;
  // R4：删除记录后回到"从哪进来的"，而不是无条件回时间线——从作品页删记录应该回作品页。
  leaveDetail({ replace: true });
  announce("这条记录已删除");
}

async function buildAllExportEntries() {
  return Promise.all(state.records.map(async (record) => {
    const work = state.works.find((item) => item.id === record.workId) || null;
    const viewingEvents = record.workId ? await fetchWorkEvents(record.workId) : [];
    return { record, work, viewingEvents };
  }));
}

/**
 * R4：详情页可以从时间线或作品页进入（见 src/routing.js 的 enterRecord）。这里用
 * routeSnapshot/applyRoute 把"从哪来、回哪去、离开那个视图时的滚动位置"都记下来，
 * 历史记录里额外带上 from/workId，popstate 时才能正确还原返回路径。
 */
async function openRecord(recordId) {
  applyRoute(routeEnterRecord(routeSnapshot(), recordId, { scrollY }));
  state.viewingEvents = [];
  const historyPayload = { view: "detail", recordId, from: state.detailReturnView, workId: state.currentWorkId };
  history.pushState(historyPayload, "", `#record=${encodeURIComponent(recordId)}`);
  render();
  scrollTo(0, 0);
  // 异步加载该记录关联的观影场次，加载完成后刷新详情页
  const record = state.records.find((r) => r.id === recordId);
  if (record?.workId) {
    const events = await fetchWorkEvents(record.workId);
    if (state.activeRecordId === recordId && state.view === "detail") {
      state.viewingEvents = events;
      if (events.length > 0) renderPreservingScroll();
    }
  }
}

/** 详情页返回：按 detailReturnView 回时间线或作品页，恢复对应视图当时的滚动位置。 */
function leaveDetail({ replace = false } = {}) {
  applyRoute(routeExitRecord(routeSnapshot()));
  state.overlay = null;
  state.viewingEvents = [];
  const url = state.view === "work" ? `#work=${encodeURIComponent(state.currentWorkId)}` : location.pathname + location.search;
  const historyPayload = state.view === "work" ? { view: "work", workId: state.currentWorkId } : {};
  if (replace) history.replaceState(historyPayload, "", url);
  else history.pushState(historyPayload, "", url);
  render();
  const targetScroll = state.view === "work" ? state.workScrollY : state.returnScrollY;
  requestAnimationFrame(() => scrollTo({ top: targetScroll, behavior: "instant" }));
}

function goHome({ replace = false } = {}) {
  applyRoute(routeGoHome(routeSnapshot()));
  state.overlay = null;
  state.viewingEvents = [];
  if (replace) history.replaceState({}, "", location.pathname + location.search);
  else history.pushState({}, "", location.pathname + location.search);
  render();
  requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
}

/** R4：首页 → 作品书架。 */
function openShelf() {
  state.overlay = null;
  applyRoute(routeEnterShelf(routeSnapshot(), { scrollY }));
  history.pushState({ view: "shelf" }, "", "#shelf");
  render();
  scrollTo(0, 0);
}

/** R4：作品书架 → 首页。 */
function closeShelf() {
  applyRoute(routeExitShelf(routeSnapshot()));
  history.pushState({}, "", location.pathname + location.search);
  render();
  requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
}

/** R4：作品书架 → 作品页。 */
function openWork(workId) {
  applyRoute(routeEnterWork(routeSnapshot(), workId, { scrollY }));
  state.currentWorkEvents = [];
  history.pushState({ view: "work", workId }, "", `#work=${encodeURIComponent(workId)}`);
  render();
  scrollTo(0, 0);
  void loadWorkEventsFor(workId);
}

/** R4：作品页 → 作品书架（本窗口里作品页只能从书架进入，所以固定回书架）。 */
function closeWork() {
  applyRoute(routeExitWork(routeSnapshot()));
  history.pushState({ view: "shelf" }, "", "#shelf");
  render();
  requestAnimationFrame(() => scrollTo({ top: state.shelfScrollY, behavior: "instant" }));
}

// R5：系列页与片单页的进出。这三个视图不参与 R4 的 detail←work←shelf←home 返回栈
// （那条栈描述的是"记录"这条主线），它们是资料侧的旁支，各自记住自己从哪来即可。

function openSeries(seriesId) {
  if (!seriesId) return;
  state.seriesReturnView = state.view;
  state.workScrollY = state.view === "work" ? scrollY : state.workScrollY;
  state.currentSeriesId = seriesId;
  state.view = "series";
  state.overlay = null;
  history.pushState({ view: "series", seriesId }, "", `#series=${encodeURIComponent(seriesId)}`);
  render();
  scrollTo(0, 0);
}

function closeSeries() {
  if (state.seriesReturnView === "work" && state.currentWorkId) {
    state.view = "work";
    history.pushState({ view: "work", workId: state.currentWorkId }, "", `#work=${encodeURIComponent(state.currentWorkId)}`);
    render();
    requestAnimationFrame(() => scrollTo({ top: state.workScrollY, behavior: "instant" }));
    return;
  }
  openShelf();
}

function openCollections() {
  state.view = "collections";
  state.overlay = null;
  state.currentCollectionId = null;
  history.pushState({ view: "collections" }, "", "#collections");
  render();
  scrollTo(0, 0);
}

function openCollection(collectionId) {
  if (!collectionId) return;
  state.currentCollectionId = collectionId;
  state.view = "collection";
  state.overlay = null;
  history.pushState({ view: "collection", collectionId }, "", `#collection=${encodeURIComponent(collectionId)}`);
  render();
  scrollTo(0, 0);
}

/**
 * R4：编辑一条 ViewingEvent 后，对该 work 的全部事件重跑初看/重看推定并整体回写——
 * 不能只改这一场，否则补录/改时间后其余场次的编号会错位（见 R1 的 assignViewingRelations）。
 */
async function updateHistoryEvent(eventId, mutator) {
  const target = state.currentWorkEvents.find((event) => event.id === eventId);
  if (!target) return;
  const draft = { ...target };
  mutator(draft);
  const merged = state.currentWorkEvents.map((event) => (event.id === eventId ? draft : event));
  const reassigned = assignViewingRelations(merged);
  await db.putViewingEvents(reassigned);
  state.currentWorkEvents = reassigned;
  await indexHomeCardData();
  renderPreservingScroll();
}

/**
 * 观影场次编辑表单的保存逻辑。两遍算 viewing_relation：先按"完全不锁定"跑一遍
 * assignViewingRelations，看时间顺序自然算出的结果是什么；只有用户这次选的初看/
 * 重看和这个自然结果不一样，才真正锁定（relation_locked: true）——这样光打开表单
 * 点"保存"、没碰过初看/重看单选框，也不会被静默锁死。
 */
async function saveHistoryEventForm(form) {
  const eventId = form.dataset.eventId;
  const target = state.currentWorkEvents.find((event) => event.id === eventId);
  if (!target) return;

  const data = new FormData(form);
  const locationType = data.get("locationType") === "cinema" ? "cinema" : "home";
  const screeningAtLocal = String(data.get("screeningAt") || "").trim();
  const screeningAt = screeningAtLocal ? localDateTimeInputToIso(screeningAtLocal) : null;
  const viewedOn = screeningAt ? screeningAt.slice(0, 10) : (target.viewed_on || null);
  const eventTypes = locationType === "cinema" ? [...new Set(data.getAll("eventTypes").map(String))] : [];
  const bonusNoteInput = String(data.get("bonusNote") || "").trim() || null;
  const chosenRelation = ["first", "rewatch"].includes(data.get("relation")) ? data.get("relation") : null;

  const updatedUnlocked = {
    ...target,
    location_type: locationType,
    viewed_on: viewedOn,
    screening_at: screeningAt,
    viewing_context: {
      ...target.viewing_context,
      cinema_name: locationType === "cinema" ? (String(data.get("cinemaName") || "").trim() || null) : null,
      format: locationType === "cinema" ? (String(data.get("format") || "").trim() || null) : null,
      event_types: eventTypes,
      bonus_note: eventTypes.includes("bonus_distribution") ? bonusNoteInput : null
    },
    needs_review: false,
    source: target.source === "ticket_paste" ? target.source : "manual",
    relation_locked: false
  };
  delete updatedUnlocked.relation_conflict;

  const naturalPass = assignViewingRelations(state.currentWorkEvents.map((event) => (event.id === eventId ? updatedUnlocked : event)));
  const naturalRelation = naturalPass.find((event) => event.id === eventId)?.viewing_relation;
  const finalDraft = chosenRelation && chosenRelation !== naturalRelation
    ? { ...updatedUnlocked, viewing_relation: chosenRelation, relation_locked: true }
    : updatedUnlocked;

  const finalEvents = assignViewingRelations(state.currentWorkEvents.map((event) => (event.id === eventId ? finalDraft : event)));
  await db.putViewingEvents(finalEvents);
  state.currentWorkEvents = finalEvents;
  await indexHomeCardData();
  state.overlay = null;
  state.editingHistoryEventId = null;
  renderPreservingScroll();
  announce("这次观影已更新");
}

// ─── R5：作品资料 / 系列 / 片单的读写 ─────────────────────────────────────────

/** 对当前作品做一次不可变更新并落库。所有 R5 的作品资料编辑都走这一个出口。 */
async function updateCurrentWork(mutate) {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return null;
  const updated = mutate(work);
  if (!updated) return null;
  await db.put("works", updated);
  state.works = state.works.map((item) => (item.id === updated.id ? updated : item));
  state.worksById.set(updated.id, updated);
  return updated;
}

/** 同上，作用于系列页当前系列。 */
async function updateCurrentSeries(mutate) {
  const series = state.series.find((item) => item.id === state.currentSeriesId);
  if (!series) return null;
  const updated = mutate(series);
  if (!updated) return null;
  await db.put("series", updated);
  state.series = state.series.map((item) => (item.id === updated.id ? updated : item));
  return updated;
}

async function persistSeries(series) {
  await db.put("series", series);
  const exists = state.series.some((item) => item.id === series.id);
  state.series = exists
    ? state.series.map((item) => (item.id === series.id ? series : item))
    : [...state.series, series];
}

async function persistCollection(collection) {
  await db.put("collections", collection);
  const exists = state.collections.some((item) => item.id === collection.id);
  state.collections = exists
    ? state.collections.map((item) => (item.id === collection.id ? collection : item))
    : [...state.collections, collection];
}

/**
 * 归入系列。一部作品只能属于一个系列，所以先从原系列移出再加入新系列——
 * 否则同一部作品会同时出现在两个系列的成员表里，顺序与关系都会失去意义。
 */
async function assignWorkToSeries(seriesId) {
  const workId = state.currentWorkId;
  const target = state.series.find((item) => item.id === seriesId);
  if (!workId || !target) return;
  const previous = findSeriesForWork(state.series, workId);
  if (previous && previous.id !== target.id) await persistSeries(removeWorkFromSeries(previous, workId));
  await persistSeries(addWorkToSeries(target, workId));
  state.overlay = null;
  renderPreservingScroll();
  announce(`已归入《${target.title}》`);
}

async function leaveCurrentSeries() {
  const workId = state.currentWorkId;
  const previous = workId ? findSeriesForWork(state.series, workId) : null;
  if (!previous) return;
  await persistSeries(removeWorkFromSeries(previous, workId));
  state.overlay = null;
  renderPreservingScroll();
  announce(`已移出《${previous.title}》`);
}

async function moveSeriesMember(workId, direction) {
  const series = state.series.find((item) => item.id === state.currentSeriesId);
  if (!series || !workId) return;
  const index = (series.member_ids || []).indexOf(workId);
  if (index === -1) return;
  await updateCurrentSeries((current) => moveWorkInSeries(current, workId, index + (direction === "up" ? -1 : 1)));
  renderPreservingScroll();
}

async function toggleWorkInCollection(collectionId) {
  const workId = state.currentWorkId;
  const collection = state.collections.find((item) => item.id === collectionId);
  if (!workId || !collection) return;
  const isIn = (collection.work_ids || []).includes(workId);
  await persistCollection(isIn ? removeWorkFromCollection(collection, workId) : addWorkToCollection(collection, workId));
  renderPreservingScroll();
  announce(isIn ? `已移出《${collection.title}》` : `已加入《${collection.title}》`);
}

async function deleteCurrentCollection() {
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);
  if (!collection) return;
  await db.delete("collections", collection.id);
  state.collections = state.collections.filter((item) => item.id !== collection.id);
  openCollections();
  announce(`已删除片单《${collection.title}》`);
}

/**
 * 打开一句话简介面板时，确保手上有这部作品的**完整简介原文**。
 *
 * 优先用匹配时存下来的 work.summary；没有（历史数据、或搜索接口给的是截断版）就按
 * subjectId 去 /api/bangumi/subject 拉一次并顺手存回 work，下次不用再请求。
 *
 * 顺带处理用户列出的"不需要 AI"的两种情况：简介原文本来就一句话、或者第一句就很合适
 * ——taglineFromSummary 能抽出来的话直接把输入框填好，用户看一眼就能保存，不动 AI。
 */
async function loadTaglineSummary() {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return;

  const applySummary = (summary) => {
    state.taglineSummary = summary || "";
    state.taglineSummaryState = summary ? "ready" : "missing";
    if (state.overlay !== "tagline") return;
    render();
    // 还没有简介时，先用"首句"填好输入框——够用就不必动 AI
    const input = document.querySelector("[data-testid='tagline-input']");
    if (input && !input.value.trim()) {
      const firstSentence = taglineFromSummary(summary);
      if (firstSentence) input.value = firstSentence;
    }
  };

  if (work.summary?.trim()) { applySummary(work.summary); return; }

  const bangumiRef = (work.external_refs || []).find((ref) => ref.source === "bangumi");
  const subjectId = bangumiRef?.id || work.poster_subject_id;
  if (!subjectId) { applySummary(""); return; }

  state.taglineSummary = "";
  state.taglineSummaryState = "loading";
  if (state.overlay === "tagline") render();

  try {
    const response = await apiFetch(`/api/bangumi/subject?id=${encodeURIComponent(subjectId)}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`subject_${response.status}`);
    const payload = await response.json();
    const summary = String(payload?.summary || "").trim();
    if (summary) {
      // 存回 work，下次打开不用再请求
      await updateCurrentWork((current) => ({ ...current, summary }));
    }
    applySummary(summary);
  } catch (error) {
    console.error("[tagline-summary]", error);
    applySummary("");
  }
}

/**
 * 让 AI 把**抓回来的完整简介**压成一句话。手动触发——不在匹配作品时自动跑，
 * 避免每匹配一部电影就静默消耗一次 AI 额度。
 * 失败时保留用户已经输入的内容，只提示，不清空。
 */
async function generateTaglineWithAi() {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work || state.taglineBusy) return;
  const summary = state.taglineSummary?.trim();
  if (!summary) { showToast("没有简介原文可概括，可以自己写一句"); return; }

  state.taglineBusy = true;
  render();
  try {
    const response = await apiFetch("/api/ai/tagline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: state.aiPreference?.provider || null,
        title: work.title,
        originalTitle: work.original_title,
        year: releaseYearOf(work),
        summary
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || `tagline_${response.status}`);
    const text = String(payload?.tagline || "").trim();
    if (!text) throw new Error("AI 没能从这段简介里概括出一句话");
    state.taglineBusy = false;
    render();
    // render() 之后才填输入框——AI 结果只是"填进草稿框"，不直接落库，
    // 用户看过、点了保存才算数（和 App 里其余 AI 产出的处理方式一致）。
    const input = document.querySelector("[data-testid='tagline-input']");
    if (input) { input.value = text; input.focus(); }
    showToast("AI 已给出一句话，确认后记得保存");
  } catch (error) {
    state.taglineBusy = false;
    render();
    // 这里必须用可见的 toast：上一版只 announce()（屏幕阅读器专用的隐藏区域），
    // 看得见屏幕的用户点了按钮完全看不到任何反馈，就是用户说的"点了几次都没反应"。
    showToast(String(error.message || "AI 概括失败，可以自己写一句").slice(0, 60));
    console.error("[tagline]", error);
  }
}

/** 用户手动选择作品类型——不影响任何一次具体观影的"特别场次"标签，两者是独立维度。 */
async function updateCurrentWorkType(workType) {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return;
  const updated = { ...work, work_type: workType };
  await db.put("works", updated);
  state.works = state.works.map((item) => (item.id === updated.id ? updated : item));
}

/**
 * R4 §3.4 补充记录（提案 E）：从作品页发起，直接进入 Step 3 书写层，不经过
 * Step 1/2（场景已经明确——就是这个作品）。生成的 record 是 record_kind: "supplement"，
 * viewing_event_id: null，finishCompose() 里据此跳过 ViewingEvent 的创建。
 */
function openSupplementCompose(workId) {
  const work = findWorkById(state.works, workId);
  if (!work) return;
  state.captureContext = { source: "manual", mode: "supplement", workId: work.id, workTitle: work.title };
  state.captureTagsExpanded = new Set();
  state.captureFlowState = "capture:compose";
  state.overlay = "compose";
  state.draft = null;
  render();
  focusComposer();
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
  } else if (action === "open-sidebar") {
    state.overlay = "sidebar";
    render();
  } else if (action === "open-shelf") {
    openShelf();
  } else if (action === "close-shelf") {
    closeShelf();
  } else if (action === "open-work") {
    const workId = trigger.dataset.workId;
    if (workId) openWork(workId);
  } else if (action === "close-work") {
    closeWork();
  } else if (action === "close-detail") {
    leaveDetail();
  } else if (action === "set-shelf-type-filter") {
    state.shelfFilter.workType = trigger.dataset.value;
    render();
  } else if (action === "toggle-shelf-events-filter") {
    state.shelfFilter.eventsOnly = !state.shelfFilter.eventsOnly;
    render();
  } else if (action === "set-shelf-sort") {
    state.shelfFilter.sort = trigger.dataset.value;
    render();
  } else if (action === "edit-history-event" || action === "review-history-event") {
    state.editingHistoryEventId = trigger.dataset.eventId;
    state.overlay = "history-event";
    render();
  } else if (action === "clear-relation-lock") {
    await updateHistoryEvent(trigger.dataset.eventId, (event) => {
      event.relation_locked = false;
    });
    announce("已改回按时间判断");
  } else if (action === "keep-relation-choice") {
    // 默认本就保持用户的选择——这里不改任何数据，只是给一个明确的反馈。
    announce("已保持你的选择");
  } else if (action === "edit-release-dates") {
    state.overlay = "release-dates";
    render();
  } else if (action === "remove-release-date") {
    await updateCurrentWork((work) => ({
      ...work,
      release_dates: removeReleaseDate(work.release_dates, trigger.dataset.entryId)
    }));
    render();
    showToast("已删除这条上映日");
  } else if (action === "edit-tagline") {
    state.overlay = "tagline";
    render();
    void loadTaglineSummary();
  } else if (action === "generate-tagline") {
    await generateTaglineWithAi();
  } else if (action === "edit-series") {
    state.overlay = "series";
    render();
  } else if (action === "assign-series") {
    await assignWorkToSeries(trigger.dataset.seriesId);
  } else if (action === "leave-series") {
    await leaveCurrentSeries();
  } else if (action === "open-series") {
    openSeries(trigger.dataset.seriesId);
  } else if (action === "close-series") {
    closeSeries();
  } else if (action === "move-series-member") {
    await moveSeriesMember(trigger.dataset.workId, trigger.dataset.direction);
  } else if (action === "remove-series-relation") {
    await updateCurrentSeries((series) => removeSeriesRelation(series, trigger.dataset.from, trigger.dataset.to));
    renderPreservingScroll();
    announce("已删除这条关系");
  } else if (action === "edit-collections") {
    state.overlay = "collections";
    render();
  } else if (action === "toggle-collection") {
    await toggleWorkInCollection(trigger.dataset.collectionId);
  } else if (action === "open-collections") {
    openCollections();
  } else if (action === "open-collection") {
    openCollection(trigger.dataset.collectionId);
  } else if (action === "delete-collection") {
    await deleteCurrentCollection();
  } else if (action === "edit-work-type") {
    state.overlay = "work-type";
    render();
  } else if (action === "select-work-type") {
    await updateCurrentWorkType(trigger.dataset.value);
    state.overlay = null;
    renderPreservingScroll();
    announce("作品类型已更新");
  } else if (action === "open-supplement") {
    if (state.currentWorkId) openSupplementCompose(state.currentWorkId);
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
      render();
    } else if (state.overlay === "sidebar") {
      // 点遮罩关闭抽屉时也走跟手手势同一条"滑出去再摘 DOM"的动画，体验和右滑关闭一致。
      closeSidebarAnimated();
    } else {
      state.overlay = null;
      render();
    }
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
  } else if (action === "request-ai-cards") {
    await requestAiCards(currentRecord()?.id);
  } else if (action === "skip-to-manual") {
    // 反馈 #3：AI 整理不可用/失败时，之前完全没有手动路径——个人态度与记忆卡片
    // 一直被 status === "raw_only_confirmed" 挡住，只能一直等或重试 AI。
    // 只在没有整理任务正在跑时允许跳过，避免和后台 AI 回来时的写入互相覆盖。
    await updateRecord((record) => {
      if (record.status !== "raw_only_confirmed" || record.analysis_status === "running") return;
      record.status = "confirmed";
      record.analysis_status = "manual";
    });
    renderPreservingScroll();
    announce("已切换为手动整理，可以自己选择态度、添加卡片了");
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
  } else if (action === "delete-card") {
    // 非 AI 建议的卡片（用户添加/已保留/已修改）此前只能编辑不能删除；删除入口在
    // 卡片编辑界面左下角，不摆在卡片正面（见 cardEditorOverlay）。
    const record = currentRecord();
    const card = record?.cards.find((item) => item.card_id === trigger.dataset.cardId);
    if (!card) return;
    if (!window.confirm("确定要删除这张记忆卡片吗？删除后无法恢复。")) return;
    await updateRecord((record) => {
      const index = record.cards.findIndex((item) => item.card_id === trigger.dataset.cardId);
      if (index < 0) return;
      record.cards.splice(index, 1);
      record.cards.forEach((item, cardIndex) => { item.order = cardIndex; });
    });
    state.overlay = null;
    renderPreservingScroll();
    announce("这张记忆卡片已删除");
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
  } else if (action === "open-record-menu") {
    state.overlay = "record-menu";
    render();
  } else if (action === "edit-impression") {
    state.overlay = "impression";
    render();
  } else if (action === "confirm-delete-record") {
    const record = currentRecord();
    if (!record) return;
    const work = currentWork(record);
    const title = work?.title || record.title || "这条记录";
    if (!window.confirm(`确定要删除《${title}》这条记录吗？\n原文、记忆卡片与关联的观影场次都会一并删除，且无法恢复。`)) return;
    await deleteRecord(record);
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
  } else if (event.target.name === "locationType" && event.target.closest("#history-event-form")) {
    // 直接切换字段可见性，不走 render()——避免清空用户已经在其他输入框里打的字。
    const cinemaFields = document.querySelector("[data-testid='history-cinema-fields']");
    if (cinemaFields) cinemaFields.hidden = event.target.value !== "cinema";
  } else if (event.target.dataset.action === "set-release-region") {
    // R5：认领某条上映日的地区。这是 <select> 的 change，不是 click，
    // 所以走这里而不是上面的点击分发。
    const entryId = event.target.dataset.entryId;
    const region = event.target.value;
    await updateCurrentWork((work) => ({
      ...work,
      release_dates: setReleaseDateRegion(work.release_dates, entryId, region)
    }));
    render();
    showToast(`已标注为${releaseRegionLabel(region)}上映`);
  } else if (event.target.dataset.action === "set-release-date") {
    // 抓错的日期本身也要能改，不是只能改地区
    const entryId = event.target.dataset.entryId;
    const date = event.target.value;
    if (!date) return;
    await updateCurrentWork((work) => {
      const before = normalizeReleaseDates(work.release_dates);
      const target = before.entries.find((entry) => entry.id === entryId);
      if (!target) return work;
      const without = removeReleaseDate(before, entryId);
      return { ...work, release_dates: addReleaseDate(without, { region: target.region, date, source: "manual" }) };
    });
    render();
    showToast("已更新上映日期");
  }
});

app.addEventListener("submit", async (event) => {
  if (event.target.id === "card-form") {
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
    return;
  }
  if (event.target.id === "impression-form") {
    // 反馈：卡片生成之后完全没有回来改原文的入口。编辑不动 attitude/recommendation/
    // cards——那些是分开确认过的字段，不因为改了几句原文就被清空。
    event.preventDefault();
    const data = new FormData(event.target);
    const rawText = String(data.get("rawText") || "").trim();
    if (!rawText) return;
    await updateRecord((record) => { record.rawText = rawText; });
    state.overlay = null;
    renderPreservingScroll();
    announce("原文已更新");
    return;
  }
  if (event.target.id === "history-event-form") {
    event.preventDefault();
    await saveHistoryEventForm(event.target);
    return;
  }
  if (event.target.id === "release-date-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const date = String(data.get("date") || "").trim();
    const region = String(data.get("region") || "unknown");
    if (!date) return;
    await updateCurrentWork((work) => ({
      ...work,
      release_dates: addReleaseDate(work.release_dates, { region, date, source: "manual" })
    }));
    render();
    announce(`已添加${releaseRegionLabel(region)}上映日`);
    return;
  }

  if (event.target.id === "tagline-form") {
    event.preventDefault();
    const text = String(new FormData(event.target).get("text") || "").trim();
    await updateCurrentWork((work) => ({ ...work, tagline: buildTagline(text, "manual") }));
    state.overlay = null;
    renderPreservingScroll();
    announce(text ? "已保存一句话简介" : "已清空一句话简介");
    return;
  }

  if (event.target.id === "series-form") {
    event.preventDefault();
    const title = String(new FormData(event.target).get("title") || "").trim();
    if (!title || !state.currentWorkId) return;
    // 同名系列直接复用，不重复创建——seriesIdFor 是按标题算的稳定 id
    const existing = state.series.find((item) => item.title === title);
    const series = existing || createSeries({ title });
    if (!existing) await persistSeries(series);
    await assignWorkToSeries(series.id);
    return;
  }

  if (event.target.id === "collection-form") {
    event.preventDefault();
    const title = String(new FormData(event.target).get("title") || "").trim();
    if (!title || !state.currentWorkId) return;
    const collection = addWorkToCollection(createCollection({ title }), state.currentWorkId);
    await persistCollection(collection);
    renderPreservingScroll();
    announce(`已新建片单《${title}》并加入`);
    return;
  }

  if (event.target.id === "collection-create-form") {
    event.preventDefault();
    const title = String(new FormData(event.target).get("title") || "").trim();
    if (!title) return;
    const collection = createCollection({ title });
    await persistCollection(collection);
    render();
    announce(`已新建片单《${title}》`);
    return;
  }

  if (event.target.id === "series-relation-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const fromWorkId = String(data.get("fromWorkId") || "");
    const toWorkId = String(data.get("toWorkId") || "");
    const type = String(data.get("type") || "other");
    if (fromWorkId === toWorkId) { announce("不能把一部作品关联到它自己"); return; }
    await updateCurrentSeries((series) => setSeriesRelation(series, { fromWorkId, toWorkId, type }));
    renderPreservingScroll();
    announce("已添加关系");
  }
});

// R4：交给浏览器原生的滚动恢复和这里手动维护的 state.*ScrollY 会互相打架
// （两边都想在 popstate 后把页面滚到某个位置），关掉原生的那一套，滚动位置
// 完全由下面 popstate 处理器里 render() 之后的 scrollTo 负责。
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

// R4：地址栏现在要区分四种视图。#record= 沿用 R3 已有的写法；新增 #shelf 与 #work=；
// 详情页的返回路径（回时间线还是回作品页）从 pushState 时存的 history.state 里读，
// 读不到（比如用户直接改地址栏，或者是很旧的历史记录）就安全降级为回时间线。
window.addEventListener("popstate", (event) => {
  const hash = location.hash;
  state.overlay = null;
  if (hash.startsWith("#record=")) {
    const recordId = decodeURIComponent(hash.slice(8));
    if (recordId && state.records.some((record) => record.id === recordId)) {
      const fromWork = event.state?.from === "work" && event.state?.workId;
      state.view = "detail";
      state.activeRecordId = recordId;
      state.detailReturnView = fromWork ? "work" : "home";
      if (fromWork) state.currentWorkId = event.state.workId;
      state.viewingEvents = [];
      render();
      scrollTo(0, 0);
      const record = state.records.find((r) => r.id === recordId);
      if (record?.workId) {
        fetchWorkEvents(record.workId).then((events) => {
          if (state.activeRecordId === recordId && state.view === "detail") {
            state.viewingEvents = events;
            renderPreservingScroll();
          }
        });
      }
      return;
    }
    state.view = "home";
    state.activeRecordId = null;
    state.currentWorkId = null;
    render();
    requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
    return;
  }
  if (hash === "#shelf") {
    state.view = "shelf";
    state.currentWorkId = null;
    render();
    requestAnimationFrame(() => scrollTo({ top: state.shelfScrollY, behavior: "instant" }));
    return;
  }
  if (hash.startsWith("#work=")) {
    const workId = decodeURIComponent(hash.slice(6));
    // 深链指向一个不存在的作品（脏数据、旧书签）——安全降级回书架，不留一个显示
    // 书架内容但 state.view 还停在 "work" 的不一致状态。
    if (!findWorkById(state.works, workId)) {
      state.view = "shelf";
      state.currentWorkId = null;
      history.replaceState({ view: "shelf" }, "", "#shelf");
      render();
      return;
    }
    state.view = "work";
    state.currentWorkId = workId;
    state.currentWorkEvents = [];
    render();
    scrollTo(0, 0);
    void loadWorkEventsFor(workId);
    return;
  }
  // R5：系列页 / 片单列表 / 片单详情。指向已删除实体的旧链接一律安全降级，
  // 不留"画面是 A、state.view 却是 B"的不一致状态（沿用 #work= 那条的处理方式）。
  if (hash.startsWith("#series=")) {
    const seriesId = decodeURIComponent(hash.slice(8));
    if (state.series.some((item) => item.id === seriesId)) {
      state.view = "series";
      state.currentSeriesId = seriesId;
      render();
      scrollTo(0, 0);
      return;
    }
    state.view = "shelf";
    history.replaceState({ view: "shelf" }, "", "#shelf");
    render();
    return;
  }
  if (hash === "#collections") {
    state.view = "collections";
    state.currentCollectionId = null;
    render();
    scrollTo(0, 0);
    return;
  }
  if (hash.startsWith("#collection=")) {
    const collectionId = decodeURIComponent(hash.slice(12));
    if (state.collections.some((item) => item.id === collectionId)) {
      state.view = "collection";
      state.currentCollectionId = collectionId;
      render();
      scrollTo(0, 0);
      return;
    }
    state.view = "collections";
    state.currentCollectionId = null;
    history.replaceState({ view: "collections" }, "", "#collections");
    render();
    return;
  }
  state.view = "home";
  state.activeRecordId = null;
  state.currentWorkId = null;
  render();
  requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
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

// R4 用户反馈：只做了"拖抽屉本身关闭"，没做安卓用户习惯的"从屏幕左边缘右滑打开"——
// 用户原话"我是安卓手机，一切要以安卓的交互理念为先"。这里把开/关两个方向的手势
// 合到一组 touchstart/touchmove/touchend 里，跟手拖动 + 松手按位移阈值判定，
// 不接入动画库，和这个项目里其余交互的实现规模一致。
// 起手要先横滑这么多才确认是"打开"。因为现在允许从画面中间任意位置起手，
// 阈值要比边缘手势时代高一些，并且要求横向位移明显压过纵向（见 touchmove），
// 否则斜着滚页面容易误触。
const SIDEBAR_OPEN_ARM_PX = 16;
const SIDEBAR_OPEN_DOMINANCE = 1.5; // 横向位移至少是纵向的这个倍数，才算"横划"
const SIDEBAR_OPEN_COMMIT_PX = 90; // 打开手势：松手时横向位移超过这个像素就算打开
const SIDEBAR_CLOSE_COMMIT_PX = 80; // 关闭手势：已经打开时，右滑超过这个像素才算关闭

/**
 * "打开"手势的起手识别区：**屏幕中央的一大片区域，从哪里起手都行**。
 *
 * 前几版一直把它做成"必须从屏幕最左边缘起手"，这是两个错误叠在一起：
 * 一是用户要的本来就不是边缘手势，而是"在画面中间随便哪儿从左往右一划就拉出抽屉"；
 * 二是安卓（尤其小米 HyperOS）把屏幕最左侧约 20–24dp 划给**系统返回手势**，
 * 落在那条窄边里的触摸由系统消费、网页根本收不到 touchstart/touchmove——
 * 于是识别区越贴边，越是永远不会被触发。
 *
 * 现在两个问题一起解决：不再限制起手位置，只排除右侧一小条（留给系统的前进手势）。
 * 误触由"横向位移必须明显大于纵向"和"横向可滚动容器让位"两道判定挡住。
 */
function sidebarSwipeStartAllowed(clientX) {
  return clientX <= innerWidth * 0.92;
}

/**
 * 起手点是否落在一个横向可滚动的容器里（书架筛选条、徽章行等）。
 * 是的话让位给它自己的横向滚动，不抢手势。
 */
function inHorizontalScroller(element) {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 4) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
  }
  return false;
}

// mode: "opening" | "closing"；armed: 是否已确认为侧边栏手势（opening 才需要"确认"这一步）
let sidebarGesture = null;

const gestureLayer = document.querySelector("#gesture-layer");

function sidebarDrawerEl() {
  return document.querySelector("[data-testid='sidebar-drawer']");
}

// 收尾动画的定时器。必须能被下一次手势取消——否则上一次"取消打开"排的 200ms 定时器
// 会在用户已经开始新一次拖动之后触发，把手势层连同正在跟手的抽屉一起清空，
// 抽屉于是凭空消失/复位，连续快速拖动时看起来就是左右反复晃动。
let sidebarTimer = null;

function cancelSidebarTimer() {
  if (sidebarTimer !== null) {
    clearTimeout(sidebarTimer);
    sidebarTimer = null;
  }
}

/** 清空手势临时层。手势取消或提交给真正的 render() 之前都要先调用，避免出现两个抽屉。 */
function clearGestureLayer() {
  if (gestureLayer) gestureLayer.innerHTML = "";
}

/** 侧边栏收起动画：先让抽屉滑回屏幕外，动画结束后再真正从 DOM 里移除。 */
function closeSidebarAnimated() {
  const drawer = sidebarDrawerEl();
  if (!drawer) {
    clearGestureLayer();
    state.overlay = null;
    render();
    return;
  }
  drawer.style.animation = "none"; // 关的过程中不要让入场动画再插一脚
  drawer.style.transition = "";
  drawer.style.transform = "translateX(-100%)";
  const overlayEl = drawer.closest(".overlay");
  overlayEl?.classList.remove("is-dragging");
  if (overlayEl) overlayEl.style.setProperty("--scrim-progress", "0");
  cancelSidebarTimer();
  sidebarTimer = setTimeout(() => {
    sidebarTimer = null;
    clearGestureLayer();
    state.overlay = null;
    render();
  }, 200);
}

/**
 * 手势进行中，抽屉与遮罩的视觉进度（0 = 完全收起，1 = 完全展开）。
 *
 * 写入合并到一帧里：touchmove 的触发频率可能高于刷新率，每次事件都直接改样式会
 * 造成同一帧内反复读写、画面抖动。拖动态用 .is-dragging 类标记（CSS 里据此关掉
 * 入场动画与过渡），不要再依赖 `[style*=...]` 属性选择器——那个属性每帧都在变，
 * 会不断触发选择器重新匹配、动画被取消又重启，就是用户看到的"不停闪屏"。
 */
let sidebarPaintFrame = null;
let sidebarPaintProgress = 0;

function paintSidebarProgress(drawer, progress) {
  sidebarPaintProgress = Math.min(1, Math.max(0, progress));
  if (sidebarPaintFrame !== null) return;
  sidebarPaintFrame = requestAnimationFrame(() => {
    sidebarPaintFrame = null;
    const target = sidebarDrawerEl();
    if (!target) return;
    const overlayEl = target.closest(".overlay");
    if (overlayEl) {
      overlayEl.classList.add("is-dragging");
      overlayEl.style.setProperty("--scrim-progress", String(sidebarPaintProgress));
    }
    // 内联写死 transition/animation：内联样式优先级高于任何样式表规则，
    // 不依赖 .is-dragging 那条规则的层叠顺序是否如预期。只要有一帧漏掉了抑制，
    // 220ms 的 transform 过渡就会和逐帧跟手互相追赶，看起来正是"左右反复晃动"。
    target.style.transition = "none";
    target.style.animation = "none";
    target.style.transform = `translateX(${(sidebarPaintProgress - 1) * 100}%)`;
  });
}

/** 结束拖动态：取消挂起的绘制帧、清掉内联抑制，让 CSS 过渡重新接管回弹动画。 */
function endSidebarDragState(drawer) {
  if (sidebarPaintFrame !== null) {
    cancelAnimationFrame(sidebarPaintFrame);
    sidebarPaintFrame = null;
  }
  const overlayEl = drawer?.closest(".overlay");
  if (overlayEl) overlayEl.classList.remove("is-dragging");
  if (drawer) {
    drawer.style.transition = "";
    drawer.style.animation = "none"; // 回弹期间仍然不要放 drawer-in 入场动画回来
  }
}

document.addEventListener("touchstart", (event) => {
  sidebarGesture = null;
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];

  // 已经打开的抽屉：拖它本身 = 关闭手势。此时抽屉在 #app 里，但关闭方向
  // 全程不需要 render()，touchstart 的目标（抽屉自己）不会被销毁，安全。
  if (event.target.closest("[data-testid='sidebar-drawer']")) {
    const drawer = sidebarDrawerEl();
    sidebarGesture = {
      mode: "closing",
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      width: drawer?.getBoundingClientRect().width || 320,
      armed: true
    };
    return;
  }

  if (state.overlay === null && sidebarSwipeStartAllowed(touch.clientX) && !inHorizontalScroller(event.target)) {
    sidebarGesture = {
      mode: "opening",
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      width: 320,
      armed: false
    };
  }
}, { passive: true });

// 这个 touchmove 必须是非 passive 的：手势确认之后要 preventDefault()，
// 否则 Chrome 会同时把这一滑当成"页面纵向滚动"或它自己的边缘返回手势，
// 抽屉会一边跟手一边被浏览器抢走。未命中手势时第一行就 return，不影响滚动性能。
document.addEventListener("touchmove", (event) => {
  if (!sidebarGesture) return;
  const touch = event.touches[0];
  sidebarGesture.lastX = touch.clientX;
  const deltaX = touch.clientX - sidebarGesture.startX;
  const deltaY = touch.clientY - sidebarGesture.startY;

  if (sidebarGesture.mode === "opening" && !sidebarGesture.armed) {
    // 纵向位移更大 → 用户是在竖着滚页面，直接放弃这次手势，别跟页面抢
    if (Math.abs(deltaY) > Math.abs(deltaX)) { sidebarGesture = null; return; }
    if (deltaX < SIDEBAR_OPEN_ARM_PX) return;
    // 从画面中间起手时，必须是一次明确的"横划"才认，避免斜着滚动被误判
    if (deltaX < Math.abs(deltaY) * SIDEBAR_OPEN_DOMINANCE) return;

    sidebarGesture.armed = true;
    // 关键：这里绝不能 render()。把抽屉塞进 #app 之外的常驻手势层，
    // touchstart 的目标元素因此不会被销毁，后续事件能继续冒泡到 document。
    if (!gestureLayer) { sidebarGesture = null; return; }
    // 新一次手势开始了：撤掉上一次收尾动画排的定时器，否则它会在这次拖动进行到
    // 一半时触发并清空手势层（抽屉凭空消失 → 再被下一帧重建，来回晃）
    cancelSidebarTimer();
    gestureLayer.innerHTML = sidebarDrawer();
    const drawer = sidebarDrawerEl();
    if (!drawer) { sidebarGesture = null; clearGestureLayer(); return; }
    // 立刻打上拖动态：CSS 据此关掉入场动画与过渡。必须在插入后的同一个同步块里做，
    // 否则会先播一帧 drawer-in，看起来就是闪一下。
    drawer.closest(".overlay")?.classList.add("is-dragging");
    drawer.style.transform = "translateX(-100%)";
    sidebarGesture.width = drawer.getBoundingClientRect().width || sidebarGesture.width;
  }

  const drawer = sidebarDrawerEl();
  if (!drawer) return;
  event.preventDefault();

  if (sidebarGesture.mode === "opening") {
    paintSidebarProgress(drawer, deltaX / sidebarGesture.width);
  } else {
    paintSidebarProgress(drawer, 1 - Math.max(0, deltaX) / sidebarGesture.width);
  }
}, { passive: false });

function finishSidebarGesture(cancelled = false) {
  if (!sidebarGesture) return;
  const gesture = sidebarGesture;
  sidebarGesture = null;
  const drawer = sidebarDrawerEl();
  if (!gesture.armed || !drawer) return;

  const deltaX = gesture.lastX - gesture.startX;
  // 先摘掉拖动态（并取消挂起的绘制帧），CSS 的 transition 才能接管回弹动画
  endSidebarDragState(drawer);
  const overlayEl = drawer.closest(".overlay");

  if (gesture.mode === "opening") {
    const committed = !cancelled && deltaX >= SIDEBAR_OPEN_COMMIT_PX;
    if (committed) {
      // 提交：现在才切状态并 render()。此时手指已经离开，重建 DOM 不会打断任何事件序列。
      clearGestureLayer();
      state.overlay = "sidebar";
      render();
      // 新渲染出来的抽屉要压掉入场动画——它在视觉上已经接近全开，
      // 再从 -100% 播一遍就是明显的倒退跳帧。
      const fresh = sidebarDrawerEl();
      if (fresh) {
        fresh.style.animation = "none";
        requestAnimationFrame(() => { fresh.style.animation = ""; });
      }
    } else {
      // 取消：让抽屉滑回屏幕外再摘掉。定时器存起来，下一次手势开始时会被撤销。
      drawer.style.transition = "";
      drawer.style.transform = "translateX(-100%)";
      if (overlayEl) overlayEl.style.setProperty("--scrim-progress", "0");
      cancelSidebarTimer();
      sidebarTimer = setTimeout(() => { sidebarTimer = null; clearGestureLayer(); }, 200);
    }
    return;
  }

  if (!cancelled && Math.max(0, deltaX) > SIDEBAR_CLOSE_COMMIT_PX) {
    closeSidebarAnimated();
  } else {
    drawer.style.transform = "";
    if (overlayEl) overlayEl.style.removeProperty("--scrim-progress");
  }
}

document.addEventListener("touchend", () => finishSidebarGesture(false));
// 系统/浏览器抢走触摸序列时（来电、手势冲突等）要有兜底，否则抽屉会停在半开状态
document.addEventListener("touchcancel", () => finishSidebarGesture(true));
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
