/**
 * R6 · TMDB 数据源（纯函数层）
 *
 * 结构刻意与 src/bangumi.js 对称：只做请求构造、响应归一化与 URL 白名单校验，
 * 不接触 DOM / 数据库 / 网络，可以在 Node 里直接单测。真正的 fetch 与密钥处理
 * 全部在 functions/api/tmdb/*.js 里，密钥绝不下发到前端。
 *
 * 定位（R6 §6/§7）：TMDB 是**第二数据源，不是 Bangumi 的替代**。
 * Bangumi 在日本动画、动画电影、TV Anime、OVA/ONA 上的数据质量更好，继续保留；
 * TMDB 负责真人电影、欧美电影、日本真人电影这些 Bangumi 覆盖不好或不适合的部分。
 * 两者共存，数据源只是 preferred source，不构成作品身份——作品身份永远是 App
 * 自己的内部 Work ID（见 domain.js workIdFor 的说明）。
 */

const API_BASE = "https://api.themoviedb.org/3";

/** TMDB 的动画类型 id。用来避免把动画电影错判成真人电影，见 inferWorkType。 */
export const TMDB_GENRE_ANIMATION = 16;

export function buildTmdbSearchRequest(query, { language = "zh-CN", page = 1 } = {}) {
  const params = new URLSearchParams({
    query: String(query || ""),
    language,
    page: String(page),
    include_adult: "false"
  });
  return { url: `${API_BASE}/search/movie?${params.toString()}` };
}

/**
 * 详情请求。append_to_response 一次把 external_ids 带回来——imdb_id 与 wikidata_id
 * 都是长期稳定的身份标识，值得存；其余 TMDB 字段不做「以后可能有用」的囤积（R6 §12）。
 */
export function buildTmdbDetailRequest(movieId, { language = "zh-CN" } = {}) {
  const id = Number(movieId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const params = new URLSearchParams({ language, append_to_response: "external_ids" });
  return { url: `${API_BASE}/movie/${id}?${params.toString()}` };
}

/**
 * 海报地址。TMDB 的 poster_path 形如 "/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg"，
 * 要拼上图床前缀和尺寸档位才是完整 URL。
 */
export function buildTmdbImageUrl(posterPath, size = "w500") {
  if (!isValidTmdbPosterPath(posterPath)) return null;
  const safeSize = /^(w\d{2,4}|original)$/.test(size) ? size : "w500";
  return `https://image.tmdb.org/t/p/${safeSize}${posterPath}`;
}

/**
 * poster_path 必须严格校验后才能拼进图片代理的上游 URL——否则 "/../.."
 * 之类的输入可以把请求引到 image.tmdb.org 上的任意路径，甚至配合重定向逃逸。
 * TMDB 的 path 只有「斜杠 + base62 文件名 + 扩展名」一种形态。
 */
export function isValidTmdbPosterPath(value) {
  return typeof value === "string" && /^\/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/i.test(value);
}

export function isAllowedTmdbImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "image.tmdb.org";
  } catch {
    return false;
  }
}

/**
 * 从 TMDB 的类型信息推断作品类型（R6 §12）。
 *
 * 红线：**绝不能因为 TMDB 的 media_type 是 movie 就判成真人电影**——日本动画电影
 * 在 TMDB 上同样是 movie，那样会把《你的名字。》标成真人电影。
 *
 * 分档：
 * - 含动画类型（16）           → animation_film （可靠）
 * - 有类型数据但不含 16        → live_action_film（可靠：TMDB 的类型标注对主流影片
 *                                质量足够，"标了类型且没标动画"是有信息量的否定）
 * - 完全没有类型数据           → unspecified，由用户在作品页认领
 *
 * @param {number[]|{id:number}[]} genres genre_ids 数组或 genres 对象数组
 * @returns {"animation_film"|"live_action_film"|"unspecified"}
 */
export function inferWorkType(genres) {
  const ids = (Array.isArray(genres) ? genres : [])
    .map((item) => (typeof item === "object" && item !== null ? Number(item.id) : Number(item)))
    // 必须 > 0：Number("") 和 Number(null) 都是 0 且 Number.isInteger(0) 为真，
    // 只判 isInteger 会把 ["", null] 这种脏数据当成"有类型信息但不是动画"，
    // 于是判成真人电影 —— 正是 §12 要避免的那类误判。
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return "unspecified";
  return ids.includes(TMDB_GENRE_ANIMATION) ? "animation_film" : "live_action_film";
}

function yearOf(releaseDate) {
  return /^\d{4}/.test(releaseDate || "") ? Number(String(releaseDate).slice(0, 4)) : null;
}

/**
 * 归一化搜索结果。上限 10 与 Bangumi 一致——片单搜索场景下 3 条远远不够。
 * @param {object} payload TMDB /search/movie 的响应体
 * @returns {object[]}
 */
export function normalizeTmdbMovies(payload) {
  if (!Array.isArray(payload?.results)) return [];
  // 先过滤再截断：反过来的话，前 10 条里只要混进无效条目，返回的候选数就会
  // 莫名其妙少几条（Bangumi 那边的老实现就是这个顺序，但它 limit=3 时不明显）。
  return payload.results.flatMap((movie) => {
    const tmdbId = Number(movie?.id);
    // TMDB 的 title 已经按 language 本地化；original_title 是原产地标题。
    const title = String(movie?.title || movie?.original_title || "").trim();
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !title) return [];
    const originalTitle = String(movie?.original_title || "").trim();
    return [{
      tmdbId,
      title,
      originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
      releaseDate: movie?.release_date || null,
      year: yearOf(movie?.release_date),
      workType: inferWorkType(movie?.genre_ids),
      posterPath: isValidTmdbPosterPath(movie?.poster_path) ? movie.poster_path : null,
      summary: typeof movie?.overview === "string" && movie.overview.trim() ? movie.overview.trim() : null,
      originalLanguage: movie?.original_language || null,
      url: `https://www.themoviedb.org/movie/${tmdbId}`
    }];
  }).slice(0, 10);
}

/**
 * 归一化详情响应。只取 App 当前真的要用的字段，以及明显具有长期身份价值的
 * external ids（imdb / wikidata）——不为「以后可能有用」把整个 TMDB 响应塞进数据库。
 * @param {object} payload TMDB /movie/{id} 的响应体
 * @returns {object|null}
 */
export function normalizeTmdbDetail(payload) {
  const tmdbId = Number(payload?.id);
  const title = String(payload?.title || payload?.original_title || "").trim();
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !title) return null;
  const originalTitle = String(payload?.original_title || "").trim();
  const runtime = Number(payload?.runtime);
  return {
    tmdbId,
    title,
    originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
    releaseDate: payload?.release_date || null,
    year: yearOf(payload?.release_date),
    workType: inferWorkType(payload?.genres),
    posterPath: isValidTmdbPosterPath(payload?.poster_path) ? payload.poster_path : null,
    summary: typeof payload?.overview === "string" && payload.overview.trim() ? payload.overview.trim() : null,
    runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? runtime : null,
    genres: (Array.isArray(payload?.genres) ? payload.genres : [])
      .map((genre) => String(genre?.name || "").trim())
      .filter(Boolean),
    externalIds: {
      imdb: payload?.external_ids?.imdb_id || null,
      wikidata: payload?.external_ids?.wikidata_id || null
    },
    url: `https://www.themoviedb.org/movie/${tmdbId}`
  };
}

// ─── R6 补丁 5：诊断结果的人话解读 ──────────────────────────────────────────

/**
 * 把 /api/tmdb/status 的原始响应翻译成一句结论 + 一句该怎么办。
 *
 * 纯函数放在这里而不是 app.js，是为了能直接单测——这几个分支正是"到底是环境变量
 * 没配、token 无效、还是召回问题"的判定依据，判错一次就要多来回一轮。
 *
 * @param {object|null} status /api/tmdb/status 的响应体
 * @returns {{ state: string, title: string, detail: string, tone: "ok"|"warn"|"error" }}
 */
export function interpretTmdbStatus(status) {
  if (!status || typeof status !== "object") {
    return {
      state: "unknown",
      title: "拿不到诊断结果",
      detail: "端点没有返回可解析的内容。如果它返回 404，说明线上部署里还没有这一版代码，先重新部署。",
      tone: "error"
    };
  }

  if (!status.configured) {
    return {
      state: "unconfigured",
      title: "环境变量没有进 context.env",
      detail: "Function 本身在正常运行，但读不到 TMDB_ACCESS_TOKEN / TMDB_API_KEY。"
        + "最常见的原因是配置之后没有重新部署——Cloudflare Pages 的环境变量只对**新的 deployment** 生效，"
        + "不会热更新到已经跑着的那一版。其次是配在了 Preview 而不是 Production。",
      tone: "error"
    };
  }

  const probe = status.probe || {};
  const via = status.variable ? `（读到的是 ${status.variable}）` : "";

  if (!probe.checked) {
    return {
      state: "configured",
      title: `已读到环境变量${via}`,
      detail: "这次没有实际请求 TMDB，所以还不能确认凭据是否有效。",
      tone: "warn"
    };
  }

  if (probe.ok) {
    return {
      state: "ok",
      title: `TMDB 链路正常${via}`,
      detail: `真实请求成功，返回 ${probe.resultCount ?? "若干"} 条结果。`
        + "搜索里仍然找不到某部片，那就是召回问题而不是配置问题——"
        + "TMDB 对中文／日文译名的收录有限，用原名或英文名再试一次。",
      tone: "ok"
    };
  }

  if (probe.status === 401) {
    return {
      state: "rejected",
      title: "变量读到了，但 TMDB 拒绝了这个凭据",
      detail: "两种 key 不能互相填错：v4 read access token 要填进 TMDB_ACCESS_TOKEN，"
        + "v3 api key 要填进 TMDB_API_KEY。填反了就是 401。",
      tone: "error"
    };
  }

  if (probe.status === null || probe.status === undefined) {
    return {
      state: "unreachable",
      title: "请求 TMDB 时出错",
      detail: probe.hint || "网络层异常，可能是超时。稍后重试一次看是否稳定复现。",
      tone: "error"
    };
  }

  return {
    state: "upstream_error",
    title: `TMDB 返回 ${probe.status}`,
    detail: probe.hint || "不是鉴权问题，可能是上游临时故障或触发了频率限制。",
    tone: "error"
  };
}
