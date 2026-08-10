import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  captureTransition,
  toggleEventType,
  syncBonusNote,
  updateEventTicketTags,
  updateBonusNote,
  flipViewingRelation,
  tentativeViewingRelation,
  buildManualViewingEvent,
  buildPendingViewingEvent,
  createViewingCaptureContext,
  captureWorkTitle,
  finalizeCaptureRecord,
  toggleEventSelection,
  selectAllEvents,
  selectedPendingEvents
} from "../src/capture.js";
import { parseTicketText, draftViewingEvent } from "../src/ticket.js";
import { assignViewingRelations, resolveWork } from "../src/domain.js";

// ─── 状态机 ──────────────────────────────────────────────────────────────────

describe("captureTransition 状态机", () => {
  it("idle --open-capture--> capture:entry", () => {
    assert.equal(captureTransition("idle", "open-capture"), "capture:entry");
  });

  it("open-capture 从任意旧流程状态都强制重启到观影信息", () => {
    for (const current of ["capture:entry", "capture:ticket-confirm", "capture:scene-choice", "capture:compose"]) {
      assert.equal(captureTransition(current, "open-capture"), "capture:entry", current);
    }
  });

  it("idle 上无关动作原样返回", () => {
    assert.equal(captureTransition("idle", "confirm"), "idle");
  });

  it("capture:entry --paste-ticket--> capture:ticket-confirm", () => {
    assert.equal(captureTransition("capture:entry", "paste-ticket"), "capture:ticket-confirm");
  });

  it("capture:entry --use-clipboard--> capture:ticket-confirm", () => {
    assert.equal(captureTransition("capture:entry", "use-clipboard"), "capture:ticket-confirm");
  });

  it("capture:entry --manual--> capture:scene-choice", () => {
    assert.equal(captureTransition("capture:entry", "manual"), "capture:scene-choice");
  });

  it("capture:entry --skip--> capture:compose（由待确认事件承接观影信息）", () => {
    assert.equal(captureTransition("capture:entry", "skip"), "capture:compose");
  });

  it("capture:entry --close--> idle", () => {
    assert.equal(captureTransition("capture:entry", "close"), "idle");
  });

  it("capture:ticket-confirm --confirm--> capture:compose", () => {
    assert.equal(captureTransition("capture:ticket-confirm", "confirm"), "capture:compose");
  });

  it("capture:ticket-confirm --repaste--> capture:entry", () => {
    assert.equal(captureTransition("capture:ticket-confirm", "repaste"), "capture:entry");
  });

  it("capture:ticket-confirm --close--> idle", () => {
    assert.equal(captureTransition("capture:ticket-confirm", "close"), "idle");
  });

  it("capture:scene-choice --confirm--> capture:compose", () => {
    assert.equal(captureTransition("capture:scene-choice", "confirm"), "capture:compose");
  });

  it("capture:scene-choice --close--> idle", () => {
    assert.equal(captureTransition("capture:scene-choice", "close"), "idle");
  });

  it("capture:compose --finish--> idle", () => {
    assert.equal(captureTransition("capture:compose", "finish"), "idle");
  });

  it("capture:compose --close--> idle（草稿保留由调用方负责，状态机本身回到 idle）", () => {
    assert.equal(captureTransition("capture:compose", "close"), "idle");
  });

  it("capture:compose --edit-context--> 依据 context.source 回到 ticket-confirm 或 scene-choice", () => {
    assert.equal(captureTransition("capture:compose", "edit-context", { source: "ticket_paste" }), "capture:ticket-confirm");
    assert.equal(captureTransition("capture:compose", "edit-context", { source: "manual" }), "capture:scene-choice");
    assert.equal(captureTransition("capture:compose", "edit-context", { source: "skipped" }), "capture:scene-choice");
  });

  it("未定义的转移原样返回当前状态，不抛错", () => {
    assert.equal(captureTransition("capture:scene-choice", "paste-ticket"), "capture:scene-choice");
    assert.equal(captureTransition("unknown-state", "anything"), "unknown-state");
  });
});

describe("createViewingCaptureContext 统一入口上下文", () => {
  it("首页等未知作品入口从空上下文开始", () => {
    const context = createViewingCaptureContext();
    assert.equal(context.lockedWork, false);
    assert.equal(context.workId, null);
    assert.equal(context.workTitle, "");
    assert.deepEqual(context.pendingEvents, []);
  });

  it("片单或作品页入口锁定同一个已有 Work", () => {
    const context = createViewingCaptureContext({
      work: { id: "work_birdman", title: "Birdman" },
      subjectId: 265865,
      viewedOn: "2017-09-10"
    });
    assert.equal(context.lockedWork, true);
    assert.equal(context.workId, "work_birdman");
    assert.equal(context.workTitle, "Birdman");
    assert.equal(context.subjectId, 265865);
    assert.equal(context.viewedOn, "2017-09-10");
  });
});

// ─── 跳过分支：手填场景 ──────────────────────────────────────────────────────

describe("buildManualViewingEvent（手动填写观影信息）", () => {
  it("在家／线上", () => {
    const event = buildManualViewingEvent({ viewedOn: "2017-09-10", locationType: "home" });
    assert.equal(event.location_type, "home");
    assert.equal(event.viewed_on, "2017-09-10");
    assert.equal(event.source, "manual");
    assert.equal(event.viewing_relation, null, "不预设初看/重看，交给 assignViewingRelations");
    assert.deepEqual(event.viewing_context.event_types, []);
  });

  it("在影院（手填影院名 + 制式）", () => {
    const event = buildManualViewingEvent({ viewedOn: "2017-09-10", locationType: "cinema", cinemaName: "TOHOシネマズ新宿", auditorium: "IMAX厅", version: "4Kリマスター", format: "IMAX", formatNote: "", is3D: true });
    assert.equal(event.location_type, "cinema");
    assert.equal(event.viewed_on, "2017-09-10");
    assert.equal(event.source, "manual");
    assert.equal(event.viewing_context.cinema_name, "TOHOシネマズ新宿");
    assert.equal(event.viewing_context.auditorium, "IMAX厅");
    assert.equal(event.viewing_context.version, "4Kリマスター");
    assert.equal(event.viewing_context.format, "IMAX");
    assert.equal(event.viewing_context.format_note, null);
    assert.equal(event.viewing_context.is_3d, true);
  });

  it("手填影院票价时金额、币种、张数独立保存", () => {
    const event = buildManualViewingEvent({
      viewedOn: "2017-09-10",
      locationType: "cinema",
      ticketPrice: { amount: 45, currency: "CNY", count: 2 }
    });
    assert.deepEqual(event.ticket_price, { amount: 45, currency: "CNY", count: 2 });
    const home = buildManualViewingEvent({ locationType: "home", ticketPrice: { amount: 1800, currency: "JPY" } });
    assert.equal(home.ticket_price, null, "在家观看不保存影院票价");
  });

  it("在影院 + 选中活动 + 特典备注", () => {
    const event = buildManualViewingEvent({
      locationType: "cinema",
      cinemaName: "MOVIX京都",
      eventTypes: ["stage_greeting", "stage_greeting"],
      bonusNote: "第3週 色紙"
    });
    // 未选中 bonus_distribution，备注应被清空
    assert.deepEqual(event.viewing_context.event_types, ["stage_greeting"]);
    assert.equal(event.viewing_context.bonus_note, null);
  });

  it("选中 bonus_distribution 才保留备注", () => {
    const event = buildManualViewingEvent({
      locationType: "cinema",
      eventTypes: ["bonus_distribution"],
      bonusNote: "第3週 色紙"
    });
    assert.equal(event.viewing_context.bonus_note, "第3週 色紙");
  });
});

describe("buildPendingViewingEvent（暂时跳过）", () => {
  it("日期和观看方式保持待确认，不默认成在家观看", () => {
    const event = buildPendingViewingEvent();
    assert.equal(event.viewed_on, null);
    assert.equal(event.location_type, null);
    assert.equal(event.needs_review, true);
    assert.equal(event.source, "skipped");
  });
});

// ─── 活动标签与特典备注 ──────────────────────────────────────────────────────

describe("toggleEventType / syncBonusNote", () => {
  it("添加一个未选中的标签", () => {
    assert.deepEqual(toggleEventType(["stage_greeting"], "cheer_screening"), ["stage_greeting", "cheer_screening"]);
  });

  it("取消一个已选中的标签", () => {
    assert.deepEqual(toggleEventType(["stage_greeting", "cheer_screening"], "stage_greeting"), ["cheer_screening"]);
  });

  it("输入数组本身含重复项时仍能正确去重", () => {
    assert.deepEqual(toggleEventType(["stage_greeting", "stage_greeting"], "cheer_screening"), ["stage_greeting", "cheer_screening"]);
  });

  it("未选中 bonus_distribution 时备注恒为 null", () => {
    assert.equal(syncBonusNote(["stage_greeting"], "任何备注"), null);
  });

  it("选中 bonus_distribution 时保留备注", () => {
    assert.equal(syncBonusNote(["bonus_distribution"], "第3週 色紙"), "第3週 色紙");
  });
});

describe("updateEventTicketTags / updateBonusNote（票务确认卡编辑）", () => {
  const sampleScreening = {
    movieTitle: "劇場版○○",
    rawTitle: "【IMAX】【舞台挨拶付き】劇場版○○",
    viewedOn: "2026-08-03",
    screeningAt: "2026-08-03T19:20:00+09:00",
    screeningEndsAt: "2026-08-03T22:00:00+09:00",
    cinemaName: "TOHOシネマズ新宿",
    city: "東京",
    format: "IMAX",
    eventTypes: ["stage_greeting"],
    seats: ["K-11", "K-12"],
    seatCount: 2,
    ticketProvider: "TOHO",
    ticketPrice: { amount: 4000, currency: "CNY", count: 2 }
  };

  it("解析出的 event_types 在确认卡预选", () => {
    const pending = draftViewingEvent(sampleScreening, "work_temp_1");
    assert.deepEqual(pending.viewing_context.event_types, ["stage_greeting"]);
  });

  it("用户取消预选项后不再出现在最终 Event", () => {
    const pending = draftViewingEvent(sampleScreening, "work_temp_1");
    const nextTypes = toggleEventType(pending.viewing_context.event_types, "stage_greeting");
    const updated = updateEventTicketTags(pending, nextTypes);
    assert.deepEqual(updated.viewing_context.event_types, []);
  });

  it("手动加选活动后正确写入且去重", () => {
    const pending = draftViewingEvent(sampleScreening, "work_temp_1");
    const nextTypes = toggleEventType(pending.viewing_context.event_types, "cheer_screening");
    const updated = updateEventTicketTags(pending, nextTypes);
    assert.deepEqual(updated.viewing_context.event_types.sort(), ["cheer_screening", "stage_greeting"].sort());
  });

  it("选中 bonus_distribution 才出现备注输入，取消后备注清空", () => {
    let pending = draftViewingEvent(sampleScreening, "work_temp_1");
    let types = toggleEventType(pending.viewing_context.event_types, "bonus_distribution");
    pending = updateEventTicketTags(pending, types);
    pending = updateBonusNote(pending, "第3週 色紙");
    assert.equal(pending.viewing_context.bonus_note, "第3週 色紙");

    types = toggleEventType(pending.viewing_context.event_types, "bonus_distribution");
    pending = updateEventTicketTags(pending, types);
    assert.equal(pending.viewing_context.bonus_note, null, "取消选中后备注应被清空");
  });

  it("无任何活动时 event_types 为空数组，不是 null", () => {
    const noEventScreening = { ...sampleScreening, eventTypes: [] };
    const pending = draftViewingEvent(noEventScreening, "work_temp_1");
    assert.deepEqual(pending.viewing_context.event_types, []);
    assert.notEqual(pending.viewing_context.event_types, null);
  });
});

// ─── 初看／重看：用户翻转 ────────────────────────────────────────────────────

describe("flipViewingRelation / tentativeViewingRelation", () => {
  it("翻转后 relation_locked 为 true，值互换", () => {
    const event = { viewing_relation: "first" };
    const flipped = flipViewingRelation(event);
    assert.equal(flipped.viewing_relation, "rewatch");
    assert.equal(flipped.relation_locked, true);

    const flippedBack = flipViewingRelation(flipped);
    assert.equal(flippedBack.viewing_relation, "first");
    assert.equal(flippedBack.relation_locked, true);
  });

  it("tentativeViewingRelation：无历史、批内第一个 → first", () => {
    assert.equal(tentativeViewingRelation(0, 0), "first");
  });

  it("tentativeViewingRelation：已有历史 → rewatch", () => {
    assert.equal(tentativeViewingRelation(1, 0), "rewatch");
  });

  it("该作品已有一次「在家」观影时，新记录一次「影院」观影 → 影院这次被推定为 rewatch", () => {
    const homeEvent = { id: "ve_home", location_type: "home", screening_at: null, viewed_on: "2020-01-01" };
    const cinemaEvent = buildManualViewingEvent({ locationType: "cinema", cinemaName: "TOHO" });
    cinemaEvent.id = "ve_cinema";
    cinemaEvent.viewed_on = "2026-08-03";
    const all = assignViewingRelations([homeEvent, cinemaEvent]);
    const home = all.find((e) => e.id === "ve_home");
    const cinema = all.find((e) => e.id === "ve_cinema");
    assert.equal(home.viewing_relation, "first");
    assert.equal(cinema.viewing_relation, "rewatch");
  });

  it("该作品已有一次「影院」观影时，新记录一次时间更早的观影 → 新的成为 first，原有的变 rewatch", () => {
    const laterCinema = { id: "ve_later", location_type: "cinema", viewed_on: "2026-08-03", viewing_relation: "first", watch_index: 1 };
    const earlierHome = buildManualViewingEvent({ locationType: "home" });
    earlierHome.id = "ve_earlier";
    earlierHome.viewed_on = "2020-01-01";
    const all = assignViewingRelations([laterCinema, earlierHome]);
    const later = all.find((e) => e.id === "ve_later");
    const earlier = all.find((e) => e.id === "ve_earlier");
    assert.equal(earlier.viewing_relation, "first");
    assert.equal(later.viewing_relation, "rewatch");
  });
});

// ─── 票务确认卡：逐场次勾选，用户可以排除误识别的场次 ─────────────────────────

describe("toggleEventSelection / selectAllEvents / selectedPendingEvents", () => {
  const makeEvents = () => [
    { id: "ve_1", viewing_context: {} },
    { id: "ve_2", viewing_context: {} },
    { id: "ve_3", viewing_context: {} }
  ];

  it("默认全部视为已选中（没有 selected 字段时按 true 处理）", () => {
    const events = makeEvents();
    assert.deepEqual(selectedPendingEvents(events).map((e) => e.id), ["ve_1", "ve_2", "ve_3"]);
  });

  it("取消某一场后不再出现在最终写入的场次里", () => {
    const events = toggleEventSelection(makeEvents(), 1);
    assert.equal(events[1].selected, false);
    assert.deepEqual(selectedPendingEvents(events).map((e) => e.id), ["ve_1", "ve_3"]);
  });

  it("再次点击同一场可以重新选中", () => {
    let events = toggleEventSelection(makeEvents(), 1);
    events = toggleEventSelection(events, 1);
    assert.equal(events[1].selected, true);
    assert.deepEqual(selectedPendingEvents(events).map((e) => e.id), ["ve_1", "ve_2", "ve_3"]);
  });

  it("全选恢复所有场次为选中状态", () => {
    let events = toggleEventSelection(makeEvents(), 0);
    events = toggleEventSelection(events, 2);
    events = selectAllEvents(events);
    assert.deepEqual(selectedPendingEvents(events).map((e) => e.id), ["ve_1", "ve_2", "ve_3"]);
  });

  it("全部取消后 selectedPendingEvents 返回空数组，而不是 null／undefined", () => {
    let events = makeEvents();
    events = toggleEventSelection(events, 0);
    events = toggleEventSelection(events, 1);
    events = toggleEventSelection(events, 2);
    const selected = selectedPendingEvents(events);
    assert.deepEqual(selected, []);
  });

  it("不修改传入的原数组（纯函数）", () => {
    const original = makeEvents();
    const snapshot = JSON.parse(JSON.stringify(original));
    toggleEventSelection(original, 0);
    assert.deepEqual(original, snapshot);
  });
});

// ─── 作品标题解析与 rawText 红线 ─────────────────────────────────────────────

describe("captureWorkTitle / finalizeCaptureRecord", () => {
  it("有 captureContext.workTitle 时优先使用，不依赖 #", () => {
    const text = "看完之后，先把还没消失的感觉写下来。灯光暗下来那一刻还是会起鸡皮疙瘩。";
    const title = captureWorkTitle(text, { workTitle: "劇場版○○" });
    assert.equal(title, "劇場版○○");
  });

  it("没有 captureContext 时回退到旧的 # 解析（兼容旧草稿）", () => {
    const title = captureWorkTitle("#穿越时空的少女 重映这天再看还是会被击中", null);
    assert.equal(title, "穿越时空的少女");
  });

  it("完成记录时，rawText 里没有任何自动插入的 #（票务分支）", () => {
    const text = "灯光暗下来那一刻，还是会起鸡皮疙瘩。";
    const now = new Date().toISOString();
    const record = finalizeCaptureRecord(text, now);
    assert.equal(record.rawText, text);
    assert.ok(!record.rawText.includes("#"));
  });

  it("完成记录时，rawText 里没有任何自动插入的 #（手填在影院分支，含影院名/制式/活动）", () => {
    const text = "这次去的影院音响效果特别好。";
    const now = new Date().toISOString();
    const captureContext = {
      source: "manual",
      workTitle: "劇場版○○",
      locationType: "cinema",
      cinemaName: "TOHOシネマズ新宿",
      format: "IMAX"
    };
    const record = finalizeCaptureRecord(text, now, captureContext);
    assert.equal(record.rawText, text);
    assert.ok(!record.rawText.includes("#"));
    assert.equal(captureWorkTitle(text, captureContext), "劇場版○○");
  });

  it("完成记录时用户原本自己打的 # 不受影响（不强制移除）", () => {
    const text = "#穿越时空的少女 还是被打动了";
    const now = new Date().toISOString();
    const record = finalizeCaptureRecord(text, now);
    assert.equal(record.rawText, text);
  });
});

// ─── captureContext 完整性（模拟草稿持久化的结构化往返）────────────────────────

describe("captureContext 持久化往返", () => {
  it("票务分支的 captureContext 可安全 JSON 序列化/反序列化（模拟 IndexedDB/D1 持久化）", () => {
    const parseResult = parseTicketText(`
作品名：【IMAX】【舞台挨拶付き】劇場版○○
観賞日：2026/8/3
開映時間：19:20
終映時間：22:00
劇場：TOHOシネマズ新宿
座席：K-11・K-12
`.trim());
    const pendingEvents = parseResult.screenings.map((s) => draftViewingEvent(s, "work_temp_1"));
    const captureContext = {
      source: "ticket_paste",
      locationType: "cinema",
      workTitle: "劇場版○○",
      subjectId: null,
      pendingEvents
    };
    const roundTripped = JSON.parse(JSON.stringify(captureContext));
    assert.deepEqual(roundTripped, captureContext);
    assert.equal(roundTripped.pendingEvents[0].viewing_context.event_types.includes("stage_greeting"), true);
  });

  it("手填分支的 captureContext 可安全往返", () => {
    const event = buildManualViewingEvent({ locationType: "cinema", cinemaName: "MOVIX京都", format: "2D" });
    const captureContext = { source: "manual", locationType: "cinema", workTitle: "雨中的车站", subjectId: null, pendingEvents: [event] };
    const roundTripped = JSON.parse(JSON.stringify(captureContext));
    assert.deepEqual(roundTripped, captureContext);
  });
});

// ─── 该作品是否已有历史（决定初看/重看选择器是否显示）──────────────────────────

describe("resolveWork 配合历史判断（该作品无历史记录时不应显示初看/重看选择器）", () => {
  it("全新作品：resolveWork 返回 isNew === true，UI 侧应据此隐藏选择器", () => {
    const { isNew } = resolveWork([], { title: "从未记录过的作品" });
    assert.equal(isNew, true);
  });

  it("已存在同名作品：resolveWork 返回 isNew === false，UI 侧应据此可能显示选择器", () => {
    const { work } = resolveWork([], { title: "穿越时空的少女" });
    const { isNew } = resolveWork([work], { title: "穿越时空的少女" });
    assert.equal(isNew, false);
  });
});

// ─── R6 补丁 7：从已有作品页发起记录时，Work 必须被锁定 ──────────────────────
//
// 实测发现的问题：进入 Birdman 作品页点「记录这次观看」，捕获流程仍然要求重新
// 输入作品名，不填就无法确认；填了还会再去搜一次外部数据库。根因是那个按钮
// 当时接的是**全局**入口（open-capture），根本没有携带 work_id。
//
// 下面这几条锁的是这条闭环里"Work 已知就不再重新识别"这个契约。
// captureContext 的形状与 src/app.js 里的一致。

describe("R6 补丁 7：lockedWork 的行为契约", () => {
  const lockedCtx = () => ({
    source: "manual",
    lockedWork: true,
    workId: "work_birdman",
    workTitle: "鸟人",
    subjectId: null
  });

  it("锁定时作品名来自 Work，不从正文里解析 # 标签", () => {
    const ctx = lockedCtx();
    // 正文里写了另一个 # 标签也不该影响——作品是页面给的，不是文本给的
    assert.equal(captureWorkTitle("#完全不相干的片 今天终于看了", ctx), "鸟人");
  });

  it("锁定时确认按钮不该被「作品名为空」卡住", () => {
    // canConfirm = Boolean(locationType) && (lockedWork || Boolean(workTitle))
    const canConfirm = (ctx, locationType) =>
      Boolean(locationType) && (ctx.lockedWork || Boolean(ctx.workTitle?.trim()));

    assert.equal(canConfirm(lockedCtx(), "cinema"), true);
    // 即便标题被清空，锁定态仍然可以确认
    assert.equal(canConfirm({ ...lockedCtx(), workTitle: "" }, "home"), true);
    // 未锁定则仍然要求填作品名
    assert.equal(canConfirm({ lockedWork: false, workTitle: "" }, "cinema"), false);
  });

  it("跳过票务导入时仍保留锁定作品", () => {
    const after = createViewingCaptureContext({ work: { id: "work_birdman", title: "鸟人" } });
    after.source = "skipped";
    after.pendingEvents = [buildPendingViewingEvent()];
    assert.equal(after.lockedWork, true);
    assert.equal(after.workId, "work_birdman");
    assert.equal(after.workTitle, "鸟人");
    assert.equal(after.pendingEvents[0].needs_review, true, "跳过会建立明确的待确认 ViewingEvent");
    assert.equal(after.pendingEvents[0].location_type, null, "待确认事件不能默认成在家观看");
  });

  it("票务粘贴时，锁定的作品名优先于票面片名", () => {
    // 复现 handleCapturePaste 的取值逻辑
    const resolveTitle = (prev, ticketTitle) =>
      prev?.lockedWork ? prev.workTitle : (ticketTitle || "");

    // 票面写的是日文原名，但用户是从「鸟人」这个 Work 进来的
    assert.equal(resolveTitle(lockedCtx(), "バードマン あるいは（無知がもたらす予期せぬ奇跡）"), "鸟人");
    // 全局入口则采用票面片名
    assert.equal(resolveTitle(null, "バードマン"), "バードマン");
  });

  it("§14 最后一道保障：Work 已知时绝不走 resolveWork 的标题模糊匹配", () => {
    // 复现 finishCompose 的判定
    const shouldUseKnownWork = (ctx) =>
      Boolean(ctx?.workId) && (ctx.mode === "supplement" || Boolean(ctx.lockedWork));

    assert.equal(shouldUseKnownWork(lockedCtx()), true);
    assert.equal(shouldUseKnownWork({ mode: "supplement", workId: "work_x" }), true);
    // 全局入口没有 workId，只能靠 resolveWork
    assert.equal(shouldUseKnownWork({ source: "manual", workTitle: "鸟人" }), false);
    assert.equal(shouldUseKnownWork(null), false);
  });

  it("锁定时不发起外部身份匹配", () => {
    // 复现 handleCapturePaste 末尾的条件
    const shouldMatchExternally = (ctx) => !ctx?.lockedWork;
    assert.equal(shouldMatchExternally(lockedCtx()), false);
    assert.equal(shouldMatchExternally({ source: "ticket_paste" }), true);
  });
});

// ─── R6 补丁 11：输入法组合与候选选中态 ─────────────────────────────────────
//
// 实测反馈两条：
// 1) 用中文输入法打「聚焦」时，拼音才敲到 "ju" 匹配就跑起来并重渲染，输入被打断，
//    得和匹配进程抢速度；
// 2) 点中想要的条目后，事实上选中了（能进下一步），但视觉上没有任何选中态。

describe("R6 补丁 11：中文输入法下的匹配调度", () => {
  // 复现 src/app.js 里 input 处理器的守卫条件
  const shouldSchedule = ({ isComposing = false, imeComposing = false, value = "", lockedWork = false }) => {
    if (lockedWork) return false;
    if (isComposing || imeComposing) return false;
    return String(value).trim().length >= 2;
  };

  it("拼音输入过程中一律不调度匹配", () => {
    // 打「聚焦」的中间态：j → ju → jujiao，全程 isComposing 为 true
    for (const value of ["j", "ju", "juj", "jujiao"]) {
      assert.equal(shouldSchedule({ isComposing: true, value }), false, `"${value}" 组合中不该触发`);
    }
  });

  it("组合结束后才调度，且仍然要求至少 2 个字符", () => {
    assert.equal(shouldSchedule({ value: "聚焦" }), true);
    assert.equal(shouldSchedule({ value: "聚" }), false, "单字太短，噪声太大");
    assert.equal(shouldSchedule({ value: "  " }), false);
  });

  it("Work 已锁定时永远不调度——作品已经确定，不需要再匹配", () => {
    assert.equal(shouldSchedule({ value: "聚焦", lockedWork: true }), false);
  });

  it("英文输入不经过组合，照常按长度调度", () => {
    assert.equal(shouldSchedule({ value: "Spotlight" }), true);
    assert.equal(shouldSchedule({ value: "S" }), false);
  });
});

describe("R6 补丁 11：候选选中态", () => {
  // 复现 captureCandidatesMarkup 里的选中判定
  const isSelected = (selected, candidate) =>
    Boolean(selected) && selected.source === candidate.source && String(selected.sourceId) === String(candidate.sourceId);

  const spotlight = { source: "tmdb", sourceId: "314365", title: "聚焦" };
  const bgmOne = { source: "bangumi", sourceId: "12345", title: "行家本色" };

  it("选中判定必须 source + sourceId 同时相等", () => {
    assert.equal(isSelected(spotlight, spotlight), true);
    assert.equal(isSelected(spotlight, bgmOne), false);
    // 不同源但 id 恰好相同，绝不能误判成同一条
    assert.equal(isSelected({ source: "bangumi", sourceId: "314365" }, spotlight), false);
  });

  it("sourceId 的数字/字符串差异不影响判定", () => {
    assert.equal(isSelected({ source: "tmdb", sourceId: 314365 }, spotlight), true);
  });

  it("没有选中任何条目时全部为未选中", () => {
    assert.equal(isSelected(null, spotlight), false);
    assert.equal(isSelected(undefined, spotlight), false);
  });
});
