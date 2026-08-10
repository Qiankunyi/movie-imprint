/**
 * R2 · 记录入口重排：状态机与场景数据构建
 *
 * 纯函数模块，不接触 DOM／数据库／网络。src/app.js 负责渲染、剪贴板读取与持久化，
 * 这里只负责：
 *   - 捕获流程状态机的转移规则（idle → capture:entry → ticket-confirm / scene-choice → compose）
 *   - 由票务解析结果 / 手填场景构建可编辑的 pendingViewingEvent 草稿
 *   - 活动标签、特典备注、初看/重看翻转的纯数据操作
 *   - 从 captureContext 推导作品标题，替代旧的「必须写 #作品名」路径
 *
 * 红线：这里的任何函数都不得把 captureContext 的字段拼回 rawText——
 * 用户在 Step 3 输入的原文必须原样保存，不得出现自动插入的 "#"。
 */

import { parseDraft, createRawOnlyRecord } from "./domain.js";

// ─── 状态机 ──────────────────────────────────────────────────────────────────

/**
 * 捕获流程状态机。纯函数：(state, action, context) → 下一个 state。
 * 未定义的转移原样返回当前 state，不抛错——方便 UI 侧安全地忽略无效点击。
 *
 * @param {string} state 当前状态
 * @param {string} action 触发的动作
 * @param {{ source?: "ticket_paste" | "manual" | "skipped" | null }} [context] 仅 compose 的 edit-context 转移需要，
 *   用于决定回到 ticket-confirm 还是 scene-choice
 * @returns {string}
 */
export function captureTransition(state, action, context = {}) {
  // “开始记录”是一个重启动作，不是只在 idle 下才生效的普通转移。
  // 应用恢复了 Step 3 草稿、或旧浮层留下了 capture:compose 状态时，用户仍然可能
  // 从首页／片单／作品页发起一条新的观影记录。此时必须无条件回到观影信息 Step 1。
  if (action === "open-capture") return "capture:entry";

  switch (state) {
    case "idle":
      return state;

    case "capture:entry":
      if (action === "paste-ticket" || action === "use-clipboard") return "capture:ticket-confirm";
      if (action === "manual") return "capture:scene-choice";
      // 跳过时仍创建一条明确的待确认 ViewingEvent；它不是“在家观看”，也没有
      // 虚构观看日期。用户完成感想后可在详情页补全。
      if (action === "skip") return "capture:compose";
      if (action === "close") return "idle";
      return state;

    case "capture:ticket-confirm":
      if (action === "confirm") return "capture:compose";
      if (action === "repaste") return "capture:entry";
      if (action === "close") return "idle";
      return state;

    case "capture:scene-choice":
      if (action === "confirm") return "capture:compose";
      if (action === "close") return "idle";
      return state;

    case "capture:compose":
      if (action === "edit-context") {
        if (context.source === "skipped") return "capture:scene-choice";
        return context.source === "manual" ? "capture:scene-choice" : "capture:ticket-confirm";
      }
      if (action === "finish" || action === "close") return "idle";
      return state;

    default:
      return state;
  }
}

/**
 * 所有“记录这次观看”入口共用的初始上下文。
 * 传入 work 时锁定到已有作品；不传时由票务或后续手填补全作品身份。
 * @param {{ work?: object|null, subjectId?: string|number|null }} [input]
 */
export function createViewingCaptureContext({ work = null, subjectId = null, viewedOn = null } = {}) {
  const lockedWork = Boolean(work?.id);
  return {
    source: null,
    lockedWork,
    workId: lockedWork ? work.id : null,
    workTitle: lockedWork ? (work.title || "") : "",
    subjectId: lockedWork ? subjectId : null,
    viewedOn,
    locationType: null,
    cinemaName: null,
    auditorium: null,
    version: null,
    format: null,
    formatNote: null,
    is3D: false,
    ticketAmount: null,
    ticketCurrency: "JPY",
    ticketCount: 1,
    eventTypes: [],
    bonusNote: null,
    workMatch: { status: "idle", candidates: [], sources: null },
    selectedCandidate: null,
    hasHistory: false,
    existingHistoryCount: 0,
    relationOverride: null,
    relationLocked: false,
    pendingEvents: []
  };
}

// ─── 活动标签 / 特典备注 ─────────────────────────────────────────────────────

/**
 * 切换活动标签的选中状态（多选，去重）。
 * @param {string[]} eventTypes
 * @param {string} key
 * @returns {string[]}
 */
export function toggleEventType(eventTypes, key) {
  const set = new Set(eventTypes || []);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set];
}

/**
 * 特典备注只在选中 bonus_distribution 时保留；取消选中后清空。
 * @param {string[]} eventTypes
 * @param {string|null} bonusNote
 * @returns {string|null}
 */
export function syncBonusNote(eventTypes, bonusNote) {
  return (eventTypes || []).includes("bonus_distribution") ? (bonusNote || null) : null;
}

/**
 * 更新一个 pending ViewingEvent（票务分支）的活动标签，并同步特典备注。
 * @param {object} pendingEvent
 * @param {string[]} eventTypes
 */
export function updateEventTicketTags(pendingEvent, eventTypes) {
  const nextTypes = [...new Set(eventTypes || [])];
  return {
    ...pendingEvent,
    viewing_context: {
      ...pendingEvent.viewing_context,
      event_types: nextTypes,
      bonus_note: syncBonusNote(nextTypes, pendingEvent.viewing_context?.bonus_note)
    }
  };
}

/**
 * 更新一个 pending ViewingEvent 的特典备注（仅在已选中 bonus_distribution 时生效）。
 * @param {object} pendingEvent
 * @param {string} bonusNote
 */
export function updateBonusNote(pendingEvent, bonusNote) {
  return {
    ...pendingEvent,
    viewing_context: {
      ...pendingEvent.viewing_context,
      bonus_note: syncBonusNote(pendingEvent.viewing_context?.event_types, bonusNote)
    }
  };
}

// ─── 初看／重看：用户手动翻转 ─────────────────────────────────────────────────

/**
 * 用户在确认卡里手动翻转初看／重看。
 * 只切换显示值并加锁；watch_index 与是否冲突交给 assignViewingRelations 在整体回写时重算。
 * @param {object} event
 * @returns {object}
 */
export function flipViewingRelation(event) {
  const next = event.viewing_relation === "first" ? "rewatch" : "first";
  return { ...event, viewing_relation: next, relation_locked: true };
}

/**
 * 在还没有写库之前，给确认卡一个「大概率是什么」的展示用初看／重看提示。
 * 只用于 UI 展示默认选中态，不是最终结果——最终结果始终由 assignViewingRelations
 * 结合该作品全部事件（含历史）重新计算。
 * @param {number} existingHistoryCount 该作品已有的历史观影事件数
 * @param {number} indexInBatch 本次新增事件在这批里的顺序（从 0 开始）
 * @returns {"first" | "rewatch"}
 */
export function tentativeViewingRelation(existingHistoryCount, indexInBatch) {
  const position = (existingHistoryCount || 0) + indexInBatch + 1;
  return position === 1 ? "first" : "rewatch";
}

// ─── 票务确认卡：逐场次勾选（用户掌握信息主动权，不强制全部采纳解析结果）──────

/**
 * 一封票务邮件可能被拆成多个场次，其中某些可能是误识别（例如把正文里无关的
 * 一段文本也当成了独立场次）。确认卡默认全选，但用户必须能单独排除某一场，
 * 而不是只能整体重新粘贴——这是这批 pendingEvent 的"是否采纳"标记，
 * 不影响 viewing_context 等其他字段。
 * @param {object[]} events
 * @param {number} index
 * @returns {object[]} 新数组，index 对应项的 selected 取反（默认视为已选中）
 */
export function toggleEventSelection(events, index) {
  return (events || []).map((event, i) => {
    if (i !== index) return event;
    const currentlySelected = event.selected !== false;
    return { ...event, selected: !currentlySelected };
  });
}

/**
 * 全选：把所有场次的 selected 都置为 true。
 * @param {object[]} events
 * @returns {object[]}
 */
export function selectAllEvents(events) {
  return (events || []).map((event) => ({ ...event, selected: true }));
}

/**
 * 取出用户实际勾选、要写入 DB 的场次（selected 未显式设为 false 即视为选中）。
 * @param {object[]} events
 * @returns {object[]}
 */
export function selectedPendingEvents(events) {
  return (events || []).filter((event) => event.selected !== false);
}

// ─── 跳过分支：手填场景 ──────────────────────────────────────────────────────

function newEventId() {
  return `ve_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 跳过票务时使用的占位事件。地点与实际日期保持未知，绝不默认成在家观看。 */
export function buildPendingViewingEvent() {
  const id = newEventId();
  return {
    id,
    viewing_id: id,
    work_id: null,
    record_id: null,
    viewed_on: null,
    screening_at: null,
    screening_ends_at: null,
    duration_minutes: null,
    viewing_relation: null,
    watch_index: null,
    location_type: null,
    ticket_price: null,
    source: "skipped",
    screened_content: { kind: "full_movie", episode_start: null, episode_end: null, display_label: null },
    viewing_context: {
      cinema_name: null,
      auditorium: null,
      city: null,
      version: null,
      format: null,
      format_note: null,
      is_3d: false,
      seats: [],
      seat_count: 0,
      ticket_provider: null,
      ticket_type: null,
      event_types: [],
      bonus_note: null
    },
    needs_review: true,
    confirmed_at: null,
    status: "pending_confirmation"
  };
}

/**
 * 跳过分支（Step 2B）：构建手填的 pendingViewingEvent 草稿。
 * 初看／重看与观看地点完全正交——这里永远不预设 viewing_relation，
 * 交由 assignViewingRelations 按时间判定。
 *
 * @param {{ viewedOn: string, locationType: "home" | "cinema", cinemaName?: string|null,
 *   auditorium?: string|null, version?: string|null, format?: string|null,
 *   formatNote?: string|null, is3D?: boolean,
 *   eventTypes?: string[], bonusNote?: string|null }} input
 * @returns {object}
 */
export function buildManualViewingEvent({ viewedOn, locationType, cinemaName = null, auditorium = null, version = null, format = null, formatNote = null, is3D = false, ticketPrice = null, eventTypes = [], bonusNote = null } = {}) {
  const id = newEventId();
  const isCinema = locationType === "cinema";
  const normalizedEventTypes = isCinema ? [...new Set(eventTypes)] : [];
  return {
    id,
    viewing_id: id,
    work_id: null,
    record_id: null,
    viewed_on: viewedOn || null,
    screening_at: null,
    screening_ends_at: null,
    duration_minutes: null,
    viewing_relation: null,
    watch_index: null,
    location_type: isCinema ? "cinema" : "home",
    ticket_price: isCinema && Number(ticketPrice?.amount) > 0
      ? {
          amount: Number(ticketPrice.amount),
          currency: ticketPrice.currency === "CNY" ? "CNY" : "JPY",
          count: Math.max(1, Number(ticketPrice.count) || 1)
        }
      : null,
    source: "manual",
    screened_content: { kind: "full_movie", episode_start: null, episode_end: null, display_label: null },
    viewing_context: {
      cinema_name: isCinema ? (cinemaName || null) : null,
      auditorium: isCinema ? (auditorium || null) : null,
      city: null,
      version: version || null,
      format: isCinema ? (format || null) : null,
      format_note: isCinema ? (formatNote || null) : null,
      is_3d: isCinema ? Boolean(is3D) : false,
      seats: [],
      seat_count: 0,
      ticket_provider: null,
      ticket_type: null,
      event_types: normalizedEventTypes,
      bonus_note: isCinema ? syncBonusNote(normalizedEventTypes, bonusNote) : null
    },
    confirmed_at: null,
    status: "pending_confirmation"
  };
}

// ─── 作品标题解析：captureContext 优先，不依赖 # ──────────────────────────────

/**
 * 推导用于 resolveWork 的作品标题。
 * 新流程下标题来自 captureContext（票务解析出的片名，或场景二选一里手填/匹配的标题），
 * 完全不需要用户输入 #。仍兼容没有 captureContext 的旧草稿（回退到 # 解析）。
 * @param {string} text composer 原文
 * @param {{ workTitle?: string|null }|null} captureContext
 * @returns {string}
 */
export function captureWorkTitle(text, captureContext) {
  const fromContext = captureContext?.workTitle?.trim();
  if (fromContext) return fromContext;
  return parseDraft(text || "").title;
}

/**
 * 组装最终要写入的 record 骨架。
 * 红线：rawText 必须与用户输入完全一致，任何 captureContext 字段都不得拼进 rawText，
 * 也不会有代码自动插入 "#"。
 * @param {string} text
 * @param {string} now ISO 时间戳
 * @returns {object}
 */
export function finalizeCaptureRecord(text, now) {
  return createRawOnlyRecord(text, now);
}
