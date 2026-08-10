/**
 * 回归测试：证据定位的格式容错。
 *
 * 线上故障复盘：
 *   用户一条《魔女宅急便 真人版》的感想，AI 整理反复失败，界面只给出
 *   `evidence_not_in_source:attitude:0`。原文是「一句一行」写下来的，
 *   模型引用时把两行接成了一句，`source.text.includes(excerpt)` 于是失败，
 *   **整份整理（态度、情绪、全部记忆卡片）一起作废**。
 *
 * 两条要同时成立、方向相反的性质：
 *   1. 纯格式差异（换行、空格、省略号、全半角）不该导致失败
 *   2. 模型编造或改写的内容必须照样被拒绝
 *
 * 还有一条容易被忽略的：存进 evidence 的必须是**原文里真实的那段字**，
 * 而不是模型改写后的版本——否则等于让 AI 悄悄替用户重写了自己的话。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateAiAnalysis } from "../src/ai.js";

// 按用户真实原文的形态构造：每个分句一行，含六个半角点的省略号、含半角空格
const RAW = `《花束般的恋爱》男主说的对啊。[泪奔]

去看了《魔女宅急便》动画电影的 4K 版 IMAX 重映。
回家后我好奇又去看了一下真人版电影。

前半部分还算能看，
无非是把现实中对待魔女的态度搬进来，
还对一心送快递的女主强调面带微笑、情绪管理什么的......`;

const RECORD_ID = "record_msnbv59g_bvd3a6";
const REV_ID = `${RECORD_ID}_rawrev_2_1786000000000`;

const sources = {
  free_reflection: {
    source_type: "free_reflection",
    source_id: RECORD_ID,
    source_revision_id: REV_ID,
    text: RAW
  },
  self_interview: { interview_id: null, answers: [] }
};

function evidence(excerpt, overrides = {}) {
  return {
    source_type: "free_reflection",
    source_id: RECORD_ID,
    source_revision_id: REV_ID,
    question_id: "",
    excerpt,
    basis: "explicit",
    voice: "user",
    claim_mode: "direct_feeling",
    explanation: "说明",
    confidence: 0.8,
    ...overrides
  };
}

function output(attitudeEvidence) {
  return JSON.stringify({
    analysis_id: "a1",
    schema_version: "2.1",
    attitude: { suggested: "mixed", alternative: "neutral", evidence: [attitudeEvidence], confidence: 0.7 },
    emotions: [],
    memory_cards: [],
    warnings: [],
    source_revision_ids: [REV_ID]
  });
}

const firstExcerpt = (result) => result.attitude.evidence[0]?.excerpt;

// ── 格式差异必须被容忍 ──────────────────────────────────────────────────────

test("跨行拼接的引用能定位（原文一句一行，模型接成一句）", () => {
  const result = validateAiAnalysis(sources, output(
    evidence("前半部分还算能看，无非是把现实中对待魔女的态度搬进来")
  ));
  assert.equal(result.attitude.evidence.length, 1);
});

test("定位后存回的是原文里真实的那段字，保留真实换行", () => {
  const result = validateAiAnalysis(sources, output(
    evidence("前半部分还算能看，无非是把现实中对待魔女的态度搬进来")
  ));
  const stored = firstExcerpt(result);
  assert.ok(RAW.includes(stored), "存回的引文不是原文里的真实片段");
  assert.ok(stored.includes("\n"), "原文里的换行没有被保留");
});

test("六个半角点的省略号被模型写成中文省略号，仍能定位并存回原样", () => {
  const result = validateAiAnalysis(sources, output(evidence("情绪管理什么的……")));
  assert.equal(firstExcerpt(result), "情绪管理什么的......");
});

test("半角空格被模型吃掉，仍能定位并存回原样", () => {
  const result = validateAiAnalysis(sources, output(evidence("4K版IMAX重映")));
  assert.equal(firstExcerpt(result), "4K 版 IMAX 重映");
});

test("全角标点与半角标点的差异不影响定位", () => {
  const result = validateAiAnalysis(sources, output(evidence("[泪奔]")));
  assert.equal(result.attitude.evidence.length, 1);
});

// ── 来源标识抄错要能兜住 ────────────────────────────────────────────────────

test("模型抄漏 revision_id 尾部时，按文本定位并回填正确来源", () => {
  const result = validateAiAnalysis(sources, output(
    evidence("前半部分还算能看", { source_revision_id: `${RECORD_ID}_rawrev_2` })
  ));
  assert.equal(result.attitude.evidence[0].source_revision_id, REV_ID, "没有回填成真实的来源标识");
});

test("question_id 传成 null 也能兜住并回填空字符串", () => {
  const result = validateAiAnalysis(sources, output(evidence("前半部分还算能看", { question_id: null })));
  assert.equal(result.attitude.evidence[0].question_id, "");
});

test("source_id 填成了别的 id，仍按文本定位回正确来源", () => {
  const result = validateAiAnalysis(sources, output(
    evidence("前半部分还算能看", { source_id: "work_msmwmm9u_co9x4t" })
  ));
  assert.equal(result.attitude.evidence[0].source_id, RECORD_ID);
});

// ── 红线：编造与改写必须照样被拒 ────────────────────────────────────────────

test("模型编造的整句被拒绝", () => {
  assert.throws(
    () => validateAiAnalysis(sources, output(evidence("这部电影让我想起了童年的夏天"))),
    /evidence_all_rejected/
  );
});

test("把原文改写成同义句被拒绝", () => {
  assert.throws(
    () => validateAiAnalysis(sources, output(evidence("前半段勉强可以看下去"))),
    /evidence_all_rejected/
  );
});

test("拼接两个不相邻片段、跳过中间内容被拒绝", () => {
  assert.throws(
    () => validateAiAnalysis(sources, output(evidence("前半部分还算能看情绪管理"))),
    /evidence_all_rejected/
  );
});

test("空引文被拒绝", () => {
  assert.throws(() => validateAiAnalysis(sources, output(evidence("   "))), /evidence_all_rejected/);
});

// ── 采访答案与自由感想的归属 ────────────────────────────────────────────────

test("引文只在采访答案里时，归属被正确判到 self_interview", () => {
  const withInterview = {
    free_reflection: sources.free_reflection,
    self_interview: {
      interview_id: "interview_1",
      answers: [{
        source_type: "self_interview",
        source_id: "answer_1",
        source_revision_id: "answer_1_rev_1",
        question_id: "first_thought",
        text: "最先想到的是女主晒衣服那段。"
      }]
    }
  };
  // 模型把 source_type 填错成 free_reflection，但文本只存在于采访答案里
  const result = validateAiAnalysis(withInterview, output(
    evidence("女主晒衣服那段", { source_type: "free_reflection" })
  ));
  assert.equal(result.attitude.evidence[0].source_type, "self_interview");
  assert.equal(result.attitude.evidence[0].source_id, "answer_1");
  assert.equal(result.attitude.evidence[0].question_id, "first_thought");
});
