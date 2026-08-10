/**
 * 提案 I：影院活动分类表
 *
 * 「制式」与「活动」是两类东西，必须分流：
 *   制式（硬件规格）→ viewing_context.format（单值）
 *   活动（这一场的性质）→ viewing_context.event_types（数组）
 * 同一场可以既是 IMAX 又是舞台挨拶付き。
 */

export const EVENT_TYPES = [
  ["stage_greeting", "舞台挨拶", [/舞台挨拶/, /舞台あいさつ/]],
  ["talk_show", "トークショー", [/トークショー/, /トークイベント/]],
  ["cheer_screening", "応援上映", [/応援上映/, /応援上映会/]],
  ["roar_screening", "爆音上映", [/爆音上映/, /爆音/]],
  ["advance_screening", "先行上映", [/先行上映/, /先行公開/]],
  ["premiere", "プレミア上映", [/プレミア上映/, /ジャパンプレミア/]],
  ["revival", "リバイバル上映", [/リバイバル/, /復活上映/]],
  ["all_night", "オールナイト上映", [/オールナイト/]],
  ["live_viewing", "ライブビューイング", [/ライブビューイング/, /ライブ?ビューイング/]],
  ["bonus_distribution", "入場者特典", [/入場者特典/, /来場者特典/, /特典配布/]],
  ["other_event", "其他活动", []]
];

/** 制式关键词——不属于活动分类表，命中即判定为 format */
const FORMAT_KEYWORD_PATTERNS = [
  /IMAX/i,
  /ドルビーシネマ|Dolby\s*Cinema/i,
  /4DX/i,
  /MX4D/i,
  /ScreenX/i,
  /TCX/i,
  /BESTIA/i,
  /^\s*[23]D\s*$/i
];

/**
 * 从判定为「制式」的括号内容里抽取真正的制式关键词本身，而不是把整段原文原样当成制式值。
 *
 * 背景（真实票务案例）：日本票务邮件里常见「SCREENX with DolbyAtmos・字幕」这类写法——
 * 一个【】里同时混了银幕规格（ScreenX）、音响系统（Dolby Atmos）和字幕标注。如果把整段
 * 原文直接存进 format 字段，下游徽章渲染只能用简单的关键词匹配去猜，Dolby 排在 ScreenX
 * 前面就会把这一场误标成「Dolby Cinema」——但这场其实是 ScreenX 厅，Dolby Atmos 只是这个
 * 厅同时具备的音响系统，不是独立的银幕规格。
 *
 * 优先级：具体的银幕／放映规格（IMAX/ScreenX/4DX/MX4D/TCX/BESTIA/Dolby Cinema）高于纯音响
 * 系统关键词（Dolby Atmos/Dolby Vision）——同一场经常是「某银幕规格 + Dolby Atmos 音效」，
 * 银幕规格才是这一场真正的「制式」。
 */
const FORMAT_EXTRACT_PATTERNS = [
  /IMAX\s*(?:(?:レーザー|LASER|with\s*Laser)\s*)?GT/i,
  /IMAX(?:\s*(?:レーザー|Laser|デジタル))?/i,
  /ScreenX/i,
  /4DX(?:\s*SCREEN)?/i,
  /MX4D/i,
  /TCX/i,
  /BESTIA/i,
  /ドルビーシネマ|Dolby\s*Cinema/i,
  /[23]D/i,
  // 兜底：纯音响系统（非独立银幕规格），只有在没有其它更具体规格命中时才会走到这里
  /Dolby\s*Atmos|Dolby\s*Vision/i
];

/** 只识别足够明确的版本词；不对普通标题做泛化删词。 */
const VERSION_LABEL_PATTERN = /^(?:4K\s*リマスタリング版|(?:4K\s*)?デジタルリマスター(?:版)?|4K\s*リマスター(?:版)?|リマスター版|完全版|修復版)$/i;
const VERSION_SUFFIX_PATTERN = /[\s　]+(4K\s*リマスタリング版|(?:4K\s*)?デジタルリマスター(?:版)?|4K\s*リマスター(?:版)?|リマスター版|完全版|修復版)$/i;

function extractPrimaryFormat(value) {
  for (const pattern of FORMAT_EXTRACT_PATTERNS) {
    const match = value.match(pattern);
    if (match) return match[0];
  }
  return value;
}

/**
 * 判断一段【】内文本属于制式、活动，还是无法判定。
 * 先匹配制式关键词，再匹配 EVENT_TYPES 的正则，都不中则 unknown。
 * @param {string} content
 * @returns {{ kind: "format", value: string } | { kind: "version", value: string } | { kind: "event", key: string } | { kind: "unknown", value: string }}
 */
export function classifyBracketContent(content) {
  const value = String(content || "").trim();
  if (!value) return { kind: "unknown", value };

  if (FORMAT_KEYWORD_PATTERNS.some((pattern) => pattern.test(value))) {
    return { kind: "format", value: extractPrimaryFormat(value) };
  }

  if (VERSION_LABEL_PATTERN.test(value)) {
    return { kind: "version", value };
  }

  for (const [key, , patterns] of EVENT_TYPES) {
    if (patterns.length && patterns.some((pattern) => pattern.test(value))) {
      return { kind: "event", key };
    }
  }

  return { kind: "unknown", value };
}

/**
 * 从标题末尾保守拆出明确版本。必须有空白边界，避免误删正式标题的一部分。
 * @param {string|null|undefined} title
 * @returns {{ movieTitle: string, version: string|null }}
 */
export function splitVersionFromTitle(title) {
  const value = String(title || "").trim();
  const match = value.match(VERSION_SUFFIX_PATTERN);
  if (!match) return { movieTitle: value, version: null };
  return {
    movieTitle: value.slice(0, match.index).trim(),
    version: match[1].replace(/^4K\s+/i, "4K").trim()
  };
}

/**
 * 从任意候选文本中提取明确放映规格词。这里只产生候选，不负责最终分类。
 * @param {string|null|undefined} text
 * @returns {string[]}
 */
export function extractCinemaFormatCandidates(text) {
  const value = String(text || "");
  if (!value) return [];
  const patterns = [
    /IMAX\s*(?:(?:レーザー|LASER|with\s*Laser)\s*)?GT/gi,
    /IMAX(?:\s*(?:レーザー|Laser|デジタル)|\s+with\s+Laser)?(?:\s*3D)?/gi,
    /ドルビーシネマ|Dolby\s*Cinema/gi,
    /MX4D(?:\s*3D)?/gi,
    /4DX(?:\s*SCREEN)?(?:\s*3D)?/gi,
    /ScreenX/gi,
    /\b(?:TCX|BESTIA)\b/gi,
    /(?:^|[\s　【[])([23]D)(?=$|[\s　】\]])/gi
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const candidate = (match[1] || match[0]).trim();
      if (candidate && !found.some((item) => item.toLowerCase() === candidate.toLowerCase())) found.push(candidate);
    }
  }
  return found;
}

/**
 * 把影院票据上的名称收敛为产品使用的稳定主分类。
 * 原始名称只在确有额外意义时进入 formatNote；“レーザー”不会单独保留。
 * @param {string|null|undefined} rawFormat
 * @returns {{ format: string|null, formatNote: string|null, is3D: boolean }}
 */
export function normalizeCinemaFormat(rawFormat) {
  const raw = String(rawFormat || "").trim().replace(/^[【[]+|[】\]]+$/g, "").trim();
  if (!raw) return { format: null, formatNote: null, is3D: false };

  const is3D = /3D/i.test(raw);
  if (/IMAX\s*(?:(?:レーザー|LASER|with\s*Laser)\s*)?GT/i.test(raw)) {
    return { format: "IMAX GT", formatNote: null, is3D };
  }
  if (/IMAX/i.test(raw)) return { format: "IMAX", formatNote: null, is3D };
  if (/ドルビーシネマ|Dolby\s*Cinema/i.test(raw)) {
    return { format: "Dolby Cinema", formatNote: null, is3D };
  }
  if (/MX4D/i.test(raw)) return { format: "4D", formatNote: "MX4D", is3D };
  if (/4DX/i.test(raw)) return { format: "4D", formatNote: "4DX", is3D };
  if (/^4D$/i.test(raw)) return { format: "4D", formatNote: null, is3D };
  if (/ScreenX/i.test(raw)) return { format: "ScreenX", formatNote: null, is3D };
  if (/^(?:2D|3D|普通)$/i.test(raw)) return { format: "普通", formatNote: null, is3D };
  if (raw === "其他") return { format: "其他", formatNote: null, is3D };
  if (/^(?:TCX|BESTIA)$/i.test(raw)) return { format: "其他", formatNote: raw, is3D };

  return { format: "其他", formatNote: raw, is3D };
}

/**
 * 从整封脱敏后的邮件文本里提取活动类型（不只看【】前缀，正文也扫描）。
 * @param {string} text
 * @returns {string[]} 去重后的 event_types key 数组
 */
export function extractEventTypes(text) {
  const value = String(text || "");
  const found = [];
  for (const [key, , patterns] of EVENT_TYPES) {
    if (patterns.length && patterns.some((pattern) => pattern.test(value))) {
      if (!found.includes(key)) found.push(key);
    }
  }
  return found;
}
