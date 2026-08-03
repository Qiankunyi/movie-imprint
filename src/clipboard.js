/**
 * R2 · 剪贴板读取与票务文本启发式判定
 *
 * 全部判定在本地进行，不上传剪贴板内容。命中后不自动解析，调用方只应该展示一条
 * 「检测到票务信息」的横幅，用户点了才走真正的解析——避免误读剪贴板里的其他内容。
 * 横幅本身也不得展示剪贴板内容原文。
 */

const DATE_RE = /\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?/;
const TIME_RE = /\d{1,2}:\d{2}/;
const CINEMA_KEYWORDS_RE = /劇場|シネマ|シアター|TOHO|MOVIX|イオンシネマ|影院|Cinema/i;
const TICKET_KEYWORDS_RE = /座席|スクリーン|上映|チケット|座位|场次/;

const HEURISTIC_PATTERNS = [DATE_RE, TIME_RE, CINEMA_KEYWORDS_RE, TICKET_KEYWORDS_RE];

/**
 * 判断一段文本是否"像票务文本"。同时命中 ≥2 项才算命中，避免只含日期的普通文本被误判。
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeTicketText(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  const hits = HEURISTIC_PATTERNS.filter((pattern) => pattern.test(value)).length;
  return hits >= 2;
}

/**
 * 尝试读取剪贴板文本并判定是否像票务文本。
 * 权限被拒绝、API 不存在或读取失败时一律静默失败：返回 null，不抛错、不弹任何提示。
 *
 * @param {{ clipboard?: { readText: () => Promise<string> } }} [nav]
 *   可注入的 navigator（便于测试；默认使用全局 navigator）
 * @returns {Promise<{ text: string, looksLikeTicket: boolean } | null>}
 */
export async function readClipboardTicketHint(nav = (typeof navigator !== "undefined" ? navigator : undefined)) {
  try {
    if (!nav?.clipboard?.readText) return null;
    const text = await nav.clipboard.readText();
    if (typeof text !== "string" || !text.trim()) return null;
    return { text, looksLikeTicket: looksLikeTicketText(text) };
  } catch (_) {
    return null;
  }
}
