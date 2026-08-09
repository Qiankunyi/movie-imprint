import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAiValidationCase } from "../src/ai-validation.js";

const baseAnalysis = {
  source_revision_ids: ["privacy_reflection_rev_1"],
  attitude: { suggested: "like", evidence: [{ source_type: "free_reflection", source_id: "privacy_reflection", source_revision_id: "privacy_reflection_rev_1", question_id: "", excerpt: "我喜欢", voice: "user", claim_mode: "direct_feeling" }] },
  emotions: [],
  memory_cards: [{ evidence: [{ source_type: "free_reflection", source_id: "privacy_reflection", source_revision_id: "privacy_reflection_rev_1", question_id: "", excerpt: "安静的结尾", voice: "user", claim_mode: "observation" }] }],
  warnings: []
};

test("脱敏验证结果不包含原文或证据原句", () => {
  const result = evaluateAiValidationCase({
    id: "privacy",
    rawText: "我喜欢安静的结尾",
    expect: { attitudes: ["like"], minCards: 1 }
  }, baseAnalysis);
  assert.equal(result.passed, true);
  assert.equal(JSON.stringify(result).includes("安静的结尾"), false);
  assert.equal(JSON.stringify(result).includes("我喜欢"), false);
});

test("验证门会拦截把他人引语归成用户观点的结果", () => {
  const result = evaluateAiValidationCase({
    id: "quoted_other",
    rawText: "朋友说结尾代表希望，但我没有这种感觉。",
    expect: {
      attitudes: ["like"],
      evidenceRules: [{
        triggers: ["结尾代表希望"],
        fields: { voice: "quoted_other", claim_mode: "reported_statement" },
        requireMatch: true
      }]
    }
  }, {
    ...baseAnalysis,
    attitude: {
      suggested: "like",
      evidence: [{ excerpt: "结尾代表希望", voice: "user", claim_mode: "observation" }]
    },
    memory_cards: []
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((item) => item.code === "evidence_classification_1").passed, false);
});

test("验证门要求编号感想保留为相互独立的记忆点", () => {
  const result = evaluateAiValidationCase({
    id: "numbered",
    rawText: "鼓点让我紧张。车站告别让我难过。玩笑让我笑了。",
    expect: { attitudes: ["like"], minCards: 3, minDistinctCardEvidence: 3 }
  }, baseAnalysis);
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((item) => item.code === "minimum_cards").passed, false);
  assert.equal(result.checks.find((item) => item.code === "independent_memory_points").passed, false);
});
