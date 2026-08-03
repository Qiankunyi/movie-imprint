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
  /Dolby/i,
  /4DX/i,
  /MX4D/i,
  /ScreenX/i,
  /TCX/i,
  /BESTIA/i,
  /^\s*[23]D\s*$/i
];

/**
 * 判断一段【】内文本属于制式、活动，还是无法判定。
 * 先匹配制式关键词，再匹配 EVENT_TYPES 的正则，都不中则 unknown。
 * @param {string} content
 * @returns {{ kind: "format", value: string } | { kind: "event", key: string } | { kind: "unknown", value: string }}
 */
export function classifyBracketContent(content) {
  const value = String(content || "").trim();
  if (!value) return { kind: "unknown", value };

  if (FORMAT_KEYWORD_PATTERNS.some((pattern) => pattern.test(value))) {
    return { kind: "format", value };
  }

  for (const [key, , patterns] of EVENT_TYPES) {
    if (patterns.length && patterns.some((pattern) => pattern.test(value))) {
      return { kind: "event", key };
    }
  }

  return { kind: "unknown", value };
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
