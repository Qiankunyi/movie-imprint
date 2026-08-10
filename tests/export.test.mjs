import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportPayload,
  copyExportText,
  deliverExport,
  downloadExport,
  exportAllFilename,
  buildCollectionsExport,
  buildExternalPublicationsExport,
  exportCollectionsMarkdown,
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
  const blobs = [];
  return {
    createObjectURL: (blob) => { blobs.push(blob); return "blob:fake-url"; },
    revokeObjectURL: (url) => revoked.push(url),
    _revoked: revoked,
    _blobs: blobs
  };
}

// 真机 bug 复现（2026-08-03）：安卓 Chrome 上"分享"完全没有弹出系统分享面板，直接下载了
// 一个乱码文件。根因是旧实现先尝试带文件分享（{files:[...]}），失败后又调用一次纯文本
// 分享，第二次 navigator.share() 因为"用户激活"已被第一次调用消耗而被浏览器静默拒绝，
// 表现为分享面板完全不出现。修复方案是文本类格式只用一次 Web Share Level 1 纯文本分享，
// 不再尝试文件分享。以下测试锁定这个行为。

test("deliverExport 对文本类格式只调用一次 navigator.share（纯文本分享），不做第二次尝试", async () => {
  const calls = [];
  const nav = {
    canShare: () => true, // 即使浏览器声称支持文件分享，也不应该被调用到
    share: async (data) => { calls.push(data); }
  };
  const result = await deliverExport(
    { content: "hello", filename: "a.md", mimeType: MIME_TYPES.markdown, shareTitle: "标题" },
    { navigator: nav }
  );
  assert.equal(result.method, "share-text");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "hello");
  assert.equal(calls[0].title, "标题");
  assert.equal("files" in calls[0], false); // 确认不是文件分享
});

test("deliverExport 在只有旧式 share（无 canShare）时依然能分享文本", async () => {
  const calls = [];
  const nav = {
    // 没有 canShare，只有 share
    share: async (data) => { calls.push(data); }
  };
  const result = await deliverExport(
    { content: "纯文本内容", filename: "a.txt", mimeType: MIME_TYPES.txt },
    { navigator: nav }
  );
  assert.equal(result.method, "share-text");
  assert.equal(calls[0].text, "纯文本内容");
});

test("deliverExport 分享失败（非用户取消）时退化为浏览器下载，且只调用一次 share", async () => {
  const shareCalls = [];
  const doc = fakeDocument();
  const url = fakeURL();
  const nav = {
    share: async (data) => { shareCalls.push(data); throw new Error("network error"); }
  };
  const result = await deliverExport(
    { content: "hello", filename: "a.md", mimeType: MIME_TYPES.markdown },
    { navigator: nav, document: doc, URL: url, Blob: globalThis.Blob }
  );
  assert.equal(result.method, "download");
  assert.equal(shareCalls.length, 1);
  assert.equal(doc._created[0].clicked, true);
});

test("deliverExport 对 JSON 这类非文本 MIME 类型不尝试分享，直接下载", async () => {
  const shareCalls = [];
  const doc = fakeDocument();
  const url = fakeURL();
  const nav = { share: async (data) => { shareCalls.push(data); } };
  const result = await deliverExport(
    { content: "{}", filename: "a.json", mimeType: MIME_TYPES.json },
    { navigator: nav, document: doc, URL: url, Blob: globalThis.Blob }
  );
  assert.equal(result.method, "download");
  assert.equal(shareCalls.length, 0);
});

test("deliverExport 在没有 navigator.share 时直接下载", async () => {
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
    share: async () => { const e = new Error("cancelled"); e.name = "AbortError"; throw e; }
  };
  const result = await deliverExport(
    { content: "hello", filename: "a.md", mimeType: MIME_TYPES.markdown },
    { navigator: nav, document: doc, URL: fakeURL() }
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

// 真机 bug 复现（2026-08-03）：下载/分享退化后的 .md 文件在手机文本查看器里打开是乱码。
// 本地文件不带 HTTP 响应头，查看器不会遵循 Blob 的 charset，只能靠内容自身的 UTF-8 BOM
// 识别编码，所以下载出的 Markdown/TXT 必须带 BOM；JSON 不加 BOM（避免影响以后重新导入解析）。
test("downloadExport 给 Markdown/TXT 加 UTF-8 BOM，避免本地文件查看器把内容认成别的编码", async () => {
  // Blob.text() 按 WHATWG Encoding 规范会自动吞掉前导 BOM，所以直接看原始字节
  const doc = fakeDocument();
  const url = fakeURL();
  downloadExport("中文内容", "a.md", MIME_TYPES.markdown, { document: doc, URL: url, Blob: globalThis.Blob });
  const bytes = new Uint8Array(await url._blobs[0].arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  // 去掉 BOM 后能正确还原为原文（确认没有破坏内容本身的编码）
  const withoutBom = Buffer.from(bytes.slice(3)).toString("utf-8");
  assert.equal(withoutBom, "中文内容");
});

test("downloadExport 不给 JSON 加 BOM", async () => {
  const doc = fakeDocument();
  const url = fakeURL();
  downloadExport('{"a":1}', "a.json", MIME_TYPES.json, { document: doc, URL: url, Blob: globalThis.Blob });
  const bytes = new Uint8Array(await url._blobs[0].arrayBuffer());
  assert.notDeepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(JSON.parse(Buffer.from(bytes).toString("utf-8")).a, 1);
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

// ─── R6 §14：片单纳入全量导出 ────────────────────────────────────────────────

const R6_WORKS = [
  {
    id: "work_birdman", title: "鸟人", original_title: "Birdman", release_year: 2014,
    merged_from: [], external_refs: [{ source: "tmdb", id: "194662" }, { source: "imdb", id: "tt2562232" }]
  },
  {
    id: "work_homecoming", title: "蜘蛛侠：英雄归来", merged_from: [], external_refs: []
  },
  {
    id: "work_merged", title: "你的名字。", release_year: 2016,
    merged_from: ["work_old_bgm"], external_refs: [{ source: "bangumi", id: "150775" }]
  }
];

const R6_COLLECTIONS = [
  {
    id: "c1", title: "Michael Keaton 补片", description: "重看《英雄归来》之后想补的",
    created_at: "2026-08-08T00:00:00.000Z", updated_at: "2026-08-08T00:00:00.000Z",
    entries: [
      {
        work_id: "work_birdman", added_at: "2026-08-08T00:00:00.000Z",
        reason: "重看《蜘蛛侠：英雄归来》后觉得他的秃鹫非常不错", source_work_id: "work_homecoming"
      },
      { work_id: "work_old_bgm", added_at: "2026-08-09T00:00:00.000Z", reason: "", source_work_id: null }
    ]
  }
];

test("R6：未观看作品的加入理由必须进导出——它是「发现过程」的记录", () => {
  const collections = buildCollectionsExport(R6_COLLECTIONS, R6_WORKS, () => false);
  const entry = collections[0].entries[0];

  assert.equal(collections[0].title, "Michael Keaton 补片");
  assert.equal(collections[0].description, "重看《英雄归来》之后想补的");
  assert.equal(entry.title, "鸟人");
  assert.equal(entry.reason, "重看《蜘蛛侠：英雄归来》后觉得他的秃鹫非常不错");
  assert.equal(entry.added_at, "2026-08-08T00:00:00.000Z");
  assert.equal(entry.watched, false);
  // §17：从哪部作品发现的，本阶段不做关系图但数据要留住
  assert.equal(entry.discovered_from, "蜘蛛侠：英雄归来");
  // 外部标识一并带出，导出的 JSON 到别处也能重新对上号
  assert.equal(entry.tmdb_id, "194662");
  assert.equal(entry.imdb_id, "tt2562232");
  assert.equal(entry.bangumi_id, null);
});

test("R6：已看状态是导出时现算的快照，条目里从来没存过这个字段", () => {
  const watched = buildCollectionsExport(R6_COLLECTIONS, R6_WORKS, (id) => id === "work_birdman");
  assert.equal(watched[0].entries[0].watched, true);
  const unwatched = buildCollectionsExport(R6_COLLECTIONS, R6_WORKS, () => false);
  assert.equal(unwatched[0].entries[0].watched, false);
  // 原始数据完全没被改动
  assert.ok(!("watched" in R6_COLLECTIONS[0].entries[0]));
});

test("R6：条目指向被合并掉的旧 work id 时，通过 merged_from 回查得到作品信息", () => {
  const collections = buildCollectionsExport(R6_COLLECTIONS, R6_WORKS, () => false);
  const entry = collections[0].entries[1];
  assert.equal(entry.title, "你的名字。", "合并过的作品不应在导出里变成空条目");
  assert.equal(entry.bangumi_id, "150775");
});

test("R6：exportAllJSON 带上片单，且 schema 版本号跟着升", () => {
  const payload = JSON.parse(exportAllJSON([], buildCollectionsExport(R6_COLLECTIONS, R6_WORKS, () => false)));
  assert.equal(payload.schema_version, "movie-imprint-export-all-0.4");
  assert.equal(payload.collections.length, 1);
  assert.equal(payload.collections[0].entries[0].reason, "重看《蜘蛛侠：英雄归来》后觉得他的秃鹫非常不错");
});

test("R6：exportAllMarkdown 里片单成段，已看/未看与理由都在", () => {
  const md = exportAllMarkdown([], buildCollectionsExport(R6_COLLECTIONS, R6_WORKS, () => false));
  assert.match(md, /# 片单/);
  assert.match(md, /## Michael Keaton 补片/);
  assert.match(md, /### 鸟人（2014） · 未看/);
  assert.match(md, /秃鹫非常不错/);
  assert.match(md, /> 从《蜘蛛侠：英雄归来》发现/);
});

test("外部发表进入全量 JSON/Markdown 备份，但不复制原帖正文", () => {
  const publications = buildExternalPublicationsExport([{
    id: "pub_1",
    work_id: "work_birdman",
    url: "https://x.com/me/status/1",
    normalized_url: "https://x.com/me/status/1",
    platform: "x",
    published_at: "2026-08-10",
    note: "重看后发表"
  }], R6_WORKS);
  const payload = JSON.parse(exportAllJSON([], [], publications));
  assert.equal(payload.external_publications[0].work_title, "鸟人");
  assert.equal(payload.external_publications[0].url, "https://x.com/me/status/1");
  const md = exportAllMarkdown([], [], publications);
  assert.match(md, /# 外部发表/);
  assert.match(md, /鸟人 · x · 2026-08-10/);
  assert.match(md, /https:\/\/x\.com\/me\/status\/1/);
});

test("R6：没有片单时不留一个空的「# 片单」标题", () => {
  assert.equal(exportCollectionsMarkdown([]), "");
  const md = exportAllMarkdown([], []);
  assert.doesNotMatch(md, /# 片单/);
});

test("标签实体与关联进入全量 JSON 备份", () => {
  const tags = [{ id: "tag_1", default_name: "夏天", category: "custom", source: "user" }];
  const assignments = [{ id: "work:w1:tag_1", tag_id: "tag_1", target_type: "work", target_id: "w1" }];
  const payload = JSON.parse(exportAllJSON([], [], [], tags, assignments));
  assert.deepEqual(payload.tags, tags);
  assert.deepEqual(payload.tag_assignments, assignments);
});
