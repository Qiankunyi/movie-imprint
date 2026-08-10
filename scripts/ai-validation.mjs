import { requestAiAnalysis } from "../src/ai-providers.js";
import { buildValidationSources, evaluateAiValidationCase } from "../src/ai-validation.js";
import { syntheticAiValidationCases } from "../tests/fixtures/ai-validation.synthetic.mjs";

const providerArgument = process.argv.find((argument) => argument.startsWith("--provider="));
const provider = providerArgument?.split("=")[1] || "gemini";
const caseArgument = process.argv.find((argument) => argument.startsWith("--case="));
const selectedCase = caseArgument?.split("=")[1] || null;
const validationCases = selectedCase
  ? syntheticAiValidationCases.filter((testCase) => testCase.id === selectedCase)
  : syntheticAiValidationCases;
if (!validationCases.length) throw new Error(`unknown_validation_case:${selectedCase}`);
const results = [];
let model = null;
let inputTokens = 0;
let outputTokens = 0;
let durationMs = 0;

for (const testCase of validationCases) {
  try {
    const response = await requestAiAnalysis({
      provider,
      title: testCase.title,
      sources: buildValidationSources(testCase)
    });
    model ||= response.metadata.model;
    inputTokens += response.metadata.usage.input_tokens || 0;
    outputTokens += response.metadata.usage.output_tokens || 0;
    durationMs += response.metadata.duration_ms || 0;
    const evaluation = evaluateAiValidationCase(testCase, response.analysis);
    results.push({
      ...evaluation,
      diagnostics: {
        source_character_counts: response.metadata.source_character_counts,
        evidence_source_counts: response.metadata.evidence_source_counts,
        model_response_characters: response.metadata.model_response_characters
      },
      error: null
    });
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
  dataset: "synthetic-v2.1-dual-source",
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
