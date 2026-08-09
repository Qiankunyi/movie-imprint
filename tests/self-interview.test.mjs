import test from "node:test";
import assert from "node:assert/strict";
import {
  SELF_INTERVIEW_QUESTIONS,
  answeredInterviewItems,
  completeSelfInterview,
  createSelfInterview,
  saveInterviewAnswer,
  skipSelfInterview
} from "../src/self-interview.js";
import { markAnalysesStale, normalizeV21Record, reviseRawText } from "../src/imprint-v2.js";

test("V2.1 固定8问的 id 与顺序保持冻结", () => {
  assert.deepEqual(SELF_INTERVIEW_QUESTIONS.map((question) => question.id), [
    "first_recall", "memorable_line", "memorable_scene", "salient_character",
    "small_detail", "strongest_feeling", "lingering_thought", "one_line_memory"
  ]);
});

test("采访逐题保存区分 answered / skipped，并完整保留长回答", () => {
  let interview = createSelfInterview("record_1", "2026-08-09T00:00:00.000Z");
  const longText = "下雨的车站让我想到告别。".repeat(100);
  interview = saveInterviewAnswer(interview, "first_recall", longText, "answered", "2026-08-09T00:01:00.000Z");
  interview = saveInterviewAnswer(interview, "memorable_line", "", "skipped", "2026-08-09T00:02:00.000Z");
  assert.equal(interview.status, "in_progress");
  assert.equal(interview.answers[0].answer_text, longText);
  assert.equal(interview.answers[0].status, "answered");
  assert.equal(interview.answers[1].status, "skipped");
  assert.notEqual(interview.answers[0].revision_id, interview.answers[1].revision_id);
});

test("回答3题后结束属于有效完成，其余问题显式记为 skipped", () => {
  let interview = createSelfInterview("record_2");
  for (const id of ["first_recall", "memorable_scene", "one_line_memory"]) {
    interview = saveInterviewAnswer(interview, id, `${id} 的回答`);
  }
  interview = completeSelfInterview(interview);
  assert.equal(interview.status, "completed");
  assert.equal(interview.answers.length, 8);
  assert.equal(answeredInterviewItems(interview).length, 3);
  assert.equal(interview.answers.filter((answer) => answer.status === "skipped").length, 5);
});

test("整体跳过采访不使用空字符串冒充未开始状态", () => {
  const interview = skipSelfInterview(createSelfInterview("record_3"));
  assert.equal(interview.status, "skipped");
  assert.equal(interview.answers.length, 8);
  assert.ok(interview.answers.every((answer) => answer.status === "skipped"));
});

test("旧记录无 SelfInterview 可安全归一化，旧 AI 建议与正式卡分离", () => {
  const record = normalizeV21Record({
    id: "legacy",
    rawText: "旧原文",
    createdAt: "2026-01-01T00:00:00.000Z",
    cards: [
      { card_id: "draft", type: "场景", content: "AI建议", order: 0, is_core: true, provenance: "ai_suggested" },
      { card_id: "formal", type: "台词", content: "已保留", order: 1, is_core: true, provenance: "user_accepted" }
    ]
  });
  assert.equal(record.self_interview.status, "not_started");
  assert.deepEqual(record.cards.map((card) => card.card_id), ["formal"]);
  assert.deepEqual(record.activeAnalysisDraft.memory_cards.map((card) => card.card_id), ["draft"]);
});

test("修改原始资料只标 stale，不改正式卡和历史 Evidence", () => {
  const record = normalizeV21Record({
    id: "record_4",
    rawText: "下雨的车站",
    cards: [{ card_id: "card_1", type: "场景", content: "车站", evidence: [{ excerpt: "下雨的车站" }], is_core: true, order: 0, provenance: "user_accepted", analysis_id: "analysis_1" }],
    analysis_history: [{ analysis_id: "analysis_1", stale: false }]
  });
  const before = structuredClone(record.cards);
  reviseRawText(record, "晴天的车站", "2026-08-09T01:00:00.000Z");
  assert.equal(record.analysis_stale, true);
  assert.equal(record.analysis_history[0].stale, true);
  assert.deepEqual(record.cards, before);
  assert.equal(record.raw_revisions[0].raw_text, "下雨的车站");
});

test("无分析时 markAnalysesStale 不制造虚假的 stale 状态", () => {
  const record = { cards: [], analysis_history: [], activeAnalysisDraft: null };
  markAnalysesStale(record);
  assert.equal(record.analysis_stale, false);
});
