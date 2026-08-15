import { EVENT_TYPES } from "./event-types.js?v=4";
import { formatBadge } from "./format-badge.js";
import { normalizeWorkStills } from "./stills.js?v=1";

export const SHARE_CARD_LANGUAGES = ["zh", "ja", "en"];
export const SHARE_CARD_ATTITUDES = ["dislike", "neutral", "like", "love", "mixed"];
export const SHARE_CARD_RECOMMENDATIONS = ["yes", "depends", "no", null];

const COPY = {
  zh: {
    attitudes: { dislike: "不喜欢", neutral: "无感", like: "喜欢", love: "超喜欢", mixed: "不好说" },
    first: "首刷", recent: "最近", count: (value) => `共 ${value} 次`,
    recommendation: { yes: "推荐", depends: "看对象", no: "不推荐", none: "未记录" }
  },
  ja: {
    attitudes: { dislike: "苦手", neutral: "普通", like: "好き", love: "大好き", mixed: "何とも言えない" },
    first: "初見", recent: "最近", count: (value) => `全 ${value} 回`,
    recommendation: { yes: "おすすめ", depends: "人による", no: "非推奨", none: "未記録" }
  },
  en: {
    attitudes: { dislike: "Dislike", neutral: "Neutral", like: "Like", love: "Love", mixed: "Uncertain" },
    first: "First", recent: "Latest", count: (value) => `${value} viewings`,
    recommendation: { yes: "Recommend", depends: "For some", no: "Not recommend", none: "Not set" }
  }
};

const EVENT_LABELS = new Map(EVENT_TYPES.map(([key, label]) => [key, label]));
const EVENT_LOCALIZED = {
  zh: {
    stage_greeting: "舞台见面会", talk_show: "主创谈话", cheer_screening: "应援上映",
    roar_screening: "爆音上映", advance_screening: "提前上映", premiere: "首映",
    revival: "重映", all_night: "通宵上映", live_viewing: "直播观影",
    bonus_distribution: "入场特典", other_event: "特别上映"
  },
  en: {
    stage_greeting: "Stage greeting", talk_show: "Talk show", cheer_screening: "Cheer screening",
    roar_screening: "Loud screening", advance_screening: "Advance screening", premiere: "Premiere",
    revival: "Revival", all_night: "All-night", live_viewing: "Live viewing",
    bonus_distribution: "Admission bonus", other_event: "Special screening"
  }
};

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function textForLocale(container, language) {
  if (!container || typeof container !== "object") return "";
  const keys = language === "zh" ? ["zh-CN", "zh_CN", "zh", "cn"]
    : language === "ja" ? ["ja-JP", "ja_JP", "ja", "jp"]
      : ["en-US", "en_US", "en"];
  for (const key of keys) if (typeof container[key] === "string" && container[key].trim()) return container[key].trim();
  return "";
}

function hasKana(value) {
  return /[\u3040-\u30ff]/u.test(value || "");
}

function isMostlyLatin(value) {
  const text = String(value || "").replace(/[\d\s\p{P}\p{S}]/gu, "");
  return Boolean(text) && /^[A-Za-zÀ-ž]+$/u.test(text);
}

export function localizedWorkTitle(work, language = "zh") {
  const lang = SHARE_CARD_LANGUAGES.includes(language) ? language : "zh";
  const direct = lang === "zh"
    ? work?.title_zh || work?.title_cn
    : lang === "ja"
      ? work?.title_ja || work?.title_jp
      : work?.title_en;
  if (String(direct || "").trim()) return String(direct).trim();
  const mapped = textForLocale(work?.localized_titles || work?.titles, lang);
  if (mapped) return mapped;
  const aliases = unique([...(work?.aliases || [])]);
  if (lang === "ja") {
    const candidate = [work?.original_title, ...aliases].find(hasKana);
    return candidate || work?.original_title || work?.title || "";
  }
  if (lang === "en") {
    const candidate = [work?.original_title, ...aliases].find(isMostlyLatin);
    return candidate || work?.original_title || work?.title || "";
  }
  return work?.title || work?.original_title || aliases[0] || "";
}

function eventDate(event) {
  const raw = event?.screening_at || event?.viewed_on || "";
  const value = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && value !== "0000-00-00" ? value : null;
}

function latestJudgement(records, viewingEvents) {
  const events = new Map((viewingEvents || []).map((event) => [event.id, event]));
  const ranked = (records || [])
    .filter((record) => record?.record_kind !== "supplement" && (record.attitude || record.recommendation))
    .map((record) => {
      const event = events.get(record.viewing_event_id)
        || (viewingEvents || []).find((item) => item.record_id === record.id);
      return { record, date: eventDate(event) || String(record.updatedAt || record.createdAt || "") };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  if (ranked[0]) return ranked[0].record;
  return [...(records || [])]
    .filter((record) => record?.attitude || record?.recommendation)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null;
}

function viewingTagLabels(viewingEvents, extraTags = []) {
  const result = [];
  for (const event of viewingEvents || []) {
    const context = event?.viewing_context || {};
    const badge = formatBadge(context.format);
    const note = String(context.format_note || "").trim();
    if (note && ["4D", "其他"].includes(badge?.label)) result.push({ id: `format:${note}`, label: note, localizeKey: null });
    else if (badge && !["普通", "其他"].includes(badge.label)) result.push({ id: `format:${badge.key}`, label: badge.label, localizeKey: null });
    if (context.is_3d && !/3D/iu.test(note) && !/3D/iu.test(badge?.label || "")) result.push({ id: "format:3d", label: "3D", localizeKey: null });
    for (const type of context.event_types || []) {
      result.push({ id: `event:${type}`, label: EVENT_LABELS.get(type) || type, localizeKey: type });
    }
  }
  for (const item of extraTags || []) {
    const label = typeof item === "string" ? item : item?.label;
    if (label) result.push({ id: typeof item === "object" && item.id ? `tag:${item.id}` : `tag:${label}`, label, localizeKey: null });
  }
  const seen = new Set();
  return result.filter((item) => {
    const key = item.label.toLocaleLowerCase("und");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item, order) => ({ ...item, order, selected: true }));
}

export function createShareCardDraft({ work, records = [], viewingEvents = [], language = "zh", profile = {}, extraTags = [] } = {}) {
  const lang = SHARE_CARD_LANGUAGES.includes(language) ? language : "zh";
  const stills = normalizeWorkStills(work?.stills);
  const validDates = (viewingEvents || []).map(eventDate).filter(Boolean).sort();
  const judgement = latestJudgement(records, viewingEvents);
  return {
    version: 1,
    workId: work?.id || null,
    language: lang,
    titles: Object.fromEntries(SHARE_CARD_LANGUAGES.map((key) => [key, localizedWorkTitle(work, key)])),
    title: localizedWorkTitle(work, lang),
    posterOverride: null,
    stillMode: stills.length > 1 ? "double" : "single",
    stills: stills.map((still) => ({ ...still })),
    selectedStillIds: stills.slice(0, stills.length > 1 ? 2 : 1).map((still) => still.id),
    nickname: String(profile.nickname || "").trim(),
    avatar: profile.avatar || null,
    attitude: judgement?.attitude || null,
    recommendation: judgement?.recommendation ?? null,
    showDate: validDates.length > 0,
    firstDate: validDates[0] || null,
    recentDate: validDates.at(-1) || null,
    viewingCount: validDates.length,
    tags: viewingTagLabels(viewingEvents, extraTags),
    recommendationIcon: "b"
  };
}

export function shareCardCopy(language = "zh") {
  return COPY[SHARE_CARD_LANGUAGES.includes(language) ? language : "zh"];
}

export function formatShareDate(date) {
  return date ? String(date).slice(0, 10).replaceAll("-", ".") : "";
}

export function dateLinesForDraft(draft) {
  if (!draft?.showDate || !draft.firstDate || !draft.viewingCount) return [];
  const copy = shareCardCopy(draft.language);
  if (draft.viewingCount === 1) return [`${formatShareDate(draft.firstDate)} · ${copy.first}`];
  return [
    `${copy.first} ${formatShareDate(draft.firstDate)} / ${copy.recent} ${formatShareDate(draft.recentDate)}`,
    `（${copy.count(draft.viewingCount)}）`
  ];
}

export function localizedTagLabel(tag, language = "zh") {
  if (!tag?.localizeKey) return tag?.label || "";
  if (language === "ja") return EVENT_LABELS.get(tag.localizeKey) || tag.label;
  return EVENT_LOCALIZED[language]?.[tag.localizeKey] || tag.label;
}

export function changeShareCardLanguage(draft, language) {
  if (!draft || !SHARE_CARD_LANGUAGES.includes(language)) return draft;
  return { ...draft, language, title: draft.titles?.[language] || draft.title };
}

export function isShareCardLiked(attitude) {
  return attitude === "like" || attitude === "love";
}

export function isShareCardRecommended(recommendation) {
  return recommendation === "yes" || recommendation === "depends";
}
