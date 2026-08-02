function collectEvidence(analysis) {
  return [
    ...(analysis?.attitude?.evidence || []),
    ...(analysis?.emotions || []).flatMap((emotion) => emotion.evidence || []),
    ...(analysis?.memory_cards || []).flatMap((card) => card.evidence || [])
  ];
}

function check(code, passed, actual = null) {
  return { code, passed: Boolean(passed), actual };
}

function matchingEvidence(evidence, triggers = []) {
  return evidence.filter((item) => triggers.some((trigger) => item.excerpt.includes(trigger)));
}

export function evaluateAiValidationCase(testCase, analysis) {
  const expectation = testCase.expect || {};
  const evidence = collectEvidence(analysis);
  const cards = analysis?.memory_cards || [];
  const emotions = analysis?.emotions || [];
  const attitude = analysis?.attitude?.suggested ?? null;
  const checks = [];

  checks.push(check(
    "attitude_allowed",
    (expectation.attitudes || [attitude]).includes(attitude),
    attitude
  ));
  checks.push(check("minimum_cards", cards.length >= (expectation.minCards || 0), cards.length));
  if (Number.isInteger(expectation.maxCards)) {
    checks.push(check("maximum_cards", cards.length <= expectation.maxCards, cards.length));
  }
  checks.push(check("minimum_emotions", emotions.length >= (expectation.minEmotions || 0), emotions.length));
  checks.push(check(
    "evidence_is_source_bound",
    evidence.every((item) => typeof item?.excerpt === "string" && testCase.rawText.includes(item.excerpt)),
    evidence.length
  ));
  checks.push(check(
    "recommendation_not_in_analysis",
    !("recommendation" in (analysis || {})) && !("recommendations" in (analysis || {})),
    null
  ));

  const distinctCardEvidence = new Set(cards.map((card) => (card.evidence || [])
    .map((item) => item.excerpt)
    .sort()
    .join("|")).filter(Boolean));
  if (Number.isInteger(expectation.minDistinctCardEvidence)) {
    checks.push(check(
      "independent_memory_points",
      distinctCardEvidence.size >= expectation.minDistinctCardEvidence,
      distinctCardEvidence.size
    ));
  }

  for (const [index, rule] of (expectation.evidenceCoverage || []).entries()) {
    checks.push(check(
      `evidence_coverage_${index + 1}`,
      evidence.some((item) => rule.triggers.some((trigger) => item.excerpt.includes(trigger))),
      null
    ));
  }

  for (const [index, rule] of (expectation.evidenceRules || []).entries()) {
    const matched = matchingEvidence(evidence, rule.triggers);
    const fieldsMatch = matched.every((item) => Object.entries(rule.fields)
      .every(([field, expected]) => item[field] === expected));
    checks.push(check(
      `evidence_classification_${index + 1}`,
      fieldsMatch && (!rule.requireMatch || matched.length > 0),
      matched.length
    ));
  }

  return {
    case_id: testCase.id,
    passed: checks.every((item) => item.passed),
    checks,
    summary: {
      attitude,
      emotion_count: emotions.length,
      card_count: cards.length,
      evidence_count: evidence.length,
      warning_count: analysis?.warnings?.length || 0
    }
  };
}

