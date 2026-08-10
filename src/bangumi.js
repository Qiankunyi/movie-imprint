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
    url: "https://api.bgm.tv/v0/search/subjects?limit=10&offset=0",
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

export function normalizeBangumiSubjects(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.slice(0, 10).flatMap((subject) => {
    const subjectId = Number(subject?.id);
    const title = String(subject?.name_cn || subject?.name || "").trim();
    if (!Number.isInteger(subjectId) || subjectId <= 0 || !title) return [];
    const originalTitle = String(subject?.name || "").trim();
    return [{
      subjectId,
      title,
      originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
      type: SUBJECT_TYPES[subject.type] || "unknown",
      // 注意：Bangumi 的 date 只是"上映日期"，不带地区语义。上层不能假设它是
      // 日本上映日（见 domain.js promoteWorkToMatched 的说明），一律按
      // region: "unknown" 落库，等用户认领。
      releaseDate: subject.date || null,
      summary: typeof subject.summary === "string" ? subject.summary : null,
      image: subject.images?.common || subject.images?.medium || null,
      url: `https://bangumi.tv/subject/${subjectId}`
    }];
  });
}

function valueList(value) {
  if (Array.isArray(value)) return value.flatMap(valueList);
  if (value && typeof value === "object") return [value.v, value.k].flatMap(valueList);
  return typeof value === "string" ? [value.trim()] : [];
}

/** Normalize `/v0/subjects/:id/persons` into stable director identities. */
export function normalizeBangumiDirectors(payload) {
  const people = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return people.flatMap((person) => {
    const relation = String(person?.relation || person?.job || "").trim();
    const careers = Array.isArray(person?.career) ? person.career.map(String) : [];
    if (!(/导演|監督|director/iu.test(relation) || careers.some((item) => /director/iu.test(item)))) return [];
    const personId = Number(person?.id);
    if (!Number.isInteger(personId) || personId <= 0) return [];
    const original = String(person?.name || "").trim();
    const simplified = String(person?.name_cn || "").trim();
    const rawAliases = [
      ...(Array.isArray(person?.aliases) ? person.aliases : []),
      ...valueList(person?.infobox)
    ].map(String).map((item) => item.trim()).filter(Boolean);
    const english = rawAliases.find((item) => /^[A-Za-z][A-Za-z .'-]+$/u.test(item)) || "";
    const names = {
      ...(simplified ? { "zh-Hans": simplified } : {}),
      ...(original ? { ja: original, "zh-Hant": original } : {}),
      ...(english ? { en: english } : {})
    };
    const name = simplified || original || english;
    if (!name) return [];
    return [{ personId, name, names, aliases: [...new Set([original, simplified, ...rawAliases].filter(Boolean))] }];
  });
}
