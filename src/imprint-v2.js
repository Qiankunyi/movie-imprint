import { normalizeSelfInterview } from "./self-interview.js";

export const RECORD_SCHEMA_VERSION = "2.1-local";

function stableLegacyId(prefix, recordId, suffix = "") {
  return `${prefix}_${String(recordId || "legacy").replace(/[^a-zA-Z0-9_-]/g, "_")}${suffix ? `_${suffix}` : ""}`;
}

export function cardLifecycleFromLegacy(card, analysisId = null) {
  const provenance = card?.provenance || "user_added";
  const origin = provenance === "user_added" ? "user_created" : "ai_generated";
  const userModified = provenance === "user_modified";
  return {
    ...card,
    card_id: card.card_id,
    origin: card.origin || origin,
    status: card.status || (provenance === "ai_suggested" ? "draft" : "confirmed"),
    user_modified: typeof card.user_modified === "boolean" ? card.user_modified : userModified,
    analysis_id: card.analysis_id || analysisId,
    revision_history: Array.isArray(card.revision_history) ? card.revision_history : [],
    why_it_matters: card.why_it_matters ?? null,
    related_emotions: Array.isArray(card.related_emotions) ? card.related_emotions : [],
    linked_viewing_ids: Array.isArray(card.linked_viewing_ids) ? card.linked_viewing_ids : [],
    evidence: Array.isArray(card.evidence) ? card.evidence : [],
    custom_fields: card.custom_fields && typeof card.custom_fields === "object" ? card.custom_fields : {}
  };
}

export function normalizeV21Record(record, now = new Date().toISOString()) {
  const rawRevisionId = record.raw_revision_id || stableLegacyId("rawrev", record.id, "1");
  const rawRevisions = Array.isArray(record.raw_revisions) ? record.raw_revisions : [];
  const legacyAnalysisId = record.analysisMetadata || (record.cards || []).some((card) => card.provenance === "ai_suggested")
    ? stableLegacyId("analysis", record.id, "legacy")
    : null;
  const normalizedCards = (Array.isArray(record.cards) ? record.cards : []).map((card) => cardLifecycleFromLegacy(card, legacyAnalysisId));
  const legacyDraftCards = normalizedCards.filter((card) => card.status === "draft");
  const formalCards = normalizedCards.filter((card) => card.status !== "draft");
  let coreSeen = false;
  for (const card of formalCards.sort((a, b) => (a.order || 0) - (b.order || 0))) {
    if (card.is_core && !coreSeen) coreSeen = true;
    else if (card.is_core) card.is_core = false;
    card.status = "confirmed";
  }

  const activeAnalysisDraft = record.activeAnalysisDraft || (legacyDraftCards.length ? {
    analysis_id: legacyAnalysisId,
    schema_version: record.analysisMetadata?.schema_version || "legacy",
    prompt_version: record.analysisMetadata?.prompt_version || "legacy",
    source_snapshot_hash: record.analysisMetadata?.input_hash || null,
    source_revision_ids: [rawRevisionId],
    status: "draft",
    stale: false,
    created_at: record.updatedAt || record.createdAt || now,
    analysis_metadata: record.analysisMetadata || {},
    warnings: record.aiWarnings || [],
    attitude: record.attitudeSuggestionDetails || null,
    emotions: record.emotions || [],
    memory_cards: legacyDraftCards,
    core_suggestion: legacyDraftCards.find((card) => card.is_core)?.card_id || null
  } : null);

  return {
    ...record,
    schema_version: RECORD_SCHEMA_VERSION,
    raw_revision_id: rawRevisionId,
    raw_revision_number: Number.isInteger(record.raw_revision_number) ? record.raw_revision_number : 1,
    raw_saved_at: record.raw_saved_at || record.createdAt || now,
    raw_revisions: rawRevisions,
    self_interview: normalizeSelfInterview(record.self_interview, record.id, record.createdAt || now),
    cards: formalCards.map((card, index) => ({ ...card, order: index })),
    activeAnalysisDraft,
    analysis_history: Array.isArray(record.analysis_history) ? record.analysis_history : [],
    analysis_status: activeAnalysisDraft && record.analysis_status !== "failed" ? "ai_draft_ready" : record.analysis_status,
    status: record.status || "raw_only_confirmed"
  };
}

export function sourceRevisionIds(record) {
  const answerRevisionIds = (record.self_interview?.answers || [])
    .filter((answer) => answer.status === "answered" && answer.answer_text?.trim())
    .map((answer) => answer.revision_id);
  return [record.raw_revision_id, ...answerRevisionIds].filter(Boolean);
}

export function markAnalysesStale(record) {
  if (record.activeAnalysisDraft) record.activeAnalysisDraft.stale = true;
  record.analysis_history = (record.analysis_history || []).map((analysis) => ({ ...analysis, stale: true }));
  record.analysis_stale = Boolean(record.activeAnalysisDraft || record.analysis_history?.length || record.cards?.some((card) => card.analysis_id));
  return record;
}

export function reviseRawText(record, rawText, now = new Date().toISOString()) {
  const currentText = String(record.rawText || "");
  if (currentText === rawText) return record;
  record.raw_revisions ||= [];
  record.raw_revisions.push({
    revision_id: record.raw_revision_id,
    revision_number: record.raw_revision_number || 1,
    raw_text: currentText,
    saved_at: record.raw_saved_at || record.updatedAt || record.createdAt || now
  });
  record.raw_revision_number = (record.raw_revision_number || 1) + 1;
  record.raw_revision_id = `${record.id}_rawrev_${record.raw_revision_number}_${Date.parse(now) || Date.now()}`;
  record.raw_saved_at = now;
  record.rawText = rawText;
  return markAnalysesStale(record);
}

export function analysisRequestSources(record) {
  return {
    free_reflection: {
      source_type: "free_reflection",
      source_id: record.id,
      source_revision_id: record.raw_revision_id,
      text: String(record.rawText || "")
    },
    self_interview: {
      interview_id: record.self_interview?.interview_id || null,
      answers: (record.self_interview?.answers || [])
        .filter((answer) => answer.status === "answered" && answer.answer_text?.trim())
        .map((answer) => ({
          source_type: "self_interview",
          source_id: answer.answer_id,
          source_revision_id: answer.revision_id,
          question_id: answer.question_id,
          text: answer.answer_text
        }))
    }
  };
}
