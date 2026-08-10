const DEFAULT_LOCALE = "zh-Hans";

export const TAG_SOURCES = ["user", "metadata_bangumi", "metadata_tmdb", "ai_suggested"];
export const TAG_CATEGORIES = ["director", "custom"];
export const TAG_TARGET_TYPES = ["work", "viewing"];

function id(prefix, now = Date.now()) {
  return `${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTagName(value = "") {
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/^#+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function tagNameKey(value = "") {
  return normalizeTagName(value).toLocaleLowerCase("und");
}

function uniqueNames(values) {
  const seen = new Set();
  return values.flatMap((value) => {
    const name = normalizeTagName(value);
    const key = tagNameKey(name);
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}

export function createTag({
  name,
  names = {},
  aliases = [],
  source = "user",
  category = "custom",
  createdLocale = DEFAULT_LOCALE,
  externalRefs = {},
  now = new Date().toISOString()
} = {}) {
  const defaultName = normalizeTagName(name || names[createdLocale] || Object.values(names).find(Boolean));
  if (!defaultName) throw new Error("tag_name_required");
  return {
    id: id("tag"),
    source: TAG_SOURCES.includes(source) ? source : "user",
    category: TAG_CATEGORIES.includes(category) ? category : "custom",
    default_name: defaultName,
    created_locale: createdLocale || DEFAULT_LOCALE,
    names: Object.fromEntries(Object.entries(names).flatMap(([locale, value]) => {
      const normalized = normalizeTagName(value);
      return normalized ? [[locale, normalized]] : [];
    })),
    aliases: uniqueNames(aliases),
    external_refs: { ...externalRefs },
    is_hidden: false,
    is_pinned: false,
    created_at: now,
    updated_at: now,
    last_used_at: now
  };
}

const LOCALE_FALLBACKS = {
  "zh-Hans": ["zh-Hans", "zh-Hant", "ja", "en"],
  "zh-Hant": ["zh-Hant", "zh-Hans", "ja", "en"],
  ja: ["ja", "zh-Hant", "zh-Hans", "en"],
  en: ["en", "ja", "zh-Hans", "zh-Hant"]
};

export function displayTagName(tag, locale = DEFAULT_LOCALE) {
  if (!tag) return "";
  if (tag.source === "user") return normalizeTagName(tag.default_name);
  const names = tag.names || {};
  for (const candidate of LOCALE_FALLBACKS[locale] || [locale, DEFAULT_LOCALE, "ja", "en"]) {
    if (normalizeTagName(names[candidate])) return normalizeTagName(names[candidate]);
  }
  return normalizeTagName(tag.default_name || Object.values(names).find(Boolean));
}

export function searchableTagNames(tag) {
  return uniqueNames([
    tag?.default_name,
    ...Object.values(tag?.names || {}),
    ...(tag?.aliases || [])
  ]);
}

export function findMatchingTag(tags, { name, bangumiPersonId } = {}) {
  const list = Array.isArray(tags) ? tags : [];
  if (bangumiPersonId !== undefined && bangumiPersonId !== null && bangumiPersonId !== "") {
    const externalKey = String(bangumiPersonId);
    const external = list.find((tag) => String(tag?.external_refs?.bangumi_person_id || "") === externalKey);
    if (external) return external;
  }
  const key = tagNameKey(name);
  if (!key) return null;
  return list.find((tag) => searchableTagNames(tag).some((candidate) => tagNameKey(candidate) === key)) || null;
}

export function ensureUserTag(tags, name, { locale = DEFAULT_LOCALE, now = new Date().toISOString() } = {}) {
  const normalized = normalizeTagName(name);
  if (!normalized) return { tags: [...(tags || [])], tag: null, created: false };
  const existing = findMatchingTag(tags, { name: normalized });
  if (existing) return { tags: [...tags], tag: existing, created: false };
  const tag = createTag({ name: normalized, createdLocale: locale, now });
  return { tags: [...(tags || []), tag], tag, created: true };
}

export function ensureBangumiDirectorTag(tags, person, { now = new Date().toISOString() } = {}) {
  const personId = person?.personId ?? person?.id;
  if (personId === undefined || personId === null || personId === "") {
    return { tags: [...(tags || [])], tag: null, created: false };
  }
  const existing = findMatchingTag(tags, { bangumiPersonId: personId });
  if (existing) {
    const names = { ...(existing.names || {}), ...(person.names || {}) };
    const aliases = uniqueNames([...(existing.aliases || []), ...(person.aliases || [])]);
    const updated = {
      ...existing,
      names,
      aliases,
      external_refs: { ...(existing.external_refs || {}), bangumi_person_id: String(personId) },
      updated_at: now,
      last_used_at: now
    };
    return {
      tags: tags.map((tag) => tag.id === existing.id ? updated : tag),
      tag: updated,
      created: false
    };
  }
  const names = person?.names || {};
  const name = names[DEFAULT_LOCALE] || names.ja || names.en || person?.name;
  const tag = createTag({
    name,
    names,
    aliases: person?.aliases || [],
    source: "metadata_bangumi",
    category: "director",
    createdLocale: DEFAULT_LOCALE,
    externalRefs: { bangumi_person_id: String(personId) },
    now
  });
  return { tags: [...(tags || []), tag], tag, created: true };
}

export function createTagAssignment({ tagId, targetType, targetId, source = "user", now = new Date().toISOString() }) {
  if (!tagId || !TAG_TARGET_TYPES.includes(targetType) || !targetId) throw new Error("invalid_tag_assignment");
  return {
    id: `${targetType}:${targetId}:${tagId}`,
    tag_id: tagId,
    target_type: targetType,
    target_id: targetId,
    source,
    created_at: now
  };
}

export function upsertAssignment(assignments, input) {
  const assignment = createTagAssignment(input);
  const list = Array.isArray(assignments) ? assignments : [];
  const existing = list.find((item) => item.id === assignment.id);
  return existing ? { assignments: [...list], assignment: existing, created: false }
    : { assignments: [...list, assignment], assignment, created: true };
}

export function assignmentsForTarget(assignments, targetType, targetId) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((item) => item.target_type === targetType && item.target_id === targetId);
}

export function tagsForTarget(tags, assignments, targetType, targetId, { includeHidden = false } = {}) {
  const ids = new Set(assignmentsForTarget(assignments, targetType, targetId).map((item) => item.tag_id));
  return (Array.isArray(tags) ? tags : []).filter((tag) => ids.has(tag.id) && (includeHidden || !tag.is_hidden));
}

export function tagUsageCount(assignments, tagId) {
  return (Array.isArray(assignments) ? assignments : []).filter((item) => item.tag_id === tagId).length;
}

export function searchTags(tags, query, { includeHidden = false } = {}) {
  const key = tagNameKey(query);
  const list = (Array.isArray(tags) ? tags : []).filter((tag) => includeHidden || !tag.is_hidden);
  if (!key) return list;
  return list.filter((tag) => searchableTagNames(tag).some((name) => tagNameKey(name).includes(key)));
}

export function rankTags(tags, assignments, { limit = Infinity } = {}) {
  const lastUsed = new Map();
  for (const assignment of assignments || []) {
    const current = lastUsed.get(assignment.tag_id) || "";
    if ((assignment.created_at || "") > current) lastUsed.set(assignment.tag_id, assignment.created_at || "");
  }
  return [...(tags || [])]
    .filter((tag) => !tag.is_hidden)
    .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned))
      || (lastUsed.get(b.id) || b.last_used_at || "").localeCompare(lastUsed.get(a.id) || a.last_used_at || "")
      || tagUsageCount(assignments, b.id) - tagUsageCount(assignments, a.id))
    .slice(0, limit);
}

export function setTagPinned(tags, tagId, pinned) {
  return (tags || []).map((tag) => tag.id === tagId
    ? { ...tag, is_pinned: Boolean(pinned), updated_at: new Date().toISOString() }
    : tag);
}

export function setTagHidden(tags, tagId, hidden) {
  return (tags || []).map((tag) => tag.id === tagId
    ? { ...tag, is_hidden: Boolean(hidden), updated_at: new Date().toISOString() }
    : tag);
}

export function unlinkTag(assignments, { tagId, targetType, targetId }) {
  return (assignments || []).filter((item) => !(
    item.tag_id === tagId && item.target_type === targetType && item.target_id === targetId
  ));
}

export function deleteTag(tags, assignments, tagId) {
  return {
    tags: (tags || []).filter((tag) => tag.id !== tagId),
    assignments: (assignments || []).filter((assignment) => assignment.tag_id !== tagId)
  };
}

export function pruneOrphanUserTags(tags, assignments) {
  const used = new Set((assignments || []).map((item) => item.tag_id));
  return (tags || []).filter((tag) => used.has(tag.id) || tag.source !== "user");
}

export function mergeTags(tags, assignments, { sourceTagId, targetTagId }) {
  if (!sourceTagId || !targetTagId || sourceTagId === targetTagId) return { tags: [...(tags || [])], assignments: [...(assignments || [])] };
  const source = (tags || []).find((tag) => tag.id === sourceTagId);
  const target = (tags || []).find((tag) => tag.id === targetTagId);
  if (!source || !target) throw new Error("tag_not_found");
  const mergedTarget = {
    ...target,
    names: { ...(source.names || {}), ...(target.names || {}) },
    aliases: uniqueNames([...(target.aliases || []), ...(source.aliases || []), source.default_name]),
    external_refs: { ...(source.external_refs || {}), ...(target.external_refs || {}) },
    is_pinned: Boolean(target.is_pinned || source.is_pinned),
    updated_at: new Date().toISOString()
  };
  const seen = new Set();
  const nextAssignments = (assignments || []).flatMap((assignment) => {
    const next = assignment.tag_id === sourceTagId
      ? createTagAssignment({ ...assignment, tagId: targetTagId, targetType: assignment.target_type, targetId: assignment.target_id })
      : assignment;
    if (seen.has(next.id)) return [];
    seen.add(next.id);
    return [next];
  });
  return {
    tags: tags.filter((tag) => tag.id !== sourceTagId).map((tag) => tag.id === targetTagId ? mergedTarget : tag),
    assignments: nextAssignments
  };
}

export function syncViewingTags(tags, assignments, record, { locale = DEFAULT_LOCALE, now = new Date().toISOString() } = {}) {
  const targetId = record?.id;
  if (!targetId) return { tags: [...(tags || [])], assignments: [...(assignments || [])] };
  const names = uniqueNames(record.tags || []);
  const current = assignmentsForTarget(assignments, "viewing", targetId);
  let nextTags = [...(tags || [])];
  let nextAssignments = (assignments || []).filter((item) => !(item.target_type === "viewing" && item.target_id === targetId));
  for (const name of names) {
    const ensured = ensureUserTag(nextTags, name, { locale, now });
    nextTags = ensured.tags;
    if (!ensured.tag) continue;
    nextAssignments = upsertAssignment(nextAssignments, {
      tagId: ensured.tag.id,
      targetType: "viewing",
      targetId,
      source: "user",
      now
    }).assignments;
  }
  const removedIds = new Set(current.map((item) => item.tag_id).filter((tagId) => !nextAssignments.some((item) => item.tag_id === tagId)));
  if (removedIds.size) nextTags = pruneOrphanUserTags(nextTags, nextAssignments);
  return { tags: nextTags, assignments: nextAssignments };
}

export function upsertBangumiDirectorAssignments(tags, assignments, workId, directors, { now = new Date().toISOString() } = {}) {
  let nextTags = [...(tags || [])];
  let nextAssignments = [...(assignments || [])];
  for (const person of Array.isArray(directors) ? directors : []) {
    const ensured = ensureBangumiDirectorTag(nextTags, person, { now });
    nextTags = ensured.tags;
    if (!ensured.tag) continue;
    nextAssignments = upsertAssignment(nextAssignments, {
      tagId: ensured.tag.id,
      targetType: "work",
      targetId: workId,
      source: "metadata_bangumi",
      now
    }).assignments;
  }
  return { tags: nextTags, assignments: nextAssignments };
}

function eventDate(event) {
  return event?.screening_at || event?.viewed_on || event?.createdAt || "";
}

export const TAG_ATTITUDE_ORDER = ["love", "like", "neutral", "dislike", "mixed", "unrated"];

export function latestWorkAttitude(work, records, viewingEvents) {
  const ids = new Set([work?.id, ...(work?.merged_from || [])]);
  const eventByRecord = new Map((viewingEvents || []).flatMap((event) => event?.record_id ? [[event.record_id, event]] : []));
  const candidates = (records || []).flatMap((record) => {
    if (!ids.has(record.work_id || record.workId) || record.record_kind === "supplement" || !record.attitude) return [];
    const event = eventByRecord.get(record.id);
    const valid = event && !event.needs_review && (event.viewed_on || event.screening_at) && ["home", "cinema"].includes(event.location_type);
    return valid ? [{ attitude: record.attitude, date: eventDate(event) }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { attitude: candidates[0]?.attitude || "unrated", lastWatchedAt: candidates[0]?.date || "" };
}

export function taggedWorkEntries(tagId, tags, assignments, works, records, viewingEvents, sort = "attitude") {
  const workIds = new Set((assignments || []).filter((item) => item.tag_id === tagId && item.target_type === "work").map((item) => item.target_id));
  const entries = (works || []).filter((work) => workIds.has(work.id)).map((work) => ({
    work,
    ...latestWorkAttitude(work, records, viewingEvents),
    releaseYear: Number(work.release_year) || null
  }));
  if (sort === "recent") return entries.sort((a, b) => b.lastWatchedAt.localeCompare(a.lastWatchedAt));
  if (sort === "release") return entries.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
  return entries.sort((a, b) => TAG_ATTITUDE_ORDER.indexOf(a.attitude) - TAG_ATTITUDE_ORDER.indexOf(b.attitude)
    || b.lastWatchedAt.localeCompare(a.lastWatchedAt));
}

export function tagOverview(tagId, assignments) {
  const own = (assignments || []).filter((item) => item.tag_id === tagId);
  return {
    workCount: own.filter((item) => item.target_type === "work").length,
    viewingCount: own.filter((item) => item.target_type === "viewing").length
  };
}

