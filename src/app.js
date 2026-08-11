import { db, clearAllData, migrateLocalToCloud } from "./db.js?v=16";
import { interpretTmdbStatus } from "./tmdb.js?v=3";
import {
  MAX_WORK_STILLS,
  addWorkStill,
  createExternalStill,
  createTmdbStill,
  moveWorkStill,
  normalizeWorkStills,
  removeWorkStill,
  setPrimaryWorkStill
} from "./stills.js?v=1";
import { selectDailySidebarStill } from "./sidebar-artwork.js?v=1";
import { SIDEBAR_STILLS, SIDEBAR_STILL_EXTENSIONS } from "../public/assets/sidebar-stills/manifest.js?v=1";
import { parseTicketText, draftViewingEvent } from "./ticket.js?v=7";
import { buildWorkSearchQuery } from "./bangumi.js?v=14";
import { applyListStyle, continueListOnEnter } from "./editor.js?v=8";
import { runMigrationIfNeeded } from "./migrate.js?v=6";
import { EVENT_TYPES, normalizeCinemaFormat } from "./event-types.js?v=4";
import { readClipboardTicketHint } from "./clipboard.js?v=1";
import {
  TICKET_OCR_LANGUAGE_OPTIONS,
  normalizeTicketOcrLanguage,
  recognizeTicketImage,
  releaseTicketOcrWorker,
  ticketOcrProgressLabel
} from "./ticket-ocr.js?v=2";
import { recordCard, emptyHomeStateMarkup, eventDateLabel, badgeChipMarkup, supplementDistanceLabel } from "./record-card.js?v=9";
import { memoryListMarkup } from "./memory-list.js?v=1";
import {
  SELF_INTERVIEW_QUESTIONS,
  answeredInterviewItems,
  completeSelfInterview,
  saveInterviewAnswer,
  skipSelfInterview
} from "./self-interview.js?v=1";
import {
  analysisRequestSources,
  cardLifecycleFromLegacy,
  markAnalysesStale,
  normalizeV21Record,
  reviseRawText,
  sourceRevisionIds
} from "./imprint-v2.js?v=1";
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
  buildSearchResults,
  buildWorkMatchOutcome,
  countBySource,
  filterCandidatesBySource,
  hasDegradedSource,
  looksCJK,
  searchLocalWorks,
  summarizeSearchSources,
  uniqueBangumiLinkCandidate
} from "./work-search.js?v=6";
import {
  buildWorkView,
  findWorkById,
  summarizeWorksForShelf,
  availableShelfDecades,
  filterShelfEntries,
  sortShelfEntries,
  indexEventsByRecord,
  viewingEventsForRecord
} from "./work-view.js?v=6";
import {
  createExternalPublication,
  detectPublicationPlatform,
  hasDuplicatePublication,
  normalizePublicationUrl,
  publicationPlatformLabel,
  sortExternalPublications,
  updateExternalPublication,
  viewingPublicationLabel,
  xStatusId
} from "./external-publications.js?v=1";
import {
  RELEASE_REGIONS,
  SERIES_RELATION_TYPES,
  addReleaseDate,
  addWorkToCollection,
  addWorkToSeries,
  buildTagline,
  collectionWorks,
  collectionWorkEntries,
  collectionEntries,
  collectionHasWork,
  collectionsForWork,
  createCollection,
  findCollectionEntry,
  moveCollectionEntry,
  updateCollectionEntryReason,
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
  seriesMemberCounts,
  seriesMemberDetails,
  seriesRelationLabel,
  seriesTimelineEntries,
  setReleaseDateRegion,
  setSeriesRelation,
  updateSeriesMember,
  taglineFromSummary
} from "./library.js?v=4";
import {
  captureTransition,
  toggleEventType,
  updateEventTicketTags,
  updateBonusNote,
  tentativeViewingRelation,
  buildManualViewingEvent,
  buildPendingViewingEvent,
  createViewingCaptureContext,
  captureWorkTitle,
  finalizeCaptureRecord,
  toggleEventSelection,
  selectAllEvents,
  selectedPendingEvents
} from "./capture.js?v=9";
import {
  ATTITUDES,
  ATTITUDE_DESCRIPTIONS,
  allowedRecommendationsForAttitude,
  CARD_TYPES,
  RECOMMENDATIONS,
  RECOMMENDATION_PRESETS,
  applyCandidateToWork,
  assignViewingRelations,
  attitudeLabel,
  candidateIdentityConflict,
  createId,
  detachRecordsToWork,
  emptyRecommendationDetails,
  isRecommendationAllowed,
  mergeWorks,
  parseDraft,
  promoteWorkToMatched,
  normalizeTitle,
  reconcileLocalWorkTitle,
  sortRecordsByViewingDate,
  workPosterRef,
  externalRefId,
  upsertExternalRef,
  findWorkByExternalRef,
  createWorkFromCandidate,
  extractHashtags,
  recommendationLabel,
  resolveWork
} from "./domain.js?v=21";
import {
  deleteTag as deleteTagEntity,
  displayTagName,
  ensureUserTag,
  assignmentsForTarget,
  mergeTags,
  pruneOrphanUserTags,
  rankTags,
  searchTags,
  setTagHidden,
  setTagPinned,
  syncViewingTags,
  tagOverview,
  taggedWorkEntries,
  tagsForTarget,
  tagUsageCount,
  unlinkTag,
  upsertAssignment,
  upsertBangumiDirectorAssignments
} from "./tags.js?v=1";
import { normalizeTagLocale, tagT } from "./tag-i18n.js?v=1";
import {
  MIME_TYPES,
  copyExportText,
  deliverExport,
  downloadExport,
  exportAllFilename,
  buildCollectionsExport,
  buildExternalPublicationsExport,
  exportAllJSON,
  exportAllMarkdown,
  exportFilename,
  exportJSON,
  exportMarkdown,
  exportTXT
} from "./export.js?v=5";

const app = document.querySelector("#app");
// 浮层与 FAB 各自有独立的挂载点（见 index.html 的注释）：只有它们变化时不去动 #app，
// 时间线里的 <img> 就不会被重建、海报也不会重新加载。
const overlayRoot = document.querySelector("#overlay-root");
const fabRoot = document.querySelector("#fab-root");
const liveRegion = document.querySelector("#live-region");
const toastRegion = document.querySelector("#toast-region");
const activeDraftId = "active";

// --- 访问密码封装 ---
// 部署到 Cloudflare 后，如果配置了 ACCESS_PASSWORD 环境变量，
// 所有 /api/* 请求需要携带此密码。密码存在 localStorage 里，一次输入长期有效。
const ACCESS_PASSWORD_KEY = "mi_access_password";
// 要求打字而不是点两次"确定"：这个操作不可撤销，误触两次按钮完全可能，
// 误打两个字不会。
const RESET_CONFIRM_PHRASE = "清空";
// 数据源在界面上的显示名。work-search.js 里的 SOURCE_LABELS 是同一套，
// 这里再放一份是为了 app.js 不必为一个字符串表额外 import。
const SOURCE_DISPLAY = { bangumi: "Bangumi", tmdb: "TMDB", local: "已在库中" };
const tagLocale = normalizeTagLocale(localStorage.getItem("movie-imprint-locale") || document.documentElement.lang || navigator.language);
const tt = (key) => tagT(tagLocale, key);

// R6 补丁 11：输入法组合状态。
// 中文/日文输入时，每按一个字母都会触发 input 事件（"j" → "ju" → …），
// 但这些是**未完成的拼音**，拿去搜索既无意义又会触发重渲染打断输入。
// 浏览器在组合期间会把 event.isComposing 置为 true，compositionend 时才算敲定。
let imeComposing = false;
document.addEventListener("compositionstart", () => { imeComposing = true; });
document.addEventListener("compositionend", (event) => {
  imeComposing = false;
  // 组合结束时补一次派发——组合期间被跳过的输入要在这里落地
  if (event.target?.id === "scene-work-title-input" || event.target?.id === "capture-manual-title-input") {
    scheduleCaptureTitleMatch(event.target.value);
  } else if (event.target?.id === "work-search-input") {
    handleWorkSearchInput(event.target.value);
  } else if (event.target?.id === "tag-search-input") {
    state.tagSearchQuery = event.target.value;
    render();
  }
});

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
function withImageToken(base) {
  const password = getAccessPassword();
  return password ? `${base}&token=${encodeURIComponent(password)}` : base;
}

/**
 * R6：海报 URL 按数据源分发。R5 之前只有 Bangumi 一个图源，海报判断直接读
 * work.poster_subject_id；现在 Work 可能带 TMDB 海报，统一走 work.poster 引用，
 * 由这里决定用哪个图片代理端点。两个端点分别是 functions/api/bangumi/image.js 与
 * functions/api/tmdb/image.js，各自做 host 白名单 + 体积/类型校验，前端不直接连外部图床。
 * @param {object} work
 * @returns {string} 没有可用海报时返回空字符串
 */
function posterUrlFor(work) {
  const ref = workPosterRef(work);
  if (!ref) return "";
  if (ref.source === "bangumi") return withImageToken(`/api/bangumi/image?subjectId=${ref.subject_id}`);
  if (ref.source === "tmdb") return withImageToken(`/api/tmdb/image?path=${encodeURIComponent(ref.path)}`);
  if (ref.source === "upload") return ref.data_url;
  return "";
}

function stillUrlFor(still, size = "w1280") {
  if (still?.source === "tmdb" && still.path) {
    return withImageToken(`/api/tmdb/image?path=${encodeURIComponent(still.path)}&size=${encodeURIComponent(size)}`);
  }
  return still?.source === "external" ? String(still.url || "") : "";
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
  currentWorkPublications: [], // 当前作品关联的外部公开内容引用
  editingPublicationId: null,  // 正在新增（null）或编辑的外部发表
  // 「这是同一部作品，还是另一部？」浮层的上下文。只在 confirmWorkMatch 判定出
  // 身份冲突、且该 Work 下还挂着别的记录时才被填上，选择完立即清空。
  workSplitPrompt: null,
  detailReturnView: "home",    // R4："home" | "work" —— 详情页从哪个视图进入，决定返回去哪
  returnScrollY: 0,            // 时间线离开时的滚动位置（R3 已有字段，R4 沿用同一套约定）
  shelfScrollY: 0,             // R4：作品书架离开时的滚动位置
  workScrollY: 0,              // R4：作品页离开时的滚动位置
  workReturnView: "shelf",
  // R4 起是书架筛选/排序的运行时状态（不持久化）。
  // R6 新增 watchStatus：书架现在是「App 中所有 Work 的统一总库」，观影前从片单
  // 建的 Work 同样在这里，靠这个维度区分。默认 watched——总库归总库，日常打开
  // 书架想看到的仍然是自己的观影收藏。
  shelfFilter: { workType: "all", eventsOnly: false, sort: "recent", watchStatus: "watched", decade: "all" },
  editingHistoryEventId: null, // R4：正在编辑/补充信息的 ViewingEvent id
  recordingPreference: null,
  aiPreference: null,
  aiProviders: { active: null, providers: [] },
  draft: null,
  activeRecordId: null,
  editingCardId: null,
  editingCardSource: "formal",
  interviewQuestionIndex: 0,
  interviewSaveTimer: null,
  deletedCardUndo: null,
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
  tags: [],
  tagAssignments: [],
  currentTagId: null,
  tagSearchQuery: "",
  tagSort: "attitude",
  currentSeriesId: null,      // R5：系列页当前显示的系列
  seriesFilter: "all",       // Series 作品轴筛选：all / core / crossover
  editingSeriesMemberId: null,
  currentCollectionId: null,  // R5：片单详情页当前显示的片单
  editingEntryWorkId: null,   // R6：正在编辑「想看理由」的片单条目对应的 work id
  entryMenuWorkId: null,      // R6 补丁 13：片单条目的二级菜单当前作用于哪条
  // R6：统一作品搜索面板。query 是输入框当前值，local/external 是两组结果，
  // selected 是用户选中的候选（选中后面板下方出现「为什么想看」输入框）。
  // Phase 4 只有本地搜索；Phase 5/6 接入 Bangumi + TMDB 后 external 才会有内容。
  // sources 记录每个外部数据源这次的状态（ok / unconfigured / failed），
  // 无论成功失败都要展示——否则"没配密钥""请求失败""确实搜不到"三种情况
  // 在界面上长得一模一样（实测搜「鸟人」只出 Bangumi 就是踩了这个坑）。
  workSearch: { query: "", local: [], external: [], status: "idle", sources: null, selected: null, sourceFilter: null },
  // R6 补丁 5：TMDB 诊断。/api/tmdb/status 被 ACCESS_PASSWORD 中间件保护着，
  // 浏览器地址栏直接访问会 401；这里用 App 已认证的 apiFetch 去调，结果显示在设置里。
  // 刻意不给这个端点开匿名白名单——?probe=1 会让 Worker 替调用方发一次外部请求，
  // 匿名开放等于送出一个免费探活/配额消耗入口，而且 access_password_enabled 与
  // d1_bound 本身就是部署拓扑信息，不该给未认证访问者。
  tmdbDiagnostic: { status: "idle", payload: null, error: null },
  workRefreshBusy: false,     // R6 补丁 12：刷新作品资料进行中
  deleteWorkConfirm: "",      // R6 补丁 12：删除作品的确认词输入
  resetConfirmText: "",       // R6：清空数据的确认词输入
  resetBusy: false,
  resetMessage: null,
  seriesReturnView: "work",   // R5：系列页从哪进来的，决定返回去哪
  taglineBusy: false,         // R5：AI 概括一句话简介进行中
  taglineSummary: "",         // R5：当前作品抓回来的完整简介原文（AI 概括的输入）
  taglineSummaryState: "idle", // "idle" | "loading" | "ready" | "missing"
  stillCandidates: { workId: null, status: "idle", items: [], error: null },
  tmdbStillLink: { workId: null, status: "idle", query: "", candidates: [], error: null },
  posterEditor: { workId: null, status: "idle", tmdbChoices: [], error: null },
  bangumiPosterLink: { workId: null, status: "idle", candidates: [], error: null },
  fabOpen: false,             // R5 补丁 4：右下角 FAB 二级菜单是否展开
  fabClosing: false,          // R5 补丁 6：正在播收起动画（播完才从 DOM 移除）
  sidebarSkipEntryAnimation: false, // 由手势提交时渲染的抽屉不播入场动画（见 finishSidebarGesture）
  sidebarArtworkPath: selectDailySidebarStill(SIDEBAR_STILLS)
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
// OCR 原文同样只保存在模块内存，不进入 captureContext / IndexedDB / 导出。
let pendingTicketOcrText = null;
// 布局坐标与 OCR 原文一样只存于当前内存；用户改字后立即丢弃，防止旧坐标覆盖修正文本。
let pendingTicketOcrLayout = null;
let ticketOcrJobId = 0;
let ticketOcrUi = {
  status: "idle", // idle | preparing | recognizing | parsing | review | done | error
  language: TICKET_OCR_LANGUAGE_OPTIONS[0].value,
  progress: 0,
  message: "",
  error: ""
};
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
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v3.5M16 3.5v3.5M4 10h16"/>',
  // R6 补丁 13：侧边栏三项要各有各的形。原来「作品书架」和「片单」共用 shelf 图标，
  // 扫一眼分不出哪个是哪个。
  // 私人影库 = 胶片格（已经收进来的作品）
  library: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14"/><path d="M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  // 候场片单 = 书签（还没看、排队等着的）
  watchlist: '<path d="M6 4h12v17l-6-4.2L6 21z"/><path d="M9.5 9.5h5"/>',
  tag: '<path d="M4 5v6.2L12.8 20 20 12.8 11.2 4H5a1 1 0 0 0-1 1Z"/><circle cx="8" cy="8" r="1.3"/>',
  pin: '<path d="m9 3 6 6-2 2 3 4-2 2-4-3-2 2-1-1 2-2-3-4z"/><path d="m7 17-3 3"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.5-4.5 3 3 2-2 4.5 3.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  sentiment_very_satisfied: '<circle cx="12" cy="12" r="9"/><path d="M7.5 9c.8-1 2.2-1 3 0M13.5 9c.8-1 2.2-1 3 0M7.5 14c1.2 2 2.7 3 4.5 3s3.3-1 4.5-3"/>',
  sentiment_satisfied: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r=".6"/><circle cx="15.5" cy="9.5" r=".6"/><path d="M8 14c1.2 1.5 2.5 2.2 4 2.2s2.8-.7 4-2.2"/>',
  sentiment_neutral: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r=".6"/><circle cx="15.5" cy="9.5" r=".6"/><path d="M8.5 15h7"/>',
  sentiment_dissatisfied: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r=".6"/><circle cx="15.5" cy="9.5" r=".6"/><path d="M8 16c1.2-1.5 2.5-2.2 4-2.2s2.8.7 4 2.2"/>',
  sentiment_confused: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r=".6"/><path d="M14 9.5h3M8.5 15c1.3-1 2.5 1 3.7 0s2.5 1 3.8 0"/>'
};

// 单条记录导出：文件扩展名与 MIME 类型映射
const EXPORT_EXT = { json: "json", markdown: "md", txt: "txt" };

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ""}</svg>`;
}

const ATTITUDE_ICON_NAMES = {
  dislike: "sentiment_dissatisfied",
  neutral: "sentiment_neutral",
  like: "sentiment_satisfied",
  love: "sentiment_very_satisfied",
  mixed: "sentiment_confused"
};

function attitudeIcon(attitude) {
  return attitude ? icon(ATTITUDE_ICON_NAMES[attitude]) : "";
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

/**
 * 补齐"记录还没有关联到任何 Work"的旧数据缺口。
 *
 * R1：只有真的缺关联才会走到新建这一步，且新建统一通过 resolveWork 去重，
 * 不再无条件按 1:1 建一张新档案卡——否则一旦这条路径被触发，会重新制造
 * "一部电影多张档案卡"的老问题。
 *
 * R6 修复记录：删除演示种子数据时，我按「publicSeedRecords 开头 → loadState 开头」
 * 整段切除，而这个函数正好夹在两者之间，被连带删掉了，loadState 里的调用因此变成
 * ReferenceError（表现为"无法打开本地记录：ensureWorkLinks is not defined"）。
 * 现从 git 历史恢复。教训写在下面的静态检查里：原来那版检查只对少数几个函数名
 * 前缀做未定义扫描，`ensure*` 不在名单里，所以没拦住。
 */
async function ensureWorkLinks(records) {
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

function viewingTagNames(record) {
  const names = extractHashtags(record?.rawText || "");
  const work = state.worksById.get(record?.work_id || record?.workId)
    || state.works.find((item) => item.id === (record?.work_id || record?.workId));
  const titleKeys = new Set([record?.title, work?.title, work?.original_title]
    .filter(Boolean)
    .map((value) => String(value).normalize("NFKC").trim().toLocaleLowerCase("und")));
  // 旧版用正文第一个 #片名 识别作品；新捕获流程的片名在 captureContext 中，正文里的
  // # 都是用户真正写下的标签。这里只过滤与作品标题完全相同的旧式片名标签。
  return [...new Set(names.filter((name) => !titleKeys.has(String(name).normalize("NFKC").trim().toLocaleLowerCase("und"))))];
}

async function persistTagState(nextTags, nextAssignments) {
  const previousTagIds = new Set(state.tags.map((item) => item.id));
  const nextTagIds = new Set(nextTags.map((item) => item.id));
  const previousAssignmentIds = new Set(state.tagAssignments.map((item) => item.id));
  const nextAssignmentIds = new Set(nextAssignments.map((item) => item.id));
  await Promise.all([
    ...nextTags.map((item) => db.put("tags", item)),
    ...nextAssignments.map((item) => db.put("tagAssignments", item)),
    ...[...previousTagIds].filter((id) => !nextTagIds.has(id)).map((id) => db.delete("tags", id)),
    ...[...previousAssignmentIds].filter((id) => !nextAssignmentIds.has(id)).map((id) => db.delete("tagAssignments", id))
  ]);
  state.tags = nextTags;
  state.tagAssignments = nextAssignments;
}

async function syncViewingRecordTags(record) {
  if (!record?.id) return;
  const result = syncViewingTags(state.tags, state.tagAssignments, {
    ...record,
    tags: viewingTagNames(record)
  }, { locale: tagLocale });
  await persistTagState(result.tags, result.assignments);
}

async function migrateLegacyViewingTags() {
  let nextTags = [...state.tags];
  let nextAssignments = [...state.tagAssignments];
  for (const record of state.records) {
    if (!record?.id || nextAssignments.some((item) => item.target_type === "viewing" && item.target_id === record.id)) continue;
    const result = syncViewingTags(nextTags, nextAssignments, { ...record, tags: viewingTagNames(record) }, { locale: tagLocale });
    nextTags = result.tags;
    nextAssignments = result.assignments;
  }
  if (nextTags.length !== state.tags.length || nextAssignments.length !== state.tagAssignments.length) {
    await persistTagState(nextTags, nextAssignments);
  }
}

async function syncBangumiDirectorsForWork(work) {
  const subjectId = externalRefId(work, "bangumi");
  if (!work?.id || !subjectId) return;
  try {
    const response = await apiFetch(`/api/bangumi/persons?subjectId=${encodeURIComponent(subjectId)}`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.directors)) return;
    const result = upsertBangumiDirectorAssignments(state.tags, state.tagAssignments, work.id, payload.directors);
    await persistTagState(result.tags, result.assignments);
    if (state.view === "work" || state.view === "tags" || state.view === "tag") renderPreservingScroll();
  } catch (error) {
    console.error("[bangumi-director-tags]", error);
  }
}

async function backfillBangumiDirectorTags() {
  for (const work of state.works) {
    if (!externalRefId(work, "bangumi")) continue;
    const assignedTagIds = new Set(assignmentsForTarget(state.tagAssignments, "work", work.id).map((item) => item.tag_id));
    const alreadyLinked = state.tags.some((tag) => assignedTagIds.has(tag.id) && tag.category === "director" && tag.source === "metadata_bangumi");
    if (!alreadyLinked) await syncBangumiDirectorsForWork(work);
  }
}

async function loadState() {
  [state.records, state.draft, state.recordingPreference, state.aiPreference, state.aiProviders] = await Promise.all([
    db.getAll("records"),
    db.get("drafts", activeDraftId),
    db.get("meta", "recording-preference"),
    db.get("meta", "ai-preference"),
    apiFetch("/api/ai/providers", { headers: { accept: "application/json" } }).then((response) => response.ok ? response.json() : null).catch(() => null)
  ]);
  state.records = (state.records || []).map((record) => normalizeV21Record(record));
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
  [state.series, state.collections, state.tags, state.tagAssignments] = await Promise.all([
    db.getAll("series").catch(() => []),
    db.getAll("collections").catch(() => []),
    db.getAll("tags").catch(() => []),
    db.getAll("tagAssignments").catch(() => [])
  ]);
  state.series ||= [];
  state.collections ||= [];
  state.tags ||= [];
  state.tagAssignments ||= [];
  await migrateLegacyViewingTags();
  await indexHomeCardData();
  // R2：草稿必须连同 captureContext 一起恢复——Step 3 中断后再打开 App，
  // 应该能直接从"继续写"回到 Step 3，而不是重走 Step 1/2。
  state.captureContext = state.draft?.captureContext || null;
  state.captureFlowState = state.captureContext ? "capture:compose" : "idle";
  const targetId = location.hash.startsWith("#record=") ? decodeURIComponent(location.hash.slice(8)) : null;
  if (targetId && state.records.some((record) => record.id === targetId)) {
    state.view = "detail";
    state.activeRecordId = targetId;
    // 刷新详情页不会触发 openRecord()。必须在首次 render 前主动恢复正式观影事件，
    // 否则首屏会把空的 state.viewingEvents 当成“观影信息待确认”。
    await hydrateRecordViewingEvents(targetId, { renderAfter: false });
    return;
  }
  if (location.hash.startsWith("#series=")) {
    const seriesId = decodeURIComponent(location.hash.slice(8));
    if (state.series.some((item) => item.id === seriesId)) {
      state.view = "series";
      state.currentSeriesId = seriesId;
      state.seriesFilter = "all";
      return;
    }
  }
  if (location.hash === "#tags") {
    state.view = "tags";
    return;
  }
  if (location.hash.startsWith("#tag=")) {
    const tagId = decodeURIComponent(location.hash.slice(5));
    if (state.tags.some((tag) => tag.id === tagId)) {
      state.view = "tag";
      state.currentTagId = tagId;
    }
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
  state.recordEventById = indexEventsByRecord(state.records, state.allViewingEvents);
  // 索引建好之后立刻按"观影日期"重排时间线——排序依据必须和卡片右下角显示的
  // 那个日期一致，否则补录旧片会莫名其妙插到最前面（见 sortRecordsByViewingDate）。
  state.records = sortRecordsByViewingDate(state.records, state.recordEventById);
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

/** 作品页专用：外部发表是独立实体，只在进入对应作品页时加载。 */
async function loadExternalPublicationsFor(workId) {
  const canonical = findWorkById(state.works, workId) || { id: workId, merged_from: [] };
  const ids = new Set([canonical.id, ...(canonical.merged_from || [])]);
  let publications = [];
  try {
    publications = (await db.getAll("externalPublications")).filter((item) => ids.has(item.work_id));
  } catch (_) {
    publications = [];
  }
  if (state.view === "work" && state.currentWorkId === workId) {
    state.currentWorkPublications = sortExternalPublications(publications);
    renderPreservingScroll();
  }
  return publications;
}

function loadWorkPageData(workId) {
  void Promise.all([loadWorkEventsFor(workId), loadExternalPublicationsFor(workId), ensureRegionalPoster(workId)]);
}

function topBar() {
  // R5 补丁 4：顶栏只保留侧边栏入口。主题切换、搜索、开始记录全部下沉到右下角的
  // FAB 二级菜单——大屏手机单手拿着时，拇指够不到屏幕最上排。
  return `<header class="top-bar">
    <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><h1>电影印记</h1></div>
    <div class="top-actions">
      <button class="icon-button" type="button" data-action="open-sidebar" aria-label="打开菜单" data-testid="open-sidebar">${icon("menu")}</button>
    </div>
  </header>`;
}

/**
 * R5 补丁 4 · 右下角 FAB 二级菜单。
 *
 * 用户要求：所有页面都尽量不要把点击区域放在画面最上方（大屏手机单手够不到），
 * 所以顶栏的操作、以及各页面顶部的返回/更多按钮，统一收进右下角这个圆形按钮里：
 * 点一下主按钮 → 主按钮旋转 45°（＋ 变 ×），二级菜单从下往上依次弹出。
 *
 * 每个视图的菜单项不同，由 fabActionsFor() 决定；主按钮本身只负责开合，
 * 不再直接触发"开始记录"——那也变成菜单里的一项（用户明确指定的交互）。
 */
function fabActionsFor() {
  const themeItem = {
    action: "theme",
    icon: state.theme === "dark" ? "sun" : "theme",
    label: state.theme === "dark" ? "浅色模式" : "深色模式"
  };
  const searchItem = { action: "search-placeholder", icon: "search", label: "搜索", disabled: true };

  if (state.view === "detail") {
    const record = currentRecord();
    const work = currentWork(record);
    const matchStatus = work?.match?.status || "idle";
    const aiBusy = record?.cardSuggestionStatus === "running" || record?.analysis_status === "running";
    return [
      themeItem,
      { action: "open-work-match", icon: "match", label: matchStatus === "needs_confirmation" ? "确认作品匹配" : work?.identity_status === "matched" ? "修改作品匹配" : "查找正式作品", testId: "detail-work-match" },
      ...(record?.status === "confirmed" ? [{ action: "open-attitude", icon: ATTITUDE_ICON_NAMES[record.attitude] || "sentiment_neutral", label: "个人态度与推荐", testId: "detail-attitude" }] : []),
      { action: record?.activeAnalysisDraft ? "open-analysis-draft" : "request-ai-cards", icon: "star", label: record?.activeAnalysisDraft ? "查看 AI 整理草稿" : aiBusy ? "AI 整理中…" : "AI 整理草稿", disabled: aiBusy && !record?.activeAnalysisDraft, testId: "detail-ai-draft" },
      { action: "open-record-menu", icon: "more", label: "更多操作", testId: "open-record-menu" },
      { action: "open-export", icon: "export", label: "导出这条记录" },
      { action: "close-detail", icon: "back", label: state.detailReturnView === "work" ? "返回作品页" : "返回观影轨迹", testId: "detail-back" }
    ];
  }
  if (state.view === "work") {
    // “记录这次观看”永远表示新增一次 ViewingEvent，不能因为作品已经看过就悄悄
    // 变成直达感想的“补充记录”。补充记录是另一种明确的动作，继续单独保留。
    const workWatched = state.currentWorkId ? isWorkWatched(state.currentWorkId) : true;
    return [
      themeItem,
      { action: "start-viewing-capture", icon: "ticket", label: "记录这次观看", testId: "work-start-record-fab" },
      ...(workWatched ? [{ action: "open-supplement", icon: "edit", label: "补充旧感想", testId: "open-supplement-fab" }] : []),
      { action: "refresh-work-metadata", icon: "match", label: "刷新作品资料", testId: "refresh-work-metadata" },
      { action: "open-delete-work", icon: "trash", label: "删除这部作品", testId: "open-delete-work" },
      { action: "close-work", icon: "back", label: "返回私人影库", testId: "work-back" }
    ];
  }
  if (state.view === "shelf") {
    return [themeItem, searchItem, { action: "close-shelf", icon: "back", label: "返回观影轨迹", testId: "shelf-back" }];
  }
  if (state.view === "series") {
    return [themeItem, { action: "close-series", icon: "back", label: "返回", testId: "series-back" }];
  }
  if (state.view === "collections") {
    // R6 补丁 13：新建入口从页内表单挪到 FAB。原来那个表单常驻在列表下方，
    // 占掉一屏可观的空间，而"新建片单"是低频动作，不该长期占版面。
    return [
      themeItem,
      { action: "open-create-collection", icon: "edit", label: "新建片单", testId: "open-create-collection" },
      { action: "go-home", icon: "back", label: "返回观影轨迹" }
    ];
  }
  if (state.view === "collection") {
    return [
      themeItem,
      { action: "open-work-search", icon: "search", label: "添加作品", testId: "collection-add-work" },
      { action: "edit-collection", icon: "edit", label: "编辑片单信息", testId: "edit-collection" },
      { action: "delete-collection", icon: "trash", label: "删除这个片单", testId: "delete-collection" },
      { action: "open-collections", icon: "back", label: "返回候场片单", testId: "collection-back" }
    ];
  }
  if (state.view === "tags") {
    return [themeItem, { action: "go-home", icon: "back", label: "返回观影轨迹" }];
  }
  if (state.view === "tag") {
    return [themeItem, { action: "manage-tag", icon: "more", label: tt("edit") }, { action: "open-tags", icon: "back", label: tt("index") }];
  }
  return [themeItem, searchItem, { action: "start-viewing-capture", icon: "edit", label: "开始记录", testId: "add-record" }];
}

/**
 * R5 补丁 6：收起也要有动画。
 * 之前只做了展开动画，收起是直接把菜单项从 DOM 里删掉——瞬间消失，很突兀。
 * 现在先打上 .closing 让 CSS 播一遍反向动画，动画结束后才真正移除。
 */
let fabCloseTimer = null;

function closeFabAnimated() {
  if (!state.fabOpen || state.fabClosing) return;
  state.fabClosing = true;
  render();
  clearTimeout(fabCloseTimer);
  fabCloseTimer = setTimeout(() => {
    state.fabClosing = false;
    state.fabOpen = false;
    render();
  }, 160);
}

function fabMenu() {
  const items = fabActionsFor();
  const open = state.fabOpen;
  // 菜单项从下往上排：数组最后一项离主按钮最近（最常用的放最后）
  const list = items.map((item, index) => `<li class="fab-item" style="--fab-index:${items.length - index}">
    <span class="fab-item-label">${escapeHtml(item.label)}</span>
    <button class="fab-item-button" type="button" ${item.disabled ? "disabled" : `data-action="${item.action}"`} aria-label="${escapeHtml(item.label)}" ${item.testId ? `data-testid="${item.testId}"` : ""}>${icon(item.icon)}</button>
  </li>`).join("");

  // 收起时直接不渲染菜单项。
  // （之前用 `hidden` 属性来藏，但 `.fab-items { display: flex }` 的优先级高于
  //  UA 样式表的 `[hidden] { display: none }`，属性根本没生效——菜单一直摊在屏幕上。）
  const closing = state.fabClosing;
  return `<div class="fab-stack ${open ? "open" : ""} ${closing ? "closing" : ""}" data-testid="fab-stack">
    ${open ? `<button class="fab-scrim" type="button" data-action="close-fab" aria-label="收起菜单"></button>` : ""}
    ${open ? `<ul class="fab-items">${list}</ul>` : ""}
    <button class="fab ${open && !closing ? "open" : ""}" type="button" data-action="toggle-fab" aria-expanded="${open}" aria-label="${open ? "收起操作菜单" : "展开操作菜单"}" data-testid="fab-toggle">＋</button>
  </div>`;
}

/**
 * 默认图片从 public/assets/sidebar-stills/manifest.js 的静态池中按天选择。未来纪念日逻辑只需设置
 * window.movieImprintSidebarArtworkOverride = { tmdbPath } 或 { url, alt } 即可覆盖；
 * 抽屉本身不承担日期规则，避免为低频场景新造一套系统。
 */
function sidebarArtworkMarkup() {
  const override = window.movieImprintSidebarArtworkOverride;
  const overrideStill = override?.tmdbPath
    ? createTmdbStill(override.tmdbPath)
    : override?.url
      ? createExternalStill(override.url)
      : null;
  const localSources = state.sidebarArtworkPath
    ? SIDEBAR_STILL_EXTENSIONS.map((extension) => `${state.sidebarArtworkPath}${extension}`)
    : [];
  const src = overrideStill ? stillUrlFor(overrideStill) : localSources[0];
  if (!src) return "";
  return `<div class="sidebar-artwork ${overrideStill ? "override" : ""}" data-testid="sidebar-artwork">
    <img class="sidebar-artwork-img resilient-image" src="${escapeHtml(src)}" ${!overrideStill ? `data-fallback-srcs="${escapeHtml(JSON.stringify(localSources.slice(1)))}"` : ""} alt="${escapeHtml(override?.alt || "电影画面")}" referrerpolicy="no-referrer" />
  </div>`;
}

/**
 * R4 · 侧边栏抽屉：时间线 / 作品书架 / 偏好设置 + 统计行。
 * 只挂在首页顶栏（与 R4_WORK_SHELF.md 描述一致）；从左侧滑入，点遮罩或右滑关闭。
 */
function sidebarDrawer() {
  const recordCount = state.records.length;
  const workCount = state.works.length;
  return `<div class="overlay sidebar-overlay ${state.sidebarSkipEntryAnimation ? "no-entry-anim" : ""}" data-testid="sidebar">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭菜单"></button>
    <nav class="sidebar-drawer" aria-label="主菜单" data-testid="sidebar-drawer">
      <div class="sidebar-brand"><span class="brand-mark" aria-hidden="true"></span><h2>电影印记</h2></div>
      ${sidebarArtworkMarkup()}
      <button type="button" class="sidebar-item ${state.view === "home" ? "active" : ""}" data-action="go-home" data-testid="sidebar-home">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("timeline")}</span><span>观影轨迹</span>
      </button>
      <button type="button" class="sidebar-item ${state.view === "shelf" || state.view === "work" ? "active" : ""}" data-action="open-shelf" data-testid="sidebar-shelf">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("library")}</span><span>私人影库</span>
      </button>
      <button type="button" class="sidebar-item ${state.view === "collections" || state.view === "collection" ? "active" : ""}" data-action="open-collections" data-testid="sidebar-collections">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("watchlist")}</span><span>候场片单</span>
      </button>
      <button type="button" class="sidebar-item ${state.view === "tags" || state.view === "tag" ? "active" : ""}" data-action="open-tags" data-testid="sidebar-tags">
        <span class="sidebar-item-icon" aria-hidden="true">${icon("tag")}</span><span>${escapeHtml(tt("index"))}</span>
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
  const draftCard = state.draft?.text?.trim() ? recordCard(state.draft, { isDraft: true, buildPosterUrl: posterUrlFor }) : "";
  const cards = state.records.map((record) => recordCard(record, {
    work: currentWork(record),
    event: state.recordEventById.get(record.id) || null,
    buildPosterUrl: posterUrlFor
  })).join("");
  const hasAnyCard = Boolean(draftCard || cards);
  return `<main class="home-view" data-testid="home">
    ${topBar()}
    <section class="feed" aria-label="电影记录">
      ${draftCard}
      ${cards}
      ${hasAnyCard ? "" : emptyHomeStateMarkup()}
    </section>
  </main>`;
}

// R5 补丁 4：详情页顶部那一排（返回 / 导出 / 更多）整体下沉到右下角 FAB 菜单，
// 正文因此可以往上顶掉原来的按钮区。这里保留一个空函数返回空串，
// 是为了让 renderDetail() 的结构改动最小、也方便以后需要时再放回顶部内容。
function detailHeader() {
  return "";
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
// R6 §5：观看状态。已看 = 有 ViewingEvent 或有 Record；想看 = 没看过且至少在一个
// 片单里；全部 = 全部 Work。定义与判定都在 work-view.js，这里只管标签。
const SHELF_WATCH_STATUS_OPTIONS = [
  ["watched", "已看"],
  ["want", "想看"],
  ["all", "全部"]
];

const SHELF_SORTS = [
  ["recent", "最近观看"],
  ["count", "最多观看"],
  ["first", "首次记录"]
];

function shelfHeader() {
  // R5 补丁 4：书架页去掉顶部标题与返回按钮，筛选栏和作品网格整体上移。
  // 返回时间线改由右下角 FAB 菜单提供（侧边栏也随时能切换）。
  return "";
}

function shelfPosterMarkup(work) {
  const title = work?.title || "";
  const initial = escapeHtml((title.trim() || "?").charAt(0));
  const src = posterUrlFor(work);
  const hasPoster = Boolean(src);
  return `<div class="shelf-poster">
    <span class="shelf-poster-fallback" aria-hidden="true">${initial}</span>
    ${hasPoster ? `<img class="shelf-poster-img" src="${escapeHtml(src)}" alt="" loading="lazy" />` : ""}
  </div>`;
}

function renderShelf() {
  const filter = state.shelfFilter;
  const summaries = summarizeWorksForShelf(state.works, state.allViewingEvents, {
    records: state.records,
    collections: state.collections
  });
  const availableDecades = availableShelfDecades(summaries);
  if (filter.decade !== "all" && !availableDecades.includes(Number(filter.decade))) filter.decade = "all";
  const entries = sortShelfEntries(
    filterShelfEntries(summaries, filter),
    filter.sort,
    { watchStatus: filter.watchStatus }
  );
  // R6 §10：想看状态下最近观看/最多观看/特别场次全都无意义（还没有任何观影事件），
  // 唯一仍然成立的是「首次记录」——它是"作品第一次进入我的记忆系统的时间"，
  // 因片单加入而建卡同样算一次。所以这一档直接把排序与特别场次收起来，
  // 而不是留一排点了没反应的按钮。
  const wantMode = filter.watchStatus === "want";

  const grid = entries.map(({ work, watchCount }) => `<button type="button" class="shelf-item" data-action="open-work" data-work-id="${escapeHtml(work.id)}" data-testid="shelf-item-${escapeHtml(work.id)}">
    <span class="shelf-poster-wrap">
      ${shelfPosterMarkup(work)}
      ${watchCount > 1 ? `<span class="shelf-count-badge" data-testid="shelf-count-${escapeHtml(work.id)}">${watchCount}</span>` : ""}
    </span>
    <span class="shelf-item-title">${escapeHtml(work.title || "未命名作品")}</span>
  </button>`).join("");

  // 用户反馈：两排筛选要按"是什么"和"怎么看"分开——第一排只回答"这是哪种作品"
  // （work_type），第二排是观看状态 + 排序 + "特别场次"。
  //
  // R6：第二排原本是三个排序按钮 + 特别场次共四个 chip，再塞一个观看状态就会
  // 挤到第三排——手机上放不下（两排是硬约束）。所以把观看状态与排序各收成一个
  // 原生 <select>，横向空间立刻够用，"特别场次"作为独立筛选功能原样保留成按钮，
  // **不能被降级成排序菜单里的一项**：它是为日本院线的应援上映/舞台挨拶/声优登台
  // 这类场次而存在的，和排序完全不是一个维度。
  //
  // 用原生 <select> 而不是自绘下拉：手机上直接调起系统 picker，不引入任何新的
  // 浮层，绕开 R5 记录过的"手势层吃掉 click"以及 render() 三段缓存导致的焦点问题。
  return `<main class="shelf-view" data-testid="shelf">
    ${shelfHeader()}
    <div class="shelf-filters" data-testid="shelf-filters">
      <div class="shelf-chip-row" role="group" aria-label="按作品类型筛选">
        ${SHELF_TYPE_FILTERS.map(([value, label]) => `<button type="button" class="shelf-chip ${filter.workType === value ? "selected" : ""}" data-action="set-shelf-type-filter" data-value="${value}" aria-pressed="${filter.workType === value}">${label}</button>`).join("")}
      </div>
      <div class="shelf-sort-row" role="group" aria-label="观看状态、排序、上映年代与特别场次筛选">
        <select class="shelf-select" id="shelf-watch-status" aria-label="观看状态" data-testid="shelf-watch-status">
          ${SHELF_WATCH_STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${filter.watchStatus === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        ${wantMode ? "" : `<select class="shelf-select" id="shelf-sort" aria-label="排序方式" data-testid="shelf-sort">
          ${SHELF_SORTS.map(([value, label]) => `<option value="${value}" ${filter.sort === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>`}
        <select class="shelf-select" id="shelf-decade" aria-label="上映年代" data-testid="shelf-decade">
          <option value="all" ${filter.decade === "all" ? "selected" : ""}>全部年代</option>
          ${availableDecades.map((decade) => `<option value="${decade}" ${Number(filter.decade) === decade ? "selected" : ""}>${decade}年代</option>`).join("")}
        </select>
        ${wantMode ? "" : `
        <span class="shelf-row-divider" aria-hidden="true"></span>
        <button type="button" class="shelf-sort ${filter.eventsOnly ? "selected" : ""}" data-action="toggle-shelf-events-filter" aria-pressed="${filter.eventsOnly}" data-testid="shelf-events-only">特别场次</button>`}
      </div>
    </div>
    <section class="shelf-grid" aria-label="作品书架" data-testid="shelf-grid">
      ${grid || `<p class="shelf-empty" data-testid="shelf-empty">${wantMode
        ? "还没有想看的作品——到片单里搜索并加入，作品就会出现在这里"
        : "这个筛选下还没有作品"}</p>`}
    </section>
  </main>`;
}

// ═══ R4 · 作品页 ════════════════════════════════════════════════════════════

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
  const src = posterUrlFor(work);
  const hasPoster = Boolean(src);
  return `<button type="button" class="work-hero archive-pressable" data-action="edit-poster" data-testid="work-hero" aria-label="更换《${escapeHtml(work.title || "")}》的海报">
    ${hasPoster
      ? `<img class="work-hero-img" src="${escapeHtml(src)}" alt="" />`
      : `<div class="work-hero-fallback" aria-hidden="true">${escapeHtml((work.title || "?").trim().charAt(0) || "?")}</div>`}
  </button>`;
}

function workMetaLine(work) {
  const year = releaseYearOf(work);
  return `<div class="work-meta-line">
    ${year ? `<span>${escapeHtml(String(year))}</span>` : ""}
    <button type="button" class="work-type-chip icon-only" data-action="edit-work-type" data-testid="edit-work-type" aria-label="编辑作品类型">${icon("edit")}</button>
  </div>`;
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
    return `<span class="release-chip ${unknown ? "unclaimed" : ""}" data-testid="release-chip-${escapeHtml(entry.id)}">
      <span class="release-chip-region">${escapeHtml(releaseRegionLabel(entry.region))}</span>
      <span class="release-chip-date">${escapeHtml(formatShortDate(entry.date))}</span>
      ${unknown ? `<span class="release-chip-hint">待认领</span>` : ""}
    </span>`;
  }).join("");
  return `<button type="button" class="work-relation-row work-release-row archive-pressable" data-action="edit-release-dates" data-testid="edit-release-dates" aria-label="上映信息">
    <span class="work-relation-label">上映</span>
    <span class="work-relation-values">${chips || `<span class="archive-empty-value" aria-hidden="true">—</span>`}</span>
  </button>`;
}

/** R5：一句话简介。抓取优先 → AI 兜底 → 手动可改，三种来源在 UI 上要能分辨。 */
function taglineRow(work) {
  const tagline = work.tagline;
  if (!tagline?.text) {
    return `<button type="button" class="work-tagline archive-pressable empty" data-action="edit-tagline" data-testid="edit-tagline" aria-label="补充一句话简介">
      <span class="work-tagline-placeholder" aria-hidden="true">—</span>
    </button>`;
  }
  return `<button type="button" class="work-tagline archive-pressable" data-action="edit-tagline" data-testid="edit-tagline" aria-label="一句话简介">
    <span class="work-tagline-text">${escapeHtml(tagline.text)}</span>
  </button>`;
}

// 用户反馈：系列和片单两行"上下没对齐"。原因是系列那行的值是纯文本、片单那行的值是
// 带边框内边距的 chip，两者文字起点自然差了一截。现在两行用同一个网格
// （`.work-relation-row` 固定的标签列 + 值列），值也统一成同一种 chip，视觉上严格对齐。

/** R5：所属系列 + 系列内位置。点进去是系列页。 */
function seriesRow(work) {
  const series = findSeriesForWork(state.series, work.id);
  const details = series ? seriesMemberDetails(series, work.id) : null;
  const value = series
    ? `<span class="collection-chip" data-testid="current-series">
        ${escapeHtml(series.title)}${details?.relation === "crossover"
          ? `<span class="work-relation-index">关联作品</span>`
          : details?.seriesOrder ? `<span class="work-relation-index">第 ${details.seriesOrder} 部</span>` : ""}
      </span>`
    : `<span class="archive-empty-value" aria-hidden="true">—</span>`;
  return `<button type="button" class="work-relation-row archive-pressable" data-action="edit-series" data-testid="edit-series" aria-label="系列信息">
    <span class="work-relation-label">系列</span>
    <span class="work-relation-values">${value}</span>
  </button>`;
}

/** R5：片单归属。一部作品可以同时在多个片单里，所以这里是一排 chip 而不是单值。 */
function collectionsRow(work) {
  const mine = collectionsForWork(state.collections, work.id);
  const chips = mine.map((collection) => `<span class="collection-chip" data-testid="work-collection-${escapeHtml(collection.id)}">${escapeHtml(collection.title)}</span>`).join("");
  return `<button type="button" class="work-relation-row archive-pressable" data-action="edit-collections" data-testid="edit-collections" aria-label="片单信息">
    <span class="work-relation-label">片单</span>
    <span class="work-relation-values">${chips || `<span class="archive-empty-value" aria-hidden="true">—</span>`}</span>
  </button>`;
}

function workStillsMarkup(work) {
  const stills = normalizeWorkStills(work.stills);
  const heading = `<div class="work-stills-heading" aria-label="剧照">
    <span class="work-stills-marker" aria-hidden="true">${icon("photo")}</span>
    ${stills.length ? `<button type="button" class="section-icon-action archive-pressable" data-action="edit-stills" data-testid="edit-stills" aria-label="管理剧照">${icon("edit")}</button>` : ""}
  </div>`;

  if (!stills.length) {
    return `<section class="work-section work-stills-section empty" data-testid="work-stills">
      ${heading}
      <button type="button" class="work-stills-empty archive-pressable" data-action="edit-stills" data-testid="add-first-still" aria-label="添加剧照">
        <span class="work-stills-empty-icon" aria-hidden="true">＋</span>
      </button>
    </section>`;
  }

  const slides = stills.map((still, index) => `<figure class="work-still" data-still-index="${index}">
    <img class="work-still-img resilient-image" src="${escapeHtml(stillUrlFor(still))}" alt="《${escapeHtml(work.title || "")}》保存的剧照 ${index + 1}" loading="${index ? "lazy" : "eager"}" referrerpolicy="no-referrer" />
    <span class="image-fallback">${icon("photo")}<small>这张图片暂时无法显示</small></span>
  </figure>`).join("");
  const dots = stills.length > 1 ? `<div class="work-still-pagination" aria-label="剧照分页">${stills.map((_, index) => `<span class="${index === 0 ? "active" : ""}" data-still-dot="${index}" aria-current="${index === 0 ? "true" : "false"}"></span>`).join("")}</div>` : "";

  return `<section class="work-section work-stills-section" data-testid="work-stills">
    ${heading}
    <div class="work-stills-shell">
      <div class="work-stills-track" data-testid="work-stills-track">${slides}</div>
      ${stills.length > 1 ? `<button type="button" class="work-still-arrow previous" data-action="scroll-stills" data-direction="previous" aria-label="上一张剧照">‹</button><button type="button" class="work-still-arrow next" data-action="scroll-stills" data-direction="next" aria-label="下一张剧照">›</button>` : ""}
    </div>
    ${dots}
  </section>`;
}

/**
 * R5 补丁 6：票价展示。双人/多张购票时票据里有多笔金额，解析时会加总；
 * 如果只显示这个总额，看起来就像"这部电影一张票就要这么多"，会误导票价认知。
 * 所以张数大于 1 时必须显式写出来。张数优先取解析到的金额笔数，其次取座位数。
 */
function normalizedTicketCurrency(ticketPrice) {
  if (ticketPrice?.currency === "CNY") return "CNY";
  if (ticketPrice?.currency === "JPY") return "JPY";
  // 旧版只存数字时沿用应用原有的日本票务默认值，仅用于兼容展示，不回写旧数据。
  return "JPY";
}

function ticketPriceLabel(event) {
  const amount = Number(event?.ticket_price?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const count = Number(event.ticket_price?.count) || Number(event.viewing_context?.ticket_count) || Number(event.viewing_context?.seat_count) || 1;
  const currency = normalizedTicketCurrency(event.ticket_price);
  const money = currency === "CNY"
    ? `${amount.toLocaleString("zh-CN")}元`
    : `${amount.toLocaleString("ja-JP")}円`;
  return count > 1 ? `${money} · ${count} 张` : money;
}

function workHistoryRow(item, index) {
  const ctx = item.viewing_context || {};
  const normalizedSpec = normalizedViewingFormat(ctx);
  const pending = item.needs_review || !(item.viewed_on || item.screening_at) || !["home", "cinema"].includes(item.location_type);
  const isCinema = item.location_type === "cinema";
  const dateLabel = pending ? "日期待确认" : (eventDateLabel(item, { withTime: isCinema }) || formatShortDate(item.viewed_on));
  const locationLabel = pending ? "观影信息待确认" : isCinema ? (ctx.cinema_name || "影院观看") : (WORK_LOCATION_LABELS[item.location_type] || WORK_LOCATION_LABELS.home);
  const fmtBadge = isCinema ? formatBadge(ctx.format) : null;
  const { badges: evBadges } = eventBadges(ctx.event_types || [], { max: 99 }); // 作品页不做首页的截断，全部显示
  const relationLabel = pending ? "" : item.viewing_relation === "first" ? "初看" : item.viewing_relation === "rewatch" ? "重看" : "";
  const metaBits = [
    ctx.version || "",
    ctx.auditorium || "",
    normalizedSpec.formatNote || "",
    normalizedSpec.is3D ? "3D" : "",
    ctx.language || "",
    ctx.ticket_type || "",
    item.duration_minutes ? `${item.duration_minutes}分` : "",
    ctx.seats?.length ? `座位 ${ctx.seats.join("、")}` : "",
    ticketPriceLabel(item)
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
      ${item.needs_review ? `<button type="button" class="work-history-review archive-pressable" data-action="review-history-event" data-event-id="${escapeHtml(item.id)}" data-testid="needs-review-${escapeHtml(item.id)}" aria-label="补充这次观看的信息">
        <span>这次观看的场景待确认</span>
      </button>` : ""}
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

function publicationLinkCard(publication) {
  let host = "";
  try { host = new URL(publication.url).hostname.replace(/^www\./, ""); } catch (_) { /* 已保存 URL 理应合法 */ }
  return `<a class="external-publication-card" href="${escapeHtml(publication.url)}" target="_blank" rel="noopener noreferrer" data-testid="external-publication-link-${escapeHtml(publication.id)}">
    <span class="external-publication-card-platform">${escapeHtml(publicationPlatformLabel(publication.platform))}</span>
    <strong>${escapeHtml(publication.title || host || "外部网页")}</strong>
    <span class="external-publication-card-host">${escapeHtml(host)} <span aria-hidden="true">↗</span></span>
  </a>`;
}

function externalPublicationItem(publication) {
  const statusId = xStatusId(publication.url);
  const viewingLabel = viewingPublicationLabel(publication, state.currentWorkEvents);
  const preview = statusId
    ? `<div class="external-publication-x" data-x-embed data-testid="external-publication-x-${escapeHtml(publication.id)}">
        <blockquote class="twitter-tweet" data-dnt="true"><a href="${escapeHtml(publication.url)}" target="_blank" rel="noopener noreferrer">X 上的原内容暂时无法预览，查看原文 ↗</a></blockquote>
      </div>`
    : publicationLinkCard(publication);
  return `<article class="external-publication" data-testid="external-publication-${escapeHtml(publication.id)}">
    <div class="external-publication-heading">
      <div><strong>${escapeHtml(publicationPlatformLabel(publication.platform))}</strong>${publication.published_at ? `<time datetime="${escapeHtml(publication.published_at)}">${escapeHtml(formatShortDate(publication.published_at))}</time>` : ""}</div>
      <div class="external-publication-actions">
        <button type="button" data-action="edit-external-publication" data-publication-id="${escapeHtml(publication.id)}">编辑</button>
        <button type="button" class="danger" data-action="remove-external-publication" data-publication-id="${escapeHtml(publication.id)}">从作品中移除</button>
      </div>
    </div>
    ${viewingLabel ? `<span class="external-publication-viewing-label">${escapeHtml(viewingLabel)}</span>` : ""}
    ${preview}
    ${publication.note ? `<p class="external-publication-note"><span>备注</span>${escapeHtml(publication.note)}</p>` : ""}
    <a class="external-publication-origin" href="${escapeHtml(publication.url)}" target="_blank" rel="noopener noreferrer">查看原文 <span aria-hidden="true">↗</span></a>
  </article>`;
}

function externalPublicationsMarkup(publications) {
  const sorted = sortExternalPublications(publications);
  return `<section class="work-section external-publications-section" data-testid="external-publications">
    <div class="external-publications-title-row">
      <div><h2 class="work-section-title">外部发表</h2><p>已公开发布在其他平台的内容引用</p></div>
      <button type="button" class="archive-pressable external-publication-add" data-action="add-external-publication" data-testid="add-external-publication">＋ 添加</button>
    </div>
    ${sorted.length
      ? `<div class="external-publications-list">${sorted.map(externalPublicationItem).join("")}</div>`
      : `<p class="work-section-empty">还没有关联外部发表。</p>`}
  </section>`;
}

function tagChipMarkup(tag, { removable = false } = {}) {
  const name = displayTagName(tag, tagLocale);
  const count = tagUsageCount(state.tagAssignments, tag.id);
  return `<button type="button" class="tag-chip ${tag.category === "director" ? "structured" : ""}" data-action="open-tag" data-tag-id="${escapeHtml(tag.id)}" data-testid="tag-${escapeHtml(tag.id)}">
    <span>#${escapeHtml(name)}</span>${count > 1 && !removable ? `<small>${count}</small>` : ""}
  </button>`;
}

function workTagsRow(work) {
  const tags = tagsForTarget(state.tags, state.tagAssignments, "work", work.id);
  return `<section class="work-tags" data-testid="work-tags" aria-label="作品标签">
    <div class="work-tag-list">${tags.map((tag) => tagChipMarkup(tag)).join("")}</div>
    <button type="button" class="work-tag-edit" data-action="edit-work-tags" aria-label="${escapeHtml(tags.length ? tt("edit") : tt("add"))}">${tags.length ? icon("edit") : "＋"}</button>
  </section>`;
}

function renderWork() {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return renderShelf();
  const view = buildWorkView(work, recordsForWork(work), state.currentWorkEvents);
  // R6：作品可能是"观影前从片单加进来的"，此时没有任何 Record / ViewingEvent。
  // 这一档的文案与主按钮都要换——「补充记录」在还没看过的作品上语义不成立
  // （补充记录本来就是"对已经看过的这部片再补一段感想"）。
  const watched = isWorkWatched(work.id);
  const wantedIn = collectionsForWork(state.collections, work.id);
  return `<main class="work-view" data-testid="work">
    <div class="work-panel" data-testid="work-panel">
      <div class="work-poster-col">${workHeroMarkup(work)}${view.latestAttitude ? `<div class="work-latest-attitude" aria-label="最新个人态度：${escapeHtml(attitudeLabel(view.latestAttitude))}" data-testid="work-latest-attitude">${attitudeIcon(view.latestAttitude)}</div>` : ""}</div>
      <div class="work-info-col">
        <h1 class="work-title">《${escapeHtml(work.title || "未命名作品")}》</h1>
        ${workMetaLine(work)}
        ${taglineRow(work)}
      </div>
    </div>
    <article class="work-content">
      <section class="work-facts" data-testid="work-facts">
        ${workTagsRow(work)}
        ${releaseDateRow(work)}
        ${seriesRow(work)}
        ${collectionsRow(work)}
      </section>
      ${workStillsMarkup(work)}
      <section class="work-section" data-testid="work-history">
        <h2 class="work-section-title">观影履历</h2>
        ${view.history.length
          ? view.history.map((item, i) => workHistoryRow(item, i)).join("")
          : `<p class="work-section-empty" data-testid="work-history-empty">${watched
              ? "还没有观影场次"
              : wantedIn.length
                ? `还没有看过。在${wantedIn.map((item) => `《${escapeHtml(item.title)}》`).join("、")}里等着。`
                : "还没有看过这部作品。"}</p>`}
      </section>
      ${attitudeTimelineMarkup(view.attitudeTimeline)}
      ${impressionsListMarkup(view.impressions)}
      ${externalPublicationsMarkup(state.currentWorkPublications)}
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

/** Series 详情：Core 与 Crossover 共用一条按上映时间排列的作品轴。 */
function renderSeries() {
  const series = state.series.find((item) => item.id === state.currentSeriesId);
  if (!series) return renderShelf();
  const members = orderedSeriesMembers(series, state.works);
  const counts = seriesMemberCounts(series);
  const timeline = seriesTimelineEntries(series, state.works);
  const visibleTimeline = state.seriesFilter === "all"
    ? timeline
    : timeline.filter((entry) => entry.relation === state.seriesFilter);
  const years = timeline.map((entry) => entry.year).filter(Boolean);
  const range = years.length
    ? `${Math.min(...years)} — ${timeline.some((entry) => !entry.year) ? "至今" : Math.max(...years)}`
    : "上映时间待补充";
  const titleById = new Map(state.works.map((work) => [work.id, work.title || "未命名作品"]));
  const memberRows = visibleTimeline.map((entry) => {
    const { work, relation, seriesOrder, relationNote, year } = entry;
    const poster = posterUrlFor(work);
    const initial = escapeHtml((work.title || "?").trim().slice(0, 1));
    const posterMarkup = poster
      ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" />`
      : `<span aria-hidden="true">${initial}</span>`;
    const node = relation === "core"
      ? `<span class="series-timeline-node core"></span>`
      : `<span class="series-timeline-node crossover"></span>`;
    const order = relation === "core" && seriesOrder
      ? `<span class="series-entry-order">${String(seriesOrder).padStart(2, "0")}</span>`
      : "";
    return `<article class="series-timeline-entry ${relation}" data-testid="series-member-${escapeHtml(work.id)}">
      <time class="series-entry-year">${year || "—"}</time>
      <span class="series-entry-rail" aria-hidden="true">${node}</span>
      <div class="series-entry-card">
        <button type="button" class="series-entry-open" data-action="open-work" data-work-id="${escapeHtml(work.id)}" aria-label="打开《${escapeHtml(work.title || "未命名作品")}》">
          <span class="series-entry-poster">${posterMarkup}</span>
          <span class="series-entry-copy">
            ${order}
            <strong>${escapeHtml(work.title || "未命名作品")}</strong>
            <small>${year || "上映年份未知"}</small>
            ${relation === "crossover" && relationNote ? `<span class="series-entry-note">${escapeHtml(relationNote)}</span>` : ""}
          </span>
        </button>
        <button type="button" class="series-entry-edit" data-action="edit-series-member" data-work-id="${escapeHtml(work.id)}" aria-label="编辑《${escapeHtml(work.title || "未命名作品")}》在系列中的关系">${icon("more")}</button>
      </div>
    </article>`;
  }).join("");

  const relationRows = (series.relations || []).map((rel) => `<div class="series-relation" data-testid="series-relation-${escapeHtml(rel.from_work_id)}-${escapeHtml(rel.to_work_id)}">
    <span class="series-relation-copy">《${escapeHtml(titleById.get(rel.from_work_id) || rel.from_work_id)}》的${escapeHtml(seriesRelationLabel(rel.type))}是《${escapeHtml(titleById.get(rel.to_work_id) || rel.to_work_id)}》</span>
    <button type="button" class="icon-button small" data-action="remove-series-relation" data-from="${escapeHtml(rel.from_work_id)}" data-to="${escapeHtml(rel.to_work_id)}" aria-label="删除这条关系">${icon("trash")}</button>
  </div>`).join("");

  const memberOptions = members.map((work) => `<option value="${escapeHtml(work.id)}">${escapeHtml(work.title || "未命名作品")}</option>`).join("");

  return `<main class="series-view" data-testid="series">
    <article class="work-content">
      <header class="series-header">
        <h1 class="page-title">${escapeHtml(series.title)}</h1>
        <p class="series-summary">${counts.core} 部主系列${counts.crossover ? ` · ${counts.crossover} 部关联作品` : ""}</p>
        <p class="series-range">${escapeHtml(range)}</p>
      </header>
      ${members.length ? `<nav class="series-filters" aria-label="筛选系列作品">
        ${[["all", "全部", members.length], ["core", "主系列", counts.core], ["crossover", "关联作品", counts.crossover]].map(([value, label, count]) => `<button type="button" data-action="set-series-filter" data-value="${value}" class="${state.seriesFilter === value ? "active" : ""}" aria-pressed="${state.seriesFilter === value}" ${value === "crossover" && !count ? "disabled" : ""}>${label}<span>${count}</span></button>`).join("")}
      </nav>` : ""}
      ${counts.crossover ? `<div class="series-legend" aria-label="图例"><span><i class="core"></i>主系列</span><span><i class="crossover"></i>关联作品</span></div>` : ""}
      <section class="series-timeline" aria-label="系列作品脉络">
        ${memberRows || `<p class="work-section-empty">${members.length ? "这个筛选下没有作品" : "这个系列还没有作品"}</p>`}
      </section>
      ${(series.relations || []).length || members.length >= 2 ? `<details class="series-legacy-relations" data-testid="series-relations">
        <summary>作品之间的其他关系</summary>
        <p class="settings-note">可继续保留原有的前作、续作等手动连线；它们不会改变主系列与关联作品身份。</p>
        <div class="series-relations">${relationRows || `<p class="work-section-empty">还没有标注其他关系</p>`}</div>
        ${members.length >= 2 ? `<form id="series-relation-form" class="series-relation-form">
          <label><span>作品</span><select name="fromWorkId">${memberOptions}</select></label>
          <label><span>关系</span><select name="type">${SERIES_RELATION_TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
          <label><span>指向</span><select name="toWorkId">${memberOptions}</select></label>
          <button class="sheet-done" type="submit" data-testid="add-series-relation">添加关系</button>
        </form>` : ""}
      </details>` : ""}
    </article>
  </main>`;
}

/** 片单列表页（侧边栏入口）。 */
function renderCollections() {
  const rows = state.collections.map((collection) => {
    // R6：片单里现在可能同时有已看和没看的作品，行摘要直接把"还没看几部"说出来——
    // 补片片单的核心信息就是"我还欠自己几部"。
    const entries = collectionEntries(collection);
    const unwatched = entries.filter((entry) => !isWorkWatched(entry.work_id)).length;
    return `<button type="button" class="collection-row" data-action="open-collection" data-collection-id="${escapeHtml(collection.id)}" data-testid="collection-row-${escapeHtml(collection.id)}">
    <span class="collection-row-main">
      <b>${escapeHtml(collection.title)}</b>
      ${collection.description ? `<small>${escapeHtml(collection.description)}</small>` : ""}
    </span>
    <span class="collection-row-count">${entries.length} 部${unwatched ? ` · ${unwatched} 部未看` : ""}</span>
  </button>`;
  }).join("");

  return `<main class="shelf-view" data-testid="collections">
    <article class="work-content">
      <h1 class="page-title">候场片单</h1>
      <p class="settings-note">候场片单是你自己定义的主题列表：想怎么归类都可以，和作品客观所属的「系列」互不影响。还没看过的电影也可以先加进来。</p>
      <div class="collection-rows">${rows || `<p class="work-section-empty">还没有片单——点右下角的 ＋ 新建一个</p>`}</div>
    </article>
  </main>`;
}

/** 片单详情页。 */
/**
 * R6 §5：某部作品是否已经看过，**永远由「Work 是否存在观影记录」派生**，
 * 绝不存在片单条目里。所以同一部《鸟人》同时在三个片单里时，看完之后三个片单
 * 都会自动显示"已看"，不需要分别去改三条条目。
 */
/** 这部作品最近一次观看的日期标签（拿不到就返回 null，徽章上只显示"看过"）。 */
function lastWatchedLabel(work) {
  if (!work) return null;
  const ids = new Set([work.id, ...(work.merged_from || [])]);
  const dates = (state.allViewingEvents || [])
    .filter((event) => ids.has(event.work_id))
    .map((event) => event.screening_at || event.viewed_on)
    .filter(Boolean)
    .sort();
  return dates.length ? formatShortDate(dates[dates.length - 1]) : null;
}

function isWorkWatched(workId) {
  if (!workId) return false;
  const work = findWorkById(state.works, workId);
  const ids = new Set([workId, ...(work ? [work.id, ...(work.merged_from || [])] : [])]);
  if (state.records.some((record) => ids.has(record.work_id || record.workId))) return true;
  return (state.allViewingEvents || []).some((event) => ids.has(event.work_id));
}

/**
 * 片单详情页。
 *
 * R6 之前这里只有一个作品网格 + 一句"到作品页点＋加入片单把它放进来"的空状态——
 * 加入动作的唯一起点是作品页，而作品页只能从书架进入、书架只列已有作品，
 * 于是片单事实上只能从"已经看过的作品"里挑。现在改成列表式条目，每条带：
 * 加入理由（reason）、已看/未看状态、移除、上下移，并在页内直接提供「添加作品」。
 */
function renderCollection() {
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);
  if (!collection) return renderCollections();

  const pairs = collectionWorkEntries(collection, state.works);
  const total = pairs.length;

  const rows = pairs.map(({ work, entry }, index) => {
    const watched = isWorkWatched(work.id);
    const year = releaseYearOf(work);
    const watchedAt = watched ? lastWatchedLabel(work) : null;
    const poster = posterUrlFor(work);
    const initial = escapeHtml((work.title || "?").trim().charAt(0) || "?");

    // 不再给 li 挂 watched/unwatched class——状态已经由海报上的印章表达，
    // 再叠一层视觉区分只是噪声（而且那两个 class 现在没有任何样式）。
    return `<li class="collection-entry" data-testid="collection-entry-${escapeHtml(work.id)}">
      <button type="button" class="collection-entry-poster" data-action="open-work" data-work-id="${escapeHtml(work.id)}" aria-label="打开《${escapeHtml(work.title || "")}》">
        ${poster
          ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" />`
          : `<span class="collection-entry-poster-fallback" aria-hidden="true">${initial}</span>`}
        ${watched ? `<span class="watched-stamp" data-testid="collection-entry-status-${escapeHtml(work.id)}">
          <b>看过</b>${watchedAt ? `<small>${escapeHtml(watchedAt)}</small>` : ""}
        </span>` : ""}
      </button>

      <div class="collection-entry-main">
        <div class="collection-entry-head">
          <button type="button" class="collection-entry-title" data-action="open-work" data-work-id="${escapeHtml(work.id)}">
            ${escapeHtml(work.title || "未命名作品")}${year ? `<small>${year}</small>` : ""}
          </button>
          <button type="button" class="icon-button collection-entry-menu" data-action="open-entry-menu" data-work-id="${escapeHtml(work.id)}" data-index="${index}" aria-label="更多操作" data-testid="entry-menu-${escapeHtml(work.id)}">${icon("more")}</button>
        </div>
        <p class="collection-entry-added">收藏于 ${escapeHtml(formatShortDate(entry.added_at) || "—")}</p>
        <p class="collection-entry-reason ${entry.reason ? "" : "empty"}" data-action="edit-entry-reason" data-work-id="${escapeHtml(work.id)}">${
          entry.reason ? escapeHtml(entry.reason) : "写下想看它的理由…"
        }</p>
      </div>
    </li>`;
  }).join("");

  const unwatched = pairs.filter(({ work }) => !isWorkWatched(work.id)).length;

  return `<main class="shelf-view" data-testid="collection">
    <article class="work-content">
      <h1 class="page-title">${escapeHtml(collection.title)}</h1>
      ${collection.description ? `<p class="settings-note">${escapeHtml(collection.description)}</p>` : ""}
      <p class="collection-summary" data-testid="collection-summary">${total} 部${unwatched ? ` · ${unwatched} 部还没看` : ""}</p>
      ${total
        ? `<ul class="collection-entries" data-testid="collection-entries">${rows}</ul>`
        : `<p class="work-section-empty">这个片单还没有作品——点右下角的 ＋，选择「添加作品」开始搜索</p>`}
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
  return memoryListMarkup(record.cards || [], { icon, currentSourceRevisionIds: sourceRevisionIds(record) });
}

function analysisDraftMarkup(record) {
  const draft = record.activeAnalysisDraft;
  if (!draft) return "";
  const emotions = (draft.emotions || []).map((emotion) => `<span>${escapeHtml(emotion.label)}</span>`).join("");
  return `<section class="analysis-draft ${draft.stale ? "stale" : ""}" data-testid="analysis-draft">
    <div class="section-heading"><div><small>AI 整理草稿 · 尚未进入正式记录</small><h2>${draft.stale ? "这份草稿基于较早版本" : "这次整理出的电影印记"}</h2></div></div>
    ${draft.stale ? `<p class="stale-note">源内容已经更新。你可以保留这份历史草稿，也可以重新整理；正式记录不会被覆盖。</p>` : ""}
    ${draft.attitude?.suggested ? `<p class="draft-attitude">总体态度建议：<b>${escapeHtml(attitudeLabel(draft.attitude.suggested))}</b></p>` : ""}
    ${emotions ? `<div class="emotion-suggestions">${emotions}</div>` : ""}
    ${memoryListMarkup(draft.memory_cards || [], { icon, mode: "draft", currentSourceRevisionIds: sourceRevisionIds(record) })}
    <div class="analysis-draft-actions">
      <button type="button" class="sheet-done" data-action="confirm-analysis-draft">${record.cards?.length ? "把建议加入正式记录" : "确认这次电影印记"}</button>
      ${record.cards?.length ? `<button type="button" class="text-action" data-action="replace-with-analysis-draft">用这次结果替换正式卡片</button>` : ""}
      <button type="button" class="text-action" data-action="discard-analysis-draft">保留正式记录并收起草稿</button>
    </div>
  </section>`;
}

function analysisDraftOverlay(record) {
  return `<div class="overlay" data-testid="analysis-draft-sheet">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭 AI 整理草稿"></button>
    <section class="bottom-sheet analysis-draft-sheet" role="dialog" aria-modal="true" aria-labelledby="analysis-draft-sheet-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">后台整理</span><h2 id="analysis-draft-sheet-title">AI 整理草稿</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      ${analysisDraftMarkup(record)}
    </section>
  </div>`;
}

function interviewArchiveMarkup(record) {
  const interview = record.self_interview;
  const answered = answeredInterviewItems(interview);
  const action = interview?.status === "in_progress"
    ? `<button type="button" class="text-action" data-action="resume-interview">继续采访</button>`
    : interview?.status === "not_started"
      ? `<button type="button" class="text-action" data-action="open-interview-invite">开始自我采访</button>`
      : `<button type="button" class="text-action" data-action="edit-interview">修改回答</button>`;
  return `<section class="raw-archive interview-archive" data-testid="interview-archive">
    <div class="raw-archive-heading"><div><small>原始档案</small><h2>🎙 观后自我采访</h2></div>${action}</div>
    ${answered.length ? `<div class="interview-answer-list">${answered.map((answer) => `<details><summary>${escapeHtml(answer.question)}</summary><p>${escapeHtml(answer.answer_text)}</p></details>`).join("")}</div>` : `<p class="work-section-empty">${interview?.status === "skipped" ? "这次跳过了采访。" : "还没有采访回答。"}</p>`}
  </section>`;
}

function normalizedRecommendationDetails(record) {
  return { ...emptyRecommendationDetails(), ...(record.recommendationDetails || {}) };
}

function recommendationPresetValues(recommendation) {
  return (RECOMMENDATION_PRESETS[recommendation] || []).flatMap((group) => group.options);
}

function workTypeLabel(type) {
  return type === "anime" ? "动画" : type === "real" ? "真人影视" : "影视作品";
}

function workMatchSourceStatusMarkup(match) {
  if (!match?.sources) return "";
  return `<p class="work-search-sources ${hasDegradedSource(match.sources) ? "degraded" : ""}" data-testid="work-match-sources">
    ${summarizeSearchSources(match.sources).map((item) => `<span class="source-chip tone-${item.tone}" data-testid="work-match-source-${item.source}">${escapeHtml(item.text)}</span>`).join("")}
  </p>`;
}

function workMatchPanel(record) {
  const work = currentWork(record);
  if (!work) return "";
  const match = work.match || { status: "idle", candidates: [] };
  if (match.status === "confirmed") {
    // R5 补丁 6：「作品已确认」「Bangumi #25833」都是给后台看的，用户不需要；
    // 「修改匹配」这个独立按钮也删掉。整块改成和下面「个人态度与推荐」一样的
    // 行式入口——右侧一个 "〉"，点整行进入修改匹配。
    const subtitle = [work.original_title, work.release_year].filter(Boolean).join(" · ");
    return `<button type="button" class="judgement-summary" data-action="rematch-work" data-testid="work-match-panel">
      <span class="judgement-summary-icon" aria-hidden="true">${icon("match")}</span>
      <span class="judgement-summary-copy">
        <small>作品条目 · 点击修改</small>
        <b>${escapeHtml(subtitle || work.title || "已匹配")}</b>
      </span>${icon("chevron")}
    </button>`;
  }
  if (match.status === "needs_confirmation") {
    return `<section class="work-match-panel" data-testid="work-match-panel">
      <div class="work-match-heading"><span class="section-label-icon">${icon("match")}作品匹配</span><b>请选择正确条目</b></div>
      ${workMatchSourceStatusMarkup(match)}
      <div class="work-candidates">
        ${(match.candidates || []).map((candidate, index) => `<button type="button" class="work-candidate" data-action="confirm-work-match" data-index="${index}">
          <b>${escapeHtml(candidate.title)}<span class="work-search-item-source src-${escapeHtml(candidate.source)}">${escapeHtml(SOURCE_DISPLAY[candidate.source] || candidate.source)}</span></b>
          <span>${escapeHtml(candidate.originalTitle || "")}</span>
          <small>${escapeHtml(workTypeLabel(candidate.workType))}${candidate.year ? ` · ${candidate.year}` : ""}</small>
        </button>`).join("")}
      </div>
      <button type="button" class="work-match-secondary" data-action="dismiss-work-match">${match.correcting ? "保留当前匹配" : "都不是，保留本地作品"}</button>
    </section>`;
  }
  if (match.status === "searching") {
    return `<section class="work-match-panel muted" data-testid="work-match-panel"><span class="match-spinner" aria-hidden="true"></span><p>正在查找正式作品条目…</p></section>`;
  }
  const message = match.message || (match.status === "no_results"
    ? "没有找到合适条目，本地作品已经保留。"
    : match.status === "dismissed"
      ? "已保留为本地作品。"
      : match.status === "unavailable"
        ? "暂时无法联网匹配，本地记录不受影响。"
        : "作品目前保存在本地，可以查找正式条目。");
  return `<section class="work-match-panel muted" data-testid="work-match-panel">
    <div class="work-match-state-copy"><p>${message}</p>${workMatchSourceStatusMarkup(match)}${emptyResultHint(match)}</div><button type="button" class="work-match-secondary" data-action="retry-work-match">${match.status === "idle" ? "查找作品" : "重新匹配"}</button>
  </section>`;
}

/**
 * 「这是同一部作品，还是另一部？」——在改写 Work 之前拦一道。
 *
 * 这个浮层存在的唯一理由，是上一版把两个语义完全不同的操作合并进了同一个按钮：
 * 「修正这个作品条目的资料」和「我这条记录挂错作品了」。前者会波及同条目下的
 * 全部记录，后者只该动一条。爆炸半径差这么多的两件事，必须让用户自己选。
 */
function workSplitOverlay() {
  const prompt = state.workSplitPrompt;
  if (!prompt) return "";
  return `<div class="overlay" data-testid="work-split-sheet">
    <button class="overlay-backdrop" type="button" data-action="cancel-work-split" aria-label="取消"></button>
    <section class="bottom-sheet work-split-sheet" role="dialog" aria-modal="true" aria-labelledby="work-split-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">请确认</span><h2 id="work-split-title">这是同一部作品吗？</h2></div></div>
      <p class="settings-note">
        你选的候选是<b>《${escapeHtml(prompt.candidateTitle || "")}》</b>，
        和当前条目<b>《${escapeHtml(prompt.workTitle || "")}》</b>${escapeHtml(prompt.reason || "")}。
      </p>
      <p class="settings-note danger-note">
        当前条目下还挂着 <b>${prompt.affectedCount}</b> 条其他感想。
        如果按「同一部作品」处理，这 ${prompt.affectedCount} 条的标题与类型会一起改变。
      </p>
      <div class="work-split-choices">
        <button type="button" class="work-candidate" data-action="work-split-detach" data-testid="work-split-detach">
          <b>这是另一部作品</b>
          <span>只把<b>当前这一条</b>感想改挂过去，另外 ${prompt.affectedCount} 条和原条目<b>完全不动</b>。</span>
          <small>推荐 · 同名重制版、真人版、续作都属于这种</small>
        </button>
        <button type="button" class="work-candidate" data-action="work-split-overwrite" data-testid="work-split-overwrite">
          <b>是同一部作品，用候选资料覆盖</b>
          <span>把当前条目本身改写成候选的资料，同条目下 ${prompt.affectedCount + 1} 条感想全部跟着变。</span>
          <small>仅在原条目资料确实录错了的时候选这个</small>
        </button>
      </div>
      <button type="button" class="work-match-secondary" data-action="cancel-work-split">先不改，返回</button>
    </section>
  </div>`;
}

function workMatchOverlay(record) {
  const work = currentWork(record);
  const match = work?.match || { status: "idle", query: "" };
  const query = match.query || buildWorkSearchQuery(record) || work?.title || record.title || "";
  const searching = match.status === "searching";
  return `<div class="overlay" data-testid="work-match-sheet">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭作品匹配"></button>
    <section class="bottom-sheet work-match-sheet" role="dialog" aria-modal="true" aria-labelledby="work-match-sheet-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work?.title || record.title || "")}》</span><h2 id="work-match-sheet-title">查找正式作品</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">用于修正<b>这个作品条目</b>的资料、海报与外部标识。你的原文、记忆卡片与观影信息不会被改动；但条目资料是同条目下所有感想共用的，选到另一部电影时会先向你确认。</p>
      <form id="work-match-search-form" class="work-match-search-form">
        <label for="work-match-query">换一个片名重新搜索</label>
        <div class="work-match-search-row">
          <input type="search" id="work-match-query" name="query" value="${escapeHtml(query)}" placeholder="例如 The Lord of the Rings: The Two Towers" autocomplete="off" maxlength="80" required data-testid="work-match-query" ${searching ? "disabled" : ""} />
          <button type="submit" data-testid="work-match-search" ${searching ? "disabled" : ""}>${searching ? "搜索中…" : "搜索"}</button>
        </div>
        <small>可以改用英文名、原名或更准确的译名；只有确认候选后才会修改作品条目。</small>
      </form>
      ${workMatchPanel(record)}
    </section>
  </div>`;
}

function viewingEventsSection(events) {
  if (!events || events.length === 0) return "";
  const dtFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" });
  const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
  const rows = events.map((e) => {
    const ctx = e.viewing_context || {};
    const normalizedSpec = normalizedViewingFormat(ctx);
    const pending = e.needs_review || !(e.viewed_on || e.screening_at) || !["home", "cinema"].includes(e.location_type);
    const dateStr = e.viewed_on ? dtFmt.format(new Date(e.viewed_on)) : (e.screening_at ? dtFmt.format(new Date(e.screening_at)) : "");
    const startStr = e.screening_at ? timeFmt.format(new Date(e.screening_at)) : "";
    const endStr = e.screening_ends_at ? timeFmt.format(new Date(e.screening_ends_at)) : "";
    const timeRange = startStr && endStr ? `${startStr}–${endStr}` : startStr;
    const seats = ctx.seats?.length ? ctx.seats.join("、") : "";
    const ticketPrice = ticketPriceLabel(e);
    const locationLabel = pending ? "观影信息待确认" : e.location_type === "cinema" ? (ctx.cinema_name || "电影院观看") : "在家／线上观看";
    return `<div class="viewing-event-card ${pending ? "pending" : ""}">
      <div class="ve-heading"><div class="ve-cinema">${escapeHtml(locationLabel)}</div><button type="button" class="icon-button small ve-edit" data-action="edit-history-event" data-event-id="${escapeHtml(e.id)}" aria-label="修改观影信息" data-testid="edit-record-viewing-info">${icon("edit")}</button></div>
      <div class="ve-meta">
        ${pending ? `<span>补充实际观看日期与观看方式</span>` : ""}
        ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ""}
        ${timeRange ? `<span>${escapeHtml(timeRange)}</span>` : ""}
        ${ctx.version ? `<span>${escapeHtml(ctx.version)}</span>` : ""}
        ${ctx.auditorium ? `<span>${escapeHtml(ctx.auditorium)}</span>` : ""}
        ${normalizedSpec.format ? `<span>${escapeHtml(normalizedSpec.format)}</span>` : ""}
        ${normalizedSpec.formatNote ? `<span>${escapeHtml(normalizedSpec.formatNote)}</span>` : ""}
        ${normalizedSpec.is3D ? `<span>3D</span>` : ""}
        ${ctx.ticket_type ? `<span>${escapeHtml(ctx.ticket_type)}</span>` : ""}
        ${seats ? `<span>座位 ${escapeHtml(seats)}</span>` : ""}
        ${ticketPrice ? `<span>${escapeHtml(ticketPrice)}</span>` : ""}
      </div>
    </div>`;
  }).join("");
  return `<section class="viewing-events-section" data-testid="viewing-events">
    <h2 class="viewing-events-heading">观影场次</h2>
    ${rows}
  </section>`;
}

function eventsForRecord(record) {
  return viewingEventsForRecord(record, state.viewingEvents);
}

function actualViewingDate(record) {
  const event = eventsForRecord(record)
    .sort((a, b) => (a.screening_at || a.viewed_on || "").localeCompare(b.screening_at || b.viewed_on || ""))[0];
  if (event) return event.screening_at || event.viewed_on || null;
  return record.record_kind === "supplement" ? record.createdAt : null;
}

function renderDetail() {
  const record = currentRecord();
  if (!record) return renderHome();
  const work = currentWork(record);
  const title = work?.title || record.title;
  const bangumiReference = work?.external_refs?.find((reference) => reference.source === "bangumi");
  const titleMarkup = bangumiReference
    ? `《<a href="https://bangumi.tv/subject/${encodeURIComponent(bangumiReference.id)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>》`
    : `《${escapeHtml(title)}》`;
  const recordEvents = eventsForRecord(record);
  const viewedAt = actualViewingDate(record);
  const detailDate = viewedAt
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(viewedAt))
    : "观影日期待确认";
  return `<main class="detail-view" data-testid="detail">
    ${detailHeader(record)}
    <article class="detail-content">
      <div class="detail-date ${viewedAt ? "" : "pending"}">${escapeHtml(detailDate)}</div>
      <div class="detail-title-row"><h1>${titleMarkup}</h1><span class="attitude-badge ${record.attitude ? "selected" : "empty"}"><i aria-hidden="true"></i>${escapeHtml(attitudeLabel(record.attitude))}</span></div>
      ${viewingEventsSection(recordEvents)}
      <div class="memory-heading"><h2>这次留下来的记忆</h2><div class="memory-heading-actions"><button class="text-action add-card" type="button" data-action="add-card">＋ 添加一条记忆</button></div></div>${state.deletedCardUndo?.recordId === record.id ? `<button class="undo-card" type="button" data-action="undo-delete-card">已删除“${escapeHtml(state.deletedCardUndo.card.title || "一条记忆")}” · 撤销</button>` : ""}${record.cardSuggestionStatus === "failed" && record.cardSuggestionError ? `<p class="card-suggestion-error" data-testid="card-suggestion-error">AI 建议没有完成：${escapeHtml(record.cardSuggestionError)}</p>` : ""}${memoryCard(record)}
      ${interviewArchiveMarkup(record)}
      ${record.aiWarnings?.length ? `<details class="analysis-warnings"><summary>整理提示</summary><ul>${record.aiWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></details>` : ""}
      ${record.analysis_status === "running" || record.analysis_status === "failed" ? `<section class="raw-only-status" data-testid="raw-only-status"><div><b>${record.analysis_status === "running" ? "正在安静整理" : "原始资料已经保存"}</b><p>${record.analysis_status === "running" ? "可以先离开，完成后从右下角的 AI 整理草稿进入。" : "上次没有整理完成，自由感想和采访回答都不受影响。"}</p>${record.analysis_status === "failed" && record.analysis_error ? `<small class="raw-only-error" data-testid="analysis-error">原因：${escapeHtml(record.analysis_error)}</small>` : ""}</div></section>` : ""}
      ${record.analysis_stale ? `<section class="stale-banner" data-testid="analysis-stale"><b>源内容已更新</b><p>正式卡片保持原样。需要时可从右下角重新生成 AI 整理草稿。</p></section>` : ""}
      <section class="raw-archive reflection-archive"><div class="raw-archive-heading"><div><small>原始手记</small><h2>我的原始感想</h2></div><button class="text-action" type="button" data-action="edit-impression" data-testid="edit-impression">${icon("edit")}编辑原文</button></div><div class="reflection-letter"><p class="impression">${escapeHtml(record.rawText)}</p></div></section>
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
  const eventContext = firstEvent?.viewing_context || {};
  const normalizedSpec = normalizedViewingFormat({
    format: eventContext.format || ctx.format,
    format_note: eventContext.format_note ?? ctx.formatNote,
    is_3d: eventContext.is_3d ?? ctx.is3D
  });
  const dateStr = firstEvent?.viewed_on
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(firstEvent.viewed_on))
    : "";
  const parts = [`《${ctx.workTitle?.trim() || "未命名作品"}》`];
  const pendingInfo = firstEvent?.needs_review || !(firstEvent?.viewed_on || firstEvent?.screening_at) || !["home", "cinema"].includes(firstEvent?.location_type);
  if (pendingInfo) parts.push("观影信息待确认");
  if (dateStr) parts.push(dateStr);
  if (eventContext.version || ctx.version) parts.push(eventContext.version || ctx.version);
  const locationType = firstEvent?.location_type || ctx.locationType;
  if (locationType === "home") {
    parts.push("在家观看");
  } else {
    if (eventContext.cinema_name || ctx.cinemaName) parts.push(eventContext.cinema_name || ctx.cinemaName);
    if (eventContext.auditorium || ctx.auditorium) parts.push(eventContext.auditorium || ctx.auditorium);
    if (normalizedSpec.format) parts.push(normalizedSpec.format);
    if (normalizedSpec.formatNote) parts.push(normalizedSpec.formatNote);
    if (normalizedSpec.is3D) parts.push("3D");
  }
  if (pendingInfo) return `<div class="capture-context-bar" data-testid="capture-context-bar">${parts.map(escapeHtml).join(" · ")}</div>`;
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

/**
 * R6 补丁：清空所有数据的确认面板。
 *
 * 取代原来的 `?reset` URL 触发。那个做法有三个问题：
 * 1. **完全没有确认**——任何一次访问带 `?reset` 的地址都会静默清库。
 *    地址一旦被收藏、被分享、或被浏览器的会话恢复重新打开，数据就没了。
 * 2. 它在模块顶层用 top-level await 执行，且没有 try/catch。清库一旦抛错
 *    （云端 500、网络中断），未捕获的 rejection 会让整个模块加载失败，
 *    表现就是"打开是一片空白"，而且看不出和清库有关。
 * 3. 清完之后 `history.replaceState` 把查询串抹掉，用户既没有任何反馈，
 *    也不知道到底清没清。
 *
 * 现在改成偏好设置里的显式入口 + 输入确认词。要求打字而不是点两次"确定"，
 * 是因为这个操作不可撤销：误触两次按钮完全可能，误打两个字不会。
 */
function resetDataOverlay() {
  const cloudEnabled = !!getAccessPassword();
  const counts = [
    [state.records.length, "条感想"],
    [state.works.length, "部作品"],
    [state.allViewingEvents?.length || 0, "场观影"],
    [state.collections.length, "个片单"],
    [state.series.length, "个系列"]
  ].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);

  const typed = state.resetConfirmText || "";
  const ready = typed.trim() === RESET_CONFIRM_PHRASE;
  const busy = state.resetBusy;

  return `<div class="overlay" data-testid="reset-data">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="reset-data-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">危险操作</span><h2 id="reset-data-title">清空所有数据</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>

      <p class="settings-note">将要删除${counts.length ? `：<b>${counts.join(" · ")}</b>` : "当前所有数据（现在看起来已经是空的）"}。</p>
      <p class="settings-note">清空范围：<b>${cloudEnabled ? "本机数据 + 云端数据库" : "本机数据"}</b>${cloudEnabled ? "" : "（未开启云端同步）"}。<b>此操作无法撤销。</b></p>

      <div class="settings-actions">
        <button type="button" data-action="export-all-download" data-testid="reset-backup-first"><span><b>先下载一份 JSON 备份</b><small>强烈建议——清空后没有任何找回途径</small></span>${icon("export")}</button>
      </div>

      <label class="reset-confirm-field">
        <span>确认请输入「${RESET_CONFIRM_PHRASE}」</span>
        <input type="text" id="reset-confirm-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${escapeHtml(typed)}" placeholder="${RESET_CONFIRM_PHRASE}" data-testid="reset-confirm-input" />
      </label>

      <button type="button" class="sheet-done reset-confirm-button" data-action="confirm-reset-data" ${ready && !busy ? "" : "disabled"} data-testid="confirm-reset-data">${busy ? "正在清空…" : "永久删除全部数据"}</button>
      ${state.resetMessage ? `<p class="settings-note" data-testid="reset-message">${escapeHtml(state.resetMessage)}</p>` : ""}
    </section>
  </div>`;
}

/**
 * TMDB 配置诊断区块。一个按钮跑完整链路检查，结论用人话写在下面，
 * 原始 JSON 也一并展示（可复制），不需要手工构造任何请求头。
 */
function tmdbDiagnosticSection() {
  const diag = state.tmdbDiagnostic;
  const running = diag.status === "running";

  let result = "";
  if (diag.status === "error") {
    result = `<p class="settings-note diag-error" data-testid="tmdb-diag-error">诊断请求失败：${escapeHtml(diag.error || "未知错误")}
      ${/401|unauthorized/i.test(diag.error || "") ? "<br>访问密码可能已失效，请到上面的「云端同步」重新输入。" : ""}</p>`;
  } else if (diag.status === "done") {
    const verdict = interpretTmdbStatus(diag.payload);
    const runtime = diag.payload?.runtime || {};
    result = `<div class="diag-result tone-${verdict.tone}" data-testid="tmdb-diag-result">
      <p class="diag-title">${escapeHtml(verdict.title)}</p>
      <p class="diag-detail">${verdict.detail}</p>
      <p class="diag-runtime">Functions 运行中：${runtime.functions_deployed ? "是" : "否"} ·
        访问密码：${runtime.access_password_enabled ? "已启用" : "未启用"} ·
        D1 绑定：${runtime.d1_bound ? "已绑定" : "未绑定"}</p>
      <details><summary>原始诊断数据</summary><pre data-testid="tmdb-diag-raw">${escapeHtml(JSON.stringify(diag.payload, null, 2))}</pre></details>
      <button type="button" class="diag-copy" data-action="copy-tmdb-diagnostic">复制诊断结果</button>
    </div>`;
  }

  return `<div class="settings-actions">
    <button type="button" data-action="run-tmdb-diagnostic" ${running ? "disabled" : ""} data-testid="run-tmdb-diagnostic">
      <span><b>${running ? "正在诊断…" : "运行 TMDB 诊断"}</b><small>检查环境变量是否生效、凭据是否被 TMDB 接受。不会显示任何密钥。</small></span>${icon("chevron")}
    </button>
  </div>
  ${result}`;
}

/** R6 补丁 12：删除作品的确认面板。有感想时直接挡住，不给"一键全删"的能力。 */
function deleteWorkOverlay(work) {
  const impact = workDeletionImpact(work);
  if (!impact) return "";
  const blocked = impact.records.length > 0;
  const ready = state.deleteWorkConfirm.trim() === RESET_CONFIRM_PHRASE;

  const willLose = [
    impact.events.length ? `${impact.events.length} 场观影记录` : null,
    impact.collections.length ? `从 ${impact.collections.length} 个片单中移除` : null,
    impact.reasons.length ? `${impact.reasons.length} 条加入理由` : null,
    impact.publications.length ? `${impact.publications.length} 条外部发表引用` : null,
    impact.series ? `退出系列《${impact.series.title}》` : null
  ].filter(Boolean);

  return `<div class="overlay" data-testid="delete-work">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="delete-work-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="delete-work-title">删除这部作品</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>

      ${blocked
        ? `<p class="settings-note diag-error" data-testid="delete-work-blocked">
             这部作品下还有 <b>${impact.records.length} 条感想</b>，不能直接删除。<br>
             作品资料删了可以从 TMDB / Bangumi 重新拿，但感想是你自己写的、找不回来——
             请先到各条感想里逐条删除，确认真的不要了，再回来删作品。
           </p>
           <p class="settings-note">如果你只是想让它用上新的海报规则，用 FAB 里的<b>「刷新作品资料」</b>就行，不需要删除重建。</p>`
        : `<p class="settings-note">这部作品目前没有任何感想，可以安全删除。</p>
           ${willLose.length ? `<p class="settings-note">将一并处理：<b>${escapeHtml(willLose.join(" · "))}</b>。<b>无法撤销。</b></p>` : ""}
           <label class="reset-confirm-field">
             <span>确认请输入「${RESET_CONFIRM_PHRASE}」</span>
             <input type="text" id="delete-work-confirm-input" autocomplete="off" value="${escapeHtml(state.deleteWorkConfirm)}" data-testid="delete-work-confirm-input" />
           </label>
           <button type="button" class="sheet-done reset-confirm-button" data-action="confirm-delete-work" ${ready ? "" : "disabled"} data-testid="confirm-delete-work">永久删除这部作品</button>`}
    </section>
  </div>`;
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
        <button type="button" data-action="export-all-share" ${state.records.length || state.collections.length ? "" : "disabled"}><span><b>分享全部记录（Markdown 合集）</b><small>${state.records.length ? `共 ${state.records.length} 条，一次分享` : "还没有可导出的记录"}</small></span>${icon("share")}</button>
        <button type="button" data-action="export-all-download" ${state.records.length || state.collections.length ? "" : "disabled"}><span><b>下载全部记录（JSON 备份）</b><small>结构化数据，适合长期存档</small></span>${icon("export")}</button>
      </div>
      <p class="settings-note">偏好只保存在本机，不会修改已有作品记录。</p>
      <h3 class="settings-section-title">诊断</h3>
      ${tmdbDiagnosticSection()}
      <h3 class="settings-section-title danger">危险区域</h3>
      <div class="settings-actions">
        <button type="button" class="settings-danger" data-action="open-reset-data" data-testid="open-reset-data"><span><b>清空所有数据</b><small>删除全部感想、作品、观影场次、系列与片单。无法撤销。</small></span>${icon("trash")}</button>
      </div>
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
        ${ATTITUDES.map(([value, label]) => `<button type="button" class="choice ${record.attitude === value ? "selected" : ""}" data-action="select-attitude" data-value="${value}" aria-pressed="${record.attitude === value}"><span class="attitude-choice-icon" aria-hidden="true">${attitudeIcon(value)}</span><span>${label}</span></button>`).join("")}
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

function interviewInviteOverlay(record) {
  return `<div class="overlay" data-testid="interview-invite">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="稍后再说"></button>
    <section class="bottom-sheet interview-invite-sheet" role="dialog" aria-modal="true" aria-labelledby="interview-invite-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <span class="sheet-kicker">原始感想已保存</span>
      <h2 id="interview-invite-title">还想再留下一点刚看完时的记忆吗？</h2>
      <p>我可以问你几个很短的问题，每题都可以跳过。回答会按原话保存，AI 不会改写。</p>
      <button type="button" class="sheet-done" data-action="start-interview">开始自我采访</button>
      <button type="button" class="text-action" data-action="skip-interview">直接生成电影印记</button>
    </section>
  </div>`;
}

function interviewQuestionOverlay(record) {
  const index = Math.max(0, Math.min(state.interviewQuestionIndex, SELF_INTERVIEW_QUESTIONS.length - 1));
  const question = SELF_INTERVIEW_QUESTIONS[index];
  const answer = record.self_interview?.answers?.find((item) => item.question_id === question.id);
  return `<div class="overlay interview-overlay" data-testid="self-interview">
    <button class="overlay-backdrop" type="button" data-action="close-interview" aria-label="保存并稍后继续"></button>
    <section class="bottom-sheet interview-question-sheet" role="dialog" aria-modal="true" aria-labelledby="interview-question-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="interview-progress"><span>${index + 1} / ${SELF_INTERVIEW_QUESTIONS.length}</span><button type="button" class="text-action" data-action="view-all-interview-questions">查看全部问题</button></div>
      <h2 id="interview-question-title">${escapeHtml(question.question)}</h2>
      <p class="interview-hint">${escapeHtml(question.hint)}</p>
      <textarea id="interview-answer-input" data-question-id="${escapeHtml(question.id)}" placeholder="按现在记得的样子写就好">${escapeHtml(answer?.status === "answered" ? answer.answer_text : "")}</textarea>
      <small class="interview-save-status" data-testid="interview-save-status">回答会自动保存</small>
      <div class="interview-nav">
        <button type="button" data-action="interview-previous" ${index === 0 ? "disabled" : ""}>上一题</button>
        <button type="button" class="text-action" data-action="skip-interview-question">跳过</button>
        <button type="button" class="sheet-done" data-action="interview-next">${index === SELF_INTERVIEW_QUESTIONS.length - 1 ? "查看摘要" : "下一题"}</button>
      </div>
      <button type="button" class="text-action interview-end" data-action="finish-interview">结束采访</button>
    </section>
  </div>`;
}

function interviewAllOverlay(record) {
  return `<div class="overlay interview-overlay" data-testid="interview-all">
    <button class="overlay-backdrop" type="button" data-action="close-interview" aria-label="保存并稍后继续"></button>
    <section class="bottom-sheet interview-all-sheet" role="dialog" aria-modal="true" aria-labelledby="interview-all-title">
      <div class="sheet-handle" aria-hidden="true"></div><h2 id="interview-all-title">全部问题</h2>
      <div class="interview-question-list">${SELF_INTERVIEW_QUESTIONS.map((question, index) => {
        const answer = record.self_interview?.answers?.find((item) => item.question_id === question.id);
        const label = answer?.status === "answered" ? "已回答" : answer?.status === "skipped" ? "已跳过" : "未回答";
        return `<button type="button" data-action="jump-interview-question" data-index="${index}"><span>${index + 1}. ${escapeHtml(question.question)}</span><small>${label}</small></button>`;
      }).join("")}</div>
      <button type="button" class="sheet-done" data-action="back-to-interview-question">返回当前问题</button>
    </section>
  </div>`;
}

function interviewSummaryOverlay(record) {
  const answered = answeredInterviewItems(record.self_interview);
  return `<div class="overlay interview-overlay" data-testid="interview-summary">
    <button class="overlay-backdrop" type="button" data-action="close-interview" aria-label="保存并稍后继续"></button>
    <section class="bottom-sheet interview-summary-sheet" role="dialog" aria-modal="true" aria-labelledby="interview-summary-title">
      <div class="sheet-handle" aria-hidden="true"></div><span class="sheet-kicker">都是你自己的原话</span><h2 id="interview-summary-title">准备好整理这次电影印记了</h2>
      ${answered.length ? `<div class="interview-summary-answers">${answered.map((answer) => `<div><b>${escapeHtml(answer.question)}</b><p>${escapeHtml(answer.answer_text)}</p></div>`).join("")}</div>` : `<p>这次没有填写采访回答，也可以只根据原始感想整理。</p>`}
      <button type="button" class="sheet-done" data-action="generate-from-interview">生成电影印记</button>
      <button type="button" class="text-action" data-action="edit-interview">修改回答</button>
    </section>
  </div>`;
}

function cardEditorOverlay(record) {
  const sourceCards = state.editingCardSource === "draft" ? (record.activeAnalysisDraft?.memory_cards || []) : record.cards;
  const editing = sourceCards.find((card) => (card.card_id || card.temporary_id) === state.editingCardId);
  const card = editing || { type: "用户自定义类型", title: "", content: "", why_it_matters: "" };
  // 用户反馈第二轮：删除不摆在卡片正面，走"编辑"这个二级入口——只有已存在、
  // 不是待审 AI 建议（那类有自己的"保留/删除建议"流程）的卡片才带删除。
  const canDelete = Boolean(editing) && state.editingCardSource === "formal" && editing.provenance !== "ai_suggested";
  return `<div class="overlay" data-testid="card-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭卡片编辑"></button>
    <section class="bottom-sheet card-editor" role="dialog" aria-modal="true" aria-labelledby="card-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">记忆卡片</span><h2 id="card-editor-title">${editing ? "编辑这一张" : "添加一张"}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="card-form" data-card-id="${editing ? (editing.card_id || editing.temporary_id) : ""}" data-card-source="${state.editingCardSource}">
        <label><span>类型</span><select name="type">${CARD_TYPES.map((type) => `<option value="${escapeHtml(type)}" ${card.type === type ? "selected" : ""}>${type === "用户自定义类型" && !editing ? "自动判断（可稍后修改）" : escapeHtml(type)}</option>`).join("")}</select></label>
        <label><span>标题</span><input name="title" value="${escapeHtml(card.title)}" placeholder="给这个片段一个短标题" /></label>
        <label><span>内容</span><textarea name="content" required placeholder="记住了什么？">${escapeHtml(card.content)}</textarea></label>
        <label><span>为什么想留下（可空）</span><textarea name="why" placeholder="只有原始资料能支持时才填写">${escapeHtml(card.why_it_matters || "")}</textarea></label>
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
 * 统一的观影信息 Step 1。所有“记录这次观看”入口都先到这里，用户可以粘贴票务、
 * 手动填写，或跳过票务导入后继续确认日期与观看方式。
 * 截图 OCR 只是另一种文本来源：图片在客户端识别，结果仍进入 parseTicketText()。
 */
function captureEntryOverlay() {
  const ctx = state.captureContext || {};
  const canContinue = Boolean(ctx.lockedWork || ctx.workTitle?.trim());
  const ocrBusy = ["preparing", "recognizing", "parsing"].includes(ticketOcrUi.status);
  const showingOcrText = pendingTicketOcrText !== null;
  const inputText = showingOcrText ? pendingTicketOcrText : "";
  const ocrStatus = ocrBusy
    ? `<div class="ticket-ocr-status" role="status" data-testid="ticket-ocr-status">
        <span>${escapeHtml(ticketOcrUi.message || "正在识别票务信息…")}</span>
        <progress max="1" value="${Math.max(0, Math.min(1, ticketOcrUi.progress || 0))}"></progress>
      </div>`
    : ticketOcrUi.error
      ? `<p class="ticket-ocr-error" role="alert" data-testid="ticket-ocr-error">${escapeHtml(ticketOcrUi.error)}</p>`
      : "";
  return `<div class="overlay" data-testid="capture-entry">
    <button class="overlay-backdrop" type="button" data-action="close-capture" aria-label="收起"></button>
    <section class="bottom-sheet capture-entry" role="dialog" aria-modal="true" aria-labelledby="capture-entry-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <span class="sheet-kicker">记录这次观看</span>
      <h2 id="capture-entry-title">观影信息</h2>
      <p class="capture-entry-hint">粘贴票务文字或导入截图后，可自动填写影院信息；识别结果都会在保存前确认。</p>
      ${ctx.lockedWork
        ? `<div class="capture-entry-work" data-testid="capture-entry-work-locked"><span>作品</span><b>《${escapeHtml(ctx.workTitle || "未命名作品")}》</b></div>`
        : `<label class="capture-entry-title-field"><span>作品</span><input type="text" id="capture-entry-work-title-input" data-testid="capture-entry-work-title-input" value="${escapeHtml(ctx.workTitle || "")}" placeholder="输入作品名；粘贴票务时可留空" /></label>`}
      ${state.clipboardTicketDetected ? `<button type="button" class="clipboard-hint-banner" data-action="use-clipboard-ticket" data-testid="clipboard-ticket-banner">
        <span>检测到票务信息 · 一键使用</span>${icon("chevron")}
      </button>` : ""}
      <div class="ticket-ocr-import">
        <div class="ticket-ocr-controls">
          <button type="button" class="ticket-ocr-button" data-action="choose-ticket-screenshot" data-testid="choose-ticket-screenshot" ${ocrBusy ? "disabled" : ""}>${icon("photo")}<span>${ocrBusy ? "正在识别…" : "导入票务截图"}</span></button>
          <label class="ticket-ocr-language"><span>截图语言</span><select id="ticket-ocr-language" data-testid="ticket-ocr-language" ${ocrBusy ? "disabled" : ""}>${TICKET_OCR_LANGUAGE_OPTIONS.map((option) => `<option value="${option.value}" ${ticketOcrUi.language === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>
          <input class="sr-only" id="ticket-ocr-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" />
        </div>
        <small>图片仅用于本地识别，不会保存；首次使用需要下载识别组件。</small>
        ${ocrStatus}
      </div>
      <label class="capture-paste-area" for="capture-paste-input">
        <span>${showingOcrText ? "识别出的文字（可修改）" : "粘贴票务信息"}</span>
        <textarea id="capture-paste-input" data-testid="capture-paste-input" placeholder="粘贴票务邮件或订单文本" rows="${showingOcrText ? 8 : 4}">${escapeHtml(inputText)}</textarea>
      </label>
      <div class="capture-entry-actions">
        <button type="button" class="sheet-done" data-action="parse-ticket-info" data-testid="parse-ticket-info" ${inputText.trim() && !ocrBusy ? "" : "disabled"}>${showingOcrText ? "重新解析" : "解析票务信息"}</button>
        <button type="button" class="capture-skip-link" data-action="skip-viewing-info" data-testid="skip-viewing-info" ${canContinue ? "" : "disabled"}>暂时跳过 →</button>
      </div>
      ${showingOcrText && ticketOcrUi.status === "review" ? `<button type="button" class="text-action ticket-ocr-manual" data-action="manual-viewing-info" ${canContinue ? "" : "disabled"}>手动填写观影信息</button>` : ""}
      ${canContinue ? "" : `<small class="capture-entry-requirement">继续前请先填写作品名</small>`}
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
  const match = ctx.workMatch || { status: "idle", candidates: [] };
  const dateFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
  const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });

  // 锁定的 Work 直接用它自己的海报引用（可能来自 TMDB）；
  // 未锁定时才回落到"刚匹配到的 bangumi subjectId"这条老路径。
  const lockedWorkForPoster = ctx.lockedWork && ctx.workId ? findWorkById(state.works, ctx.workId) : null;
  // 选中的候选可能来自 TMDB，海报要用它自己的 posterRef，不能只认 bangumi subjectId
  const posterSrc = lockedWorkForPoster
    ? posterUrlFor(lockedWorkForPoster)
    : (ctx.selectedCandidate?.posterRef ? posterUrlFor({ poster: ctx.selectedCandidate.posterRef }) : "");
  const posterBlock = (!ctx.lockedWork && match.status === "searching")
    ? `<div class="ticket-confirm-poster skeleton" aria-hidden="true" data-testid="capture-match-skeleton"></div>`
    : posterSrc
      ? `<img class="ticket-confirm-poster" src="${escapeHtml(posterSrc)}" alt="" data-testid="capture-match-poster" onerror="this.hidden=true" />`
      : "";

  const candidatesBlock = ctx.showMatchCandidates
    ? `${captureCandidatesSlot(ctx, "select-capture-candidate", "capture-match-candidates")}
       <label class="manual-title-fallback"><span>都不是，手动输入片名</span><input type="text" id="capture-manual-title-input" data-testid="capture-manual-title-input" value="${escapeHtml(ctx.workTitle || "")}" /></label>`
    : "";

  const allEvents = ctx.pendingEvents || [];
  const selectedCount = selectedPendingEvents(allEvents).length;
  const selectedEventsValid = selectedPendingEvents(allEvents).every((event) => event.viewed_on && event.location_type);
  const allSelected = selectedCount >= allEvents.length;

  const cards = allEvents.map((event, index) => {
    const selected = event.selected !== false;
    const ec = event.viewing_context || {};
    const normalizedSpec = normalizedViewingFormat(ec);
    const dateStr = event.viewed_on ? dateFmt.format(new Date(`${event.viewed_on}T00:00:00`)) : "";
    const startStr = event.screening_at ? timeFmt.format(new Date(event.screening_at)) : "";
    const endStr = event.screening_ends_at ? timeFmt.format(new Date(event.screening_ends_at)) : "";
    const timeRange = startStr ? (endStr ? `${startStr}–${endStr}` : startStr) : "";
    const seatsStr = ec.seats?.length ? ec.seats.join("、") : "";
    const priceStr = ticketPriceLabel(event);
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
        ${ec.version ? `<span>${escapeHtml(ec.version)}</span>` : ""}
        ${normalizedSpec.format ? `<span>${escapeHtml(normalizedSpec.format)}${normalizedSpec.is3D ? " · 3D" : ""}</span>` : ""}
        ${ec.ticket_type ? `<span>${escapeHtml(ec.ticket_type)}</span>` : ""}
        ${ec.language ? `<span>${escapeHtml(ec.language)}</span>` : ""}
        ${event.duration_minutes ? `<span>${event.duration_minutes}分</span>` : ""}
        ${seatsStr ? `<span>座位 ${escapeHtml(seatsStr)}</span>` : ""}
        ${priceStr ? `<span>${escapeHtml(priceStr)}</span>` : ""}
      </div>
      ${selected ? `<div class="ticket-viewing-fields" aria-label="观影信息">
        <label><span>实际观看日期</span><input type="date" data-field="ticket-viewed-on" data-event-index="${index}" value="${escapeHtml(event.viewed_on || "")}" required /></label>
        <label><span>观看方式</span><select data-field="ticket-location-type" data-event-index="${index}">
          <option value="cinema" ${event.location_type === "cinema" ? "selected" : ""}>电影院</option>
          <option value="home" ${event.location_type === "home" ? "selected" : ""}>在家／线上</option>
        </select></label>
        <label><span>版本（可选）</span><input type="text" data-field="ticket-version" data-event-index="${index}" value="${escapeHtml(ec.version || "")}" /></label>
        ${event.location_type === "cinema" ? `<label><span>影院</span><input type="text" data-field="ticket-cinema-name" data-event-index="${index}" value="${escapeHtml(ec.cinema_name || "")}" /></label>
        <label><span>影厅</span><input type="text" data-field="ticket-auditorium" data-event-index="${index}" value="${escapeHtml(ec.auditorium || "")}" /></label>
        <label><span>放映规格</span><select data-field="ticket-format" data-event-index="${index}"><option value="">未填写</option>${CINEMA_FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${normalizedSpec.format === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}</select></label>
        <label><span>规格备注（可选）</span><input type="text" data-field="ticket-format-note" data-event-index="${index}" value="${escapeHtml(normalizedSpec.formatNote || "")}" /></label>
        <label><span>3D</span><select data-field="ticket-is-3d" data-event-index="${index}"><option value="false" ${normalizedSpec.is3D ? "" : "selected"}>否</option><option value="true" ${normalizedSpec.is3D ? "selected" : ""}>是</option></select></label>
        <label><span>语言（可选）</span><input type="text" data-field="ticket-language" data-event-index="${index}" value="${escapeHtml(ec.language || "")}" /></label>
        <div class="price-fields ticket-price-fields">
          <label><span>票价合计</span><input type="number" min="0" step="0.01" inputmode="decimal" data-field="ticket-price-amount" data-event-index="${index}" value="${event.ticket_price?.amount ?? ""}" placeholder="未填写" /></label>
          <label><span>币种</span><select data-field="ticket-price-currency" data-event-index="${index}">
            <option value="JPY" ${normalizedTicketCurrency(event.ticket_price) === "JPY" ? "selected" : ""}>JPY（日元）</option>
            <option value="CNY" ${normalizedTicketCurrency(event.ticket_price) === "CNY" ? "selected" : ""}>CNY（人民币）</option>
          </select></label>
          <label><span>张数</span><input type="number" min="1" step="1" inputmode="numeric" data-field="ticket-price-count" data-event-index="${index}" value="${event.ticket_price?.count || ec.ticket_count || ec.seat_count || 1}" /></label>
        </div>` : ""}
      </div>
      ${eventTypeTagsRow(ec.event_types || [], `event-${index}`)}
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
        ${ctx.lockedWork ? "" : `<button type="button" class="text-action" data-action="toggle-capture-match-candidates" data-testid="change-capture-match">更换</button>`}
      </div>
      ${ctx.lockedWork ? `<p class="ticket-locked-note" data-testid="ticket-work-locked">从作品页进入，作品已确定；票务里的片名会被忽略。</p>` : candidatesBlock}
      ${pendingTicketOcrText !== null ? `<details class="ticket-ocr-review" open data-testid="ticket-ocr-review">
        <summary>识别出的文字</summary>
        <textarea id="ticket-ocr-review-text" data-testid="ticket-ocr-review-text" rows="7">${escapeHtml(pendingTicketOcrText)}</textarea>
        ${ticketOcrUi.error ? `<p class="ticket-ocr-error" role="alert">${escapeHtml(ticketOcrUi.error)}</p>` : ""}
        <div class="ticket-ocr-review-actions">
          <small>可以修正错字后重新解析；图片与文字均不会保存。</small>
          <button type="button" class="text-action" data-action="reparse-ticket-ocr" data-testid="reparse-ticket-ocr" ${pendingTicketOcrText.trim() ? "" : "disabled"}>重新解析</button>
        </div>
      </details>` : ""}
      <div class="ticket-confirm-cards">${cards}</div>
      ${!allSelected && allEvents.length > 1 ? `<button type="button" class="text-action" data-action="select-all-ticket-events" data-testid="select-all-ticket-events">全选</button>` : ""}
      <p class="ticket-privacy-note">姓名、邮箱、取票码已本地移除，原始邮件不保存</p>
      <div class="ticket-actions">
        <button type="button" class="sheet-done" data-action="confirm-ticket-capture" data-testid="confirm-ticket-capture" ${selectedCount === 0 || !selectedEventsValid ? "disabled" : ""}>${escapeHtml(ctaLabel)}</button>
        <button type="button" class="text-action" data-action="repaste-ticket-capture">重新粘贴</button>
      </div>
    </section>
  </div>`;
}

const CINEMA_FORMAT_OPTIONS = ["普通", "IMAX", "IMAX GT", "Dolby Cinema", "4D", "ScreenX", "其他"];

function normalizedViewingFormat(context = {}) {
  const normalized = normalizeCinemaFormat(context.format);
  return {
    format: normalized.format,
    formatNote: context.format_note ?? normalized.formatNote,
    is3D: typeof context.is_3d === "boolean" ? context.is_3d : normalized.is3D
  };
}

/**
 * R2 Step 2B · 场景二选一（跳过分支）。初看／重看与观看地点完全正交——
 * 两条分支共用同一套「该作品已有历史才显示选择器」逻辑，不做「影院＝初看」之类的假设。
 */
function sceneChoiceOverlay() {
  const ctx = state.captureContext || {};
  const locationType = ctx.locationType || null;
  const eventTypes = ctx.eventTypes || [];
  const normalizedSpec = normalizedViewingFormat({ format: ctx.format, format_note: ctx.formatNote, is_3d: ctx.is3D });
  // 实际观看日期与观看方式是观影信息本身，票务只负责预填，二者都必须由用户确认。
  const canConfirm = Boolean(ctx.viewedOn && locationType) && (ctx.lockedWork || Boolean(ctx.workTitle?.trim()));
  return `<div class="overlay" data-testid="scene-choice">
    <button class="overlay-backdrop" type="button" data-action="close-capture" aria-label="关闭"></button>
    <section class="bottom-sheet scene-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="scene-choice-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <span class="sheet-kicker">观影信息</span>
      <h2 id="scene-choice-title">这次是什么时候、在哪看的？</h2>
      <label class="scene-viewed-on"><span>实际观看日期</span><input type="date" id="scene-viewed-on-input" data-testid="scene-viewed-on-input" value="${escapeHtml(ctx.viewedOn || "")}" required /></label>
      <div class="location-choice" role="group" aria-label="观看地点">
        <button type="button" class="location-option ${locationType === "home" ? "selected" : ""}" data-action="select-location" data-value="home" data-testid="location-home">在家／线上</button>
        <button type="button" class="location-option ${locationType === "cinema" ? "selected" : ""}" data-action="select-location" data-value="cinema" data-testid="location-cinema">在影院</button>
      </div>
      <label class="scene-viewed-on"><span>版本（可选）</span><input type="text" id="scene-version-input" value="${escapeHtml(ctx.version || "")}" /></label>
      ${locationType === "cinema" ? `<div class="cinema-fields">
        <label><span>影院名</span><input type="text" id="scene-cinema-name-input" data-testid="scene-cinema-name-input" value="${escapeHtml(ctx.cinemaName || "")}" placeholder="影院名称" /></label>
        <label><span>影厅</span><input type="text" id="scene-auditorium-input" data-testid="scene-auditorium-input" value="${escapeHtml(ctx.auditorium || "")}" placeholder="如：IMAX 厅、3号厅" /></label>
        <label><span>放映规格</span><select id="scene-format-select" data-testid="scene-format-select">
          <option value="">未填写</option>
          ${CINEMA_FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${normalizedSpec.format === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
        </select></label>
        <label><span>规格备注（可选）</span><input type="text" id="scene-format-note-input" value="${escapeHtml(normalizedSpec.formatNote || "")}" /></label>
        <label><span>3D</span><select id="scene-is-3d-select"><option value="false" ${normalizedSpec.is3D ? "" : "selected"}>否</option><option value="true" ${normalizedSpec.is3D ? "selected" : ""}>是</option></select></label>
        <div class="price-fields ticket-price-fields">
          <label><span>票价合计</span><input type="number" min="0" step="0.01" inputmode="decimal" id="scene-ticket-amount-input" value="${ctx.ticketAmount ?? ""}" placeholder="未填写" /></label>
          <label><span>币种</span><select id="scene-ticket-currency-select">
            <option value="JPY" ${ctx.ticketCurrency !== "CNY" ? "selected" : ""}>JPY（日元）</option>
            <option value="CNY" ${ctx.ticketCurrency === "CNY" ? "selected" : ""}>CNY（人民币）</option>
          </select></label>
          <label><span>张数</span><input type="number" min="1" step="1" inputmode="numeric" id="scene-ticket-count-input" value="${ctx.ticketCount || 1}" /></label>
        </div>
        ${eventTypeTagsRow(eventTypes, "scene")}
        ${eventTypes.includes("bonus_distribution") ? `<label class="bonus-note-input"><span>特典</span><input type="text" data-field="bonus-note" data-event-index="scene" value="${escapeHtml(ctx.bonusNote || "")}" placeholder="如：第3週 色紙" /></label>` : ""}
      </div>` : ""}
      ${ctx.lockedWork
        ? `<div class="scene-work-locked" data-testid="scene-work-locked">
            <span class="scene-work-locked-label">作品</span>
            <span class="scene-work-locked-title">《${escapeHtml(ctx.workTitle || "")}》</span>
            <small>从作品页进入，这次记录会直接挂到这部作品，不需要重新识别。</small>
          </div>`
        : `<label class="scene-work-title"><span>作品</span><input type="text" id="scene-work-title-input" data-testid="scene-work-title-input" value="${escapeHtml(ctx.workTitle || "")}" placeholder="作品名" /></label>
      ${captureCandidatesSlot(ctx, "select-scene-candidate", "scene-match-candidates")}`}
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

function todayInJapan() {
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo"
  }).format(new Date());
}

/**
 * R4 §3.1「每一行都要有编辑入口，可改地点、时间、影院、制式、活动、初看／重看」，
 * 同一个表单也承担 needs_review 场次的「补充信息」——两者本质是同一件事：把这场
 * ViewingEvent 的字段补全或改对。
 */
function historyEventEditorOverlay(event) {
  const ctx = event.viewing_context || {};
  const normalizedSpec = normalizedViewingFormat(ctx);
  const isCinema = event.location_type === "cinema";
  const isHome = event.location_type === "home";
  const localDateTime = event.screening_at ? isoToLocalDateTimeInputValue(event.screening_at) : "";
  const viewedOn = event.viewed_on || localDateTime.slice(0, 10);
  const screeningTime = localDateTime.slice(11, 16);
  const isReview = Boolean(event.needs_review);
  return `<div class="overlay" data-testid="history-event-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭编辑"></button>
    <section class="bottom-sheet history-editor" role="dialog" aria-modal="true" aria-labelledby="history-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">观影场次</span><h2 id="history-editor-title">${isReview ? "补充这次观看的信息" : "编辑这次观影"}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="history-event-form" data-event-id="${escapeHtml(event.id)}">
        <div class="location-choice" role="group" aria-label="观看地点">
          <label class="location-option ${isHome ? "selected" : ""}"><input type="radio" name="locationType" value="home" ${isHome ? "checked" : ""} required data-testid="history-location-home" />在家／线上</label>
          <label class="location-option ${isCinema ? "selected" : ""}"><input type="radio" name="locationType" value="cinema" ${isCinema ? "checked" : ""} required data-testid="history-location-cinema" />在影院</label>
        </div>
        <label><span>实际观看日期</span><input type="date" name="viewedOn" value="${escapeHtml(viewedOn)}" required data-testid="history-viewed-on" /></label>
        <label><span>开场时间（可选）</span><input type="time" name="screeningTime" value="${escapeHtml(screeningTime)}" data-testid="history-screening-time" /></label>
        <label><span>版本（可选）</span><input type="text" name="version" value="${escapeHtml(ctx.version || "")}" /></label>
        <div class="cinema-only-fields" data-testid="history-cinema-fields" ${isCinema ? "" : "hidden"}>
          <label><span>影院名</span><input type="text" name="cinemaName" value="${escapeHtml(ctx.cinema_name || "")}" placeholder="影院名称" /></label>
          <label><span>影厅</span><input type="text" name="auditorium" value="${escapeHtml(ctx.auditorium || "")}" placeholder="如：IMAX 厅、3号厅" /></label>
          <label><span>放映规格</span><select name="format">
            <option value="">未填写</option>
            ${CINEMA_FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${normalizedSpec.format === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
          </select></label>
          <label><span>规格备注（可选）</span><input type="text" name="formatNote" value="${escapeHtml(normalizedSpec.formatNote || "")}" /></label>
          <label><span>3D</span><select name="is3D"><option value="false" ${normalizedSpec.is3D ? "" : "selected"}>否</option><option value="true" ${normalizedSpec.is3D ? "selected" : ""}>是</option></select></label>
          <label><span>语言（可选）</span><input type="text" name="language" value="${escapeHtml(ctx.language || "")}" /></label>
          <fieldset class="event-tags-row" aria-label="活动类型">
            ${EVENT_TYPES.map(([key, label]) => `<label class="event-tag-chip ${(ctx.event_types || []).includes(key) ? "selected" : ""}"><input type="checkbox" name="eventTypes" value="${key}" ${(ctx.event_types || []).includes(key) ? "checked" : ""} />${escapeHtml(label)}</label>`).join("")}
          </fieldset>
          <label><span>特典备注（选了"入場者特典"才会保留）</span><input type="text" name="bonusNote" value="${escapeHtml(ctx.bonus_note || "")}" placeholder="如：第3週 色紙" /></label>
        </div>
        <!-- R5 补丁 6：票价与张数可手动修正。票据格式五花八门，解析难免有抓不到
             （蜘蛛侠那张就没抓到）或把双人票加总成一个数的情况，得留人工订正的口子。 -->
        <div class="price-fields">
          <label><span>票价合计</span><input type="number" name="ticketAmount" min="0" step="0.01" inputmode="decimal" value="${event.ticket_price?.amount ?? ""}" placeholder="未填写" data-testid="history-ticket-amount" /></label>
          <label><span>币种</span><select name="ticketCurrency" data-testid="history-ticket-currency">
            <option value="JPY" ${normalizedTicketCurrency(event.ticket_price) === "JPY" ? "selected" : ""}>JPY（日元）</option>
            <option value="CNY" ${normalizedTicketCurrency(event.ticket_price) === "CNY" ? "selected" : ""}>CNY（人民币）</option>
          </select></label>
          <label><span>张数</span><input type="number" name="ticketCount" min="1" step="1" inputmode="numeric" value="${event.ticket_price?.count || event.viewing_context?.ticket_count || event.viewing_context?.seat_count || 1}" data-testid="history-ticket-count" /></label>
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

function externalPublicationEditorOverlay(work) {
  const publication = state.currentWorkPublications.find((item) => item.id === state.editingPublicationId) || null;
  const platform = publication ? publication.platform : "other";
  const eventOptions = [...state.currentWorkEvents]
    .sort((a, b) => Number(a.watch_index || 0) - Number(b.watch_index || 0))
    .map((item) => {
      const index = Number(item.watch_index);
      const relation = item.viewing_relation === "first" || index === 1
        ? "第一次观看"
        : Number.isFinite(index) && index > 1 ? `第 ${index} 次观看` : "一次观看";
      const date = formatShortDate(item.viewed_on || item.screening_at);
      return `<option value="${escapeHtml(item.id)}" ${publication?.viewing_record_id === item.id ? "selected" : ""}>${escapeHtml(relation)}${date ? ` · ${escapeHtml(date)}` : ""}</option>`;
    }).join("");
  return `<div class="overlay" data-testid="external-publication-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet external-publication-editor" role="dialog" aria-modal="true" aria-labelledby="external-publication-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="external-publication-title">${publication ? "编辑外部发表" : "添加外部发表"}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">这里只保存作品与原始 URL 的引用关系，不复制外部正文。</p>
      <form id="external-publication-form" data-publication-id="${escapeHtml(publication?.id || "")}">
        <label><span>URL</span><input id="external-publication-url" name="url" type="url" inputmode="url" value="${escapeHtml(publication?.url || "")}" placeholder="https://..." required /></label>
        <p class="external-publication-detected">平台：<strong id="external-publication-platform">${escapeHtml(publicationPlatformLabel(platform))}</strong><span>（自动识别）</span></p>
        <label><span>发布时间（可选）</span><input name="publishedAt" type="date" value="${escapeHtml(publication?.published_at?.slice(0, 10) || "")}" /></label>
        <label><span>关联观影记录（可选）</span><select name="viewingRecordId"><option value="">不关联具体观看</option>${eventOptions}</select></label>
        <label><span>备注（可选）</span><textarea name="note" rows="3" placeholder="例如：第二次重看后写的日语短评">${escapeHtml(publication?.note || "")}</textarea></label>
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

function posterChoiceSelected(work, source, value) {
  const current = workPosterRef(work);
  if (!current || current.source !== source) return false;
  if (source === "bangumi") return String(current.subject_id) === String(value);
  if (source === "tmdb") return current.path === value;
  return source === "upload";
}

function posterChoiceButton(work, { source, value, label, src, testId }) {
  const selected = posterChoiceSelected(work, source, value);
  return `<button type="button" class="poster-choice ${selected ? "selected" : ""}" data-action="select-poster" data-source="${escapeHtml(source)}" data-value="${escapeHtml(value || "")}" aria-pressed="${selected}" data-testid="${escapeHtml(testId)}">
    <span class="poster-choice-preview">
      <img class="resilient-image" src="${escapeHtml(src)}" alt="${escapeHtml(label)}海报" loading="lazy" />
      <span class="image-fallback">${icon("photo")}<small>无法预览</small></span>
      ${selected ? `<span class="poster-choice-check" aria-hidden="true">✓</span>` : ""}
    </span>
    <span class="poster-choice-label">${escapeHtml(label)}</span>
  </button>`;
}

function posterEditorOverlay(work) {
  const editor = state.posterEditor.workId === work.id
    ? state.posterEditor
    : { status: "idle", tmdbChoices: [], error: null };
  const bangumiId = externalRefId(work, "bangumi");
  const tmdbId = externalRefId(work, "tmdb");
  const current = workPosterRef(work);
  const bangumiLink = state.bangumiPosterLink.workId === work.id
    ? state.bangumiPosterLink
    : { status: "idle", candidates: [], error: null };

  let bangumiBlock = "";
  if (bangumiId) {
    bangumiBlock = posterChoiceButton(work, {
        source: "bangumi",
        value: bangumiId,
        label: "Bangumi",
        src: posterUrlFor({ poster: { source: "bangumi", subject_id: Number(bangumiId) } }),
        testId: "poster-choice-bangumi"
      });
  } else if (bangumiLink.status === "loading") {
    bangumiBlock = `<div class="poster-link-state"><span class="poster-link-spinner" aria-hidden="true"></span><span>正在按当前片名查找 Bangumi…</span></div>`;
  } else if (bangumiLink.status === "error") {
    bangumiBlock = `<p class="poster-source-empty error">${escapeHtml(bangumiLink.error || "暂时无法查找 Bangumi")}</p><button type="button" class="text-action" data-action="search-bangumi-poster-link">重试</button>`;
  } else if (bangumiLink.status === "ready" && bangumiLink.candidates.length) {
    bangumiBlock = `<div class="poster-link-candidates">${bangumiLink.candidates.map((candidate, index) => {
      const year = /^\d{4}/.test(candidate.releaseDate || "") ? String(candidate.releaseDate).slice(0, 4) : "年份未知";
      return `<button type="button" class="poster-link-candidate" data-action="link-bangumi-poster" data-index="${index}" data-testid="poster-link-bangumi-${index}">
        <img src="${escapeHtml(posterUrlFor({ poster: { source: "bangumi", subject_id: Number(candidate.subjectId) } }))}" alt="" loading="lazy" />
        <span><b>${escapeHtml(candidate.title || "未命名作品")}</b><small>${escapeHtml([year, candidate.originalTitle].filter(Boolean).join(" · "))}</small></span>
        <span class="poster-link-action">关联</span>
      </button>`;
    }).join("")}</div>`;
  } else {
    bangumiBlock = `<button type="button" class="poster-link-start" data-action="search-bangumi-poster-link" data-testid="search-bangumi-poster-link">
      <span>${icon("match")}</span><span><b>关联 Bangumi</b><small>按当前片名查找；唯一同名同年结果会直接关联</small></span>
    </button>`;
  }

  let tmdbBlock = "";
  if (!tmdbId) {
    tmdbBlock = `<p class="poster-source-empty">未关联 TMDB 条目</p>`;
  } else if (editor.status === "loading" || editor.status === "idle") {
    tmdbBlock = `<div class="poster-choice-skeletons" aria-label="正在读取 TMDB 海报"><span></span><span></span><span></span></div>`;
  } else if (editor.status === "error") {
    tmdbBlock = `<p class="poster-source-empty error">${escapeHtml(editor.error || "暂时拿不到 TMDB 海报")}</p><button type="button" class="text-action" data-action="reload-poster-choices">重试</button>`;
  } else if (!editor.tmdbChoices.length) {
    tmdbBlock = `<p class="poster-source-empty">英语、中文和日语地区暂无可用海报</p>`;
  } else {
    tmdbBlock = `<div class="poster-choice-grid">${editor.tmdbChoices.map((choice, index) => posterChoiceButton(work, {
      source: "tmdb",
      value: choice.path,
      label: choice.label,
      src: posterUrlFor({ poster: { source: "tmdb", path: choice.path } }),
      testId: `poster-choice-tmdb-${index}`
    })).join("")}</div>`;
  }

  const uploadedPreview = current?.source === "upload"
    ? `<div class="poster-upload-current"><img src="${escapeHtml(current.data_url)}" alt="当前手动上传的海报" /><span>当前使用</span></div>`
    : "";

  return `<div class="overlay" data-testid="poster-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet poster-editor" role="dialog" aria-modal="true" aria-labelledby="poster-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="poster-editor-title">选择海报</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">自动海报按作品出品地区选择；你也可以随时改用下面任一版本。手动选择会保持不变，不会被资料刷新覆盖。</p>
      <section class="poster-source-section" aria-labelledby="poster-bangumi-title">
        <div class="poster-source-heading"><h3 id="poster-bangumi-title">Bangumi</h3><span>${bangumiId ? "1 张" : "未关联"}</span></div>
        <div class="${bangumiId ? "poster-choice-grid single" : "poster-link-shell"}">${bangumiBlock}</div>
      </section>
      <section class="poster-source-section" aria-labelledby="poster-tmdb-title">
        <div class="poster-source-heading"><h3 id="poster-tmdb-title">TMDB</h3><span>${tmdbId ? "英语 · 中文 · 日语" : "未关联"}</span></div>
        ${tmdbBlock}
      </section>
      <section class="poster-source-section poster-upload-section" aria-labelledby="poster-upload-title">
        <div class="poster-source-heading"><h3 id="poster-upload-title">自己的图片</h3><span>会压缩后保存</span></div>
        <div class="poster-upload-row">
          ${uploadedPreview}
          <label class="poster-upload-button" for="poster-upload-input">${icon("photo")}<span><b>${current?.source === "upload" ? "换一张图片" : "上传海报"}</b><small>JPG、PNG 或 WebP</small></span></label>
          <input class="sr-only" id="poster-upload-input" type="file" accept="image/jpeg,image/png,image/webp" />
        </div>
      </section>
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
  const options = state.series.map((series) => {
    const counts = seriesMemberCounts(series);
    return `<button type="button" class="series-option ${current?.id === series.id ? "selected" : ""}" data-action="assign-series" data-series-id="${escapeHtml(series.id)}" data-testid="assign-series-${escapeHtml(series.id)}">
      <span class="series-option-title">${escapeHtml(series.title)}</span>
      <span class="series-option-count">${counts.core} 部主系列${counts.crossover ? ` · ${counts.crossover} 部关联` : ""}</span>
    </button>`;
  }).join("");

  return `<div class="overlay" data-testid="series-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet series-editor" role="dialog" aria-modal="true" aria-labelledby="series-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="series-editor-title">归入系列</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      ${current ? `<div class="series-current-actions">
        <button type="button" class="text-action" data-action="open-series" data-series-id="${escapeHtml(current.id)}" data-testid="open-series">查看系列档案</button>
        <button type="button" class="text-action danger" data-action="leave-series" data-testid="leave-series">移出《${escapeHtml(current.title)}》</button>
      </div>` : ""}
      <div class="series-options">${options || `<p class="work-section-empty">还没有任何系列</p>`}</div>
      <form id="series-form">
        <label><span>新建系列</span><input type="text" name="title" maxlength="60" placeholder="例如：蜘蛛侠" data-testid="series-title-input" /></label>
        <button class="sheet-done" type="submit">新建并归入</button>
      </form>
    </section>
  </div>`;
}

/** 在 Series 页沿用现有 bottom sheet 编辑单个 Series—Work 关系。 */
function seriesMemberEditorOverlay(series) {
  const workId = state.editingSeriesMemberId;
  const work = findWorkById(state.works, workId);
  if (!work || !(series.member_ids || []).includes(workId)) return "";
  const details = seriesMemberDetails(series, workId);
  const index = (series.member_ids || []).indexOf(workId);
  return `<div class="overlay" data-testid="series-member-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet series-member-editor" role="dialog" aria-modal="true" aria-labelledby="series-member-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">${escapeHtml(series.title)}</span><h2 id="series-member-editor-title">《${escapeHtml(work.title || "未命名作品")}》</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="series-member-form">
        <label><span>成员关系</span><select name="relation" data-testid="series-member-relation">
          <option value="core" ${details.relation === "core" ? "selected" : ""}>主系列作品</option>
          <option value="crossover" ${details.relation === "crossover" ? "selected" : ""}>关联作品</option>
        </select></label>
        <label><span>系列编号 <small>主系列作品使用</small></span><input type="number" name="seriesOrder" min="1" step="1" value="${details.seriesOrder || ""}" placeholder="例如 1" /></label>
        <label><span>关系说明 <small>关联作品使用，建议填写</small></span><textarea name="relationNote" rows="3" maxlength="120" placeholder="例如：MCU版 Spider-Man 首次登场">${escapeHtml(details.relationNote)}</textarea></label>
        <p class="settings-note">页面按上映时间混排；手动顺序只在上映日期相同或未知时作为补充。</p>
        <div class="series-member-order-actions">
          <button type="button" class="text-action" data-action="move-series-member" data-work-id="${escapeHtml(workId)}" data-direction="up" ${index === 0 ? "disabled" : ""}>手动上移</button>
          <button type="button" class="text-action" data-action="move-series-member" data-work-id="${escapeHtml(workId)}" data-direction="down" ${index === (series.member_ids || []).length - 1 ? "disabled" : ""}>手动下移</button>
        </div>
        <button class="sheet-done" type="submit" data-testid="save-series-member">保存关系</button>
        <button type="button" class="text-action danger series-member-remove" data-action="remove-series-member" data-work-id="${escapeHtml(workId)}">从这个系列移除</button>
      </form>
    </section>
  </div>`;
}

/** R5：片单归属编辑。多选——一部作品可以同时属于多个片单。 */
function collectionsEditorOverlay(work) {
  const mine = new Set(collectionsForWork(state.collections, work.id).map((item) => item.id));
  const options = state.collections.map((collection) => `<div class="series-option-row">
    <button type="button" class="series-option ${mine.has(collection.id) ? "selected" : ""}" data-action="toggle-collection" data-collection-id="${escapeHtml(collection.id)}" data-testid="toggle-collection-${escapeHtml(collection.id)}">
      <span class="series-option-title">${escapeHtml(collection.title)}</span>
      <span class="series-option-count">${collectionEntries(collection).length} 部</span>
    </button>
    ${mine.has(collection.id) ? `<button type="button" class="icon-button small" data-action="open-collection" data-collection-id="${escapeHtml(collection.id)}" aria-label="打开《${escapeHtml(collection.title)}》片单">${icon("chevron")}</button>` : ""}
  </div>`).join("");

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

function stillsEditorOverlay(work) {
  const stills = normalizeWorkStills(work.stills);
  const full = stills.length >= MAX_WORK_STILLS;
  const savedTmdbPaths = new Set(stills.filter((item) => item.source === "tmdb").map((item) => item.path));
  const candidates = state.stillCandidates.workId === work.id ? state.stillCandidates : { status: "idle", items: [], error: null };
  const linkState = state.tmdbStillLink.workId === work.id
    ? state.tmdbStillLink
    : { status: "idle", query: work.title || "", candidates: [], error: null };
  const tmdbId = externalRefId(work, "tmdb");

  const storedRows = stills.map((still, index) => `<li class="still-manager-row" data-testid="still-manager-${escapeHtml(still.id)}">
    <div class="still-manager-preview">
      <img class="still-manager-thumb resilient-image" src="${escapeHtml(stillUrlFor(still, "w500"))}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="image-fallback">${icon("photo")}</span>
    </div>
    <div class="still-manager-copy"><b>${index === 0 ? "主展示图" : `第 ${index + 1} 张`}</b><small>${still.source === "tmdb" ? "来自 TMDB" : "外链图片"}</small></div>
    <div class="still-manager-actions">
      ${index > 0 ? `<button type="button" data-action="set-primary-still" data-still-id="${escapeHtml(still.id)}" aria-label="设为主展示图">${icon("star")}</button>` : ""}
      <button type="button" data-action="move-still" data-direction="up" data-still-id="${escapeHtml(still.id)}" aria-label="前移" ${index === 0 ? "disabled" : ""}>↑</button>
      <button type="button" data-action="move-still" data-direction="down" data-still-id="${escapeHtml(still.id)}" aria-label="后移" ${index === stills.length - 1 ? "disabled" : ""}>↓</button>
      <button type="button" class="danger" data-action="remove-still" data-still-id="${escapeHtml(still.id)}" aria-label="删除剧照">${icon("trash")}</button>
    </div>
  </li>`).join("");

  let tmdbBlock;
  if (!tmdbId) {
    const linkResults = linkState.candidates.length
      ? `<div class="tmdb-link-candidates" data-testid="tmdb-still-link-results">${linkState.candidates.map((candidate, index) => `<button type="button" class="tmdb-link-candidate" data-action="link-tmdb-for-stills" data-index="${index}" data-testid="tmdb-still-link-${index}">
          <span><b>${escapeHtml(candidate.title || "未命名作品")}</b>${candidate.originalTitle ? `<small>${escapeHtml(candidate.originalTitle)}</small>` : ""}</span>
          <span class="tmdb-link-year">${candidate.year || "年份未知"}</span>
        </button>`).join("")}</div>`
      : "";
    const status = linkState.status === "loading"
      ? `<p class="stills-source-state">正在搜索 TMDB…</p>`
      : linkState.status === "error"
        ? `<p class="stills-source-state error">${escapeHtml(linkState.error || "搜索失败，请稍后重试")}</p>`
        : linkState.status === "ready" && !linkState.candidates.length
          ? `<p class="stills-source-state">没有找到对应条目，可以换原名或英文名再试。</p>`
          : `<p class="stills-source-state">当前保留 Bangumi 关联；确认 TMDB 条目后会追加第二关联，不会替换原信息。</p>`;
    tmdbBlock = `<form id="tmdb-still-link-form" class="tmdb-still-link-form">
      <label><span>搜索 TMDB 条目</span><input type="search" name="query" value="${escapeHtml(linkState.query || work.title || "")}" placeholder="作品名、原名或英文名" required data-testid="tmdb-still-link-query" /></label>
      <button type="submit" class="sheet-done" ${linkState.status === "loading" ? "disabled" : ""}>搜索</button>
    </form>${status}${linkResults}`;
  } else if (candidates.status === "loading" || candidates.status === "idle") {
    tmdbBlock = `<p class="stills-source-state">正在读取 TMDB 候选剧照…</p>`;
  } else if (candidates.status === "error") {
    tmdbBlock = `<p class="stills-source-state error">${escapeHtml(candidates.error || "暂时拿不到候选剧照")}</p><button type="button" class="text-action" data-action="reload-tmdb-stills">重试</button>`;
  } else if (!candidates.items.length) {
    tmdbBlock = `<p class="stills-source-state">TMDB 暂无可用的横向剧照。</p>`;
  } else {
    tmdbBlock = `<div class="tmdb-still-candidates">${candidates.items.map((candidate, index) => {
      const saved = savedTmdbPaths.has(candidate.path);
      return `<button type="button" class="tmdb-still-candidate ${saved ? "saved" : ""}" data-action="add-tmdb-still" data-path="${escapeHtml(candidate.path)}" ${saved || full ? "disabled" : ""} data-testid="tmdb-still-${index}">
        <span class="tmdb-still-preview"><img class="tmdb-still-img resilient-image" src="${escapeHtml(stillUrlFor({ source: "tmdb", path: candidate.path }, "w500"))}" alt="候选剧照 ${index + 1}" loading="lazy" /><span class="image-fallback">${icon("photo")}<small>无法预览</small></span></span>
        <span>${saved ? "已保存" : full ? "已满 4 张" : "保存这张"}</span>
      </button>`;
    }).join("")}</div>`;
  }

  return `<div class="overlay" data-testid="stills-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet stills-editor" role="dialog" aria-modal="true" aria-labelledby="stills-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="stills-editor-title">私人剧照</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">只留下真正想记住的画面。最多 4 张，第一张会作为作品页主展示图，不会自动轮播。</p>
      <div class="stills-capacity"><span>已保存 ${stills.length} / ${MAX_WORK_STILLS}</span><i><b style="width:${stills.length / MAX_WORK_STILLS * 100}%"></b></i></div>
      ${storedRows ? `<ol class="still-manager-list">${storedRows}</ol>` : ""}
      <form id="still-url-form" class="still-url-form">
        <label><span>添加图片链接</span><input type="url" name="url" inputmode="url" placeholder="https://example.com/still.jpg" ${full ? "disabled" : ""} data-testid="still-url-input" required /></label>
        <button class="sheet-done" type="submit" ${full ? "disabled" : ""}>添加剧照</button>
      </form>
      ${full ? `<p class="stills-limit-note">已经选满 4 张。删除或替换一张后才能继续添加。</p>` : ""}
      <section class="tmdb-stills-source" aria-labelledby="tmdb-stills-title">
        <div class="stills-source-heading"><h3 id="tmdb-stills-title">从 TMDB 选择</h3>${tmdbId ? `<span>候选不会自动保存</span>` : ""}</div>
        ${tmdbBlock}
      </section>
    </section>
  </div>`;
}

/**
 * R6 §10：统一作品搜索面板。
 *
 * 用户不需要理解 Bangumi 和 TMDB 的区别，也不需要选「从哪里添加」——只有一个
 * 「搜索作品」。结果分成两组呈现：先是本地已有的 Work（优先引用，绝不重复建卡），
 * 再是外部数据源的候选。选中外部候选后一次完成 Work 创建 + 片单条目创建，
 * 不要求用户先「导入作品」再回到片单添加。
 */
/**
 * 数据源状态行。**无论成功失败都显示**——这正是「结果缺失时分不清是数据源故障
 * 还是确实搜不到」的解药。必须渲染在 .work-search-results 容器内部，
 * 因为增量重绘只替换那个容器（放外面就永远不会被刷新）。
 */
function sourceStatusMarkup(search) {
  if (!search.sources) return "";
  const items = summarizeSearchSources(search.sources);
  const degraded = hasDegradedSource(search.sources);
  const counts = countBySource(search.external);
  const active = search.sourceFilter;

  // R6 补丁 8：这排 chip 从纯状态显示升级成**可点击的筛选**。
  // 搜「魔女宅急便」时 Bangumi 10 条 + TMDB 2 条混在一起，同名条目一大串，
  // 光看标题分不清哪条来自哪个库。ok 且有结果的源才可点；未配置/失败的源
  // 没有结果可筛，保持不可点，只做状态提示。
  return `<p class="work-search-sources ${degraded ? "degraded" : ""}" data-testid="work-search-sources">
    ${active ? `<button type="button" class="source-chip filter" data-action="filter-search-source" data-source="all" data-testid="source-filter-all">← 全部</button>` : ""}
    ${items.map((item) => {
      const clickable = item.state === "ok" && (counts[item.source] || 0) > 0;
      if (!clickable) {
        return `<span class="source-chip tone-${item.tone}" data-testid="source-status-${item.source}">${escapeHtml(item.text)}</span>`;
      }
      return `<button type="button" class="source-chip filter tone-${item.tone} ${active === item.source ? "active" : ""}"
        data-action="filter-search-source" data-source="${item.source}"
        aria-pressed="${active === item.source}"
        data-testid="source-status-${item.source}">${escapeHtml(item.text)}</button>`;
    }).join("")}
  </p>`;
}

/**
 * 外部源都正常、却一条都没搜到时的补充说明。
 *
 * ⚠️ 更正：我此前断言过"TMDB 对中文译名收录有限，中文查询召回为空是常态"。
 * 实测推翻了这个说法——配置生效后搜「鸟人」，TMDB 是能返回电影结果的。
 * `language=zh-CN` 对匹配的影响比我说的大。
 *
 * 所以这条提示改成只陈述**这一次**发生了什么，不再对 TMDB 的中文能力下普遍结论：
 * 这次没匹配到，换原名或英文名再试通常更容易命中——这句话无论 TMDB 的中文收录
 * 好不好都成立。
 */
function emptyResultHint(search) {
  if (!search.sources) return "";
  const tmdbOk = search.sources.tmdb?.state === "ok" && (search.sources.tmdb?.count || 0) === 0;
  if (tmdbOk && looksCJK(search.query)) {
    return `<p class="work-search-state">TMDB 这次没有匹配到这个中文／日文片名。换成原名或英文名再试一次，通常更容易命中。</p>`;
  }
  return "";
}

function workSearchOverlay() {
  const search = state.workSearch;
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);

  const itemMarkup = (candidate, index, group) => {
    const selected = search.selected
      && search.selected.source === candidate.source
      && String(search.selected.sourceId) === String(candidate.sourceId);
    const meta = [
      candidate.year || null,
      candidate.originalTitle && candidate.originalTitle !== candidate.title ? candidate.originalTitle : null,
      group === "local" && candidate.inThisCollection ? "已在这个片单里" : null
    ].filter(Boolean).join(" · ");
    // R6 §9：跨源疑似同一部片只提示，绝不自动合并——同名不同片、重制版与原版、
    // 剧场版与 TV 版都会踩中"标题+年份"这类启发式，误判的代价远大于让用户多看一眼。
    const dupHint = candidate.possibleDuplicateOf
      ? `<span class="work-search-item-meta">可能与列表中另一条是同一部（《${escapeHtml(candidate.possibleDuplicateOf.title || "")}》）</span>`
      : "";
    const poster = posterUrlFor({ poster: candidate.posterRef });
    // 来源徽章：同名条目一大串时，知道这条来自 Bangumi 还是 TMDB 才好判断该选哪个
    const badge = candidate.source === "local"
      ? ""
      : `<span class="work-search-item-source src-${escapeHtml(candidate.source)}">${escapeHtml(SOURCE_DISPLAY[candidate.source] || candidate.source)}</span>`;
    return `<button type="button" class="work-search-item ${selected ? "selected" : ""}" data-action="select-search-candidate" data-group="${group}" data-index="${index}" data-testid="work-search-item-${group}-${index}" ${candidate.inThisCollection ? "disabled" : ""}>
      ${poster ? `<img class="work-search-item-poster" src="${escapeHtml(poster)}" alt="" loading="lazy" />` : ""}
      <span class="work-search-item-body">
        <span class="work-search-item-title-row">
          <span class="work-search-item-title">${escapeHtml(candidate.title || "")}</span>${badge}
        </span>
        ${meta ? `<span class="work-search-item-meta">${escapeHtml(meta)}</span>` : ""}
        ${dupHint}
      </span>
    </button>`;
  };

  const localGroup = search.local.length
    ? `<p class="work-search-group-title">已经在你的库里</p>${search.local.map((c, i) => itemMarkup(c, i, "local")).join("")}`
    : "";
  // 注意索引：itemMarkup 传的是**筛选后**数组里的下标，选中回调必须用同一份数组，
  // 否则筛选状态下点第 1 条会选中未筛选数组的第 1 条（不同的片）。
  const visibleExternal = filterCandidatesBySource(search.external, search.sourceFilter);
  const externalGroup = visibleExternal.length
    ? `<p class="work-search-group-title">${search.sourceFilter ? `只看 ${SOURCE_DISPLAY[search.sourceFilter] || search.sourceFilter}` : "从数据库中找到"}</p>${visibleExternal.map((c, i) => itemMarkup(c, i, "external")).join("")}`
    : "";

  let body;
  if (!search.query.trim()) {
    body = `<p class="work-search-state">输入片名开始搜索。还没看过的电影也可以直接加进片单。</p>`;
  } else if (search.status === "loading" && !localGroup && !externalGroup) {
    body = `<p class="work-search-state">正在搜索…</p>`;
  } else if (!localGroup && !externalGroup) {
    body = `<p class="work-search-state" data-testid="work-search-empty">没有找到「${escapeHtml(search.query)}」。</p>${emptyResultHint(search)}`;
  } else {
    body = `${localGroup}${externalGroup}${emptyResultHint(search)}${search.status === "loading" ? `<p class="work-search-state">还在找更多…</p>` : ""}`;
  }

  return `<div class="overlay" data-testid="work-search">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="work-search-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(collection?.title || "")}》</span><h2 id="work-search-title">添加作品</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <label class="work-search-field"><span class="visually-hidden">搜索作品</span>
        <input type="search" id="work-search-input" placeholder="搜索片名，例如 Birdman / 鸟人" value="${escapeHtml(search.query)}" autocomplete="off" data-testid="work-search-input" />
      </label>
      <div class="work-search-results" data-testid="work-search-results">${sourceStatusMarkup(search)}${body}</div>
      ${search.selected ? `<form id="work-search-add-form">
        <label><span>为什么想看（可选）</span><textarea name="reason" rows="3" maxlength="500" placeholder="例如：重看《蜘蛛侠：英雄归来》后觉得 Michael Keaton 的秃鹫非常不错。" data-testid="work-search-reason"></textarea></label>
        <button class="sheet-done" type="submit" data-testid="work-search-confirm">加入《${escapeHtml(collection?.title || "")}》</button>
      </form>` : ""}
    </section>
  </div>`;
}

/**
 * R6 补丁 13：片单条目的二级菜单。
 *
 * 原来编辑理由/上移/下移/移除四个按钮竖着排在卡片最右侧，既占宽度又把卡片撑高，
 * 中间还空出一大片。收进右上角一个「⋯」之后，卡片横向空间全部留给海报和理由。
 */
function entryMenuOverlay(collection) {
  const workId = state.entryMenuWorkId;
  const entries = collectionEntries(collection);
  const index = entries.findIndex((entry) => entry.work_id === workId);
  if (index === -1) return "";
  const work = findWorkById(state.works, workId);

  return `<div class="overlay" data-testid="entry-menu">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="entry-menu-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">${escapeHtml(collection.title)}</span><h2 id="entry-menu-title">《${escapeHtml(work?.title || "")}》</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <div class="settings-actions">
        <button type="button" data-action="start-viewing-capture" data-work-id="${escapeHtml(workId)}" data-testid="menu-start-viewing"><span><b>记录这次观看</b><small>先填写观影信息，再写感想</small></span>${icon("edit")}</button>
        <button type="button" data-action="edit-entry-reason" data-work-id="${escapeHtml(workId)}" data-testid="menu-edit-reason"><span><b>编辑想看的理由</b><small>只属于这个片单</small></span>${icon("edit")}</button>
        <button type="button" data-action="move-entry-up" data-work-id="${escapeHtml(workId)}" ${index === 0 ? "disabled" : ""}><span><b>上移</b></span>↑</button>
        <button type="button" data-action="move-entry-down" data-work-id="${escapeHtml(workId)}" ${index === entries.length - 1 ? "disabled" : ""}><span><b>下移</b></span>↓</button>
        <button type="button" class="settings-danger" data-action="remove-from-collection" data-work-id="${escapeHtml(workId)}" data-testid="menu-remove-entry"><span><b>移出这个片单</b><small>作品本身与感想都不会被删除</small></span>${icon("trash")}</button>
      </div>
    </section>
  </div>`;
}

/** R6 补丁 13：新建片单。从片单列表页的常驻表单挪进来的。 */
function createCollectionOverlay() {
  return `<div class="overlay" data-testid="create-collection">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="create-collection-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">候场片单</span><h2 id="create-collection-title">新建片单</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="collection-create-form">
        <label><span>标题</span><input type="text" name="title" maxlength="60" placeholder="例如：Michael Keaton 补片" data-testid="new-collection-input" required /></label>
        <label><span>描述（可选）</span><input type="text" name="description" maxlength="120" placeholder="例如：重看《英雄归来》之后想补的" data-testid="new-collection-description" /></label>
        <button class="sheet-done" type="submit">创建</button>
      </form>
    </section>
  </div>`;
}

/** R6：编辑片单本身的标题与描述。 */
function collectionEditorOverlay(collection) {
  return `<div class="overlay" data-testid="collection-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="collection-editor-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">片单</span><h2 id="collection-editor-title">编辑片单信息</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="collection-edit-form">
        <label><span>标题</span><input type="text" name="title" maxlength="60" value="${escapeHtml(collection.title || "")}" data-testid="collection-edit-title" required /></label>
        <label><span>描述（可选）</span><input type="text" name="description" maxlength="120" value="${escapeHtml(collection.description || "")}" data-testid="collection-edit-description" /></label>
        <button class="sheet-done" type="submit">保存</button>
      </form>
    </section>
  </div>`;
}

/**
 * R6 §4：编辑某个片单条目的「想看理由」。
 *
 * 理由属于 **条目** 而不是作品——同一部《鸟人》在「Michael Keaton 补片」里的理由
 * 是"重看《英雄归来》后觉得他的秃鹫很好"，在「2010 年代补片」里可能是"补奥斯卡
 * 最佳影片"。所以这个面板永远绑定"哪个片单 + 哪部作品"，不写到 work 上。
 */
function entryReasonEditorOverlay(collection) {
  const workId = state.editingEntryWorkId;
  const entry = findCollectionEntry(collection, workId);
  const work = findWorkById(state.works, workId);
  if (!entry) return "";
  return `<div class="overlay" data-testid="entry-reason-editor">
    <button class="overlay-backdrop" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="entry-reason-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work?.title || "")}》</span><h2 id="entry-reason-title">为什么想看</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <p class="settings-note">只属于《${escapeHtml(collection.title)}》这一个片单。同一部作品在别的片单里可以写完全不同的理由。</p>
      <form id="entry-reason-form">
        <label><span>理由</span><textarea name="reason" rows="4" maxlength="500" placeholder="例如：重看《蜘蛛侠：英雄归来》后觉得 Michael Keaton 的秃鹫非常不错，想看他的其他代表作。" data-testid="entry-reason-input">${escapeHtml(entry.reason || "")}</textarea></label>
        <button class="sheet-done" type="submit">保存</button>
      </form>
    </section>
  </div>`;
}

// 上一次写入各挂载点的 HTML，用于跳过无变化的重写（见 render() 末尾的说明）
let lastBaseHtml = null;
let lastFabHtml = null;
let lastOverlayHtml = null;
let xWidgetsPromise = null;

function hydrateExternalPublicationEmbeds() {
  if (!app.querySelector("[data-x-embed]")) return;
  const loadWidgets = () => window.twttr?.widgets?.load?.(app);
  if (window.twttr?.widgets) {
    loadWidgets();
    return;
  }
  if (!xWidgetsPromise) {
    xWidgetsPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://platform.twitter.com/widgets.js"]');
      const script = existing || document.createElement("script");
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", reject, { once: true });
      if (!existing) {
        script.src = "https://platform.twitter.com/widgets.js";
        script.async = true;
        script.charset = "utf-8";
        document.head.append(script);
      }
    });
  }
  // 网络、隐私插件或平台状态导致加载失败时，保留 blockquote 内的原文链接即可。
  xWidgetsPromise.then(loadWidgets).catch(() => {});
}

function workTagEditorOverlay(work) {
  const tags = tagsForTarget(state.tags, state.tagAssignments, "work", work.id, { includeHidden: true });
  const value = tags.map((tag) => displayTagName(tag, tagLocale)).join("，");
  return `<div class="overlay" data-testid="work-tag-editor">
    <button class="overlay-scrim" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet tag-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="work-tag-editor-title">
      <div class="sheet-title-row"><div><span class="sheet-kicker">《${escapeHtml(work.title || "")}》</span><h2 id="work-tag-editor-title">${escapeHtml(tt("edit"))}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <form id="work-tag-form">
        <label><span>${escapeHtml(tt("add"))}</span><textarea name="tags" rows="4" placeholder="${escapeHtml(tt("namePlaceholder"))}" data-testid="work-tag-input">${escapeHtml(value)}</textarea></label>
        ${tags.length ? `<div class="tag-editor-existing">${tags.map((tag) => `<span><b>#${escapeHtml(displayTagName(tag, tagLocale))}</b><small>${tag.source === "metadata_bangumi" ? "Bangumi · 导演" : "个人标签"}</small></span>`).join("")}</div>` : ""}
        <p class="settings-note">从输入框移除名称只会取消这部作品的关联，不会影响其他作品或观影记录。</p>
        <button class="sheet-done" type="submit">${escapeHtml(tt("save"))}</button>
      </form>
    </section>
  </div>`;
}

function tagManagerOverlay(tag) {
  const candidates = state.tags.filter((item) => item.id !== tag.id);
  return `<div class="overlay" data-testid="tag-manager">
    <button class="overlay-scrim" type="button" data-action="close-overlay" aria-label="关闭"></button>
    <section class="bottom-sheet tag-manager-sheet" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
      <div class="sheet-title-row"><div><span class="sheet-kicker">#${escapeHtml(displayTagName(tag, tagLocale))}</span><h2 id="tag-manager-title">${escapeHtml(tt("edit"))}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">${icon("close")}</button></div>
      <div class="tag-manager-actions">
        <button type="button" data-action="toggle-tag-pin" data-tag-id="${escapeHtml(tag.id)}">${icon("pin")} ${escapeHtml(tag.is_pinned ? "取消固定" : tt("pinned"))}</button>
        <button type="button" data-action="toggle-tag-hidden" data-tag-id="${escapeHtml(tag.id)}">${escapeHtml(tag.is_hidden ? "取消隐藏" : tt("hidden"))}</button>
      </div>
      ${candidates.length ? `<form id="tag-merge-form"><label><span>${escapeHtml(tt("merge"))}</span><select name="targetTagId">${candidates.map((item) => `<option value="${escapeHtml(item.id)}">#${escapeHtml(displayTagName(item, tagLocale))}</option>`).join("")}</select></label><button type="submit">${escapeHtml(tt("merge"))}</button></form>` : ""}
      <button type="button" class="danger-action" data-action="delete-tag" data-tag-id="${escapeHtml(tag.id)}">${escapeHtml(tt("delete"))}</button>
    </section>
  </div>`;
}

function tagSectionMarkup(title, tags, testId) {
  if (!tags.length) return "";
  return `<section class="tag-index-section" data-testid="${testId}"><h2>${escapeHtml(title)}</h2><div class="tag-cloud">${tags.map((tag) => tagChipMarkup(tag)).join("")}</div></section>`;
}

function renderTags() {
  const query = state.tagSearchQuery.trim();
  const visible = state.tags.filter((tag) => !tag.is_hidden);
  const results = searchTags(visible, query);
  const frequent = rankTags(visible, state.tagAssignments, { limit: 10 });
  const creators = visible.filter((tag) => tag.category === "director").sort((a, b) => tagUsageCount(state.tagAssignments, b.id) - tagUsageCount(state.tagAssignments, a.id));
  const personal = visible.filter((tag) => tag.category === "custom").sort((a, b) => tagUsageCount(state.tagAssignments, b.id) - tagUsageCount(state.tagAssignments, a.id));
  const body = query
    ? tagSectionMarkup(`${tt("search")} · ${results.length}`, results, "tag-search-results") || `<p class="tag-index-empty">${escapeHtml(tt("noResults"))}</p>`
    : visible.length
      ? [tagSectionMarkup(tt("frequent"), frequent, "tag-frequent"), tagSectionMarkup(tt("creators"), creators, "tag-creators"), tagSectionMarkup(tt("personal"), personal, "tag-personal")].join("")
      : `<p class="tag-index-empty">${escapeHtml(tt("empty"))}</p>`;
  return `<main class="tag-index-view" data-testid="tags">
    ${topBar()}
    <article class="tag-index-content">
      <header class="tag-index-header"><span class="page-eyebrow">RELATION INDEX</span><h1>${escapeHtml(tt("index"))}</h1><p>把作品与每一次观看之间的共同线索，收进自己的电影关系目录。</p></header>
      <label class="tag-search">${icon("search")}<input id="tag-search-input" type="search" value="${escapeHtml(state.tagSearchQuery)}" placeholder="${escapeHtml(tt("search"))}" autocomplete="off" /></label>
      ${body}
    </article>
  </main>`;
}

function attitudeDistributionMarkup(entries) {
  const counts = new Map(["love", "like", "neutral", "dislike", "mixed", "unrated"].map((key) => [key, 0]));
  for (const entry of entries) counts.set(entry.attitude, (counts.get(entry.attitude) || 0) + 1);
  return `<div class="tag-attitude-grid">${["love", "like", "neutral", "dislike", "mixed"].map((key) => `<span><i>${attitudeIcon(key)}</i><b>${escapeHtml(attitudeLabel(key))}</b><strong>${counts.get(key) || 0}</strong></span>`).join("")}</div>`;
}

function taggedWorksMarkup(tag) {
  const entries = taggedWorkEntries(tag.id, state.tags, state.tagAssignments, state.works, state.records, state.allViewingEvents, state.tagSort);
  if (!entries.length) return "";
  const rows = entries.map((entry) => `<button type="button" class="tag-work-row" data-action="open-work" data-work-id="${escapeHtml(entry.work.id)}">
    <span><b>《${escapeHtml(entry.work.title || "未命名作品")}》</b><small>${entry.releaseYear || "—"}</small></span>
    <span class="tag-work-attitude">${entry.attitude === "unrated" ? "未形成态度" : `${attitudeIcon(entry.attitude)}${escapeHtml(attitudeLabel(entry.attitude))}`}</span>
  </button>`).join("");
  return `<section class="tag-detail-section"><div class="tag-detail-section-title"><h2>${escapeHtml(tt("works"))}</h2><select id="tag-sort" aria-label="排序方式"><option value="attitude" ${state.tagSort === "attitude" ? "selected" : ""}>${escapeHtml(tt("sortAttitude"))}</option><option value="recent" ${state.tagSort === "recent" ? "selected" : ""}>${escapeHtml(tt("sortRecent"))}</option><option value="release" ${state.tagSort === "release" ? "selected" : ""}>${escapeHtml(tt("sortRelease"))}</option></select></div><div class="tag-work-list">${rows}</div></section>`;
}

function taggedViewingsMarkup(tag) {
  const recordIds = new Set(state.tagAssignments.filter((item) => item.tag_id === tag.id && item.target_type === "viewing").map((item) => item.target_id));
  const records = state.records.filter((record) => recordIds.has(record.id));
  if (!records.length) return "";
  return `<section class="tag-detail-section"><h2>${escapeHtml(tt("viewings"))}</h2><div class="tag-viewing-list">${records.map((record) => {
    const work = currentWork(record);
    const event = state.recordEventById.get(record.id);
    const date = event?.screening_at || event?.viewed_on || record.createdAt;
    return `<button type="button" data-action="open-record" data-record-id="${escapeHtml(record.id)}"><span><b>《${escapeHtml(work?.title || record.title || "未命名作品")}》</b><small>${date ? escapeHtml(String(date).slice(0, 10)) : ""}</small></span><p>${escapeHtml(String(record.rawText || "").replace(/\s+/gu, " ").slice(0, 90))}</p></button>`;
  }).join("")}</div></section>`;
}

function renderTagDetail() {
  const tag = state.tags.find((item) => item.id === state.currentTagId);
  if (!tag) return renderTags();
  const overview = tagOverview(tag.id, state.tagAssignments);
  const entries = taggedWorkEntries(tag.id, state.tags, state.tagAssignments, state.works, state.records, state.allViewingEvents, "attitude");
  const otherNames = [...new Set(Object.values(tag.names || {}).filter((name) => name && name !== displayTagName(tag, tagLocale)))];
  return `<main class="tag-detail-view" data-testid="tag-detail">
    ${topBar()}
    <article class="tag-detail-content">
      <header class="tag-identity"><div><span class="page-eyebrow">${tag.category === "director" ? escapeHtml(tt("director")) : "PERSONAL TAG"}</span><h1>#${escapeHtml(displayTagName(tag, tagLocale))}</h1>${otherNames.length ? `<p>${otherNames.map(escapeHtml).join(" · ")}</p>` : ""}${tag.source === "metadata_bangumi" ? `<small>${escapeHtml(tt("sourceBangumi"))}</small>` : ""}</div><button type="button" class="icon-button" data-action="manage-tag" aria-label="${escapeHtml(tt("edit"))}">${icon("more")}</button></header>
      <section class="tag-overview"><div><strong>${overview.workCount}</strong><span>${escapeHtml(tt("works"))}</span></div><div><strong>${overview.viewingCount}</strong><span>${escapeHtml(tt("viewings"))}</span></div></section>
      ${entries.length ? `<section class="tag-detail-section"><h2>${escapeHtml(tt("attitude"))}</h2>${attitudeDistributionMarkup(entries)}</section>` : ""}
      ${taggedWorksMarkup(tag)}
      ${taggedViewingsMarkup(tag)}
    </article>
  </main>`;
}

function render() {
  const base = state.view === "detail" ? renderDetail()
    : state.view === "shelf" ? renderShelf()
    : state.view === "work" ? renderWork()
    : state.view === "series" ? renderSeries()
    : state.view === "collections" ? renderCollections()
    : state.view === "collection" ? renderCollection()
    : state.view === "tags" ? renderTags()
    : state.view === "tag" ? renderTagDetail()
    : renderHome();
  const record = currentRecord();
  const currentWorkForOverlay = state.view === "work" ? findWorkById(state.works, state.currentWorkId) : null;
  const editingHistoryEvent = [...(state.currentWorkEvents || []), ...(state.viewingEvents || [])]
    .find((event) => event.id === state.editingHistoryEventId) || null;
  const currentCollectionForOverlay = state.collections.find((item) => item.id === state.currentCollectionId) || null;
  const currentSeriesForOverlay = state.series.find((item) => item.id === state.currentSeriesId) || null;
  const overlay = state.overlay === "capture-entry"
    ? captureEntryOverlay()
    : state.overlay === "ticket-confirm"
      ? ticketConfirmOverlay()
    : state.overlay === "scene-choice"
      ? sceneChoiceOverlay()
    : state.overlay === "compose"
      ? composerOverlay()
    : state.overlay === "interview-invite" && record
      ? interviewInviteOverlay(record)
    : state.overlay === "self-interview" && record
      ? interviewQuestionOverlay(record)
    : state.overlay === "interview-all" && record
      ? interviewAllOverlay(record)
    : state.overlay === "interview-summary" && record
      ? interviewSummaryOverlay(record)
    : state.overlay === "settings"
      ? settingsOverlay()
    : state.overlay === "sidebar"
      ? sidebarDrawer()
    : state.overlay === "attitude" && record
      ? attitudeOverlay(record)
      : state.overlay === "work-split" && state.workSplitPrompt
        ? workSplitOverlay()
      : state.overlay === "work-match" && record
        ? workMatchOverlay(record)
      : state.overlay === "analysis-draft" && record?.activeAnalysisDraft
        ? analysisDraftOverlay(record)
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
      : state.overlay === "external-publication" && currentWorkForOverlay
        ? externalPublicationEditorOverlay(currentWorkForOverlay)
      : state.overlay === "release-dates" && currentWorkForOverlay
        ? releaseDateEditorOverlay(currentWorkForOverlay)
      : state.overlay === "poster" && currentWorkForOverlay
        ? posterEditorOverlay(currentWorkForOverlay)
      : state.overlay === "work-type" && currentWorkForOverlay
        ? workTypeEditorOverlay(currentWorkForOverlay)
      : state.overlay === "tagline" && currentWorkForOverlay
        ? taglineEditorOverlay(currentWorkForOverlay)
      : state.overlay === "series" && currentWorkForOverlay
        ? seriesEditorOverlay(currentWorkForOverlay)
      : state.overlay === "series-member" && currentSeriesForOverlay
        ? seriesMemberEditorOverlay(currentSeriesForOverlay)
      : state.overlay === "collections" && currentWorkForOverlay
        ? collectionsEditorOverlay(currentWorkForOverlay)
      : state.overlay === "stills" && currentWorkForOverlay
        ? stillsEditorOverlay(currentWorkForOverlay)
      : state.overlay === "collection-editor" && currentCollectionForOverlay
        ? collectionEditorOverlay(currentCollectionForOverlay)
      : state.overlay === "entry-reason" && currentCollectionForOverlay
        ? entryReasonEditorOverlay(currentCollectionForOverlay)
      : state.overlay === "work-search"
        ? workSearchOverlay()
      : state.overlay === "reset-data"
        ? resetDataOverlay()
      : state.overlay === "delete-work" && currentWorkForOverlay
        ? deleteWorkOverlay(currentWorkForOverlay)
      : state.overlay === "create-collection"
        ? createCollectionOverlay()
      : state.overlay === "entry-menu" && currentCollectionForOverlay
        ? entryMenuOverlay(currentCollectionForOverlay)
      : state.overlay === "work-tags" && currentWorkForOverlay
        ? workTagEditorOverlay(currentWorkForOverlay)
      : state.overlay === "tag-manager" && state.tags.find((item) => item.id === state.currentTagId)
        ? tagManagerOverlay(state.tags.find((item) => item.id === state.currentTagId))
        : "";

  // 三块分别挂载，各自只在自己变化时重写：
  //  - #app 里是视图正文（时间线列表等）。只有它真的变了才重写，否则开合浮层/FAB
  //    会把列表整棵重建，<img> 重新创建并重新加载 —— 就是用户看到的"海报又刷新了一遍"。
  //  - #overlay-root 是浮层，#fab-root 是右下角按钮，它们变化不影响正文。
  if (base !== lastBaseHtml) {
    app.innerHTML = base;
    lastBaseHtml = base;
    requestAnimationFrame(hydrateExternalPublicationEmbeds);
  }
  const fab = fabMenu();
  if (fab !== lastFabHtml) {
    fabRoot.innerHTML = fab;
    lastFabHtml = fab;
  }
  if (overlay !== lastOverlayHtml) {
    overlayRoot.innerHTML = overlay;
    lastOverlayHtml = overlay;
  }
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
  // R6：两种情况下 Work 都是**已经确定**的，绝不能再走 resolveWork 的标题模糊匹配
  //（那有可能撞到另一部同名作品，或者因为译名不同而新建出第二个 Work）：
  //   1. 补充记录 —— R4 起就从作品页发起
  //   2. lockedWork —— R6 新增，从作品页发起的正式观影记录
  // 这是 §14 闭环"看完之后必须命中原 Work"的最后一道保障。
  let work;
  if (state.captureContext?.workId && (isSupplement || state.captureContext.lockedWork)) {
    work = findWorkById(state.works, state.captureContext.workId);
  }

  // R6 补丁 10：用户在捕获流程里选了候选（可能来自本地／Bangumi／TMDB）时，
  // 走和片单添加**完全同一条**落库路径——它会补 TMDB 详情、按发行地区挑海报、
  // 并保证相同 external id 不重复建 Work。
  // 以前这里只把 bangumi subjectId 传给 resolveWork，TMDB 候选的 id、海报、
  // 时长这些信息在落库时全部丢失。
  if (!work && state.captureContext?.selectedCandidate) {
    work = await resolveOrCreateWorkFromCandidate(state.captureContext.selectedCandidate);
  }

  if (!work) {
    // 没选任何候选（手填片名直接保存）：仍然按标题/别名查重，不新建 1:1 Work
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
  await syncViewingRecordTags(record);
  await openRecord(record.id);
  state.overlay = "interview-invite";
  render();
  announce("原文已保存在本机，可以开始自我采访");
  void requestWorkMatch(record.id);
}

async function runAiAnalysis(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record || record.analysis_status === "running") return;
  record.analysis_status = "running";
  record.cardSuggestionStatus = "running";
  record.analysis_error = null;
  await db.put("records", record);
  renderPreservingScroll();
  try {
    const response = await apiFetch("/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ provider: state.aiPreference?.provider, title: currentWork(record)?.title || record.title, sources: analysisRequestSources(record) })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "整理暂时没有完成");
    const analysis = payload.analysis;
    if (record.activeAnalysisDraft) {
      record.analysis_history ||= [];
      record.analysis_history.push({ ...record.activeAnalysisDraft, status: "superseded" });
    }
    record.activeAnalysisDraft = {
      ...analysis,
      source_snapshot_hash: payload.metadata?.input_hash || null,
      analysis_metadata: payload.metadata || {},
      status: "draft",
      stale: false,
      created_at: new Date().toISOString(),
      memory_cards: (analysis.memory_cards || []).map((card) => ({ ...card, analysis_id: analysis.analysis_id }))
    };
    record.analysisMetadata = payload.metadata;
    record.aiWarnings = analysis.warnings || [];
    record.analysis_stale = false;
    record.analysis_status = "ai_draft_ready";
    record.cardSuggestionStatus = "done";
    record.updatedAt = new Date().toISOString();
    await db.put("records", record);
    renderPreservingScroll();
  } catch (error) {
    record.analysis_status = "failed";
    record.cardSuggestionStatus = "failed";
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
  if (record?.self_interview?.status === "not_started") {
    await updateRecord((item) => { item.self_interview = skipSelfInterview(item.self_interview); });
  } else if (record?.self_interview?.status === "in_progress") {
    await updateRecord((item) => { item.self_interview = completeSelfInterview(item.self_interview); });
  }
  return runAiAnalysis(recordId);
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

async function requestWorkMatch(recordId, { force = false, query: queryOverride = null } = {}) {
  const record = state.records.find((item) => item.id === recordId);
  const work = currentWork(record);
  if (!record || !work || work.match?.status === "searching" || (work.identity_status === "matched" && !force)) return;
  const query = String(queryOverride ?? buildWorkSearchQuery(record)).trim();
  if (!query) return;
  work.match = { status: "searching", query, candidates: [], message: null, correcting: force };
  await db.put("works", work);
  renderPreservingScroll();

  // R6 补丁 10：这里原本只打 /api/bangumi/search。记录一部真人电影时 Bangumi
  // 常常没有条目，于是首页永远挂着"待确认作品"却怎么点都匹配不上。
  // 现在与捕获流程、片单搜索走同一条统一搜索：Bangumi + TMDB 并行。
  const [bangumiResult, tmdbResult] = await Promise.allSettled([
    fetchSearchSource(`/api/bangumi/search?q=${encodeURIComponent(query)}`),
    fetchSearchSource(`/api/tmdb/search?q=${encodeURIComponent(query)}`)
  ]);
  const unwrap = (settled) => settled.status === "fulfilled"
    ? settled.value
    : { state: "failed", candidates: [], error: settled.reason?.message || "网络错误" };
  const bangumiInfo = unwrap(bangumiResult);
  const tmdbInfo = unwrap(tmdbResult);
  const sources = {
    bangumi: { state: bangumiInfo.state, count: bangumiInfo.candidates.length, error: bangumiInfo.error },
    tmdb: { state: tmdbInfo.state, count: tmdbInfo.candidates.length, error: tmdbInfo.error }
  };

  const { external } = buildSearchResults({
    local: [],
    bangumi: bangumiInfo.candidates,
    tmdb: tmdbInfo.candidates,
    query
  });

  work.match = buildWorkMatchOutcome({ query, candidates: external, sources, correcting: force });
  await db.put("works", work);
  renderPreservingScroll();
}

/**
 * 这个 Work 名下除了当前这条记录，还挂着别的记录吗？
 *
 * 用来判断「改写这个 Work」的爆炸半径。只有一条记录时，改写 Work 和改写这条记录的
 * 归属没有区别，不必打扰用户；一旦还有别人，就必须先问清楚——否则就是线上那个
 * bug 的现场：改一条感想的关联，把同条目下另外三条动画版感想全改成了真人版。
 */
function otherRecordsOnWork(work, exceptRecordId) {
  const ids = new Set([work.id, ...(work.merged_from || [])]);
  return state.records.filter(
    (item) => ids.has(item.work_id || item.workId) && item.id !== exceptRecordId
  );
}

async function confirmWorkMatch(candidateIndex, { force = false } = {}) {
  const record = currentRecord();
  const work = currentWork(record);
  let candidate = work?.match?.candidates?.[Number(candidateIndex)];
  if (!record || !work || !candidate) return;

  // 搜索响应里的 poster_path 受 TMDB_LANGUAGE 影响，不能直接落库；详情响应才带有
  // 各语言图片与出品国，必须先按地区规则重挑。失败时仍保留原候选，不阻断匹配。
  if (candidate.source === "tmdb") {
    try { candidate = await enrichTmdbCandidate(candidate); } catch (_) { /* 保留搜索候选 */ }
  }

  // 拦截「其实是另一部作品」的情况。
  //
  // 这个入口的语义一直是「这个作品条目认错了，用候选的资料把它改对」——它会就地
  // 改写 Work 的标题、类型、年份、external_refs，而 work.id 不变，于是挂在这个
  // Work 下的**所有**记录、场次、书架条目全部跟着变。当这个 Work 底下还有别的
  // 记录、而候选又明显是另一部电影时，用户想要的几乎肯定不是改写，
  // 而是「把我这条记录挪到那部电影去」。先问清楚，不要替他猜。
  if (!force) {
    const { conflict, reason } = candidateIdentityConflict(work, candidate);
    const others = otherRecordsOnWork(work, record.id);
    if (conflict && others.length > 0) {
      state.workSplitPrompt = {
        candidateIndex: Number(candidateIndex),
        reason,
        affectedCount: others.length,
        workTitle: work.title,
        candidateTitle: candidate.title
      };
      state.overlay = "work-split";
      render();
      return;
    }
  }

  // R6：匹配 Bangumi 只是给这个 Work 增加一条 external_ref，**work.id 不再变更**。
  //
  // R1～R5 这里的合并触发条件是「升格后的新 id 撞上某个已存在的 work」——因为当时
  // id 是由 bangumi subjectId 算出来的，所以每次升格都可能撞车，这条高危链路也
  // 因此出过两次线上 bug（书架幽灵重复条目）。R6 之后 id 恒定，那种撞车不存在了。
  //
  // 但真正的重复作品仍然要处理：用户把 Work A 匹配到 bangumi:123，而 Work B 早就
  // 持有 bangumi:123 —— 同一个外部标识指向两个 Work，那它们确定是同一部电影
  // （R6 §9：相同 bangumi_id → 不重复创建 Work）。这时才合并，并把所有指向被合并
  // 一方的 record / viewing event 改指过去。这是罕见路径，不再是每次匹配的常规流程。
  // R6 补丁 10：候选可能来自 Bangumi 也可能来自 TMDB，冲突检测要按候选自己的源来查，
  // 不能写死 bangumi。
  const candidateSource = candidate.source;
  const conflictingWork = candidateSource && candidateSource !== "local"
    ? state.works.find(
        (item) => item.id !== work.id && externalRefId(item, candidateSource) === String(candidate.sourceId)
      )
    : null;

  const promoted = applyCandidateToWork(work, candidate, { overwritePoster: true });
  const oldId = work.id;
  // 合并时以「已经持有这个 external_ref 的一方」为主体，被匹配的一方并入它
  const finalWork = conflictingWork ? mergeWorks(conflictingWork, [promoted]) : promoted;

  await db.put("works", finalWork);

  const staleIds = [...new Set([oldId, conflictingWork?.id].filter((id) => id && id !== finalWork.id))];
  if (staleIds.length) {
    let nextTagAssignments = state.tagAssignments.filter((item) => !(item.target_type === "work" && staleIds.includes(item.target_id)));
    for (const assignment of state.tagAssignments.filter((item) => item.target_type === "work" && staleIds.includes(item.target_id))) {
      nextTagAssignments = upsertAssignment(nextTagAssignments, {
        tagId: assignment.tag_id,
        targetType: "work",
        targetId: finalWork.id,
        source: assignment.source,
        now: assignment.created_at
      }).assignments;
    }
    await persistTagState(state.tags, nextTagAssignments);
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
    // 外部发表也是 Work 的子实体。合并作品时一并改指向；如果两边已经引用了同一条
    // normalized URL，只保留一条，继续维持 work_id + normalized_url 的唯一语义。
    const allPublications = await db.getAll("externalPublications").catch(() => []);
    const retainedUrls = new Set(allPublications
      .filter((item) => item.work_id === finalWork.id)
      .map((item) => item.normalized_url || normalizePublicationUrl(item.url))
      .filter(Boolean));
    for (const publication of allPublications.filter((item) => staleIds.includes(item.work_id))) {
      const normalized = publication.normalized_url || normalizePublicationUrl(publication.url);
      if (normalized && retainedUrls.has(normalized)) {
        await db.delete("externalPublications", publication.id).catch(() => {});
        continue;
      }
      if (normalized) retainedUrls.add(normalized);
      await db.put("externalPublications", {
        ...publication,
        work_id: finalWork.id,
        normalized_url: normalized,
        updated_at: new Date().toISOString()
      });
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
    loadWorkPageData(finalWork.id);
  }
  // 走完覆盖分支后把拦截浮层的上下文清掉，否则下次打开匹配面板会残留上一次的提示。
  if (state.workSplitPrompt) {
    state.workSplitPrompt = null;
    state.overlay = null;
  }
  await syncBangumiDirectorsForWork(finalWork);
  render();
  announce(`已确认作品：${finalWork.title}`);
}

/**
 * 把当前这条记录从它现在挂着的 Work **拆到**候选代表的那部作品上。
 *
 * 与 confirmWorkMatch 的根本区别：**原来那个 Work 一个字段都不改**。
 * 变的只有这条 record 的 work_id、它名下那场 ViewingEvent 的归属，以及两侧
 * 各自重排后的初看/重看编号。
 *
 * 目标 Work 的取得沿用 resolveOrCreateWorkFromCandidate：候选带的 external id
 * 已经存在就直接引用，不存在才新建——这样从别的入口搜到同一部片时不会再多出一条。
 */
async function detachRecordToCandidate(candidateIndex) {
  const record = currentRecord();
  const fromWork = currentWork(record);
  const candidate = fromWork?.match?.candidates?.[Number(candidateIndex)];
  if (!record || !fromWork || !candidate) return;

  const toWork = await resolveOrCreateWorkFromCandidate(candidate);
  if (!toWork || toWork.id === fromWork.id) {
    // 候选解析回了同一个 Work（标题/别名撞上了）。这时拆分没有意义，也不能
    // 悄悄退回改写——那正是要避免的行为。如实告诉用户，让他去作品页处理。
    showToast("这个候选被识别成了同一部作品，无法拆分。请先在作品页修正标题或别名。");
    state.overlay = null;
    state.workSplitPrompt = null;
    render();
    return;
  }

  const relatedIds = new Set([fromWork.id, ...(fromWork.merged_from || []), toWork.id]);
  const relatedRecords = state.records.filter((item) => relatedIds.has(item.work_id || item.workId));
  const eventGroups = await Promise.all(
    [...relatedIds].map((id) => db.getViewingEventsByWork(id).catch(() => []))
  );
  const relatedEvents = eventGroups.flat();

  const { movedRecords, stayingEvents, movedEvents } = detachRecordsToWork({
    fromWork,
    toWork,
    records: relatedRecords,
    events: relatedEvents,
    recordIds: [record.id]
  });

  for (const item of movedRecords) {
    item.updatedAt = new Date().toISOString();
    await db.put("records", item);
    const index = state.records.findIndex((existing) => existing.id === item.id);
    if (index >= 0) state.records[index] = item;
  }
  const allEvents = [...stayingEvents, ...movedEvents];
  if (allEvents.length) await db.putViewingEvents(allEvents);

  // fromWork 完全没有被写回——这是这条路径的红线。
  state.viewingEvents = movedEvents.filter((event) => event.work_id === toWork.id);
  state.currentWorkId = toWork.id;
  state.overlay = null;
  state.workSplitPrompt = null;

  await indexHomeCardData();
  render();
  announce(`已把这条记录改挂到《${toWork.title}》，《${fromWork.title}》没有变动`);
  showToast(`已改挂到《${toWork.title}》。原条目《${fromWork.title}》未受影响。`);
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

function resetTicketOcrUi({ clearText = true } = {}) {
  ticketOcrJobId += 1;
  if (clearText) {
    pendingTicketOcrText = null;
    pendingTicketOcrLayout = null;
  }
  ticketOcrUi = {
    ...ticketOcrUi,
    status: "idle",
    progress: 0,
    message: "",
    error: ""
  };
}

function paintTicketOcrProgress() {
  const status = document.querySelector("[data-testid='ticket-ocr-status'] span");
  const progress = document.querySelector("[data-testid='ticket-ocr-status'] progress");
  if (status) status.textContent = ticketOcrUi.message || "正在识别票务信息…";
  if (progress) progress.value = Math.max(0, Math.min(1, ticketOcrUi.progress || 0));
}

async function handleTicketScreenshot(file) {
  const captureAtStart = state.captureContext;
  const jobId = ++ticketOcrJobId;
  pendingTicketOcrText = null;
  pendingTicketOcrLayout = null;
  ticketOcrUi = {
    ...ticketOcrUi,
    status: "preparing",
    progress: 0.02,
    message: "正在准备识别…",
    error: ""
  };
  render();

  try {
    const ocrResult = await recognizeTicketImage(file, {
      language: ticketOcrUi.language,
      onProgress(message) {
        if (jobId !== ticketOcrJobId) return;
        ticketOcrUi.status = String(message?.status || "").toLowerCase().includes("recognizing")
          ? "recognizing"
          : "preparing";
        ticketOcrUi.progress = Number.isFinite(message?.progress) ? message.progress : ticketOcrUi.progress;
        ticketOcrUi.message = ticketOcrProgressLabel(message);
        paintTicketOcrProgress();
      }
    });
    if (jobId !== ticketOcrJobId || state.captureContext !== captureAtStart || state.overlay !== "capture-entry") return;

    const text = String(typeof ocrResult === "string" ? ocrResult : ocrResult?.text || "");
    pendingTicketOcrText = text;
    pendingTicketOcrLayout = typeof ocrResult === "string" ? null : ocrResult.layout;
    if (!text.trim()) {
      ticketOcrUi = {
        ...ticketOcrUi,
        status: "error",
        progress: 0,
        message: "",
        error: "没有识别到文字，请尝试更清晰的截图，或直接粘贴票务文字。"
      };
      render();
      return;
    }

    ticketOcrUi = {
      ...ticketOcrUi,
      status: "parsing",
      progress: 1,
      message: "正在解析票务信息…",
      error: ""
    };
    render();
    ticketOcrUi.status = "done";
    if (!handleCapturePaste(text, { ocr: true, layout: pendingTicketOcrLayout })) {
      ticketOcrUi = {
        ...ticketOcrUi,
        status: "review",
        progress: 0,
        message: "",
        error: "已经识别出文字，但未能识别出票务信息。请修改文字后重新解析，或手动填写。"
      };
      render();
    }
  } catch (error) {
    if (jobId !== ticketOcrJobId || state.captureContext !== captureAtStart || state.overlay !== "capture-entry") return;
    console.error("[ticket-ocr]", error);
    ticketOcrUi = {
      ...ticketOcrUi,
      status: "error",
      progress: 0,
      message: "",
      error: error?.message || "截图识别失败，请重试或直接粘贴票务文字。"
    };
    render();
  }
}

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
function handleCapturePaste(rawText, options = {}) {
  if (!rawText || !rawText.trim()) return false;
  let result;
  try {
    result = parseTicketText(rawText, options);
  } catch (_) {
    announce("解析失败，请检查粘贴内容");
    return false;
  }
  if (!result.screenings.length) {
    announce("未能识别出场次，请检查粘贴内容");
    return false;
  }
  // 默认全选，但每场都保留 selected 标记——用户可以单独排除误识别的场次，
  // 不必因为一场解析错了就整体重新粘贴。
  const pendingEvents = result.screenings.map((s) => ({ ...draftViewingEvent(s, "work_capture_pending"), selected: true }));

  // 从作品页发起时 Work 已经锁定：票务里解析出的片名一律忽略，
  // 也不再做任何外部身份匹配。票务其余字段（影院/时间/座位/票价）照常采用。
  const locked = state.captureContext?.lockedWork ? state.captureContext : null;
  const workTitle = locked ? locked.workTitle : (result.screenings[0]?.movieTitle || "");

  state.captureContext = {
    source: "ticket_paste",
    locationType: "cinema",
    lockedWork: !!locked,
    workId: locked?.workId || null,
    workTitle,
    subjectId: locked?.subjectId ?? null,
    showMatchCandidates: false,
    workMatch: { status: "idle", candidates: [], query: workTitle, sources: null },
    selectedCandidate: null,
    hasHistory: false,
    existingHistoryCount: 0,
    pendingEvents
  };
  state.captureTagsExpanded = new Set();
  applyCaptureTransition("paste-ticket");
  render();
  if (!locked) void runCaptureWorkMatch(workTitle);
  void refreshCaptureHistoryFlag();
  return true;
}

/**
 * 捕获流程里的作品匹配。
 *
 * R6 补丁 10：原来叫 runCaptureBangumiMatch，**只搜 Bangumi**。
 * 当初那样写是因为最早只接了一个源、且用户以看动画电影为主，先拿一个源试效果。
 * 但只要看真人电影，Bangumi 常常根本没有条目，用户就卡在"匹配不到"——
 * 而这正是引入 TMDB 要解决的问题。现在与片单那套走**同一条**统一搜索：
 * 本地 + Bangumi + TMDB 并行，任一源失败不阻塞另一个。
 *
 * @param {string} query
 */
async function runCaptureWorkMatch(query) {
  const ctx = state.captureContext;
  if (!ctx || ctx.lockedWork || !query?.trim()) return;

  ctx.workMatch = { status: "searching", candidates: [], query, sources: null };
  renderCaptureCandidates();

  const [bangumiResult, tmdbResult] = await Promise.allSettled([
    fetchSearchSource(`/api/bangumi/search?q=${encodeURIComponent(query)}`),
    fetchSearchSource(`/api/tmdb/search?q=${encodeURIComponent(query)}`)
  ]);
  if (state.captureContext !== ctx) return;   // 用户已经离开或重新开始

  const unwrap = (settled) => settled.status === "fulfilled"
    ? settled.value
    : { state: "failed", candidates: [], error: settled.reason?.message || "网络错误" };
  const bangumiInfo = unwrap(bangumiResult);
  const tmdbInfo = unwrap(tmdbResult);

  const { local, external } = buildSearchResults({
    local: searchLocalWorks(state.works, query, { limit: 4 }),
    bangumi: bangumiInfo.candidates,
    tmdb: tmdbInfo.candidates,
    query
  });

  // 本地已有的排最前——记录一部已经在库里的片时，直接引用比重新匹配外部源更对
  const candidates = [...local, ...external].slice(0, 8);

  ctx.workMatch = {
    status: candidates.length ? "candidates" : "none",
    candidates,
    query,
    sources: {
      bangumi: { state: bangumiInfo.state, count: bangumiInfo.candidates.length, error: bangumiInfo.error },
      tmdb: { state: tmdbInfo.state, count: tmdbInfo.candidates.length, error: tmdbInfo.error }
    }
  };
  renderCaptureCandidates();
}

/**
 * 选中一条候选。统一候选可能来自本地库，也可能来自任一外部源，
 * 所以这里存的是**整条候选**，而不是像以前那样只存一个 bangumi subjectId——
 * 那样存不下 tmdb_id、海报路径这些信息，落库时就丢了。
 *
 * `subjectId` 仍然同步维护一份，是因为老代码（草稿卡海报等）还在读它。
 */
function selectCaptureCandidate(ctx, candidate) {
  ctx.selectedCandidate = candidate;
  ctx.workTitle = candidate.title;
  ctx.subjectId = candidate.externalIds?.bangumi ? Number(candidate.externalIds.bangumi) : null;
  // 选中本地已有作品 → 直接锁定，后面 finishCompose 会挂到这个 work_id 上
  ctx.workId = candidate.source === "local" ? candidate.workId : null;
}

/**
 * 候选区的稳定槽位。局部重绘只替换这个槽位的内容，**不碰输入框**。
 *
 * 注意用 data-action-name 而不是 data-action——点击分发靠
 * `closest("[data-action]")` 找触发元素，包一层带 data-action 的 div 会被误当成按钮。
 */
function captureCandidatesSlot(ctx, action, testId) {
  return `<div class="capture-candidates-slot" data-testid="capture-candidates-slot"
    data-action-name="${escapeHtml(action)}" data-slot-testid="${escapeHtml(testId)}">${captureCandidatesMarkup(ctx, action, testId)}</div>`;
}

/**
 * 只重绘候选区，不走 render()。
 *
 * 为什么必须这样：`render()` 会重建整个浮层，输入框连同**输入法的组合状态**一起被销毁。
 * 用中文输入法打「聚焦」时，拼音还没敲完（比如刚打到 "ju"）匹配就返回并重渲染，
 * 输入直接被打断——用户得和匹配进程抢速度。
 */
function renderCaptureCandidates() {
  const slot = document.querySelector("[data-testid='capture-candidates-slot']");
  if (!slot) { render(); return; }
  slot.innerHTML = captureCandidatesMarkup(
    state.captureContext || {},
    slot.dataset.actionName,
    slot.dataset.slotTestid
  );
}

/**
 * 需要整体重渲染、但当前正停在捕获流程的文本输入上时，保住焦点与光标位置。
 * 组合中（isComposing）一律推迟——组合状态没法在 DOM 重建后恢复。
 */
function renderCapturePreservingFocus() {
  const active = document.activeElement;
  const isCaptureInput = active && (active.id === "scene-work-title-input" || active.id === "capture-manual-title-input");
  if (!isCaptureInput) { render(); return; }
  if (imeComposing) return;   // 组合中绝不重建 DOM
  const { id, value, selectionStart, selectionEnd } = active;
  render();
  const restored = document.getElementById(id);
  if (!restored) return;
  restored.value = value;
  restored.focus();
  try { restored.setSelectionRange(selectionStart, selectionEnd); } catch (_) { /* 某些输入类型不支持 */ }
}

/**
 * 调度一次防抖的作品匹配。
 *
 * 防抖从 400ms 提到 500ms：中文输入法下一个词往往要敲 3–6 个字母，
 * 加上 compositionend 才触发，500ms 更贴近"打完一个词停一下"的真实节奏，
 * 也少打几次外部 API。
 */
function scheduleCaptureTitleMatch(value) {
  if (!state.captureContext || state.captureContext.lockedWork) return;
  state.captureContext.workTitle = value;
  clearTimeout(sceneTitleMatchTimer);
  const query = String(value || "").trim();
  if (query.length < 2) return;
  sceneTitleMatchTimer = setTimeout(() => {
    void runCaptureWorkMatch(query);
    void refreshCaptureHistoryFlag();
  }, 500);
}

/** 候选列表的公共渲染（捕获流程的两个面板共用）。 */
function captureCandidatesMarkup(ctx, action, testId) {
  const match = ctx.workMatch || { status: "idle", candidates: [] };
  if (match.status === "searching") {
    return `<p class="capture-match-note">正在从数据库匹配…</p>`;
  }
  if (!match.candidates?.length) {
    return match.status === "none"
      ? `<p class="capture-match-note" data-testid="${testId}-empty">没有匹配到条目，直接用你填的片名保存也可以。</p>`
      : "";
  }
  const selected = ctx.selectedCandidate;
  return `<div class="work-candidates" data-testid="${testId}">
    ${match.sources ? `<p class="work-search-sources">${summarizeSearchSources(match.sources)
      .map((item) => `<span class="source-chip tone-${item.tone}">${escapeHtml(item.text)}</span>`).join("")}</p>` : ""}
    ${match.candidates.map((c, i) => {
      const isSelected = selected && selected.source === c.source && String(selected.sourceId) === String(c.sourceId);
      const badge = c.source === "local"
        ? `<span class="work-search-item-source">已在库中</span>`
        : `<span class="work-search-item-source src-${escapeHtml(c.source)}">${escapeHtml(SOURCE_DISPLAY[c.source] || c.source)}</span>`;
      return `<button type="button" class="work-candidate ${isSelected ? "selected" : ""}" data-action="${action}" data-index="${i}">
        <b>${escapeHtml(c.title)}${badge}</b>
        <span>${escapeHtml([c.year || null, c.originalTitle].filter(Boolean).join(" · "))}</span>
      </button>`;
    }).join("")}
  </div>`;
}

/**
 * 判断当前捕获上下文对应的作品是否已有历史观影记录——只有这样才展示初看/重看选择器。
 * 用 resolveWork 做只读试探（不落库），不新建 work，也不影响 state.works。
 */
async function refreshCaptureHistoryFlag() {
  const ctx = state.captureContext;
  if (!ctx) return;
  // Work 已锁定时直接用它，不再按标题模糊反查——那有可能撞到另一部同名作品，
  // 把别人的观影次数算到这次头上。
  let work = ctx.lockedWork && ctx.workId ? findWorkById(state.works, ctx.workId) : null;
  if (!work) {
    const title = ctx.workTitle;
    if (!title?.trim()) { ctx.hasHistory = false; ctx.existingHistoryCount = 0; renderCapturePreservingFocus(); return; }
    const resolved = resolveWork(state.works, { title, subjectId: ctx.subjectId, aliases: [] });
    if (resolved.isNew) { ctx.hasHistory = false; ctx.existingHistoryCount = 0; renderCapturePreservingFocus(); return; }
    work = resolved.work;
  }
  const events = await fetchWorkEvents(work.id); // 含 merged_from——否则合并过的作品会被误判成"第一次看"
  if (state.captureContext !== ctx) return;
  ctx.hasHistory = events.length > 0;
  ctx.existingHistoryCount = events.length;
  renderCapturePreservingFocus();
}

async function updateRecord(mutator) {
  const record = currentRecord();
  if (!record) return;
  mutator(record);
  record.updatedAt = new Date().toISOString();
  await db.put("records", record);
}

async function persistInterviewAnswer(status = "answered") {
  clearTimeout(state.interviewSaveTimer);
  const input = document.querySelector("#interview-answer-input");
  const questionId = input?.dataset.questionId || SELF_INTERVIEW_QUESTIONS[state.interviewQuestionIndex]?.id;
  const text = input?.value || "";
  if (!questionId) return;
  await updateRecord((record) => {
    const existing = record.self_interview?.answers?.find((answer) => answer.question_id === questionId);
    const finalStatus = status === "answered" && text.trim() ? "answered" : "skipped";
    const finalText = finalStatus === "answered" ? text : "";
    if (existing?.status === finalStatus && existing.answer_text === finalText) return;
    record.self_interview = saveInterviewAnswer(record.self_interview, questionId, finalText, finalStatus);
    markAnalysesStale(record);
  });
}

function formalizeDraftCard(card, record, { keepCoreSuggestion = true } = {}) {
  const hasCore = record.cards.some((item) => item.is_core);
  return cardLifecycleFromLegacy({
    ...card,
    card_id: createId("card"),
    is_core: keepCoreSuggestion && !hasCore && Boolean(card.is_core),
    order: record.cards.length,
    provenance: card.user_modified ? "user_modified" : "user_accepted",
    origin: "ai_generated",
    status: "confirmed",
    user_modified: Boolean(card.user_modified)
  }, card.analysis_id);
}

function archiveActiveAnalysis(record, status) {
  if (!record.activeAnalysisDraft) return;
  record.analysis_history ||= [];
  record.analysis_history.push({ ...record.activeAnalysisDraft, status });
  record.activeAnalysisDraft = null;
}

function applyActiveAnalysisDraft(record, { replaceCards = false } = {}) {
  const draft = record.activeAnalysisDraft;
  if (!draft) return;
  if (replaceCards) record.cards = [];
  for (const card of draft.memory_cards || []) record.cards.push(formalizeDraftCard(card, record));
  record.cards.forEach((card, index) => { card.order = index; });
  if (!record.attitudeProvenance) {
    record.attitudeSuggestion = draft.attitude?.suggested || null;
    record.attitudeSuggestionDetails = draft.attitude || null;
  }
  record.emotions = draft.emotions || [];
  archiveActiveAnalysis(record, replaceCards ? "confirmed_replacement" : "confirmed_addition");
  record.status = "confirmed";
  record.analysis_status = "confirmed";
  record.analysis_stale = false;
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
  const remainingTagAssignments = state.tagAssignments.filter((item) => !(item.target_type === "viewing" && item.target_id === record.id));
  await persistTagState(pruneOrphanUserTags(state.tags, remainingTagAssignments), remainingTagAssignments);
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
async function hydrateRecordViewingEvents(recordId, { renderAfter = true } = {}) {
  const record = state.records.find((r) => r.id === recordId);
  const recordWorkId = record?.work_id || record?.workId;
  if (!record || !recordWorkId) return [];

  let events = await fetchWorkEvents(recordWorkId);
  const linkedEvent = viewingEventsForRecord(record, events)[0];
  // 兼容曾经被“直接跳过”保存、因此完全没有 ViewingEvent 的记录。补一张待确认卡，
  // 但只有正式关联真的不存在时才补，刷新绝不能覆盖已经填写好的影院/日期。
  if (record.record_kind !== "supplement" && !linkedEvent) {
    const pending = {
      ...buildPendingViewingEvent(),
      work_id: recordWorkId,
      record_id: record.id,
      confirmed_at: new Date().toISOString(),
      status: "confirmed"
    };
    await db.putViewingEvents([pending]);
    record.viewing_event_id = pending.id;
    await db.put("records", record);
    events = [...events, pending];
    await indexHomeCardData();
  }
  if (state.activeRecordId === recordId && state.view === "detail") {
    state.viewingEvents = events;
    if (renderAfter) renderPreservingScroll();
  }
  return events;
}

async function openRecord(recordId) {
  applyRoute(routeEnterRecord(routeSnapshot(), recordId, { scrollY }));
  state.viewingEvents = [];
  const historyPayload = { view: "detail", recordId, from: state.detailReturnView, workId: state.currentWorkId };
  history.pushState(historyPayload, "", `#record=${encodeURIComponent(recordId)}`);
  render();
  scrollTo(0, 0);
  await hydrateRecordViewingEvents(recordId);
}

/** 详情页返回：按 detailReturnView 回时间线或作品页，恢复对应视图当时的滚动位置。 */
// R5 补丁 5：默认 replace。之前每次"返回"都 pushState，历史栈里塞满了往返记录，
// 用户用系统的右往左返回手势时就会在 片单/作品页/时间线 之间来回跳——
// 看起来"无规律"，其实是在倒放自己走过的每一步。返回动作只替换当前条目即可。
function leaveDetail({ replace = true } = {}) {
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
  history.replaceState({}, "", location.pathname + location.search);
  render();
  requestAnimationFrame(() => scrollTo({ top: state.returnScrollY, behavior: "instant" }));
}

/** R4：作品书架 → 作品页。 */
function openWork(workId) {
  state.workReturnView = ["tag", "series"].includes(state.view) ? state.view : "shelf";
  applyRoute(routeEnterWork(routeSnapshot(), workId, { scrollY }));
  state.currentWorkEvents = [];
  state.currentWorkPublications = [];
  history.pushState({ view: "work", workId }, "", `#work=${encodeURIComponent(workId)}`);
  render();
  scrollTo(0, 0);
  loadWorkPageData(workId);
}

/** R4：作品页 → 作品书架（本窗口里作品页只能从书架进入，所以固定回书架）。 */
function closeWork() {
  if (state.workReturnView === "tag" && state.currentTagId) {
    state.view = "tag";
    state.currentWorkId = null;
    history.replaceState({ view: "tag", tagId: state.currentTagId }, "", `#tag=${encodeURIComponent(state.currentTagId)}`);
    render();
    return;
  }
  if (state.workReturnView === "series" && state.currentSeriesId) {
    state.view = "series";
    state.currentWorkId = null;
    history.replaceState({ view: "series", seriesId: state.currentSeriesId }, "", `#series=${encodeURIComponent(state.currentSeriesId)}`);
    render();
    return;
  }
  applyRoute(routeExitWork(routeSnapshot()));
  history.replaceState({ view: "shelf" }, "", "#shelf");
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
  state.seriesFilter = "all";
  state.editingSeriesMemberId = null;
  state.view = "series";
  state.overlay = null;
  history.pushState({ view: "series", seriesId }, "", `#series=${encodeURIComponent(seriesId)}`);
  render();
  scrollTo(0, 0);
}

function closeSeries() {
  if (state.seriesReturnView === "work" && state.currentWorkId) {
    state.view = "work";
    history.replaceState({ view: "work", workId: state.currentWorkId }, "", `#work=${encodeURIComponent(state.currentWorkId)}`);
    render();
    requestAnimationFrame(() => scrollTo({ top: state.workScrollY, behavior: "instant" }));
    return;
  }
  openShelf();
}

function openCollections({ replace = false } = {}) {
  const back = replace || state.view === "collection";
  state.view = "collections";
  state.overlay = null;
  state.currentCollectionId = null;
  const payload = { view: "collections" };
  if (back) history.replaceState(payload, "", "#collections");
  else history.pushState(payload, "", "#collections");
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

function openTags({ replace = false } = {}) {
  state.view = "tags";
  state.overlay = null;
  state.currentTagId = null;
  const payload = { view: "tags" };
  if (replace) history.replaceState(payload, "", "#tags");
  else history.pushState(payload, "", "#tags");
  render();
  scrollTo(0, 0);
}

function openTag(tagId, { replace = false } = {}) {
  if (!state.tags.some((tag) => tag.id === tagId)) return;
  state.view = "tag";
  state.currentTagId = tagId;
  state.overlay = null;
  state.tagSort = "attitude";
  const payload = { view: "tag", tagId };
  if (replace) history.replaceState(payload, "", `#tag=${encodeURIComponent(tagId)}`);
  else history.pushState(payload, "", `#tag=${encodeURIComponent(tagId)}`);
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
  const eventPool = state.view === "detail" ? (state.viewingEvents || []) : (state.currentWorkEvents || []);
  const target = eventPool.find((event) => event.id === eventId);
  if (!target) return;

  const data = new FormData(form);
  const locationValue = String(data.get("locationType") || "");
  if (!["home", "cinema"].includes(locationValue)) return;
  const locationType = locationValue;
  const viewedOn = String(data.get("viewedOn") || "").trim();
  if (!viewedOn) return;
  const screeningTime = String(data.get("screeningTime") || "").trim();
  const screeningAt = screeningTime ? localDateTimeInputToIso(`${viewedOn}T${screeningTime}`) : null;
  const eventTypes = locationType === "cinema" ? [...new Set(data.getAll("eventTypes").map(String))] : [];
  const bonusNoteInput = String(data.get("bonusNote") || "").trim() || null;
  const chosenRelation = ["first", "rewatch"].includes(data.get("relation")) ? data.get("relation") : null;

  // R5 补丁 6：票价与张数。留空表示"没有票价信息"，写 null 而不是 0。
  const amountRaw = String(data.get("ticketAmount") || "").trim();
  const amountNum = amountRaw === "" ? null : Number(amountRaw);
  const ticketCurrency = data.get("ticketCurrency") === "CNY" ? "CNY" : "JPY";
  const countNum = Math.max(1, Number(data.get("ticketCount")) || 1);
  const ticketPrice = locationType === "cinema" && Number.isFinite(amountNum) && amountNum > 0
    ? { amount: amountNum, currency: ticketCurrency, count: countNum }
    : null;

  const updatedUnlocked = {
    ...target,
    location_type: locationType,
    viewed_on: viewedOn,
    screening_at: screeningAt,
    screening_ends_at: screeningAt === target.screening_at ? target.screening_ends_at : null,
    duration_minutes: screeningAt === target.screening_at ? target.duration_minutes : null,
    ticket_price: ticketPrice,
    viewing_context: {
      ...target.viewing_context,
      cinema_name: locationType === "cinema" ? (String(data.get("cinemaName") || "").trim() || null) : null,
      auditorium: locationType === "cinema" ? (String(data.get("auditorium") || "").trim() || null) : null,
      city: locationType === "cinema" ? (target.viewing_context?.city || null) : null,
      version: String(data.get("version") || "").trim() || null,
      format: locationType === "cinema" ? (String(data.get("format") || "").trim() || null) : null,
      format_note: locationType === "cinema" ? (String(data.get("formatNote") || "").trim() || null) : null,
      is_3d: locationType === "cinema" && data.get("is3D") === "true",
      seats: locationType === "cinema" ? (target.viewing_context?.seats || []) : [],
      seat_count: locationType === "cinema" ? (target.viewing_context?.seat_count || 0) : 0,
      ticket_provider: locationType === "cinema" ? (target.viewing_context?.ticket_provider || null) : null,
      ticket_type: locationType === "cinema" ? (target.viewing_context?.ticket_type || null) : null,
      language: locationType === "cinema" ? (String(data.get("language") || "").trim() || null) : null,
      ticket_count: locationType === "cinema" ? countNum : null,
      event_types: eventTypes,
      bonus_note: eventTypes.includes("bonus_distribution") ? bonusNoteInput : null
    },
    needs_review: false,
    source: target.source === "ticket_paste" ? target.source : "manual",
    relation_locked: false
  };
  delete updatedUnlocked.relation_conflict;

  const naturalPass = assignViewingRelations(eventPool.map((event) => (event.id === eventId ? updatedUnlocked : event)));
  const naturalRelation = naturalPass.find((event) => event.id === eventId)?.viewing_relation;
  const finalDraft = chosenRelation && chosenRelation !== naturalRelation
    ? { ...updatedUnlocked, viewing_relation: chosenRelation, relation_locked: true }
    : updatedUnlocked;

  const finalEvents = assignViewingRelations(eventPool.map((event) => (event.id === eventId ? finalDraft : event)));
  await db.putViewingEvents(finalEvents);
  if (state.view === "detail") state.viewingEvents = finalEvents;
  if (state.currentWorkEvents.some((event) => event.id === eventId)) state.currentWorkEvents = finalEvents;
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

async function linkBangumiPosterCandidate(candidate) {
  const work = findWorkById(state.works, state.currentWorkId);
  const subjectId = Number(candidate?.subjectId);
  if (!work || !Number.isInteger(subjectId) || subjectId <= 0) return;

  const duplicate = findWorkByExternalRef(state.works, "bangumi", subjectId);
  if (duplicate && duplicate.id !== work.id) {
    state.bangumiPosterLink = {
      workId: work.id,
      status: "error",
      candidates: [],
      error: `这个 Bangumi 条目已经关联《${duplicate.title || "另一部作品"}》`
    };
    render();
    return;
  }

  const updated = await updateCurrentWork((current) => ({
    ...current,
    external_refs: upsertExternalRef(current.external_refs, {
      source: "bangumi",
      id: subjectId,
      url: candidate.url
    }),
    identity_status: "matched",
    primary_source: current.primary_source || "bangumi"
  }));
  state.bangumiPosterLink = { workId: work.id, status: "idle", candidates: [], error: null };
  if (updated) await syncBangumiDirectorsForWork(updated);
  render();
  showToast("已追加 Bangumi 关联");
}

async function searchBangumiForPosterLink() {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work || externalRefId(work, "bangumi")) return;
  state.bangumiPosterLink = { workId: work.id, status: "loading", candidates: [], error: null };
  render();
  try {
    const result = await fetchSearchSource(`/api/bangumi/search?q=${encodeURIComponent(work.title || "")}`);
    if (result.state !== "ok") throw new Error(result.error || "Bangumi 暂时不可用");
    const exact = uniqueBangumiLinkCandidate(work, result.candidates);
    if (exact) {
      await linkBangumiPosterCandidate(exact);
      return;
    }
    state.bangumiPosterLink = {
      workId: work.id,
      status: result.candidates.length ? "ready" : "error",
      candidates: result.candidates.slice(0, 5),
      error: result.candidates.length ? null : "没有找到可关联的 Bangumi 条目"
    };
  } catch (error) {
    state.bangumiPosterLink = {
      workId: work.id,
      status: "error",
      candidates: [],
      error: String(error.message || error)
    };
  }
  if (state.overlay === "poster" && state.currentWorkId === work.id) render();
}

async function loadPosterChoices({ force = false } = {}) {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return;
  const tmdbId = externalRefId(work, "tmdb");
  if (!tmdbId) {
    state.posterEditor = { workId: work.id, status: "ready", tmdbChoices: [], error: null };
    render();
    return;
  }
  if (!force && state.posterEditor.workId === work.id && state.posterEditor.status === "ready") return;

  state.posterEditor = { workId: work.id, status: "loading", tmdbChoices: [], error: null };
  render();
  try {
    const response = await apiFetch(`/api/tmdb/movie?id=${encodeURIComponent(tmdbId)}`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.detail) throw new Error(payload?.message || "暂时拿不到 TMDB 海报");
    state.posterEditor = {
      workId: work.id,
      status: "ready",
      tmdbChoices: Array.isArray(payload.detail.posterChoices) ? payload.detail.posterChoices.slice(0, 3) : [],
      error: null
    };
  } catch (error) {
    state.posterEditor = { workId: work.id, status: "error", tmdbChoices: [], error: error.message };
  }
  if (state.overlay === "poster" && state.currentWorkId === work.id) render();
}

/**
 * 旧版可能已经把 TMDB 搜索响应里随 zh-CN 返回的 poster_path 落了库。
 * 首次打开作品页时用详情接口纠正一次；用户明确手选过的海报永远跳过。
 */
async function ensureRegionalPoster(workId) {
  const work = findWorkById(state.works, workId);
  const tmdbId = externalRefId(work, "tmdb");
  if (!work || !tmdbId || work.poster_rule_version >= 2 || work.poster?.selected_by === "user") return;
  try {
    const response = await apiFetch(`/api/tmdb/movie?id=${encodeURIComponent(tmdbId)}`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.detail) return;
    const current = findWorkById(state.works, workId);
    if (!current || current.poster?.selected_by === "user") return;
    const updated = {
      ...current,
      poster: payload.detail.posterPath ? { source: "tmdb", path: payload.detail.posterPath } : current.poster,
      poster_rule_version: 2
    };
    await db.put("works", updated);
    state.works = state.works.map((item) => (item.id === updated.id ? updated : item));
    state.worksById.set(updated.id, updated);
    if (state.view === "work" && state.currentWorkId === workId) renderPreservingScroll();
  } catch (_) { /* 网络失败时保留当前海报，下次进入作品页再试 */ }
}

async function selectPosterReference(source, value) {
  const selectedAt = new Date().toISOString();
  const poster = source === "bangumi"
    ? { source, subject_id: Number(value) || null, selected_by: "user", selected_at: selectedAt }
    : source === "tmdb"
      ? { source, path: value, selected_by: "user", selected_at: selectedAt }
      : null;
  if (!workPosterRef({ poster })) return;
  await updateCurrentWork((work) => ({ ...work, poster, poster_rule_version: 2 }));
  render();
  showToast("海报已更新");
}

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

async function optimizePosterUpload(file) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!file || !allowed.has(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.size > 12 * 1024 * 1024) throw new Error("原图请不要超过 12 MB");

  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1200 / bitmap.width, 1800 / bitmap.height);
    let output = null;
    for (const quality of [0.86, 0.78, 0.7]) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#101415";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      output = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (output && output.size <= 1_200_000) break;
      scale *= 0.78;
    }
    if (!output || output.size > 1_500_000) throw new Error("图片压缩后仍然过大，请换一张尺寸较小的图");
    return blobAsDataUrl(output);
  } finally {
    bitmap.close?.();
  }
}

async function saveUploadedPoster(file) {
  try {
    const dataUrl = await optimizePosterUpload(file);
    const poster = {
      source: "upload",
      data_url: dataUrl,
      selected_by: "user",
      selected_at: new Date().toISOString(),
      filename: String(file.name || "poster").slice(0, 120)
    };
    await updateCurrentWork((work) => ({ ...work, poster, poster_rule_version: 2 }));
    render();
    showToast("上传的海报已保存");
  } catch (error) {
    showToast(error.message || "海报上传失败");
  }
}

async function loadTmdbStillCandidates({ force = false } = {}) {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work) return;
  const tmdbId = externalRefId(work, "tmdb");
  if (!tmdbId) return;
  if (!force && state.stillCandidates.workId === work.id && state.stillCandidates.status === "ready") return;

  state.stillCandidates = { workId: work.id, status: "loading", items: [], error: null };
  render();
  try {
    const response = await apiFetch(`/api/tmdb/movie?id=${encodeURIComponent(tmdbId)}`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.detail) throw new Error(payload?.message || "暂时拿不到候选剧照");
    state.stillCandidates = {
      workId: work.id,
      status: "ready",
      items: Array.isArray(payload.detail.backdrops) ? payload.detail.backdrops : [],
      error: null
    };
  } catch (error) {
    state.stillCandidates = { workId: work.id, status: "error", items: [], error: String(error.message || "暂时拿不到候选剧照") };
  }
  if (state.overlay === "stills" && state.currentWorkId === work.id) render();
}

async function searchTmdbForStills(query) {
  const work = findWorkById(state.works, state.currentWorkId);
  const normalizedQuery = String(query || "").trim();
  if (!work || !normalizedQuery || externalRefId(work, "tmdb")) return;
  state.tmdbStillLink = { workId: work.id, status: "loading", query: normalizedQuery, candidates: [], error: null };
  render();
  try {
    const result = await fetchSearchSource(`/api/tmdb/search?q=${encodeURIComponent(normalizedQuery)}`);
    if (result.state === "unconfigured") throw new Error("TMDB 尚未配置");
    if (result.state !== "ok") throw new Error(result.error || "搜索失败，请稍后重试");
    state.tmdbStillLink = {
      workId: work.id,
      status: "ready",
      query: normalizedQuery,
      candidates: result.candidates,
      error: null
    };
  } catch (error) {
    state.tmdbStillLink = { workId: work.id, status: "error", query: normalizedQuery, candidates: [], error: String(error.message || error) };
  }
  if (state.overlay === "stills" && state.currentWorkId === work.id) render();
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

// ─── R6 补丁 12：刷新作品资料 / 删除作品 ────────────────────────────────────

/**
 * 刷新作品资料。
 *
 * 这才是「已有作品想用上新的海报规则」该走的入口——**删掉重建是错的**：
 * 那会丢掉 first_recorded_at（作品进入你记忆系统的时间）、片单条目与加入理由，
 * 而且重新导入会生成新的 Work ID，片单里那条 entry 指向的旧 id 当场失效。
 * R6 把 Work ID 做成永久不变，正是为了让"更新资料"不必动身份。
 *
 * 保住的：id、first_recorded_at、merged_from、tagline、手动认领的作品类型
 *（「活动」「其他」只可能来自手动认领，见 applyCandidateToWork）、
 * 全部 Record / ViewingEvent / 片单条目。
 * 更新的：标题与别名、上映日、时长、类型标签、简介、external ids、**海报**。
 */
async function refreshWorkMetadata() {
  const work = findWorkById(state.works, state.currentWorkId);
  if (!work || state.workRefreshBusy) return;

  const tmdbId = externalRefId(work, "tmdb");
  const bangumiId = externalRefId(work, "bangumi");
  if (!tmdbId && !bangumiId) {
    showToast("这部作品还没有关联外部条目，先在感想详情页匹配一次");
    return;
  }

  state.workRefreshBusy = true;
  renderPreservingScroll();

  try {
    let candidate = null;

    // TMDB 优先：它的详情能一次带回 images，按发行地区重挑海报靠的就是这个
    if (tmdbId) {
      const response = await apiFetch(`/api/tmdb/movie?id=${encodeURIComponent(tmdbId)}`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      const detail = payload?.detail;
      if (response.ok && detail) {
        candidate = {
          source: "tmdb",
          sourceId: String(detail.tmdbId),
          title: detail.title,
          originalTitle: detail.originalTitle,
          releaseDate: detail.releaseDate,
          year: detail.year,
          workType: detail.workType,
          posterRef: detail.posterPath ? { source: "tmdb", path: detail.posterPath } : null,
          posterRuleVersion: 2,
          summary: detail.summary,
          runtimeMinutes: detail.runtimeMinutes,
          genres: detail.genres,
          externalIds: {
            ...(detail.externalIds?.imdb ? { imdb: detail.externalIds.imdb } : {}),
            ...(detail.externalIds?.wikidata ? { wikidata: detail.externalIds.wikidata } : {})
          }
        };
      }
    }

    if (!candidate && bangumiId) {
      const response = await apiFetch(`/api/bangumi/subject?id=${encodeURIComponent(bangumiId)}`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.subjectId) {
        candidate = {
          source: "bangumi",
          sourceId: String(payload.subjectId),
          title: payload.title,
          originalTitle: payload.originalTitle,
          releaseDate: payload.date,
          posterRef: { source: "bangumi", subject_id: Number(payload.subjectId) || null },
          summary: payload.summary
        };
      }
    }

    if (!candidate) {
      state.workRefreshBusy = false;
      renderPreservingScroll();
      showToast("暂时拿不到最新资料，稍后再试");
      return;
    }

    const updated = applyCandidateToWork(work, candidate, { overwritePoster: true });
    await db.put("works", updated);
    state.works = state.works.map((item) => (item.id === updated.id ? updated : item));
    state.worksById.set(updated.id, updated);
    await syncBangumiDirectorsForWork(updated);
    state.workRefreshBusy = false;
    renderPreservingScroll();
    showToast("作品资料已刷新");
  } catch (error) {
    state.workRefreshBusy = false;
    renderPreservingScroll();
    showToast(`刷新失败：${error.message}`);
  }
}

/**
 * 删除作品前的影响面统计。删除是不可撤销的，UI 必须先把代价说清楚。
 */
function workDeletionImpact(work) {
  if (!work) return null;
  const ids = new Set([work.id, ...(work.merged_from || [])]);
  const records = state.records.filter((record) => ids.has(record.work_id || record.workId));
  const events = (state.allViewingEvents || []).filter((event) => ids.has(event.work_id));
  const collections = state.collections.filter((collection) =>
    collectionEntries(collection).some((entry) => ids.has(entry.work_id))
  );
  const reasons = collections.flatMap((collection) =>
    collectionEntries(collection).filter((entry) => ids.has(entry.work_id) && entry.reason).map((entry) => entry.reason)
  );
  const publications = state.currentWorkPublications.filter((item) => ids.has(item.work_id));
  return { records, events, collections, reasons, publications, series: findSeriesForWork(state.series, work.id) };
}

/**
 * 执行删除。
 *
 * 连带规则（用户拍板）：
 * - **有感想就不许删**，提示先去删记录。作品资料删了能从 TMDB / Bangumi 重新拿，
 *   感想是你自己写的、不可再生——让"删作品"这个动作具备顺手清掉感想的能力，
 *   风险不对等。
 * - ViewingEvent 跟着删：它只有挂在 Work 上才有意义，留下就是孤儿。
 * - 片单条目跟着移除（加入理由会一起没），确认框里会先列出来。
 * - 系列成员身份一并移除。
 * - **物理删除，不留墓碑标记**：R1 与 R6 各因为"留下没清理干净的旧行"出过一次
 *   幽灵条目，再引入软删除是同一个坑。JSON 导出已经承担备份角色。
 */
async function performWorkDeletion() {
  const work = findWorkById(state.works, state.currentWorkId);
  const impact = workDeletionImpact(work);
  if (!work || !impact) return;
  if (impact.records.length) return;   // UI 已经挡住，这里是最后一道保险

  const ids = [work.id, ...(work.merged_from || [])];

  for (const collection of impact.collections) {
    let next = collection;
    for (const id of ids) next = removeWorkFromCollection(next, id);
    await persistCollection(next);
  }

  if (impact.series) {
    let next = impact.series;
    for (const id of ids) next = removeWorkFromSeries(next, id);
    await persistSeries(next);
  }

  for (const event of impact.events) {
    await db.delete("viewingEvents", event.id).catch(() => {});
  }
  const storedPublications = await db.getAll("externalPublications").catch(() => impact.publications);
  for (const publication of storedPublications.filter((item) => ids.includes(item.work_id))) {
    await db.delete("externalPublications", publication.id).catch(() => {});
  }

  const remainingTagAssignments = state.tagAssignments.filter((item) => !(item.target_type === "work" && ids.includes(item.target_id)));
  await persistTagState(pruneOrphanUserTags(state.tags, remainingTagAssignments), remainingTagAssignments);

  await db.delete("works", work.id).catch(() => {});
  for (const id of work.merged_from || []) await db.delete("works", id).catch(() => {});

  state.works = state.works.filter((item) => item.id !== work.id);
  state.worksById.delete(work.id);
  state.overlay = null;
  state.deleteWorkConfirm = "";
  await indexHomeCardData();
  closeWork();
  showToast(`已删除《${work.title}》`);
}

// ─── R6 补丁 5：TMDB 诊断 ───────────────────────────────────────────────────

async function runTmdbDiagnostic() {
  if (state.tmdbDiagnostic.status === "running") return;
  state.tmdbDiagnostic = { status: "running", payload: null, error: null };
  render();

  try {
    // apiFetch 会自动带上访问密码（localStorage 里的 mi_access_password），
    // 所以用户不需要自己拼 Authorization 头。
    const response = await apiFetch("/api/tmdb/status?probe=1", { headers: { accept: "application/json" } });
    if (response.status === 404) {
      state.tmdbDiagnostic = { status: "done", payload: null, error: null };
      render();
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    state.tmdbDiagnostic = { status: "done", payload, error: null };
  } catch (error) {
    state.tmdbDiagnostic = { status: "error", payload: null, error: error.message };
  }
  render();
}

async function copyTmdbDiagnostic() {
  const text = JSON.stringify(state.tmdbDiagnostic.payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast("诊断结果已复制");
  } catch (_) {
    showToast("复制失败，可以手动选中上面的原始数据");
  }
}

// ─── R6 补丁：清空所有数据 ───────────────────────────────────────────────────

/**
 * 执行清库。
 *
 * 三件事都要做，缺一件都会留下"数据没真的清干净"的观感：
 * 1. 云端 D1（开了同步才有）与本机 IndexedDB —— 由 db.clearAllData 保证两边都清；
 * 2. Service Worker 的缓存（shell 与海报）—— 否则清完之后旧海报还会从缓存里冒出来；
 * 3. 重新加载页面 —— 内存里有二十多个 state 字段、路由栈、渲染缓存，逐个手动重置
 *    既冗长又容易漏。直接重载到干净地址最稳，也顺便满足"清完回到 App 正常入口，
 *    不停留在特殊 URL"。
 *
 * 全程 try/catch：清库失败必须让用户看见原因，而不是把页面搞成一片空白
 * （那正是旧的 `?reset` 顶层 await 会造成的结果）。
 */
async function performDataReset() {
  if (state.resetBusy) return;
  state.resetBusy = true;
  state.resetMessage = null;
  render();

  let result;
  try {
    result = await clearAllData();
  } catch (error) {
    state.resetBusy = false;
    state.resetMessage = `清空失败：${error.message}。数据没有被改动。`;
    render();
    return;
  }

  // Service Worker 缓存：清不掉也不算致命，只是旧海报可能残留一阵，
  // 所以单独 catch，不让它影响主流程的成功判定。
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.error("[reset] Service Worker 缓存清理失败:", error.message);
  }

  if (!result.local || result.cloud === "failed") {
    state.resetBusy = false;
    state.resetMessage = [
      result.local ? "本机数据已清空。" : "本机数据清空失败。",
      result.cloud === "failed" ? `云端清空失败（${result.cloudError || "未知原因"}），请检查同步密码或稍后重试。` : ""
    ].filter(Boolean).join("");
    render();
    return;
  }

  showToast(result.cloud === "cleared" ? "本机与云端数据已清空" : "本机数据已清空");
  // 留一拍让 toast 能被看到，然后重载到干净地址（去掉任何 hash / 查询串）
  setTimeout(() => location.replace(location.origin + location.pathname), 700);
}

// ─── R6：统一作品搜索 + 一次完成的片单添加 ───────────────────────────────────

let workSearchTimer = null;
let workSearchToken = 0;

function openWorkSearch() {
  state.workSearch = { query: "", local: [], external: [], status: "idle", sources: null, selected: null, sourceFilter: null };
  state.overlay = "work-search";
  render();
  requestAnimationFrame(() => document.querySelector("#work-search-input")?.focus());
}

/** 本地搜索：零延迟，不等网络。命中标题或任一别名（别名里存着各语言标题变体）。 */
function currentLocalCandidates(query) {
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);
  return searchLocalWorks(state.works, query, {
    isInCollection: (workId) => (collection ? collectionHasWork(collection, workId) : false)
  });
}

/**
 * 输入变化时的搜索调度。
 *
 * 本地结果立刻出（同步过滤内存数组，0 延迟）；外部数据源走 350ms debounce ——
 * 绝不能每敲一个字符就同时打两个外部 API（R6 §11）。少于 2 个字符不发外部请求。
 */
function handleWorkSearchInput(value) {
  const query = value || "";
  state.workSearch.query = query;
  state.workSearch.selected = null;
  state.workSearch.local = currentLocalCandidates(query);
  state.workSearch.external = [];
  // 上一次的数据源状态跟着作废——否则改了查询词之后，状态行还挂着旧一轮的条数
  state.workSearch.sources = null;
  state.workSearch.sourceFilter = null;

  clearTimeout(workSearchTimer);
  // token 让过期的请求结果直接作废：用户继续打字后，先发出的那次请求即使晚回来
  // 也不会把已经过时的候选写进 state。
  const token = ++workSearchToken;

  if (query.trim().length < 2) {
    state.workSearch.status = "idle";
    renderWorkSearchResults();
    return;
  }

  state.workSearch.status = "loading";
  renderWorkSearchResults();
  workSearchTimer = setTimeout(() => { void runExternalWorkSearch(query, token); }, 350);
}

/**
 * 并行请求 Bangumi 与 TMDB。
 *
 * 用 allSettled 而不是 all：**任一数据源失败不阻塞另一个**（R6 §11）。
 * Bangumi 挂了照样能看到 TMDB 的结果，反之亦然，只在提示条里说明哪个源暂时不可用。
 * 不做「该搜哪个源」的启发式判断——猜错的代价是"搜不到"，这是最糟的体验；
 * 两个源的差异只体现在 sortExternalCandidates 的排序权重上。
 */
async function runExternalWorkSearch(query, token) {
  const [bangumiResult, tmdbResult] = await Promise.allSettled([
    fetchSearchSource(`/api/bangumi/search?q=${encodeURIComponent(query)}`),
    fetchSearchSource(`/api/tmdb/search?q=${encodeURIComponent(query)}`)
  ]);
  if (token !== workSearchToken || state.overlay !== "work-search") return;

  // allSettled 的 rejected 只剩下"网络层直接抛错"（断网、超时）这一类；
  // HTTP 层的失败与未配置已经在 fetchSearchSource 里转成了 state。
  const unwrap = (settled) => settled.status === "fulfilled"
    ? settled.value
    : { state: "failed", candidates: [], error: settled.reason?.message || "网络错误" };

  const bangumiInfo = unwrap(bangumiResult);
  const tmdbInfo = unwrap(tmdbResult);

  const { local, external } = buildSearchResults({
    local: currentLocalCandidates(query),
    bangumi: bangumiInfo.candidates,
    tmdb: tmdbInfo.candidates,
    query
  });

  state.workSearch.local = local;
  state.workSearch.external = external;
  state.workSearch.status = "done";
  state.workSearch.sources = {
    bangumi: { state: bangumiInfo.state, count: bangumiInfo.candidates.length, error: bangumiInfo.error },
    tmdb: { state: tmdbInfo.state, count: tmdbInfo.candidates.length, error: tmdbInfo.error }
  };
  renderWorkSearchResults();
}

async function fetchSearchSource(url) {
  const response = await apiFetch(url, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { state: "failed", candidates: [], error: payload.message || `HTTP ${response.status}` };
  }
  if (payload.configured === false) {
    return { state: "unconfigured", candidates: [] };
  }
  return { state: "ok", candidates: payload.candidates || [] };
}

/**
 * 只重绘结果区，不走 render()。
 *
 * 必须这样做：render() 会整体重写 overlay 挂载点的 HTML，输入框会被重建、
 * 焦点和输入法组合状态全部丢失——边打字边搜索的面板绝对不能走全量重渲染。
 */
function renderWorkSearchResults() {
  if (state.overlay !== "work-search") return;
  const container = document.querySelector("[data-testid='work-search-results']");
  if (!container) { render(); return; }
  const fresh = document.createElement("div");
  fresh.innerHTML = workSearchOverlay();
  const next = fresh.querySelector("[data-testid='work-search-results']");
  if (next) container.innerHTML = next.innerHTML;

  // 选中候选后要出现「为什么想看」表单；它在结果区之外，只能整块换一次。
  const sheet = container.closest(".bottom-sheet");
  const hasForm = !!sheet?.querySelector("#work-search-add-form");
  if (hasForm !== !!state.workSearch.selected) {
    const input = document.querySelector("#work-search-input");
    const caret = input?.selectionStart ?? null;
    render();
    const restored = document.querySelector("#work-search-input");
    if (restored) {
      restored.focus();
      if (caret != null) restored.setSelectionRange(caret, caret);
    }
  }
}

function selectWorkSearchCandidate(group, index) {
  // 必须和渲染时用的是同一份数组——外部组在筛选状态下渲染的是过滤后的列表，
  // 这里若用未过滤的原数组，下标会错位，点第 1 条选中的是另一部片。
  const list = group === "local"
    ? state.workSearch.local
    : filterCandidatesBySource(state.workSearch.external, state.workSearch.sourceFilter);
  const candidate = list[Number(index)];
  if (!candidate || candidate.inThisCollection) return;
  const current = state.workSearch.selected;
  const same = current && current.source === candidate.source && String(current.sourceId) === String(candidate.sourceId);
  state.workSearch.selected = same ? null : candidate;
  renderWorkSearchResults();
}

/** 用 TMDB 详情补齐搜索候选，并强制走当前的地区海报规则。 */
async function enrichTmdbCandidate(candidate) {
  if (candidate?.source !== "tmdb" || !candidate.sourceId) return candidate;
  const response = await apiFetch(`/api/tmdb/movie?id=${encodeURIComponent(candidate.sourceId)}`, {
    headers: { accept: "application/json" }
  });
  const payload = await response.json().catch(() => null);
  const detail = payload?.detail;
  if (!response.ok || !detail) return candidate;
  return {
    ...candidate,
    originalTitle: detail.originalTitle || candidate.originalTitle,
    releaseDate: detail.releaseDate || candidate.releaseDate,
    year: detail.year ?? candidate.year,
    workType: detail.workType && detail.workType !== "unspecified" ? detail.workType : candidate.workType,
    posterRef: detail.posterPath ? { source: "tmdb", path: detail.posterPath } : candidate.posterRef,
    posterRuleVersion: 2,
    posterChoices: Array.isArray(detail.posterChoices) ? detail.posterChoices : [],
    summary: detail.summary || candidate.summary,
    runtimeMinutes: detail.runtimeMinutes,
    genres: detail.genres,
    externalIds: {
      ...candidate.externalIds,
      ...(detail.externalIds?.imdb ? { imdb: detail.externalIds.imdb } : {}),
      ...(detail.externalIds?.wikidata ? { wikidata: detail.externalIds.wikidata } : {})
    }
  };
}

/**
 * 把一条候选解析成 Work：已有就引用，没有才新建。**一次完成**，不要求用户
 * 先「导入作品」再回到片单添加。
 *
 * 去重顺序与 resolveWork 一致：先按外部标识（相同 bangumi_id / tmdb_id 绝不重复
 * 建卡），再按标题与别名。
 *
 * @returns {Promise<object>} Work（可能是已存在的，也可能是刚建的）
 */
async function resolveOrCreateWorkFromCandidate(candidate) {
  if (candidate.source === "local") {
    const existing = findWorkById(state.works, candidate.workId);
    if (existing) return existing;
  }

  // TMDB 搜索结果里没有 runtime、完整 genres 和 external_ids，落库前补一次详情。
  // 这一步失败不阻断流程——拿不到详情就用搜索结果里已有的字段建卡，
  // 作品照样能进片单（R6 §13：外部 API 是 metadata source，不是 App 数据库本身）。
  let enriched = candidate;
  if (candidate.source === "tmdb") {
    try {
      enriched = await enrichTmdbCandidate(candidate);
    } catch (_) { /* 拿不到详情就用搜索结果建卡，不打断添加流程 */ }
  }

  const externalIds = { ...(enriched.externalIds || {}) };
  if (enriched.source !== "local" && enriched.sourceId) externalIds[enriched.source] = enriched.sourceId;

  const { work, isNew } = resolveWork(state.works, {
    title: enriched.title,
    aliases: [enriched.originalTitle].filter(Boolean),
    externalRefs: externalIds
  });

  if (!isNew) {
    // 已有 Work 但这次的候选带了它还没有的外部标识 —— 顺手补上，
    // 以后从另一个源搜到同一部片时就能直接命中，不会再产生重复。
    let merged = applyCandidateToWork(work, enriched, { overwritePoster: true });
    for (const [source, id] of Object.entries(externalIds)) {
      if (!id || externalRefId(merged, source)) continue;
      merged = { ...merged, external_refs: upsertExternalRef(merged.external_refs, { source, id }) };
    }
    if (merged !== work) {
      await db.put("works", merged);
      state.works = state.works.map((item) => (item.id === merged.id ? merged : item));
      state.worksById.set(merged.id, merged);
    }
    await syncBangumiDirectorsForWork(merged);
    return merged;
  }

  // 全新作品：只建 Work，**不建任何 Record / ViewingEvent**。
  // 这是「观影前」路径的核心——作品存在于 App 中，不等于用户看过它。
  const created = createWorkFromCandidate({ ...enriched, externalIds });
  await db.put("works", created);
  state.works = [...state.works, created];
  state.worksById.set(created.id, created);
  await syncBangumiDirectorsForWork(created);
  return created;
}

async function addSelectedCandidateToCollection(reason) {
  const candidate = state.workSearch.selected;
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);
  if (!candidate || !collection) return;

  const work = await resolveOrCreateWorkFromCandidate(candidate);
  await persistCollection(addWorkToCollection(collection, work.id, { reason }));

  state.overlay = null;
  state.workSearch = { query: "", local: [], external: [], status: "idle", sources: null, selected: null, sourceFilter: null };
  render();
  announce(`已把《${work.title}》加入${collection.title}`);
}

/** R6：对当前片单做一次不可变更新并落库。片单页的所有编辑都走这一个出口。 */
async function updateCurrentCollection(mutate) {
  const collection = state.collections.find((item) => item.id === state.currentCollectionId);
  if (!collection) return null;
  const updated = mutate(collection);
  if (!updated || updated === collection) return collection;
  await persistCollection(updated);
  return updated;
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
  const isIn = collectionHasWork(collection, workId);
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

  const subjectId = externalRefId(work, "bangumi");
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
/**
 * 从**已有作品页**发起一次观影记录。
 *
 * 与全局「＋ 开始记录」的关键区别：**Work 已经确定**。
 * 所以整条捕获流程都不再问"这是哪部作品"，也不再去 Bangumi / TMDB 做身份匹配——
 * 作品名只做展示，ViewingRecord 与 ViewingEvent 直接挂到当前 work_id。
 *
 * 这正是 R6 §14 闭环的后半段：片单里先建好的 Work，日后真的看了要能直接接着记，
 * 不能再要求用户重新识别一次作品。
 *
 * 仍然走完整的 Step 1（可以粘贴票务，拿到影院/座位/时间/票价），只是票务里解析出的
 * 片名会被忽略——锁定的 Work 优先级更高。
 */
function startViewingCapture(workId = null) {
  const work = workId ? findWorkById(state.works, workId) : null;
  if (workId && !work) return;
  state.returnScrollY = scrollY;
  state.captureContext = createViewingCaptureContext({
    work,
    subjectId: work ? (externalRefId(work, "bangumi") || null) : null,
    viewedOn: todayInJapan()
  });
  state.captureTagsExpanded = new Set();
  state.clipboardTicketDetected = false;
  pendingClipboardText = null;
  resetTicketOcrUi();
  applyCaptureTransition("open-capture");
  render();
  void peekClipboardForTicket();
  if (work) void refreshCaptureHistoryFlag();
}

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

// 外部图片与 TMDB 代理都可能暂时失败。统一切到档案式占位，避免浏览器破图图标。
document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains("resilient-image")) return;
  if (image.classList.contains("sidebar-artwork-img") && image.dataset.fallbackSrcs) {
    try {
      const sources = JSON.parse(image.dataset.fallbackSrcs);
      const next = sources.shift();
      image.dataset.fallbackSrcs = JSON.stringify(sources);
      if (next) {
        image.src = next;
        return;
      }
    } catch {
      image.dataset.fallbackSrcs = "";
    }
  }
  image.hidden = true;
  image.closest(".work-still, .still-manager-preview, .tmdb-still-preview, .sidebar-artwork")?.classList.add("image-failed");
}, true);

let stillScrollFrame = null;
document.addEventListener("scroll", (event) => {
  const track = event.target;
  if (!(track instanceof HTMLElement) || !track.classList.contains("work-stills-track")) return;
  cancelAnimationFrame(stillScrollFrame);
  stillScrollFrame = requestAnimationFrame(() => {
    const count = track.querySelectorAll(".work-still").length;
    const index = Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
    track.closest(".work-stills-section")?.querySelectorAll("[data-still-dot]").forEach((dot, dotIndex) => {
      const active = dotIndex === index;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-current", String(active));
    });
  });
}, true);

document.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const { action } = trigger.dataset;
  // R5 补丁 4：点了 FAB 菜单里的任何一项之后，菜单都要收起来——
  // 除了开合按钮本身，以及不改变当前页面的主题切换（切完还能继续点别的）。
  if (state.fabOpen && action !== "toggle-fab" && action !== "close-fab" && action !== "theme") { state.fabOpen = false; state.fabClosing = false; }
  if (action === "toggle-fab") {
    if (state.fabOpen) closeFabAnimated();
    else { state.fabOpen = true; render(); }
    return;
  }
  if (action === "close-fab") {
    closeFabAnimated();
    return;
  }
  if (action === "search-placeholder") return;
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
  } else if (action === "open-tags") {
    openTags({ replace: state.view === "tag" });
  } else if (action === "open-tag") {
    openTag(trigger.dataset.tagId);
  } else if (action === "close-shelf") {
    closeShelf();
  } else if (action === "open-work") {
    const workId = trigger.dataset.workId;
    if (workId) openWork(workId);
  } else if (action === "close-work") {
    closeWork();
  } else if (action === "edit-work-tags") {
    state.overlay = "work-tags";
    render();
  } else if (action === "manage-tag") {
    state.overlay = "tag-manager";
    render();
  } else if (action === "toggle-tag-pin") {
    const next = setTagPinned(state.tags, trigger.dataset.tagId, !state.tags.find((tag) => tag.id === trigger.dataset.tagId)?.is_pinned);
    await persistTagState(next, state.tagAssignments);
    render();
  } else if (action === "toggle-tag-hidden") {
    const next = setTagHidden(state.tags, trigger.dataset.tagId, !state.tags.find((tag) => tag.id === trigger.dataset.tagId)?.is_hidden);
    await persistTagState(next, state.tagAssignments);
    render();
  } else if (action === "delete-tag") {
    const tag = state.tags.find((item) => item.id === trigger.dataset.tagId);
    if (!tag || !window.confirm(`要删除 #${displayTagName(tag, tagLocale)} 吗？\n它与所有作品和观影记录的关联都会一起删除。`)) return;
    const result = deleteTagEntity(state.tags, state.tagAssignments, tag.id);
    await persistTagState(result.tags, result.assignments);
    state.overlay = null;
    openTags({ replace: true });
    notify("标签已删除");
  } else if (action === "close-detail") {
    leaveDetail();
  } else if (action === "set-shelf-type-filter") {
    state.shelfFilter.workType = trigger.dataset.value;
    render();
  } else if (action === "toggle-shelf-events-filter") {
    state.shelfFilter.eventsOnly = !state.shelfFilter.eventsOnly;
    render();
  } else if (action === "edit-history-event" || action === "review-history-event") {
    state.editingHistoryEventId = trigger.dataset.eventId;
    state.overlay = "history-event";
    render();
  } else if (action === "add-external-publication") {
    state.editingPublicationId = null;
    state.overlay = "external-publication";
    render();
  } else if (action === "edit-external-publication") {
    state.editingPublicationId = trigger.dataset.publicationId || null;
    state.overlay = "external-publication";
    render();
  } else if (action === "remove-external-publication") {
    const publication = state.currentWorkPublications.find((item) => item.id === trigger.dataset.publicationId);
    if (!publication) return;
    if (!window.confirm("要从这部作品中移除这条外部发表吗？\n只会删除 App 内的引用关系，不会删除原平台内容。")) return;
    await db.delete("externalPublications", publication.id);
    state.currentWorkPublications = state.currentWorkPublications.filter((item) => item.id !== publication.id);
    renderPreservingScroll();
    notify("已从作品中移除外部发表");
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
  } else if (action === "edit-poster") {
    const work = findWorkById(state.works, state.currentWorkId);
    if (!work) return;
    state.posterEditor = { workId: work.id, status: "idle", tmdbChoices: [], error: null };
    state.bangumiPosterLink = { workId: work.id, status: "idle", candidates: [], error: null };
    state.overlay = "poster";
    render();
    void loadPosterChoices();
  } else if (action === "search-bangumi-poster-link") {
    void searchBangumiForPosterLink();
  } else if (action === "link-bangumi-poster") {
    const linkState = state.bangumiPosterLink.workId === state.currentWorkId ? state.bangumiPosterLink : null;
    const candidate = linkState?.candidates?.[Number(trigger.dataset.index)];
    if (candidate) await linkBangumiPosterCandidate(candidate);
  } else if (action === "reload-poster-choices") {
    void loadPosterChoices({ force: true });
  } else if (action === "select-poster") {
    await selectPosterReference(trigger.dataset.source, trigger.dataset.value);
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
  } else if (action === "set-series-filter") {
    state.seriesFilter = ["core", "crossover"].includes(trigger.dataset.value) ? trigger.dataset.value : "all";
    render();
  } else if (action === "edit-series-member") {
    state.editingSeriesMemberId = trigger.dataset.workId || null;
    state.overlay = "series-member";
    render();
  } else if (action === "move-series-member") {
    await moveSeriesMember(trigger.dataset.workId, trigger.dataset.direction);
  } else if (action === "remove-series-member") {
    const workId = trigger.dataset.workId;
    const work = findWorkById(state.works, workId);
    await updateCurrentSeries((series) => removeWorkFromSeries(series, workId));
    state.overlay = null;
    state.editingSeriesMemberId = null;
    renderPreservingScroll();
    announce(`已把《${work?.title || "这部作品"}》移出系列`);
  } else if (action === "remove-series-relation") {
    await updateCurrentSeries((series) => removeSeriesRelation(series, trigger.dataset.from, trigger.dataset.to));
    renderPreservingScroll();
    announce("已删除这条关系");
  } else if (action === "edit-collections") {
    state.overlay = "collections";
    render();
  } else if (action === "edit-stills") {
    const work = findWorkById(state.works, state.currentWorkId);
    if (work && !externalRefId(work, "tmdb")) {
      state.tmdbStillLink = { workId: work.id, status: "idle", query: work.title || "", candidates: [], error: null };
    }
    state.overlay = "stills";
    render();
    void loadTmdbStillCandidates();
  } else if (action === "reload-tmdb-stills") {
    void loadTmdbStillCandidates({ force: true });
  } else if (action === "link-tmdb-for-stills") {
    const current = findWorkById(state.works, state.currentWorkId);
    const linkState = state.tmdbStillLink.workId === current?.id ? state.tmdbStillLink : null;
    const candidate = linkState?.candidates?.[Number(trigger.dataset.index)];
    const tmdbId = candidate?.tmdbId;
    if (!current || !tmdbId) return;
    const duplicate = findWorkByExternalRef(state.works, "tmdb", tmdbId);
    if (duplicate && duplicate.id !== current.id) {
      showToast(`这个 TMDB 条目已关联《${duplicate.title || "另一部作品"}》`);
      return;
    }
    await updateCurrentWork((work) => ({
      ...work,
      external_refs: upsertExternalRef(work.external_refs, { source: "tmdb", id: tmdbId, url: candidate.url })
    }));
    state.tmdbStillLink = { workId: current.id, status: "idle", query: "", candidates: [], error: null };
    state.stillCandidates = { workId: current.id, status: "idle", items: [], error: null };
    render();
    showToast("已追加 TMDB 关联，Bangumi 信息保持不变");
    void loadTmdbStillCandidates({ force: true });
  } else if (action === "add-tmdb-still") {
    const still = createTmdbStill(trigger.dataset.path);
    const current = findWorkById(state.works, state.currentWorkId);
    if (!still || normalizeWorkStills(current?.stills).length >= MAX_WORK_STILLS) return;
    await updateCurrentWork((work) => ({ ...work, stills: addWorkStill(work.stills, still) }));
    render();
    showToast("已保存这张剧照");
  } else if (action === "remove-still") {
    await updateCurrentWork((work) => ({ ...work, stills: removeWorkStill(work.stills, trigger.dataset.stillId) }));
    render();
    showToast("已移除这张剧照");
  } else if (action === "move-still") {
    await updateCurrentWork((work) => ({ ...work, stills: moveWorkStill(work.stills, trigger.dataset.stillId, trigger.dataset.direction) }));
    render();
  } else if (action === "set-primary-still") {
    await updateCurrentWork((work) => ({ ...work, stills: setPrimaryWorkStill(work.stills, trigger.dataset.stillId) }));
    render();
    showToast("已设为主展示图");
  } else if (action === "scroll-stills") {
    const track = trigger.closest(".work-stills-shell")?.querySelector(".work-stills-track");
    if (track) track.scrollBy({ left: (trigger.dataset.direction === "previous" ? -1 : 1) * track.clientWidth, behavior: "smooth" });
  } else if (action === "toggle-collection") {
    await toggleWorkInCollection(trigger.dataset.collectionId);
  } else if (action === "remove-from-collection") {
    state.overlay = null;
    // R6 §5：只有用户主动移除才会删条目。看完电影**不会**自动把它从片单里删掉——
    // 片单本身也是"我过去对什么感兴趣、怎么发现它的"这段记录。
    await updateCurrentCollection((collection) => removeWorkFromCollection(collection, trigger.dataset.workId));
    renderPreservingScroll();
    announce("已移出这个片单");
  } else if (action === "move-entry-up" || action === "move-entry-down") {
    state.overlay = null;
    const collection = state.collections.find((item) => item.id === state.currentCollectionId);
    const index = collectionEntries(collection).findIndex((entry) => entry.work_id === trigger.dataset.workId);
    if (index === -1) return;
    await updateCurrentCollection((current) =>
      moveCollectionEntry(current, trigger.dataset.workId, index + (action === "move-entry-up" ? -1 : 1))
    );
    renderPreservingScroll();
  } else if (action === "edit-entry-reason") {
    state.editingEntryWorkId = trigger.dataset.workId;
    state.overlay = "entry-reason";
    render();
  } else if (action === "edit-collection") {
    state.overlay = "collection-editor";
    render();
  } else if (action === "open-entry-menu") {
    state.entryMenuWorkId = trigger.dataset.workId;
    state.overlay = "entry-menu";
    render();
  } else if (action === "open-create-collection") {
    state.overlay = "create-collection";
    render();
  } else if (action === "refresh-work-metadata") {
    await refreshWorkMetadata();
  } else if (action === "open-delete-work") {
    state.deleteWorkConfirm = "";
    state.overlay = "delete-work";
    render();
  } else if (action === "confirm-delete-work") {
    if (state.deleteWorkConfirm.trim() !== RESET_CONFIRM_PHRASE) return;
    await performWorkDeletion();
  } else if (action === "run-tmdb-diagnostic") {
    await runTmdbDiagnostic();
  } else if (action === "copy-tmdb-diagnostic") {
    await copyTmdbDiagnostic();
  } else if (action === "open-reset-data") {
    state.resetConfirmText = "";
    state.resetMessage = null;
    state.resetBusy = false;
    state.overlay = "reset-data";
    render();
  } else if (action === "confirm-reset-data") {
    if (state.resetConfirmText.trim() !== RESET_CONFIRM_PHRASE) return;
    await performDataReset();
  } else if (action === "open-work-search") {
    openWorkSearch();
  } else if (action === "filter-search-source") {
    const next = trigger.dataset.source;
    state.workSearch.sourceFilter = next === "all" ? null : next;
    state.workSearch.selected = null;   // 筛选变了，之前选中的可能已经不在列表里
    renderWorkSearchResults();
  } else if (action === "select-search-candidate") {
    selectWorkSearchCandidate(trigger.dataset.group, trigger.dataset.index);
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
  } else if (action === "start-viewing-capture") {
    const workId = trigger.dataset.workId || (state.view === "work" ? state.currentWorkId : null);
    startViewingCapture(workId);
  } else if (action === "resume-draft") {
    // 旧版本可能留下 source=skipped 且没有 ViewingEvent 的草稿。恢复时不能继续绕过
    // 观影信息，否则保存后又会回落成“创建日 + 在家观看”。
    state.returnScrollY = scrollY;
    const needsViewingInfo = state.captureContext?.mode !== "supplement"
      && state.captureContext
      && !(state.captureContext.pendingEvents || []).length;
    if (needsViewingInfo) {
      state.captureContext.source = "manual";
      state.captureContext.viewedOn ||= todayInJapan();
      state.captureFlowState = "capture:scene-choice";
      state.overlay = "scene-choice";
    } else {
      state.captureFlowState = state.captureContext ? "capture:compose" : "idle";
      state.overlay = "compose";
    }
    render();
    if (!needsViewingInfo) focusComposer();
  } else if (action === "close-capture") {
    // Step 1/2A/2B 的背景点击：还没有产生任何记录，直接丢弃这次捕获上下文。
    state.captureContext = null;
    state.captureTagsExpanded = new Set();
    resetTicketOcrUi();
    applyCaptureTransition("close");
    render();
  } else if (action === "use-clipboard-ticket") {
    resetTicketOcrUi();
    handleCapturePaste(pendingClipboardText || "");
  } else if (action === "choose-ticket-screenshot") {
    if (["preparing", "recognizing", "parsing"].includes(ticketOcrUi.status)) return;
    document.querySelector("#ticket-ocr-input")?.click();
  } else if (action === "parse-ticket-info") {
    const ticketText = document.querySelector("#capture-paste-input")?.value || "";
    if (pendingTicketOcrText !== null) pendingTicketOcrText = ticketText;
    handleCapturePaste(ticketText, pendingTicketOcrText !== null
      ? { ocr: true, layout: pendingTicketOcrLayout }
      : {});
  } else if (action === "reparse-ticket-ocr") {
    if (!pendingTicketOcrText?.trim()) return;
    ticketOcrUi.error = "";
    if (!handleCapturePaste(pendingTicketOcrText, { ocr: true, layout: pendingTicketOcrLayout })) {
      ticketOcrUi.error = "修改后的文字仍未能识别出票务信息，当前卡片保留上一次解析结果。";
      render();
    }
  } else if (action === "manual-viewing-info") {
    if (!state.captureContext) return;
    resetTicketOcrUi();
    state.captureContext.source = "manual";
    state.captureTagsExpanded = new Set();
    if (state.captureContext.workTitle?.trim()) void refreshCaptureHistoryFlag();
    applyCaptureTransition("manual");
    render();
  } else if (action === "skip-viewing-info") {
    const ctx = state.captureContext;
    if (!ctx || (!ctx.lockedWork && !ctx.workTitle?.trim())) return;
    ctx.source = "skipped";
    ctx.pendingEvents = [buildPendingViewingEvent()];
    applyCaptureTransition("skip");
    await saveDraft(state.draft?.text || "", true);
    render();
    focusComposer();
  } else if (action === "repaste-ticket-capture") {
    const previous = state.captureContext;
    const work = previous?.lockedWork && previous.workId ? findWorkById(state.works, previous.workId) : null;
    state.captureContext = createViewingCaptureContext({
      work,
      subjectId: work ? (externalRefId(work, "bangumi") || null) : null,
      viewedOn: todayInJapan()
    });
    state.captureTagsExpanded = new Set();
    resetTicketOcrUi();
    applyCaptureTransition("repaste");
    render();
  } else if (action === "toggle-capture-match-candidates") {
    if (!state.captureContext) return;
    state.captureContext.showMatchCandidates = !state.captureContext.showMatchCandidates;
    render();
  } else if (action === "select-capture-candidate") {
    const ctx = state.captureContext;
    if (!ctx) return;
    const candidate = ctx.workMatch?.candidates?.[Number(trigger.dataset.index)];
    if (!candidate) return;
    selectCaptureCandidate(ctx, candidate);
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
    if (!selected.length || selected.some((event) => !event.viewed_on || !event.location_type)) return;
    ctx.pendingEvents = selected; // 只把用户勾选的场次带进 compose，排除的场次彻底丢弃
    resetTicketOcrUi();
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
    const candidate = ctx.workMatch?.candidates?.[Number(trigger.dataset.index)];
    if (!candidate) return;
    selectCaptureCandidate(ctx, candidate);
    render();
    void refreshCaptureHistoryFlag();
  } else if (action === "confirm-scene-choice") {
    const ctx = state.captureContext;
    if (!ctx?.viewedOn || !ctx.locationType || !ctx.workTitle?.trim()) return;
    const event = buildManualViewingEvent({
      viewedOn: ctx.viewedOn,
      locationType: ctx.locationType,
      cinemaName: ctx.cinemaName,
      auditorium: ctx.auditorium,
      version: ctx.version,
      format: ctx.format,
      formatNote: ctx.formatNote,
      is3D: ctx.is3D,
      ticketCount: Math.max(1, Number(ctx.ticketCount) || 1),
      ticketPrice: Number(ctx.ticketAmount) > 0 ? {
        amount: Number(ctx.ticketAmount),
        currency: ctx.ticketCurrency === "CNY" ? "CNY" : "JPY",
        count: Math.max(1, Number(ctx.ticketCount) || 1)
      } : null,
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
  } else if (action === "open-interview-invite") {
    state.overlay = "interview-invite";
    render();
  } else if (action === "start-interview" || action === "resume-interview" || action === "edit-interview") {
    const record = currentRecord();
    if (!record) return;
    const firstOpen = SELF_INTERVIEW_QUESTIONS.findIndex((question) => !record.self_interview?.answers?.some((answer) => answer.question_id === question.id && answer.status === "answered"));
    state.interviewQuestionIndex = action === "edit-interview" ? 0 : Math.max(0, firstOpen);
    await updateRecord((item) => {
      item.self_interview.status = "in_progress";
      item.self_interview.completed_at = null;
      item.self_interview.updated_at = new Date().toISOString();
    });
    state.overlay = "self-interview";
    render();
  } else if (action === "skip-interview") {
    await updateRecord((record) => { record.self_interview = skipSelfInterview(record.self_interview); });
    state.overlay = null;
    renderPreservingScroll();
    await runAiAnalysis(currentRecord()?.id);
  } else if (action === "close-interview") {
    if (state.overlay === "self-interview") await persistInterviewAnswer("answered");
    state.overlay = null;
    renderPreservingScroll();
    announce("采访进度已保存，可以稍后继续");
  } else if (action === "interview-previous") {
    await persistInterviewAnswer("answered");
    state.interviewQuestionIndex = Math.max(0, state.interviewQuestionIndex - 1);
    render();
  } else if (action === "interview-next") {
    await persistInterviewAnswer("answered");
    if (state.interviewQuestionIndex >= SELF_INTERVIEW_QUESTIONS.length - 1) {
      await updateRecord((record) => { record.self_interview = completeSelfInterview(record.self_interview); });
      state.overlay = "interview-summary";
    } else {
      state.interviewQuestionIndex += 1;
    }
    render();
  } else if (action === "skip-interview-question") {
    await persistInterviewAnswer("skipped");
    if (state.interviewQuestionIndex >= SELF_INTERVIEW_QUESTIONS.length - 1) state.overlay = "interview-summary";
    else state.interviewQuestionIndex += 1;
    render();
  } else if (action === "finish-interview") {
    await persistInterviewAnswer("answered");
    await updateRecord((record) => { record.self_interview = completeSelfInterview(record.self_interview); });
    state.overlay = "interview-summary";
    render();
  } else if (action === "view-all-interview-questions") {
    await persistInterviewAnswer("answered");
    state.overlay = "interview-all";
    render();
  } else if (action === "jump-interview-question") {
    state.interviewQuestionIndex = Math.max(0, Math.min(Number(trigger.dataset.index) || 0, SELF_INTERVIEW_QUESTIONS.length - 1));
    state.overlay = "self-interview";
    render();
  } else if (action === "back-to-interview-question") {
    state.overlay = "self-interview";
    render();
  } else if (action === "generate-from-interview") {
    await updateRecord((record) => { record.self_interview = completeSelfInterview(record.self_interview); });
    state.overlay = null;
    renderPreservingScroll();
    await runAiAnalysis(currentRecord()?.id);
  } else if (action === "open-record") {
    openRecord(trigger.dataset.recordId);
  } else if (action === "go-home") {
    goHome();
  } else if (action === "confirm-work-match") {
    await confirmWorkMatch(trigger.dataset.index);
  } else if (action === "work-split-detach") {
    await detachRecordToCandidate(state.workSplitPrompt?.candidateIndex);
  } else if (action === "work-split-overwrite") {
    await confirmWorkMatch(state.workSplitPrompt?.candidateIndex, { force: true });
  } else if (action === "cancel-work-split") {
    state.workSplitPrompt = null;
    state.overlay = "work-match";
    render();
  } else if (action === "dismiss-work-match") {
    await dismissWorkMatch();
  } else if (action === "open-work-match") {
    state.overlay = "work-match";
    render();
  } else if (action === "retry-work-match") {
    await requestWorkMatch(currentRecord()?.id, { force: currentWork(currentRecord())?.identity_status === "matched" });
  } else if (action === "rematch-work") {
    await requestWorkMatch(currentRecord()?.id, { force: true });
  } else if (action === "retry-local-analysis") {
    await runAiAnalysis(currentRecord()?.id);
  } else if (action === "request-ai-cards") {
    await requestAiCards(currentRecord()?.id);
    if (state.view === "detail" && currentRecord()?.activeAnalysisDraft) {
      state.overlay = "analysis-draft";
      render();
    }
  } else if (action === "open-analysis-draft") {
    state.overlay = "analysis-draft";
    render();
  } else if (action === "confirm-analysis-draft") {
    await updateRecord((record) => applyActiveAnalysisDraft(record));
    state.overlay = null;
    renderPreservingScroll();
    announce("这次电影印记已确认");
  } else if (action === "replace-with-analysis-draft") {
    await updateRecord((record) => applyActiveAnalysisDraft(record, { replaceCards: true }));
    state.overlay = null;
    renderPreservingScroll();
    announce("正式卡片已按你的选择替换");
  } else if (action === "discard-analysis-draft") {
    await updateRecord((record) => {
      archiveActiveAnalysis(record, "dismissed");
      record.analysis_status = record.status === "confirmed" ? "confirmed" : "manual";
    });
    state.overlay = null;
    renderPreservingScroll();
  } else if (action === "accept-draft-card") {
    await updateRecord((record) => {
      const cards = record.activeAnalysisDraft?.memory_cards || [];
      const index = cards.findIndex((card) => (card.card_id || card.temporary_id) === trigger.dataset.cardId);
      if (index < 0) return;
      record.cards.push(formalizeDraftCard(cards[index], record));
      cards.splice(index, 1);
      record.status = "confirmed";
    });
    renderPreservingScroll();
  } else if (action === "remove-draft-card") {
    await updateRecord((record) => {
      const cards = record.activeAnalysisDraft?.memory_cards || [];
      record.activeAnalysisDraft.memory_cards = cards.filter((card) => (card.card_id || card.temporary_id) !== trigger.dataset.cardId);
    });
    renderPreservingScroll();
  } else if (action === "toggle-core-card") {
    await updateRecord((record) => {
      const target = record.cards.find((card) => card.card_id === trigger.dataset.cardId);
      if (!target) return;
      const next = !target.is_core;
      record.cards.forEach((card) => { card.is_core = false; });
      target.is_core = next;
    });
    renderPreservingScroll();
  } else if (action === "move-card") {
    await updateRecord((record) => {
      const index = record.cards.findIndex((card) => card.card_id === trigger.dataset.cardId);
      const nextIndex = trigger.dataset.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= record.cards.length) return;
      const [card] = record.cards.splice(index, 1);
      record.cards.splice(nextIndex, 0, card);
      record.cards.forEach((item, order) => { item.order = order; });
    });
    renderPreservingScroll();
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
    await updateRecord((record) => {
      const index = record.cards.findIndex((item) => item.card_id === trigger.dataset.cardId);
      if (index < 0) return;
      const [card] = record.cards.splice(index, 1);
      state.deletedCardUndo = { recordId: record.id, card, index };
      record.cards.forEach((item, cardIndex) => { item.order = cardIndex; });
    });
    state.overlay = null;
    renderPreservingScroll();
    announce("这张记忆卡片已删除，可以撤销");
  } else if (action === "undo-delete-card") {
    const undo = state.deletedCardUndo;
    if (!undo || undo.recordId !== currentRecord()?.id) return;
    await updateRecord((record) => {
      record.cards.splice(Math.min(undo.index, record.cards.length), 0, undo.card);
      record.cards.forEach((item, index) => { item.order = index; });
    });
    state.deletedCardUndo = null;
    renderPreservingScroll();
  } else if (action === "add-card") {
    state.editingCardId = null;
    state.editingCardSource = "formal";
    state.overlay = "card";
    render();
  } else if (action === "edit-card") {
    state.editingCardId = trigger.dataset.cardId;
    state.editingCardSource = trigger.dataset.cardSource || "formal";
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
    const publications = await db.getAll("externalPublications").catch(() => []);
    if (!state.records.length && !state.collections.length && !publications.length) { notify("还没有可导出的内容"); return; }
    const entries = await buildAllExportEntries();
    const content = exportAllMarkdown(
      entries,
      buildCollectionsExport(state.collections, state.works, isWorkWatched),
      buildExternalPublicationsExport(publications, state.works)
    );
    try {
      const result = await deliverExport({ content, filename: exportAllFilename("md"), mimeType: MIME_TYPES.markdown, shareTitle: "电影印记 · 全部记录" });
      if (result.method === "cancelled") return;
      notify(result.method === "download" ? "这个浏览器不支持分享，已改为下载文件" : "已分享");
    } catch (error) {
      notify(`分享失败：${error.message}`);
    }
  } else if (action === "export-all-download") {
    const publications = await db.getAll("externalPublications").catch(() => []);
    if (!state.records.length && !state.collections.length && !publications.length) { notify("还没有可导出的内容"); return; }
    const entries = await buildAllExportEntries();
    downloadExport(
      exportAllJSON(
        entries,
        buildCollectionsExport(state.collections, state.works, isWorkWatched),
        buildExternalPublicationsExport(publications, state.works),
        state.tags,
        state.tagAssignments
      ),
      exportAllFilename("json"),
      MIME_TYPES.json
    );
    notify("已下载全部记录的 JSON 备份");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.id !== "composer-input" || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  const input = event.target;
  const edit = continueListOnEnter(input.value, input.selectionStart, input.selectionEnd);
  if (!edit) return;
  event.preventDefault();
  applyComposerEdit(input, edit);
});

document.addEventListener("input", (event) => {
  if (event.target.id === "tag-search-input") {
    state.tagSearchQuery = event.target.value;
    if (event.isComposing || imeComposing) return;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector("#tag-search-input");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    return;
  }
  if (event.target.id === "external-publication-url") {
    const label = document.querySelector("#external-publication-platform");
    if (label) label.textContent = publicationPlatformLabel(detectPublicationPlatform(event.target.value));
    return;
  }
  if (event.target.id === "interview-answer-input") {
    clearTimeout(state.interviewSaveTimer);
    const status = document.querySelector("[data-testid='interview-save-status']");
    if (status) status.textContent = "正在保存…";
    state.interviewSaveTimer = setTimeout(async () => {
      await persistInterviewAnswer("answered");
      const currentStatus = document.querySelector("[data-testid='interview-save-status']");
      if (currentStatus) currentStatus.textContent = "已保存";
    }, 300);
    return;
  }
  if (event.target.id === "delete-work-confirm-input") {
    state.deleteWorkConfirm = event.target.value;
    const button = document.querySelector("[data-testid='confirm-delete-work']");
    if (button) button.disabled = state.deleteWorkConfirm.trim() !== RESET_CONFIRM_PHRASE;
    return;
  }
  if (event.target.id === "reset-confirm-input") {
    state.resetConfirmText = event.target.value;
    // 只切按钮的 disabled，不走 render()——重渲染会重建输入框、丢焦点
    const button = document.querySelector("[data-testid='confirm-reset-data']");
    if (button) button.disabled = state.resetConfirmText.trim() !== RESET_CONFIRM_PHRASE || state.resetBusy;
    return;
  }
  if (event.target.id === "work-search-input") {
    // 组合中（正在打拼音）不触发搜索——compositionend 时会补一次
    if (event.isComposing || imeComposing) return;
    handleWorkSearchInput(event.target.value);
    return;
  }
  if (event.target.id === "composer-input") {
    saveDraft(event.target.value);
    updateSeriesHint(event.target.value);
    const finish = document.querySelector("[data-testid='finish-record']");
    if (finish) finish.disabled = !event.target.value.trim();
  } else if (event.target.matches("[data-testid='recommendation-note']")) {
    updateRecord((record) => { record.recommendationNote = event.target.value; });
  } else if (event.target.id === "capture-paste-input") {
    if (pendingTicketOcrText !== null) {
      pendingTicketOcrText = event.target.value;
      pendingTicketOcrLayout = null;
    }
    const parseButton = document.querySelector("[data-testid='parse-ticket-info']");
    if (parseButton) parseButton.disabled = !event.target.value.trim();
  } else if (event.target.id === "ticket-ocr-review-text") {
    pendingTicketOcrText = event.target.value;
    pendingTicketOcrLayout = null;
    const reparseButton = document.querySelector("[data-testid='reparse-ticket-ocr']");
    if (reparseButton) reparseButton.disabled = !event.target.value.trim();
  } else if (event.target.id === "capture-entry-work-title-input") {
    if (!state.captureContext) return;
    state.captureContext.workTitle = event.target.value;
    const skipButton = document.querySelector("[data-testid='skip-viewing-info']");
    if (skipButton) skipButton.disabled = !event.target.value.trim();
    const requirement = document.querySelector(".capture-entry-requirement");
    if (requirement) requirement.hidden = Boolean(event.target.value.trim());
  } else if (event.target.id === "scene-work-title-input" || event.target.id === "capture-manual-title-input") {
    // R2：作品标题输入是"受控但不整页重渲染"——保留光标，只手动同步按钮可用态与防抖匹配。
    if (!state.captureContext) return;
    state.captureContext.workTitle = event.target.value;
    const confirmButton = document.querySelector("[data-testid='confirm-scene-choice']");
    if (confirmButton) {
      confirmButton.disabled = !(state.captureContext.locationType
        && (state.captureContext.lockedWork || event.target.value.trim()));
    }
    // 组合中（正在打拼音）不调度匹配——compositionend 时会补一次
    if (event.isComposing || imeComposing) return;
    scheduleCaptureTitleMatch(event.target.value);
  } else if (event.target.id === "scene-cinema-name-input") {
    if (state.captureContext) state.captureContext.cinemaName = event.target.value;
  } else if (event.target.id === "scene-auditorium-input") {
    if (state.captureContext) state.captureContext.auditorium = event.target.value;
  } else if (event.target.id === "scene-version-input") {
    if (state.captureContext) state.captureContext.version = event.target.value;
  } else if (event.target.id === "scene-format-note-input") {
    if (state.captureContext) state.captureContext.formatNote = event.target.value;
  } else if (event.target.id === "scene-ticket-amount-input") {
    if (state.captureContext) state.captureContext.ticketAmount = event.target.value === "" ? null : Number(event.target.value);
  } else if (event.target.id === "scene-ticket-count-input") {
    if (state.captureContext) state.captureContext.ticketCount = Math.max(1, Number(event.target.value) || 1);
  } else if (event.target.id === "scene-viewed-on-input") {
    if (!state.captureContext) return;
    state.captureContext.viewedOn = event.target.value;
    const confirmButton = document.querySelector("[data-testid='confirm-scene-choice']");
    if (confirmButton) confirmButton.disabled = !(event.target.value
      && state.captureContext.locationType
      && (state.captureContext.lockedWork || state.captureContext.workTitle?.trim()));
  } else if (event.target.matches("[data-field='ticket-viewed-on']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (!pending) return;
    const viewedOn = event.target.value;
    const shiftDate = (iso) => {
      if (!iso || !viewedOn || !pending.viewed_on) return iso;
      const dayDelta = Math.round((Date.parse(`${viewedOn}T00:00:00Z`) - Date.parse(`${pending.viewed_on}T00:00:00Z`)) / 86_400_000);
      const isoDate = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
      isoDate.setUTCDate(isoDate.getUTCDate() + dayDelta);
      return `${isoDate.toISOString().slice(0, 10)}${iso.slice(10)}`;
    };
    ctx.pendingEvents[idx] = {
      ...pending,
      viewed_on: viewedOn || null,
      screening_at: shiftDate(pending.screening_at),
      screening_ends_at: shiftDate(pending.screening_ends_at)
    };
    const confirmButton = document.querySelector("[data-testid='confirm-ticket-capture']");
    if (confirmButton) confirmButton.disabled = selectedPendingEvents(ctx.pendingEvents).some((item) => !item.viewed_on || !item.location_type);
  } else if (event.target.matches("[data-field='ticket-cinema-name'], [data-field='ticket-auditorium'], [data-field='ticket-version'], [data-field='ticket-format-note'], [data-field='ticket-language']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (!pending) return;
    const key = {
      "ticket-cinema-name": "cinema_name",
      "ticket-auditorium": "auditorium",
      "ticket-version": "version",
      "ticket-format-note": "format_note",
      "ticket-language": "language"
    }[event.target.dataset.field];
    ctx.pendingEvents[idx] = { ...pending, viewing_context: { ...pending.viewing_context, [key]: event.target.value || null } };
  } else if (event.target.matches("[data-field='ticket-price-amount'], [data-field='ticket-price-count']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (!pending) return;
    const card = event.target.closest(".ticket-confirm-card");
    const amountInput = card?.querySelector("[data-field='ticket-price-amount']");
    const currencyInput = card?.querySelector("[data-field='ticket-price-currency']");
    const countInput = card?.querySelector("[data-field='ticket-price-count']");
    const amount = Number(amountInput?.value);
    ctx.pendingEvents[idx] = {
      ...pending,
      viewing_context: {
        ...pending.viewing_context,
        ticket_count: Math.max(1, Number(countInput?.value) || 1)
      },
      ticket_price: amount > 0 ? {
        amount,
        currency: currencyInput?.value === "CNY" ? "CNY" : "JPY",
        count: Math.max(1, Number(countInput?.value) || 1)
      } : null
    };
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

// 粘贴本身只把文本放进输入框；是否解析由左侧主按钮明确触发，和右侧“暂时跳过”
// 保持两条不同语义的路径。
document.addEventListener("paste", (event) => {
  if (event.target.id !== "capture-paste-input") return;
  setTimeout(() => {
    const parseButton = document.querySelector("[data-testid='parse-ticket-info']");
    if (parseButton) parseButton.disabled = !event.target.value.trim();
  }, 0);
});

document.addEventListener("error", (event) => {
  if (!event.target.matches?.(".record-poster-img")) return;
  event.target.hidden = true;
}, true);

document.addEventListener("change", async (event) => {
  if (event.target.id === "ticket-ocr-input") {
    const [file] = event.target.files || [];
    event.target.value = "";
    if (file) await handleTicketScreenshot(file);
    return;
  } else if (event.target.id === "ticket-ocr-language") {
    ticketOcrUi.language = normalizeTicketOcrLanguage(event.target.value);
    return;
  } else if (event.target.id === "poster-upload-input") {
    const [file] = event.target.files || [];
    if (file) await saveUploadedPoster(file);
    return;
  } else if (event.target.id === "tag-sort") {
    state.tagSort = event.target.value;
    renderPreservingScroll();
    return;
  } else if (event.target.id === "shelf-watch-status") {
    // R6：书架观看状态。切到「想看」时排序下拉会被收起来，但 state.shelfFilter.sort
    // 保持原值不动——切回「已看」应该回到用户原来选的排序，而不是被重置。
    state.shelfFilter.watchStatus = event.target.value;
    render();
    return;
  } else if (event.target.id === "shelf-sort") {
    state.shelfFilter.sort = event.target.value;
    render();
    return;
  } else if (event.target.id === "shelf-decade") {
    state.shelfFilter.decade = event.target.value === "all" ? "all" : Number(event.target.value);
    render();
    return;
  }
  if (event.target.matches("[data-testid='recommendation-note']")) {
    await updateRecord((record) => { record.recommendationNote = event.target.value.trim(); });
    announce("推荐说明已保存");
  } else if (event.target.id === "scene-format-select") {
    if (state.captureContext) state.captureContext.format = event.target.value || null;
  } else if (event.target.id === "scene-is-3d-select") {
    if (state.captureContext) state.captureContext.is3D = event.target.value === "true";
  } else if (event.target.id === "scene-ticket-currency-select") {
    if (state.captureContext) state.captureContext.ticketCurrency = event.target.value === "CNY" ? "CNY" : "JPY";
  } else if (event.target.matches("[data-field='ticket-location-type']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (!pending) return;
    const locationType = event.target.value === "home" ? "home" : "cinema";
    ctx.pendingEvents[idx] = {
      ...pending,
      location_type: locationType,
      ticket_price: locationType === "cinema" ? pending.ticket_price : null,
      viewing_context: locationType === "cinema" ? pending.viewing_context : {
        ...pending.viewing_context,
        cinema_name: null,
        auditorium: null,
        format: null,
        format_note: null,
        is_3d: false,
        seats: [],
        seat_count: 0,
        ticket_type: null,
        language: null,
        ticket_count: null,
        event_types: [],
        bonus_note: null
      }
    };
    render();
  } else if (event.target.matches("[data-field='ticket-price-currency']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (!pending?.ticket_price) return;
    ctx.pendingEvents[idx] = {
      ...pending,
      ticket_price: { ...pending.ticket_price, currency: event.target.value === "CNY" ? "CNY" : "JPY" }
    };
    render();
  } else if (event.target.matches("[data-field='ticket-format']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (pending) ctx.pendingEvents[idx] = { ...pending, viewing_context: { ...pending.viewing_context, format: event.target.value || null } };
  } else if (event.target.matches("[data-field='ticket-is-3d']")) {
    const ctx = state.captureContext;
    const idx = Number(event.target.dataset.eventIndex);
    const pending = ctx?.pendingEvents?.[idx];
    if (pending) ctx.pendingEvents[idx] = { ...pending, viewing_context: { ...pending.viewing_context, is_3d: event.target.value === "true" } };
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

document.addEventListener("submit", async (event) => {
  if (event.target.id === "work-match-search-form") {
    event.preventDefault();
    const query = String(new FormData(event.target).get("query") || "").trim();
    const record = currentRecord();
    if (!record || !query) return;
    await requestWorkMatch(record.id, {
      force: currentWork(record)?.identity_status === "matched",
      query
    });
    return;
  }

  if (event.target.id === "work-tag-form") {
    event.preventDefault();
    const work = findWorkById(state.works, state.currentWorkId);
    if (!work) return;
    const input = String(new FormData(event.target).get("tags") || "");
    const names = [...new Set(input.split(/[，,\n]+/u).map((name) => name.trim().replace(/^#+/u, "")).filter(Boolean))];
    let nextTags = [...state.tags];
    let nextAssignments = state.tagAssignments.filter((item) => !(item.target_type === "work" && item.target_id === work.id));
    for (const name of names) {
      const ensured = ensureUserTag(nextTags, name, { locale: tagLocale });
      nextTags = ensured.tags;
      if (!ensured.tag) continue;
      nextAssignments = upsertAssignment(nextAssignments, {
        tagId: ensured.tag.id,
        targetType: "work",
        targetId: work.id,
        source: ensured.tag.source
      }).assignments;
    }
    nextTags = pruneOrphanUserTags(nextTags, nextAssignments);
    await persistTagState(nextTags, nextAssignments);
    state.overlay = null;
    renderPreservingScroll();
    notify("作品标签已保存");
    return;
  }

  if (event.target.id === "tag-merge-form") {
    event.preventDefault();
    const targetTagId = String(new FormData(event.target).get("targetTagId") || "");
    const sourceTagId = state.currentTagId;
    if (!sourceTagId || !targetTagId) return;
    const sourceName = displayTagName(state.tags.find((item) => item.id === sourceTagId), tagLocale);
    const targetName = displayTagName(state.tags.find((item) => item.id === targetTagId), tagLocale);
    if (!window.confirm(`把 #${sourceName} 合并到 #${targetName} 吗？\n所有关联都会迁移到目标标签。`)) return;
    const result = mergeTags(state.tags, state.tagAssignments, { sourceTagId, targetTagId });
    await persistTagState(result.tags, result.assignments);
    state.currentTagId = targetTagId;
    state.overlay = null;
    history.replaceState({ view: "tag", tagId: targetTagId }, "", `#tag=${encodeURIComponent(targetTagId)}`);
    render();
    notify("标签已合并");
    return;
  }
  if (event.target.id === "external-publication-form") {
    event.preventDefault();
    const work = findWorkById(state.works, state.currentWorkId);
    if (!work) return;
    const data = new FormData(event.target);
    const url = String(data.get("url") || "").trim();
    const normalizedUrl = normalizePublicationUrl(url);
    if (!normalizedUrl) {
      showToast("请输入有效的 HTTP / HTTPS URL");
      return;
    }
    const publicationId = event.target.dataset.publicationId || null;
    if (hasDuplicatePublication(state.currentWorkPublications, {
      workId: work.id,
      normalizedUrl,
      exceptId: publicationId
    })) {
      showToast("这条外部发表已经添加过了。");
      return;
    }
    const changes = {
      url,
      publishedAt: String(data.get("publishedAt") || "") || null,
      viewingRecordId: String(data.get("viewingRecordId") || "") || null,
      note: String(data.get("note") || "")
    };
    const existing = state.currentWorkPublications.find((item) => item.id === publicationId);
    let publication;
    try {
      publication = existing
        ? updateExternalPublication(existing, changes)
        : createExternalPublication({ id: createId("publication"), workId: work.id, ...changes });
    } catch (_) {
      showToast("无法保存，请检查 URL");
      return;
    }
    await db.put("externalPublications", publication);
    state.currentWorkPublications = sortExternalPublications([
      ...state.currentWorkPublications.filter((item) => item.id !== publication.id),
      publication
    ]);
    state.editingPublicationId = null;
    state.overlay = null;
    renderPreservingScroll();
    notify(existing ? "外部发表已更新" : "外部发表已添加");
    return;
  }
  if (event.target.id === "card-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const content = String(data.get("content") || "").trim();
    if (!content) return;
    const id = event.target.dataset.cardId;
    const source = event.target.dataset.cardSource || "formal";
    await updateRecord((record) => {
      const cards = source === "draft" ? (record.activeAnalysisDraft?.memory_cards || []) : record.cards;
      if (id) {
        const card = cards.find((item) => (item.card_id || item.temporary_id) === id);
        if (!card) return;
        card.revision_history ||= [];
        card.revision_history.push({
          revision_id: createId("cardrev"),
          title: card.title,
          content: card.content,
          why_it_matters: card.why_it_matters ?? null,
          type: card.type,
          saved_at: new Date().toISOString()
        });
        Object.assign(card, {
          type: data.get("type"),
          title: String(data.get("title") || "").trim(),
          content,
          why_it_matters: String(data.get("why") || "").trim() || null,
          user_modified: true,
          provenance: "user_modified"
        });
      } else {
        record.cards.push({
          card_id: createId("card"),
          type: data.get("type"),
          title: String(data.get("title") || "").trim(),
          content,
          why_it_matters: String(data.get("why") || "").trim() || null,
          is_core: false,
          order: record.cards.length,
          provenance: "user_added",
          origin: "user_created",
          status: "confirmed",
          user_modified: false,
          analysis_id: null,
          revision_history: [],
          related_emotions: [],
          linked_viewing_ids: [],
          evidence: [],
          custom_fields: {}
        });
        record.status = "confirmed";
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
    await updateRecord((record) => {
      reviseRawText(record, rawText);
      record.tags = extractHashtags(rawText);
    });
    await syncViewingRecordTags(currentRecord());
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

  if (event.target.id === "tmdb-still-link-form") {
    event.preventDefault();
    const query = String(new FormData(event.target).get("query") || "").trim();
    if (query) await searchTmdbForStills(query);
    return;
  }

  if (event.target.id === "still-url-form") {
    event.preventDefault();
    const url = String(new FormData(event.target).get("url") || "").trim();
    const still = createExternalStill(url);
    const work = findWorkById(state.works, state.currentWorkId);
    if (!still) {
      showToast("请输入有效的 HTTPS 图片链接");
      return;
    }
    if (normalizeWorkStills(work?.stills).length >= MAX_WORK_STILLS) {
      showToast("每部作品最多保存 4 张剧照");
      return;
    }
    const before = normalizeWorkStills(work?.stills).length;
    const updated = await updateCurrentWork((current) => ({ ...current, stills: addWorkStill(current.stills, still) }));
    const after = normalizeWorkStills(updated?.stills).length;
    if (after === before) {
      showToast("这张图片已经保存过了");
      return;
    }
    render();
    showToast("已添加剧照");
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

  if (event.target.id === "work-search-add-form") {
    event.preventDefault();
    await addSelectedCandidateToCollection(String(new FormData(event.target).get("reason") || ""));
    return;
  }

  if (event.target.id === "collection-edit-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const title = String(data.get("title") || "").trim();
    if (!title) return;
    await updateCurrentCollection((collection) => ({
      ...collection,
      title,
      description: String(data.get("description") || "").trim(),
      updated_at: new Date().toISOString()
    }));
    state.overlay = null;
    render();
    announce("已更新片单信息");
    return;
  }

  if (event.target.id === "entry-reason-form") {
    event.preventDefault();
    const reason = String(new FormData(event.target).get("reason") || "").trim();
    const workId = state.editingEntryWorkId;
    await updateCurrentCollection((collection) => updateCollectionEntryReason(collection, workId, reason));
    state.overlay = null;
    state.editingEntryWorkId = null;
    render();
    announce(reason ? "已保存想看的理由" : "已清空想看的理由");
    return;
  }

  if (event.target.id === "collection-create-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const title = String(data.get("title") || "").trim();
    if (!title) return;
    const collection = createCollection({ title, description: String(data.get("description") || "") });
    await persistCollection(collection);
    state.overlay = null;
    render();
    announce(`已新建片单《${title}》`);
    return;
  }

  if (event.target.id === "series-member-form") {
    event.preventDefault();
    const workId = state.editingSeriesMemberId;
    if (!workId) return;
    const data = new FormData(event.target);
    await updateCurrentSeries((series) => updateSeriesMember(series, workId, {
      relation: String(data.get("relation") || "core"),
      seriesOrder: data.get("seriesOrder"),
      relationNote: String(data.get("relationNote") || "")
    }));
    state.overlay = null;
    state.editingSeriesMemberId = null;
    renderPreservingScroll();
    announce("已保存系列成员关系");
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
      void hydrateRecordViewingEvents(recordId);
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
    state.currentWorkPublications = [];
    render();
    scrollTo(0, 0);
    loadWorkPageData(workId);
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
  if (hash === "#tags") {
    state.view = "tags";
    state.currentTagId = null;
    render();
    scrollTo(0, 0);
    return;
  }
  if (hash.startsWith("#tag=")) {
    const tagId = decodeURIComponent(hash.slice(5));
    if (state.tags.some((tag) => tag.id === tagId)) {
      state.view = "tag";
      state.currentTagId = tagId;
      render();
      scrollTo(0, 0);
      return;
    }
    state.view = "tags";
    state.currentTagId = null;
    history.replaceState({ view: "tags" }, "", "#tags");
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
  if (event.key !== "Escape") return;
  // FAB 菜单展开时，Esc 先收菜单（它是最上层的临时 UI）
  if (state.fabOpen) {
    state.fabOpen = false;
    render();
    return;
  }
  if (!state.overlay) return;
  if (state.overlay === "compose") {
    await saveDraft(document.querySelector("#composer-input")?.value || "", true);
    applyCaptureTransition("close");
  } else if (state.overlay === "self-interview") {
    await persistInterviewAnswer("answered");
    state.overlay = null;
  } else if (state.overlay === "interview-all" || state.overlay === "interview-summary" || state.overlay === "interview-invite") {
    state.overlay = null;
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
      armed: true,
      // moved 才代表"真的拖了"。仅仅点一下抽屉里的菜单项也会走到这里并且 armed=true，
      // 如果据此就去抑制随后的 click，侧边栏里的「作品书架 / 片单 / 偏好设置」
      // 会全部点不动——这正是上一版把侧边栏点击整个搞失效的原因。
      moved: false
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
      armed: false,
      moved: false
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
  // 超过一点点位移才算"拖过"，只有拖过才需要抑制随后的合成 click
  if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) sidebarGesture.moved = true;

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
    // R5 补丁 6：关闭手势**两个方向都支持**。
    // 用户反馈：既然拉出来是从左往右滑，直觉上推回去就该从右往左滑，
    // 结果之前只认"从左往右"，往左滑半天毫无反应。现在取横向位移的绝对值——
    // 往左滑（推回去，最直觉）和往右滑（原来的做法）都能关。
    paintSidebarProgress(drawer, 1 - Math.abs(deltaX) / sidebarGesture.width);
  }
}, { passive: false });

function finishSidebarGesture(cancelled = false) {
  if (!sidebarGesture) return;
  const gesture = sidebarGesture;
  sidebarGesture = null;
  const drawer = sidebarDrawerEl();
  if (!gesture.armed || !drawer) return;
  // 只有真的拖动过才拦掉随后的合成 click。单纯点一下抽屉里的菜单项不能拦，
  // 否则侧边栏里的所有入口都会失效。
  if (gesture.moved) suppressClickAfterGesture();

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
      // 由手势提交时，正式渲染的抽屉必须**完全不播**入场动画。
      // 之前是先设 animation:none、下一帧又还原成 ""，那等于把 drawer-in 重新触发了一遍：
      // 抽屉先瞬间弹到位再缩回去从头滑出来——就是用户描述的"拖到刚好全开时，
      // 侧边栏飞快弹到顶又飞快缩回"。现在改成渲染时就带上 no-entry-anim 类，不再还原。
      state.sidebarSkipEntryAnimation = true;
      render();
      state.sidebarSkipEntryAnimation = false;
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

  // 两个方向都算数（见 touchmove 里的说明）
  if (!cancelled && Math.abs(deltaX) > SIDEBAR_CLOSE_COMMIT_PX) {
    closeSidebarAnimated();
  } else {
    drawer.style.transform = "";
    if (overlayEl) overlayEl.style.removeProperty("--scrim-progress");
  }
}

document.addEventListener("touchend", () => finishSidebarGesture(false));
// 系统/浏览器抢走触摸序列时（来电、手势冲突等）要有兜底，否则抽屉会停在半开状态
document.addEventListener("touchcancel", () => finishSidebarGesture(true));

/**
 * 抑制滑动手势结束后浏览器补发的那一次合成 click。
 *
 * 这是"右滑时像同时点了右上角按钮、两个侧边栏动画叠加"以及"在侧边栏上拖动时主页
 * 闪屏、海报重新载入"的真正原因：手指抬起后，浏览器会在松手位置补发一个 click。
 * 此时手势层的 .overlay 正盖满全屏，这个 click 于是落在遮罩上（data-action="close-overlay"）
 * 或落在抽屉的菜单项上，触发一次 render() —— app.innerHTML 被整体重建，
 * 所有 <img> 重新创建并重新加载（海报"强制刷新"），叠在正在播的手势动画上就是闪屏。
 *
 * 用捕获阶段拦下手势结束后的第一次 click 即可。只在手势真正 armed 过时才拦，
 * 普通点击完全不受影响。
 */
let suppressNextClickUntil = 0;

function suppressClickAfterGesture() {
  suppressNextClickUntil = Date.now() + 500;
}

document.addEventListener("click", (event) => {
  if (Date.now() > suppressNextClickUntil) return;
  suppressNextClickUntil = 0;
  event.stopPropagation();
  event.preventDefault();
}, true);
window.addEventListener("pagehide", () => {
  void releaseTicketOcrWorker();
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
  void backfillBangumiDirectorTags();
} catch (error) {
  app.innerHTML = `<main class="fatal-error"><h1>无法打开本地记录</h1><p>${escapeHtml(error.message)}</p><p>请确认浏览器允许使用本地存储后再重试。</p></main>`;
}
