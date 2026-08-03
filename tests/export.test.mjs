import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportPayload,
  copyExportText,
  deliverExport,
  downloadExport,
  exportAllFilename,
  exportAllJSON,
  exportAllMarkdown,
  exportFilename,
  exportJSON,
  exportMarkdown,
  exportTXT,
  MIME_TYPES
} from "../src/export.js";

// ─── 固定测试数据 ───────────────────────────────────────────────────────────

function makeRecord(overrides = {}) {
  return {
    id: "record_1",
    title: "穿越时空的少女",
    rawText: "#穿越时空的少女 #电影院\n重映这天再看，还是会被最后那句来自未来的约定击中。",
    createdAt: "2026-07-20T12:00:00.000Z",
    attitude: "like",
    recommendation: "depends",
    recommendationNote: "适合喜欢青春动画的人",
    recommendationDetails: { audiences: ["系列观众"], reasons: [], cautions: [], noReasons: [], issueTypes: [], positives: [] },
    emotions: [{ label: "怀旧" }, { label: "感动" }],
    cards: [
      { card_id: "card_1", type: "被击中的瞬间", title: "最后那句约定", content: "来自未来的约定击中了我。", is_core: true, order: 0 },
      { card_id: "card_2", type: "场景", title: "", content: "重映影厅的光线。", is_core: false, order: 1 }
    ],
    ...overrides
  };
}

function makeWork(overrides = {}) {
  return {
    id: "work_1",
    title: "穿越时空的少女",
    original_title: "時をかける少女",
    release_year: 2006,
    external_refs: [{ source: "bangumi", id: "1234" }],
    ...overrides
  };
}

function makeViewingEvents() {
  return [{
    id: "ve_1",
    work_id: "work_1",
    viewed_on: "2026-07-20",
    screening_at: "2026-07-20T12:35:00+09:00",
    screening_ends_at: "2026-07-20T14:10:00+09:00",
    viewing_context: {
      cinema_name: "MOVIX京都",
      city: "京都",
      format: "字幕版",
      seats: ["J-11", "J-12"],
      seat_count: 2,
      ticket_provider: "SMT"
    }
  }];
}

// ─── 内容生成 ───────────────────────────────────────────────────────────────

test("exportJSON 包含完整原文、态度、情绪、卡片、场次，且不含票务敏感字段", () => {
  const record = makeRecord();
  const work = makeWork();
  const events = makeViewingEvents();
  const payload = JSON.parse(exportJSON(record, work, events));

  assert.equal(payload.title, "穿越时空的少女");
  assert.equal(payload.raw_text, record.rawText);
  assert.equal(payload.attitude_label, "喜欢");
  assert.equal(payload.recommendation_label, "看对象");
  assert.deepEqual(payload.emotions, ["怀旧", "感动"]);
  assert.equal(payload.cards.length, 2);
  assert.equal(payload.cards[0].content, "来自未来的约定击中了我。");
  assert.equal(payload.viewing_events.length, 1);
  assert.equal(payload.viewing_events[0].cinema, "MOVIX京都");
  assert.deepEqual(payload.viewing_events[0].seats, ["J-11", "J-12"]);

  // 不含订单号/票价/姓名/邮箱这类敏感字段（这些从未进入 viewing_context，这里再确认导出层没有引入）
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["order", "price", "円", "¥", "email", "ticket_provider", "seat_count", "city"]) {
    assert.equal(serialized.includes(forbidden), false, `导出内容不应包含 ${forbidden}`);
  }
});

test("exportMarkdown 包含原文、场次、态度推荐与记忆卡片分节", () => {
  const md = exportMarkdown(makeRecord(), makeWork(), makeViewingEvents());
  assert.match(md, /^# 穿越时空的少女/);
  assert.match(md, /## 观影场次/);
  assert.match(md, /MOVIX京都/);
  assert.match(md, /## 原文/);
  assert.match(md, /重映这天再看/);
  assert.match(md, /## 态度与推荐/);
  assert.match(md, /个人态度：喜欢/);
  assert.match(md, /## 记忆卡片/);
  assert.match(md, /最后那句约定（核心）/);
});

test("exportTXT 是纯文本，包含原文与场次信息，适合直接阅读", () => {
  const txt = exportTXT(makeRecord(), makeWork(), makeViewingEvents());
  assert.equal(txt.includes("##"), false); // 不引入 Markdown 标题标记（原文里用户自己的 # 标签允许保留）
  assert.match(txt, /观影场次：/);
  assert.match(txt, /原文：/);
  assert.match(txt, /重映这天再看/);
  assert.match(txt, /个人态度：喜欢/);
});

test("没有场次信息时三种格式都能正常生成，不出现空场次分节", () => {
  const record = makeRecord({ cards: [] });
  assert.doesNotThrow(() => exportJSON(record, null, []));
  const md = exportMarkdown(record, null, []);
  assert.equal(md.includes("## 观影场次"), false);
  assert.equal(md.includes("## 记忆卡片"), false);
  const txt = exportTXT(record, null, []);
  assert.equal(txt.includes("观影场次："), false);
});

test("buildExportPayload 对未匹配作品和空态度也能生成合理默认值", () => {
  const record = makeRecord({ attitude: null, recommendation: null, emotions: [] });
  const payload = buildExportPayload(record, null, []);
  assert.equal(payload.title, record.title);
  assert.equal(payload.attitude_label, "尚未选择");
  assert.equal(payload.bangumi_id, null);
});

// ─── 批量导出 ───────────────────────────────────────────────────────────────

test("exportAllJSON / exportAllMarkdown 汇总多条记录", () => {
  const entries = [
    { record: makeRecord(), work: makeWork(), viewingEvents: makeViewingEvents() },
    { record: makeRecord({ id: "record_2", title: "雨中的车站", rawText: "#雨中的车站\n像是真的被带进那场雨里。" }), work: null, viewingEvents: [] }
  ];
  const all = JSON.parse(exportAllJSON(entries));
  assert.equal(all.count, 2);
  assert.equal(all.records.length, 2);
  assert.equal(all.records[1].title, "雨中的车站");

  const md = exportAllMarkdown(entries);
  assert.match(md, /# 穿越时空的少女/);
  assert.match(md, /# 雨中的车站/);
  assert.match(md, /\n\n---\n\n/);
});

// ─── 文件名 ─────────────────────────────────────────────────────────────────

test("exportFilename 生成安全文件名，包含作品名与今天日期", () => {
  const name = exportFilename(makeWork(), makeRecord(), "json");
  assert.match(name, /^movie-imprint_穿越时空的少女_\d{4}-\d{2}-\d{2}\.json$/);
});

test("exportFilename 清理文件名中的非法字符", () => {
  const work = makeWork({ title: 'A/B\\C:D*E?F"G<H>I|J K' });
  const name = exportFilename(work, makeRecord(), "md");
  assert.equal(/[/\\:*?"<>|]/.test(name.replace(".md", "")), false);
});

test("exportAllFilename 生成批量导出文件名", () => {
  const name = exportAllFilename("json");
  assert.match(name, /^movie-imprint_全部记录_\d{4}-\d{2}-\d{2}\.json$/);
});

// ─── 交付层：分享优先，复制/下载为辅 ────────────────────────────────────────

function fakeDocument() {
  const created = [];
  return {
    createElement(tag) {
      const el = {
        tag, clicked: false, appended: false,
        click() { this.clicked = true; },
        remove() {}
      };
      created.push(el);
      return el;
    },
    body: { appendChild(el) { el.appended = true; } },
    _created: created
  };
}

function fakeURL() {
  const revoked = [];
  return {
    createObjectURL: () => "blob:fake-url",
    revokeObjectURL: (url) => revoked.push(url),
    _revoked: revoked
  };
}

test("deliverExport 优先走文件分享（移动端主路径）", async () => {
  const calls = [];
  const nav = {
    canShare: (data) => Array.isArray(data.files) && data.files.length === 1,
    share: async (data) => { calls.push(data); }
  };
  const result = await deliverExport(
    { content: "hello", filename: "a.md", mimeType: MIME_TYPES.markdown, shareTitle: "标题" },
    { navigator: nav, File: globalThis.File, Blob: globalThis.Blob }
  );
  assert.equal(result.method, "share-file");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].files[0].name, "a.md");
});

test("deliverExport 在不支持文件分享但支持文本分享时退化为文本分享", async () => {
  const calls = [];
  const nav = {
    // 没有 canShare，只有 share（部分安卓浏览器的情况）
    share: async (data) => { calls.push(data); }
  };
  const result = await deliverExport(
    { content: "纯文本内容", filename: "a.txt", mimeType: MIME_TYPES.txt },
    { navigator: nav }
  );
  assert.equal(result.method, "share-text");
  assert.equal(calls[0].text, "纯文本内容");
});

test("deliverExport 在分享不可用时退化为浏览器下载", async () => {
  const doc = fakeDocument();
  const url = fakeURL();
  const result = await deliverExport(
    { content: "{}", filename: "a.json", mimeType: MIME_TYPES.json },
    { navigator: {}, document: doc, URL: url, Blob: globalThis.Blob }
  );
  assert.equal(result.method, "download");
  assert.equal(doc._created[0].clicked, true);
  assert.equal(doc._created[0].appended, true);
  assert.equal(url._revoked.length, 1);
});

test("deliverExport 在用户取消分享时不再退化为下载", async () => {
  const doc = fakeDocument();
  const nav = {
    canShare: () => true,
    share: async () => { const e = new Error("cancelled"); e.name = "AbortError"; throw e; }
  };
  const result = await deliverExport(
    { content: "hello", filename: "a.md", mimeType: MIME_TYPES.markdown },
    { navigator: nav, File: globalThis.File, Blob: globalThis.Blob, document: doc, URL: fakeURL() }
  );
  assert.equal(result.method, "cancelled");
  assert.equal(doc._created.length, 0);
});

test("downloadExport 直接触发下载，不尝试分享", () => {
  const doc = fakeDocument();
  const url = fakeURL();
  const result = downloadExport("content", "a.txt", MIME_TYPES.txt, { document: doc, URL: url, Blob: globalThis.Blob });
  assert.equal(result.method, "download");
  assert.equal(doc._created[0].clicked, true);
});

test("copyExportText 使用 Clipboard API 复制文本", async () => {
  const calls = [];
  const nav = { clipboard: { writeText: async (text) => calls.push(text) } };
  const result = await copyExportText("要复制的内容", { navigator: nav });
  assert.equal(result.method, "copy");
  assert.deepEqual(calls, ["要复制的内容"]);
});

test("copyExportText 在剪贴板不可用时抛出错误", async () => {
  await assert.rejects(() => copyExportText("x", { navigator: {} }));
});
