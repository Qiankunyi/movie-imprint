import { requestAiAnalysis } from "../src/ai-providers.js";
import { evaluateAiValidationCase } from "../src/ai-validation.js";
import { syntheticAiValidationCases } from "../tests/fixtures/ai-validation.synthetic.mjs";

const providerArgument = process.argv.find((argument) => argument.startsWith("--provider="));
const provider = providerArgument?.split("=")[1] || "gemini";
const results = [];
let model = null;
let inputTokens = 0;
let outputTokens = 0;
let durationMs = 0;

for (const testCase of syntheticAiValidationCases) {
  try {
    const response = await requestAiAnalysis({
      provider,
      title: testCase.title,
      rawText: testCase.rawText
    });
    model ||= response.metadata.model;
    inputTokens += response.metadata.usage.input_tokens || 0;
    outputTokens += response.metadata.usage.output_tokens || 0;
    durationMs += response.metadata.duration_ms || 0;
    const evaluation = evaluateAiValidationCase(testCase, response.analysis);
    results.push({ ...evaluation, error: null });
    console.log(`${testCase.id}: ${evaluation.passed ? "PASS" : "FAIL"}`);
  } catch (error) {
    results.push({
      case_id: testCase.id,
      passed: false,
      checks: [],
      summary: null,
      error: error?.message || "unknown_error"
    });
    console.log(`${testCase.id}: ERROR ${error?.message || "unknown_error"}`);
  }
}

const report = {
  generated_at: new Date().toISOString(),
  dataset: "synthetic-c3-v1",
  privacy: "No raw input, evidence excerpt, or credential is included in this report.",
  provider,
  model,
  passed: results.filter((result) => result.passed).length,
  total: results.length,
  usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  duration_ms: durationMs,
  results
};

console.log(`AI_VALIDATION_REPORT=${JSON.stringify(report)}`);
if (report.passed !== report.total) process.exitCode = 1;

