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

export function buildValidationSources(testCase) {
  return {
    free_reflection: {
      source_type: "free_reflection",
      source_id: `${testCase.id}_reflection`,
      source_revision_id: `${testCase.id}_reflection_rev_1`,
      text: testCase.rawText
    },
    self_interview: {
      interview_id: `${testCase.id}_interview`,
      answers: (testCase.interviewAnswers || []).map((answer, index) => ({
        source_type: "self_interview",
        source_id: `${testCase.id}_answer_${index + 1}`,
        source_revision_id: `${testCase.id}_answer_${index + 1}_rev_1`,
        question_id: answer.questionId,
        text: answer.text
      }))
    }
  };
}

function sourceEntries(testCase) {
  const sources = buildValidationSources(testCase);
  return [
    { ...sources.free_reflection, question_id: "" },
    ...sources.self_interview.answers
  ];
}

export function evaluateAiValidationCase(testCase, analysis) {
  const expectation = testCase.expect || {};
  const evidence = collectEvidence(analysis);
  const cards = analysis?.memory_cards || [];
  const emotions = analysis?.emotions || [];
  const attitude = analysis?.attitude?.suggested ?? null;
  const checks = [];
  const sources = sourceEntries(testCase);

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
    evidence.every((item) => typeof item?.excerpt === "string" && sources.some((source) => (
      item.source_type === source.source_type
      && item.source_id === source.source_id
      && item.source_revision_id === source.source_revision_id
      && item.question_id === source.question_id
      && source.text.includes(item.excerpt)
    ))),
    evidence.length
  ));
  checks.push(check(
    "analysis_snapshot_revisions",
    sources.every((source) => analysis?.source_revision_ids?.includes(source.source_revision_id)),
    analysis?.source_revision_ids?.length || 0
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
      evidence.some((item) => (!rule.sourceType || item.source_type === rule.sourceType)
        && rule.triggers.some((trigger) => item.excerpt.includes(trigger))),
      null
    ));
  }

  if (Array.isArray(expectation.requiredEvidenceSources)) {
    for (const sourceType of expectation.requiredEvidenceSources) {
      checks.push(check(
        `evidence_uses_${sourceType}`,
        evidence.some((item) => item.source_type === sourceType),
        evidence.filter((item) => item.source_type === sourceType).length
      ));
    }
  }

  if (Number.isInteger(expectation.minCrossSourceCards)) {
    const crossSourceCards = cards.filter((card) => new Set((card.evidence || [])
      .map((item) => item.source_type)).size > 1).length;
    checks.push(check(
      "cross_source_memory_clusters",
      crossSourceCards >= expectation.minCrossSourceCards,
      crossSourceCards
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
