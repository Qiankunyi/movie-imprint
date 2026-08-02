const SUBJECT_TYPES = {
  1: "book",
  2: "anime",
  3: "music",
  4: "game",
  6: "real"
};

export function buildWorkSearchQuery(record) {
  const seriesPath = record.inputHints?.seriesPath || [];
  const workTitle = record.inputHints?.workTitle;
  return [...seriesPath, workTitle].filter(Boolean).join("：") || record.title;
}

export function buildBangumiSearchRequest(query) {
  return {
    url: "https://api.bgm.tv/v0/search/subjects?limit=3&offset=0",
    body: {
      keyword: query,
      sort: "match",
      filter: {
        type: [2, 6],
        nsfw: false
      }
    }
  };
}

export function buildBangumiImageRequest(subjectId) {
  const id = Number(subjectId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return `https://api.bgm.tv/v0/subjects/${id}/image?type=large`;
}

export function isAllowedBangumiImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "lain.bgm.tv";
  } catch {
    return false;
  }
}

export function wallpaperCandidates(works) {
  return works.flatMap((work) => {
    if (work.identity_status !== "matched") return [];
    const reference = work.external_refs?.find((item) => item.source === "bangumi");
    const subjectId = Number(reference?.id);
    if (!Number.isInteger(subjectId) || subjectId <= 0) return [];
    return [{ workId: work.id, subjectId, title: work.title, attributionUrl: `https://bangumi.tv/subject/${subjectId}` }];
  }).sort((first, second) => first.workId.localeCompare(second.workId));
}

export function chooseDailyWallpaper(works, dateKey) {
  const eligible = wallpaperCandidates(works);
  if (!eligible.length) return null;
  let hash = 2166136261;
  const seed = `${dateKey}:${eligible.map((item) => item.subjectId).join(",")}`;
  for (const character of seed) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return { dateKey, ...eligible[(hash >>> 0) % eligible.length] };
}

export function chooseNextWallpaper(works, currentWorkId, dateKey) {
  const eligible = wallpaperCandidates(works);
  if (!eligible.length) return null;
  const currentIndex = eligible.findIndex((candidate) => candidate.workId === currentWorkId);
  const next = currentIndex === -1
    ? chooseDailyWallpaper(works, dateKey)
    : eligible[(currentIndex + 1) % eligible.length];
  return next ? { dateKey, ...next } : null;
}

export function normalizeBangumiSubjects(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.slice(0, 3).flatMap((subject) => {
    const subjectId = Number(subject?.id);
    const title = String(subject?.name_cn || subject?.name || "").trim();
    if (!Number.isInteger(subjectId) || subjectId <= 0 || !title) return [];
    const originalTitle = String(subject?.name || "").trim();
    return [{
      subjectId,
      title,
      originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
      type: SUBJECT_TYPES[subject.type] || "unknown",
      releaseDate: subject.date || null,
      image: subject.images?.common || subject.images?.medium || null,
      url: `https://bangumi.tv/subject/${subjectId}`
    }];
  });
}

export function applyBangumiCandidateToWork(work, candidate) {
  const aliases = [
    ...(work.aliases || []),
    candidate.title,
    candidate.originalTitle
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
  const releaseYear = /^\d{4}/.test(candidate.releaseDate || "")
    ? Number(candidate.releaseDate.slice(0, 4))
    : null;

  return {
    ...work,
    title: candidate.title,
    original_title: candidate.originalTitle,
    work_type: candidate.type === "anime"
      ? "animation_movie"
      : candidate.type === "real"
        ? "live_action_movie"
        : "unspecified",
    aliases,
    release_year: releaseYear,
    external_refs: [{
      source: "bangumi",
      id: String(candidate.subjectId),
      url: `https://bangumi.tv/subject/${candidate.subjectId}`
    }],
    identity_status: "matched",
    match: {
      status: "confirmed",
      query: work.match?.query || null,
      candidates: [],
      message: null,
      confirmedSubjectId: candidate.subjectId
    }
  };
}
