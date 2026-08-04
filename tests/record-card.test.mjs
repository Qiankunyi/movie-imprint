import test from "node:test";
import assert from "node:assert/strict";
import { recordCard, emptyHomeStateMarkup } from "../src/record-card.js";

const buildPosterUrl = (subjectId) => `https://img.example.com/${subjectId}`;

function cinemaRecord(overrides = {}) {
  return {
    record: {
      id: "record_1",
      title: "原始标题",
      createdAt: "2026-08-03T10:00:00.000Z",
      attitude: "like",
      ...overrides.record
    },
    work: {
      title: "剧场版：测试",
      identity_status: "matched",
      poster_subject_id: 123,
      ...overrides.work
    },
    event: {
      location_type: "cinema",
      screening_at: "2026-08-03T19:20:00+09:00",
      watch_index: 1,
      viewing_context: { format: "IMAX", event_types: [], cinema_name: "TOHO シネマズ 新宿" },
      ...overrides.event
    }
  };
}

test("影院卡：含影院名、制式徽章、增强描边 class", () => {
  const { record, work, event } = cinemaRecord();
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /record-card cinema high-spec/);
  assert.match(html, /TOHO シネマズ 新宿/);
  assert.match(html, /tone-imax/);
  assert.match(html, /IMAX/);
});

test("线上/在家卡：含「在家观看」、无制式徽章、无高光 class", () => {
  const { record, work } = cinemaRecord();
  const event = { location_type: "home", viewed_on: "2026-11-20", watch_index: 1, viewing_context: { format: null, event_types: [] } };
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /record-card home"/);
  assert.doesNotMatch(html, /high-spec/);
  assert.match(html, /在家观看/);
  assert.doesNotMatch(html, /format-badge solid/);
});

test("补充记录卡：含「补充记录」、含间隔年数、日期弱化", () => {
  const record = { id: "record_2", title: "旧作", createdAt: "2029-03-02T00:00:00.000Z", attitude: "love", record_kind: "supplement" };
  const work = { title: "旧作", first_recorded_at: "2026-03-02T00:00:00.000Z" };
  const html = recordCard(record, { work, buildPosterUrl });
  assert.match(html, /record-card supplement/);
  assert.match(html, /补充记录/);
  assert.match(html, /距首次观看 3 年/);
  // R5 补丁 2：卡片结构改成 标题 / 影院名行 / 态度 / 右下角日期，
  // 补充记录的说明文字现在落在影院名那一行的位置上。
  assert.match(html, /record-card-venue">补充记录 · 距首次观看 3 年</);
});

test("watch_index >= 2 → 显示「重看 · 第N次」", () => {
  const { record, work } = cinemaRecord();
  const event = { location_type: "home", viewed_on: "2026-11-20", watch_index: 2, viewing_context: { format: null, event_types: [] } };
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /重看 · 第2次/);
});

test("watch_index === 1 → 不显示重看徽章", () => {
  const { record, work, event } = cinemaRecord();
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.doesNotMatch(html, /重看/);
});

test("watch_index === 1 且 location_type === home → 正常渲染，不显示重看徽章", () => {
  const { record, work } = cinemaRecord();
  const event = { location_type: "home", viewed_on: "2026-11-20", watch_index: 1, viewing_context: { format: null, event_types: [] } };
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.doesNotMatch(html, /重看/);
  assert.match(html, /在家观看/);
});

test("watch_index === 7 → 显示「重看 · 第7次」，两位数不撑破布局", () => {
  const { record, work, event } = cinemaRecord({ event: { watch_index: 7 } });
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /重看 · 第7次/);
});

test("影院卡且 watch_index >= 2 → 增强描边与制式勋章照常显示，不因重看降级", () => {
  const { record, work, event } = cinemaRecord({ event: { watch_index: 3 } });
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /record-card cinema high-spec/);
  assert.match(html, /tone-imax/);
  assert.match(html, /重看 · 第3次/);
});

test("无海报 → 渲染占位块而非破图", () => {
  const { record, event } = cinemaRecord();
  const work = { title: "本地作品", identity_status: "local_only", poster_subject_id: null };
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /record-poster-fallback/);
  assert.match(html, />本</);
});

test("卡片不再渲染感想原文预览", () => {
  const { record, work, event } = cinemaRecord({ record: { rawText: "这段原文绝不应该出现在首页卡片里" } });
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.doesNotMatch(html, /这段原文绝不应该出现在首页卡片里/);
});

test("草稿卡：有 captureContext 时显示海报与作品名", () => {
  const draft = { id: "active", text: "还没写完", captureContext: { workTitle: "进行中的作品", subjectId: 456 } };
  const html = recordCard(draft, { isDraft: true, buildPosterUrl });
  assert.match(html, /draft-card/);
  assert.match(html, /进行中的作品/);
  assert.match(html, /<img class="record-poster-img"/);
});

test("草稿卡：没有 captureContext 时维持「继续写」", () => {
  const draft = { id: "active", text: "随手写的几个字" };
  const html = recordCard(draft, { isDraft: true, buildPosterUrl });
  assert.match(html, /继续写/);
  assert.doesNotMatch(html, /<img/);
});

test("无记录 → 渲染空状态插画与文案，不是白屏", () => {
  const html = emptyHomeStateMarkup();
  assert.match(html, /home-empty/);
  assert.match(html, /<img/);
  assert.match(html, /电影散场以后/);
});

// R3 补丁 1：海报改为占据卡片整个左侧（record-card-button 直接包住 poster + body，
// 不再有把 poster 和文字都框进去、四周留白的 record-card-row）
test("海报直接是 record-card-button 的第一个子元素，不再包在四周留白的 row 容器里", () => {
  const { record, work, event } = cinemaRecord();
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.doesNotMatch(html, /record-card-row/);
  assert.match(html, /<button class="record-card-button"[^>]*>\s*<div class="record-poster"/);
});

// R3 补丁 1：「仅保存原文」/「待确认作品」从文字行改为叠加在海报角落的小标签，
// 不再挤占文字区（R5 补丁 2 之后，文字区的对应位置是态度标签那一行）
test("仅保存原文 → 状态标签叠在海报上，不在文字区里", () => {
  const { record, work, event } = cinemaRecord({ record: { status: "raw_only_confirmed" } });
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /<div class="record-poster"[^>]*>[\s\S]*?record-poster-status[\s\S]*?<\/div>/);
  assert.match(html, /仅保存原文/);
  const bodyMatch = html.match(/<div class="record-card-body">([\s\S]*?)<\/button>/);
  assert.ok(bodyMatch, "应有 record-card-body");
  assert.doesNotMatch(bodyMatch[1], /仅保存原文|work-match-status/);
});

test("待确认作品 → 状态标签同样叠在海报上，不在文字区里", () => {
  const { record, event } = cinemaRecord();
  const work = { title: "本地作品", identity_status: "local_only", poster_subject_id: null, match: { status: "needs_confirmation" } };
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /待确认作品/);
  const bodyMatch = html.match(/<div class="record-card-body">([\s\S]*?)<\/button>/);
  assert.ok(bodyMatch, "应有 record-card-body");
  assert.doesNotMatch(bodyMatch[1], /待确认作品/);
});

test("R5 补丁 2/3：卡片信息顺序为 标题 → 影院名+徽章 → 底部（态度 + 日期同一行）", () => {
  const { record, work, event } = cinemaRecord();
  const html = recordCard(record, { work, event, buildPosterUrl });
  const order = ["record-card-title", "record-card-venue-row", "record-card-bottom", "record-attitude-tag", "record-card-date"]
    .map((cls) => html.indexOf(cls));
  assert.ok(order.every((index) => index !== -1), "各区块都应存在");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "顺序必须是 标题→影院名→底部行(态度→日期)");
  // 徽章跟在影院名右边、同一行里
  assert.match(html, /record-card-venue-row">[\s\S]*?record-card-venue[\s\S]*?record-badge-row/);
  // 态度与日期必须在同一个底部行里（用户要求态度下移与时间平齐）
  assert.match(html, /record-card-bottom">[\s\S]*?record-attitude-tag[\s\S]*?record-card-date/);
});

test("R5 补丁 3：卡片日期只到日，不含星期与具体时刻", () => {
  const { record, work } = cinemaRecord();
  const event = { location_type: "cinema", screening_at: "2026-07-18T09:50:00+09:00", viewing_context: { format: null, event_types: [] } };
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /record-card-date">2026\/07\/18</);
  assert.doesNotMatch(html, /09:50/);
  assert.doesNotMatch(html, /\(土\)/);
});

test("R5 补丁 2：有海报时只渲染 <img>（靠原图比例撑宽度），不再叠一层占位块", () => {
  const { record, work, event } = cinemaRecord();
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.match(html, /record-poster-img/);
  assert.doesNotMatch(html, /record-poster-fallback/);
});

test("正常记录（无异常状态）→ 海报上不渲染状态标签", () => {
  const { record, work, event } = cinemaRecord();
  const html = recordCard(record, { work, event, buildPosterUrl });
  assert.doesNotMatch(html, /record-poster-status/);
});
