import test from "node:test";
import assert from "node:assert/strict";
import {
  changeShareCardLanguage,
  createShareCardDraft,
  dateLinesForDraft,
  isShareCardLiked,
  isShareCardRecommended,
  localizedTagLabel,
  localizedWorkTitle
} from "../src/share-card.js";

const work = {
  id: "work_msm34um5_qrwod2",
  title: "蜘蛛侠：崭新之日",
  original_title: "Spider-Man: Brand New Day",
  aliases: ["スパイダーマン：ブランド・ニュー・デイ"],
  stills: [
    { id: "s1", source: "tmdb", path: "/abcdefgh.jpg" },
    { id: "s2", source: "external", url: "https://example.com/second.jpg" },
    { id: "s3", source: "external", url: "https://example.com/third.jpg" }
  ]
};

const records = [
  { id: "r1", viewing_event_id: "e1", attitude: "like", recommendation: "no", createdAt: "2026-05-01" },
  { id: "r2", viewing_event_id: "e2", attitude: "dislike", recommendation: "yes", createdAt: "2026-08-16" }
];

const events = [
  { id: "e1", viewed_on: "2026-05-01", viewing_context: { format: "IMAX", event_types: ["stage_greeting"] } },
  { id: "e2", screening_at: "2026-08-16T18:30:00+09:00", viewing_context: { format: "4D", format_note: "4DX", event_types: ["premiere"] } }
];

test("draft clones real work data and caps its default selection at two stills", () => {
  const draft = createShareCardDraft({ work, records, viewingEvents: events, profile: { nickname: "kira" } });
  assert.equal(draft.workId, work.id);
  assert.equal(draft.stillMode, "double");
  assert.deepEqual(draft.selectedStillIds, ["s1", "s2"]);
  assert.equal(draft.nickname, "kira");
  assert.equal(draft.attitude, "dislike");
  assert.equal(draft.recommendation, "yes");
  draft.title = "临时标题";
  assert.equal(work.title, "蜘蛛侠：崭新之日");
});

test("single and aggregate date copy use actual valid event dates", () => {
  const multiple = createShareCardDraft({ work, records, viewingEvents: events });
  assert.deepEqual(dateLinesForDraft(multiple), ["首刷 2026.05.01 / 最近 2026.08.16", "（共 2 次）"]);
  const single = createShareCardDraft({ work, records: records.slice(0, 1), viewingEvents: events.slice(0, 1) });
  assert.deepEqual(dateLinesForDraft(single), ["2026.05.01 · 首刷"]);
  const none = createShareCardDraft({ work, records: [], viewingEvents: [{ viewed_on: null }] });
  assert.deepEqual(dateLinesForDraft(none), []);
  const sameDay = createShareCardDraft({ work, records, viewingEvents: [events[0], { ...events[0], id: "e3" }] });
  assert.deepEqual(dateLinesForDraft(sameDay), ["首刷 2026.05.01 / 最近 2026.05.01", "（共 2 次）"]);
});

test("format and event tags are de-duplicated without limiting the data layer", () => {
  const draft = createShareCardDraft({ work, records, viewingEvents: [...events, events[0]], extraTags: ["Staff"] });
  assert.deepEqual(draft.tags.map((tag) => tag.label), ["IMAX", "舞台挨拶", "4DX", "プレミア上映", "Staff"]);
  assert.equal(localizedTagLabel(draft.tags[1], "zh"), "舞台见面会");
  assert.equal(localizedTagLabel(draft.tags[1], "en"), "Stage greeting");
});

test("language picks localized title candidates and switching only changes draft", () => {
  assert.equal(localizedWorkTitle(work, "zh"), "蜘蛛侠：崭新之日");
  assert.equal(localizedWorkTitle(work, "ja"), "スパイダーマン：ブランド・ニュー・デイ");
  assert.equal(localizedWorkTitle(work, "en"), "Spider-Man: Brand New Day");
  const original = createShareCardDraft({ work, records, viewingEvents: events });
  const changed = changeShareCardLanguage(original, "en");
  assert.equal(changed.title, "Spider-Man: Brand New Day");
  assert.equal(original.language, "zh");
});

test("heart and recommendation remain independent", () => {
  assert.equal(isShareCardLiked("like"), true);
  assert.equal(isShareCardLiked("dislike"), false);
  assert.equal(isShareCardRecommended("yes"), true);
  assert.equal(isShareCardRecommended("depends"), true);
  assert.equal(isShareCardRecommended("no"), false);
  assert.equal(isShareCardRecommended(null), false);
});
