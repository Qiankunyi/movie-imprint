/**
 * R3 · 制式与活动的徽章视觉映射。
 *
 * 「制式」（硬件规格，viewing_context.format，单值）与「活动」（这一场发生了什么，
 * viewing_context.event_types，数组）在数据层已经分流（见 src/event-types.js）；
 * 本文件只负责把两者映射成视觉：
 *   - 制式徽章：实心底 + 白字，方角（style: "solid"）
 *   - 活动徽章：描边样式，圆角（style: "outline"）
 * 两者是两个独立的家族，不互相推导。
 */

import { EVENT_TYPES } from "./event-types.js";

const FORMAT_RULES = [
  { key: "imax", label: "IMAX", tone: "imax", patterns: [/IMAX/i] },
  { key: "dolby", label: "Dolby Cinema", tone: "dolby", patterns: [/ドルビーシネマ/, /Dolby/i] },
  { key: "4dx", label: "4DX", tone: "warm", patterns: [/4DX/i] },
  { key: "mx4d", label: "MX4D", tone: "warm", patterns: [/MX4D/i] },
  { key: "screenx", label: "ScreenX", tone: "screenx", patterns: [/ScreenX/i] },
  { key: "2d", label: "2D", tone: "neutral", patterns: [/^2D$/i] }
];

/** 视觉权重更高的制式——影院卡的增强描边/高光只为这些制式启用 */
export const HIGH_SPEC_FORMAT_KEYS = ["imax", "dolby", "4dx", "mx4d", "screenx"];

function stripBracket(value) {
  return String(value ?? "").trim().replace(/^[【[]+|[】\]]+$/g, "").trim();
}

/**
 * 把任意写法的制式字符串归一化到统一 key。未命中已知制式 → "unknown"；空值 → null。
 * @param {string|null|undefined} rawFormat
 * @returns {string|null}
 */
export function normalizeFormatKey(rawFormat) {
  const value = stripBracket(rawFormat);
  if (!value) return null;
  const rule = FORMAT_RULES.find((item) => item.patterns.some((pattern) => pattern.test(value)));
  return rule ? rule.key : "unknown";
}

/**
 * 制式徽章数据。未命中已知制式时优雅降级：中性配色 + 原样显示文本，不抛错。
 * @param {string|null|undefined} rawFormat
 * @returns {{key:string,label:string,style:"solid",tone:string}|null}
 */
export function formatBadge(rawFormat) {
  const value = stripBracket(rawFormat);
  if (!value) return null;
  const key = normalizeFormatKey(rawFormat);
  const rule = FORMAT_RULES.find((item) => item.key === key);
  return {
    key: key || "unknown",
    label: rule ? rule.label : value,
    style: "solid",
    tone: rule ? rule.tone : "neutral"
  };
}

export function isHighSpecFormat(rawFormat) {
  const key = normalizeFormatKey(rawFormat);
  return key ? HIGH_SPEC_FORMAT_KEYS.includes(key) : false;
}

/** 活动优先级：舞台挨拶／トーク最高，其余按 EVENT_TYPES 声明顺序排在后面 */
const EVENT_PRIORITY = [
  "stage_greeting", "talk_show", "premiere", "advance_screening",
  "cheer_screening", "roar_screening",
  "revival", "all_night", "live_viewing", "bonus_distribution", "other_event"
];

const EVENT_TONES = {
  stage_greeting: "warm-red",
  talk_show: "warm-red",
  cheer_screening: "warm-orange",
  roar_screening: "warm-orange",
  advance_screening: "gold",
  premiere: "gold",
  revival: "indigo",
  all_night: "indigo",
  live_viewing: "cyan",
  bonus_distribution: "neutral",
  other_event: "neutral"
};

const EVENT_ICONS = {
  bonus_distribution: "gift"
};

const EVENT_LABELS = new Map(EVENT_TYPES.map(([key, label]) => [key, label]));

/**
 * 活动徽章列表，按约定优先级排序，最多显示 max 个，其余折叠为 { overflow }。
 * @param {string[]} eventTypeKeys
 * @param {{max?: number}} [options]
 * @returns {{badges: Array<{key:string,label:string,style:"outline",tone:string,icon:string|null}>, overflow: number}}
 */
export function eventBadges(eventTypeKeys, { max = 2 } = {}) {
  const list = Array.isArray(eventTypeKeys) ? eventTypeKeys.filter(Boolean) : [];
  const unique = [...new Set(list)];
  if (!unique.length) return { badges: [], overflow: 0 };
  const sorted = unique.sort((a, b) => {
    const ia = EVENT_PRIORITY.indexOf(a);
    const ib = EVENT_PRIORITY.indexOf(b);
    return (ia === -1 ? EVENT_PRIORITY.length : ia) - (ib === -1 ? EVENT_PRIORITY.length : ib);
  });
  const shown = sorted.slice(0, max);
  const overflow = Math.max(0, sorted.length - max);
  const badges = shown.map((key) => ({
    key,
    label: EVENT_LABELS.get(key) || key,
    style: "outline",
    tone: EVENT_TONES[key] || "neutral",
    icon: EVENT_ICONS[key] || null
  }));
  return { badges, overflow };
}
