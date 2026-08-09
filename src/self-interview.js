export const SELF_INTERVIEW_SCHEMA_VERSION = "1.0";
export const SELF_INTERVIEW_QUESTION_VERSION = "1.0";

export const SELF_INTERVIEW_QUESTIONS = [
  {
    id: "first_recall",
    question: "现在脑子里最先浮现的是什么？",
    hint: "不用想得太完整。一个画面、人物、一句话、一种感觉都可以。"
  },
  {
    id: "memorable_line",
    question: "印象最深的一句话是什么？",
    hint: "记不清原话也没关系，可以写大概意思。"
  },
  {
    id: "memorable_scene",
    question: "印象最深的场景是什么？",
    hint: "发生了什么？只写你记得最清楚的部分也可以。"
  },
  {
    id: "salient_character",
    question: "哪个人物最让我在意？",
    hint: "喜欢、讨厌、心疼、好奇，或者只是一直忍不住注意他／她，都可以。"
  },
  {
    id: "small_detail",
    question: "有没有一个很小，但我特别记得的细节？",
    hint: "一个动作、表情、声音、道具、背景，甚至很短的一瞬间都可以。"
  },
  {
    id: "strongest_feeling",
    question: "现在最强烈的感觉是什么？",
    hint: "不一定只有一种，也不用找准确的词。"
  },
  {
    id: "lingering_thought",
    question: "电影结束以后，我还在想着什么？",
    hint: "一个问题、一个人、一件事，或者和自己有关的联想都可以。"
  },
  {
    id: "one_line_memory",
    question: "如果只能留下一句话记录这次观影，我现在会写什么？",
    hint: "不用总结电影，只写此刻最想留下的那句话。"
  }
];

function legacyId(prefix, recordId, suffix = "") {
  return `${prefix}_${String(recordId || "legacy").replace(/[^a-zA-Z0-9_-]/g, "_")}${suffix ? `_${suffix}` : ""}`;
}

export function createSelfInterview(recordId, now = new Date().toISOString()) {
  return {
    interview_id: legacyId("interview", recordId),
    record_id: recordId,
    schema_version: SELF_INTERVIEW_SCHEMA_VERSION,
    status: "not_started",
    created_at: now,
    updated_at: now,
    completed_at: null,
    answers: []
  };
}

export function normalizeSelfInterview(interview, recordId, now = new Date().toISOString()) {
  const base = interview && typeof interview === "object" ? interview : createSelfInterview(recordId, now);
  const answers = Array.isArray(base.answers) ? base.answers : [];
  const normalizedAnswers = answers
    .filter((answer) => SELF_INTERVIEW_QUESTIONS.some((question) => question.id === answer?.question_id))
    .map((answer) => {
      const order = SELF_INTERVIEW_QUESTIONS.findIndex((question) => question.id === answer.question_id);
      const status = answer.status === "answered" && String(answer.answer_text || "").trim() ? "answered" : "skipped";
      const answerId = answer.answer_id || legacyId("answer", recordId, answer.question_id);
      const revisionId = answer.revision_id || legacyId("answerrev", recordId, `${answer.question_id}_1`);
      return {
        answer_id: answerId,
        question_id: answer.question_id,
        question_version: answer.question_version || SELF_INTERVIEW_QUESTION_VERSION,
        answer_text: status === "answered" ? String(answer.answer_text) : "",
        status,
        answered_at: status === "answered" ? (answer.answered_at || answer.updated_at || now) : null,
        updated_at: answer.updated_at || now,
        order: Number.isInteger(answer.order) ? answer.order : order,
        revision_id: revisionId,
        revisions: Array.isArray(answer.revisions) ? answer.revisions : []
      };
    })
    .sort((a, b) => a.order - b.order);

  const allowedStatus = new Set(["not_started", "in_progress", "completed", "skipped"]);
  return {
    interview_id: base.interview_id || legacyId("interview", recordId),
    record_id: recordId,
    schema_version: SELF_INTERVIEW_SCHEMA_VERSION,
    status: allowedStatus.has(base.status) ? base.status : "not_started",
    created_at: base.created_at || now,
    updated_at: base.updated_at || now,
    completed_at: base.completed_at || null,
    answers: normalizedAnswers
  };
}

function nextRevisionId(answer, now) {
  const serial = (answer?.revisions?.length || 0) + 1;
  return `${answer?.answer_id || "answer"}_rev_${serial}_${Date.parse(now) || Date.now()}`;
}

export function saveInterviewAnswer(interview, questionId, text, status = "answered", now = new Date().toISOString()) {
  const questionIndex = SELF_INTERVIEW_QUESTIONS.findIndex((question) => question.id === questionId);
  if (questionIndex < 0) throw new Error("invalid_interview_question");
  const normalized = normalizeSelfInterview(interview, interview?.record_id, now);
  const existing = normalized.answers.find((answer) => answer.question_id === questionId);
  const answerText = status === "answered" ? String(text ?? "") : "";
  const finalStatus = status === "answered" && answerText.trim() ? "answered" : "skipped";
  const answerId = existing?.answer_id || legacyId("answer", normalized.record_id, questionId);
  const revisions = [...(existing?.revisions || [])];
  if (existing?.revision_id && (existing.answer_text !== answerText || existing.status !== finalStatus)) {
    revisions.push({
      revision_id: existing.revision_id,
      answer_text: existing.answer_text,
      status: existing.status,
      saved_at: existing.updated_at
    });
  }
  const next = {
    answer_id: answerId,
    question_id: questionId,
    question_version: SELF_INTERVIEW_QUESTION_VERSION,
    answer_text: finalStatus === "answered" ? answerText : "",
    status: finalStatus,
    answered_at: finalStatus === "answered" ? (existing?.answered_at || now) : null,
    updated_at: now,
    order: questionIndex,
    revision_id: nextRevisionId({ ...existing, answer_id: answerId, revisions }, now),
    revisions
  };
  normalized.answers = [...normalized.answers.filter((answer) => answer.question_id !== questionId), next]
    .sort((a, b) => a.order - b.order);
  normalized.status = "in_progress";
  normalized.updated_at = now;
  normalized.completed_at = null;
  return normalized;
}

export function completeSelfInterview(interview, now = new Date().toISOString()) {
  let normalized = normalizeSelfInterview(interview, interview?.record_id, now);
  for (const question of SELF_INTERVIEW_QUESTIONS) {
    if (!normalized.answers.some((answer) => answer.question_id === question.id)) {
      normalized = saveInterviewAnswer(normalized, question.id, "", "skipped", now);
    }
  }
  normalized.status = "completed";
  normalized.completed_at = now;
  normalized.updated_at = now;
  return normalized;
}

export function skipSelfInterview(interview, now = new Date().toISOString()) {
  const normalized = completeSelfInterview(interview, now);
  normalized.status = "skipped";
  normalized.completed_at = now;
  return normalized;
}

export function answeredInterviewItems(interview) {
  const normalized = normalizeSelfInterview(interview, interview?.record_id);
  return normalized.answers
    .filter((answer) => answer.status === "answered" && answer.answer_text.trim())
    .map((answer) => ({
      ...answer,
      question: SELF_INTERVIEW_QUESTIONS.find((item) => item.id === answer.question_id)?.question || answer.question_id
    }));
}

export function interviewSourceRevisionIds(interview) {
  return answeredInterviewItems(interview).map((answer) => answer.revision_id);
}
