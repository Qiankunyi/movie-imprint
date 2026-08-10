import test from "node:test";
import assert from "node:assert/strict";
import { CARD_TYPES, EMOTION_TAGS } from "../src/domain.js";
import { validateAiAnalysis } from "../src/ai.js";
import { analysisRequestSources, reviseRawText } from "../src/imprint-v2.js";

const sources = {
  free_reflection: {
    source_type: "free_reflection",
    source_id: "record_1",
    source_revision_id: "raw_rev_2",
    text: "雨中的车站让我很遗憾，也一直记得配乐。"
  },
  self_interview: {
    interview_id: "interview_1",
    answers: [{
      source_type: "self_interview",
      source_id: "answer_q3",
      source_revision_id: "answer_q3_rev_1",
      question_id: "memorable_scene",
      text: "最先想到的还是下雨的车站。"
    }]
  }
};

function evidence(overrides = {}) {
  return {
    source_type: "free_reflection",
    source_id: "record_1",
    source_revision_id: "raw_rev_2",
    question_id: "",
    excerpt: "雨中的车站",
    basis: "explicit",
    voice: "user",
    claim_mode: "observation",
    explanation: "用户直接提到这个场景",
    confidence: 0.9,
    ...overrides
  };
}

function output(cards = []) {
  return {
    attitude: { suggested: "none", alternative: "none", evidence: [], confidence: 0.5 },
    emotions: [{ label: "遗憾", evidence: [evidence({ excerpt: "很遗憾", claim_mode: "direct_feeling" })], confidence: 0.9 }],
    memory_cards: cards,
    warnings: []
  };
}

function card(index) {
  return {
    temporary_id: `memory_${index}`,
    memory_cluster_id: `cluster_${index}`,
    type: "场景",
    title: `记忆 ${index}`,
    content: "我记得雨中的车站。",
    why_it_matters: "",
    related_emotion_tag_ids: ["遗憾"],
    is_core_suggestion: index === 0,
    evidence: [evidence()],
    confidence: 0.8
  };
}

test("权威枚举严格对齐44种卡片类型与46种情绪", () => {
  assert.equal(CARD_TYPES.length, 44);
  assert.equal(new Set(CARD_TYPES).size, 44);
  assert.equal(EMOTION_TAGS.length, 46);
  assert.equal(new Set(EMOTION_TAGS).size, 46);
});

test("V2.1 双源 Evidence 精确关联来源与源版本", () => {
  const result = validateAiAnalysis(sources, output([{
    ...card(0),
    evidence: [evidence({
      source_type: "self_interview",
      source_id: "answer_q3",
      source_revision_id: "answer_q3_rev_1",
      question_id: "memorable_scene",
      excerpt: "下雨的车站"
    })]
  }]));
  assert.equal(result.memory_cards[0].evidence[0].source_type, "self_interview");
  assert.equal(result.memory_cards[0].evidence[0].question_id, "memorable_scene");
  assert.deepEqual(result.source_revision_ids, ["raw_rev_2", "answer_q3_rev_1"]);
});

test("采访问题文案不能冒充用户 Evidence", () => {
  const invalid = output([{ ...card(0), evidence: [evidence({
    source_type: "self_interview",
    source_id: "answer_q3",
    source_revision_id: "answer_q3_rev_1",
    question_id: "memorable_scene",
    excerpt: "印象最深的场景是什么？"
  })] }]);
  assert.throws(() => validateAiAnalysis(sources, invalid), /evidence_not_in_source/);
});

test("0张卡片是合法结果", () => {
  assert.deepEqual(validateAiAnalysis(sources, output([])).memory_cards, []);
});

test("卡片不再受固定7张上限约束", () => {
  const result = validateAiAnalysis(sources, output(Array.from({ length: 12 }, (_, index) => card(index))));
  assert.equal(result.memory_cards.length, 12);
});

test("一次分析最多一个核心建议，也允许没有", () => {
  const cards = [card(0), { ...card(1), is_core_suggestion: true }];
  assert.throws(() => validateAiAnalysis(sources, output(cards)), /multiple_core_suggestions/);
  const none = [card(0), card(1)].map((item) => ({ ...item, is_core_suggestion: false }));
  assert.equal(validateAiAnalysis(sources, output(none)).memory_cards.some((item) => item.is_core), false);
});

test("AI 请求读取自由感想的当前修订版而不是历史版本", () => {
  const record = {
    id: "record_latest",
    rawText: "旧版自由感想",
    raw_revision_id: "record_latest_rawrev_1",
    raw_revision_number: 1,
    raw_revisions: [],
    self_interview: { interview_id: "interview_latest", answers: [] }
  };
  reviseRawText(record, "新版自由感想里有独立记忆", "2026-08-10T00:00:00.000Z");
  const requestSources = analysisRequestSources(record);
  assert.equal(requestSources.free_reflection.text, "新版自由感想里有独立记忆");
  assert.equal(requestSources.free_reflection.source_revision_id, record.raw_revision_id);
  assert.equal(record.raw_revisions[0].raw_text, "旧版自由感想");
});
