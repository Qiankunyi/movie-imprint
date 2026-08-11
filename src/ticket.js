/**
 * C4 票务解析模块
 *
 * 处理顺序（严格执行）：
 *   浏览器本地拆分邮件 → 本地脱敏 → 确定性模板解析 → 输出 screenings 数组
 *
 * 票务原文默认不保存，不发给 AI，不进入导出或 GitHub。
 *
 * R1 红线变更（2026-08-03，见 docs/RESTRUCTURE_PLAN_R1-R5.md §9.1）：
 * 票价不再脱敏，作为观影事实解析并保留；姓名、邮箱、手机号、订单号、取票码、
 * 二维码令牌、会员登录 URL、支付方式与卡号仍然强制移除。票价不得进入 AI 请求体。
 */

import {
  classifyBracketContent,
  extractCinemaFormatCandidates,
  extractEventTypes,
  normalizeCinemaFormat,
  splitVersionFromTitle
} from "./event-types.js";
import {
  cleanOcrCinemaCandidate,
  cleanOcrTitleCandidate,
  normalizeOcrTicketInput
} from "./ticket-normalize.js";

// ─── 1. 敏感信息模式 ────────────────────────────────────────────────────────

/** 逐字段脱敏规则，顺序执行，每步相互独立 */
const REDACTION_RULES = [
  // QR 完整地址（含 https:// 的取票 URL）
  {
    pattern: /https?:\/\/\S+/gi,
    replacement: "[TICKET_QR_REDACTED]"
  },
  // 日文邮箱 / RFC 5321 邮箱
  {
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL_REDACTED]"
  },
  // 日本手机号（080/090/070 开头，11 位，各种分隔符）
  {
    pattern: /0[789]0[-\s]?\d{4}[-\s]?\d{4}/g,
    replacement: "[PHONE_REDACTED]"
  },
  // 国际格式手机号 +81
  {
    pattern: /\+81[-\s]?\d{2,3}[-\s]?\d{4}[-\s]?\d{4}/g,
    replacement: "[PHONE_REDACTED]"
  },
  // 支付方式说明（決済方法／支払方法：クレジットカード 等）——票价是观影事实，
  // 支付信息是金融信息，两者不同，支付信息仍强制移除
  {
    pattern: /(?:決済方法|支払方法|お支払い方法|支払い方法)[：:]\s*[^\n]+/g,
    replacement: "[PAYMENT_METHOD_REDACTED]"
  },
  // 银行卡号（13–19 位，允许空格或短横分隔，含卡号后四位标注）
  {
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g,
    replacement: "[CARD_NUMBER_REDACTED]"
  },
  {
    pattern: /(?:カード番号)?(?:末尾|下)\s*4\s*桁[：:]\s*\d{3,4}/g,
    replacement: "[CARD_NUMBER_REDACTED]"
  },
  // SMT / 一般购票系统的订单号（8–20 位纯数字，独立出现）
  {
    pattern: /(?<!\d)\d{8,20}(?!\d)/g,
    replacement: "[ORDER_REDACTED]"
  },
  // 注意：票价（¥／円）不再脱敏（R1 红线变更），由 parseTicketPrice 正常解析保留
  // 姓名行：「様」「さま」「殿」前的片假名 / 汉字姓名（2–8 字）
  {
    pattern: /[゠-ヿ一-鿿]{2,8}\s*(?:様|さま|殿)/g,
    replacement: "[NAME_REDACTED]様"
  },
  // 会员登录 URL（my-page / login / member 路径）
  {
    pattern: /https?:\/\/\S*(?:my-?page|login|member|account)\S*/gi,
    replacement: "[MEMBER_URL_REDACTED]"
  }
];

/**
 * 对单段文本执行本地脱敏
 * @param {string} text
 * @returns {string}
 */
export function redactSensitiveInfo(text) {
  let result = text;
  for (const { pattern, replacement } of REDACTION_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── 2. 多邮件拆分 ───────────────────────────────────────────────────────────

/**
 * 识别邮件边界的启发规则：
 * - 重复出现"From:"/"件名:"/"Subject:" 行
 * - SMT 固有页眉"松竹マルチプレックスシアターズ"
 * - 连续 4 个以上 "-" 分隔行
 * - "-- Forwarded message --" 之类的转发标记
 */
const EMAIL_BOUNDARY_RE = /(?=^(?:From:|件名:|Subject:|To:|宛先:))/im;
const SMT_HEADER_RE = /松竹マルチプレックスシアターズ|SMT\b|smt-cinema\.com/i;

/**
 * 判断一个文本段是否包含订票信息（日期 + 片名或影院）
 * 用于过滤分隔线拆分后的假段落
 * @param {string} segment
 * @returns {boolean}
 */
function looksLikeBooking(segment) {
  const hasDate = /\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}/.test(segment);
  const hasTime = /\d{1,2}:\d{2}\s*[～〜]\s*\d{1,2}:\d{2}|開映(?:時間)?[：:]/.test(segment);
  const hasTitle = /(?:上映作品|作品名|作品|映画名|タイトル)[ \t　]*[：:][ \t　]*.{2,}/.test(segment);
  const hasCinema = /(?:劇場名|劇場|映画館|上映劇場)[ \t　]*[：:]/.test(segment);
  return (hasDate || hasTime) && (hasTitle || hasCinema);
}

/**
 * 把粘贴文本按邮件边界拆分为若干段
 * @param {string} raw
 * @returns {string[]}
 */
export function splitEmails(raw) {
  // 先尝试按"From:"这类标准头部分割
  const byHeader = raw.split(EMAIL_BOUNDARY_RE).map((s) => s.trim()).filter(Boolean);
  if (byHeader.length > 1) return byHeader;

  // 若无明显头部，按连续 4+ 横线分割（常见于邮件客户端复制粘贴）
  // 但需过滤：只有 ≥2 段都像真实订票时才拆（避免 KINEZO 等内部多用分隔线的邮件被误拆）
  const byDivider = raw.split(/\n[-─━=]{4,}\n/).map((s) => s.trim()).filter(Boolean);
  if (byDivider.length > 1) {
    const bookingSegments = byDivider.filter(looksLikeBooking);
    if (bookingSegments.length >= 2) return bookingSegments;
    // 只有 0 或 1 段像订票 → 整体当单封处理，不拆分
  }

  // SMT 固有特征：重复出现发件方标识（必须用全局正则计数）
  const smtMatches = raw.match(SMT_HEADER_RE_G) || [];
  const smtCount = smtMatches.length;
  if (smtCount >= 2) {
    // 以第二次出现为边界拆分
    const firstToken = smtMatches[0];
    const idx = raw.indexOf(firstToken);
    const second = raw.indexOf(firstToken, idx + firstToken.length);
    if (second > idx) {
      return [raw.slice(0, second).trim(), raw.slice(second).trim()].filter(Boolean);
    }
  }

  return [raw.trim()];
}

// ─── 3. 制式前缀清洗 ─────────────────────────────────────────────────────────

/** 用于计数的全局版本 SMT 匹配正则 */
const SMT_HEADER_RE_G = /松竹マルチプレックスシアターズ|SMT\b|smt-cinema\.com/gi;

/**
 * 已知放映制式／活动前缀（用于从电影名称中剥离，可能连续多个【】）
 * 以日文全角方括号包裹为主
 */
const BRACKET_TOKEN_RE = /【([^】]*)】|\[([^\]]*)\]/gu;

/**
 * 从邮件中提取的原始片名中分离制式前缀、活动前缀与片名。
 *
 * 提案 I：制式（硬件规格，如 IMAX/Dolby Cinema/4DX）与活动（这一场的性质，如舞台挨拶／
 * 応援上映）是两类东西，必须分流——不能像旧实现那样把片名里的【...】一律当作制式。
 *
 * @param {string} raw 例如 "【IMAX】【舞台挨拶付き】劇場版○○"
 * @returns {{ movieTitle: string, version: string|null, format: string|null, formatNote: string|null, is3D: boolean, eventTypes: string[] }}
 */
export function extractFormatAndTitle(raw) {
  const brackets = [...String(raw || "").matchAll(BRACKET_TOKEN_RE)];
  const rawFormats = [];
  let version = null;
  const eventTypes = [];
  const removableTokens = [];
  for (const match of brackets) {
    const content = (match[1] ?? match[2] ?? "").trim();
    const classification = classifyBracketContent(content);
    if (classification.kind === "format") {
      rawFormats.push(classification.value);
      removableTokens.push(match[0]);
    } else if (classification.kind === "version") {
      if (!version) version = classification.value;
      removableTokens.push(match[0]);
    } else if (classification.kind === "event") {
      if (!eventTypes.includes(classification.key)) eventTypes.push(classification.key);
      removableTokens.push(match[0]);
    }
  }
  let cleanedTitle = String(raw || "");
  for (const token of removableTokens) cleanedTitle = cleanedTitle.replace(token, " ");
  cleanedTitle = cleanedTitle.replace(/[\s　]+/g, " ").trim();

  const suffix = splitVersionFromTitle(cleanedTitle);
  version ||= suffix.version;
  const normalizedFormats = rawFormats.map(normalizeCinemaFormat);
  const normalized = normalizedFormats.find((item) => item.format && item.format !== "普通")
    || normalizedFormats[0]
    || normalizeCinemaFormat(null);
  return {
    movieTitle: suffix.movieTitle,
    version,
    format: normalized.format,
    formatNote: normalized.formatNote,
    is3D: normalizedFormats.some((item) => item.is3D),
    eventTypes
  };
}

/**
 * 从一段文本中解析票价。金额与币种分开返回；明确的「円 / JPY」和
 * 「元 / CNY / RMB」直接判定，只有 ¥/￥ 时再根据票务文本语言判断。
 * 多个数值时取各项之和；只有一个数值时即为合计。
 *
 * R5 补丁 6：额外返回 `count`（原文里出现了几笔金额）。
 * 双人观影的票据里会出现两笔，之前只把它们加总成一个数字存下来，
 * 展示时看着就像"这部电影一张票 4,500 円"，会误导对票价的认知。
 * 有了 count，UI 就能明确写成「￥4,500 · 2 张」。
 *
 * @param {string} segment
 * @returns {{ amount: number, currency: "JPY"|"CNY", count: number } | null}
 */
export function parseTicketPrice(segment) {
  if (!segment) return null;
  const text = String(segment);
  let currency = null;
  if (/(?:\d[\d,]*(?:\.\d+)?)\s*(?:円|日元|JPY\b)|\bJPY\s*[\d,]/i.test(text)) currency = "JPY";
  if (/(?:\d[\d,]*(?:\.\d+)?)\s*(?:元|人民币|CNY\b|RMB\b)|\b(?:CNY|RMB)\s*[\d,]/i.test(text)) currency = "CNY";

  // 同一段出现两种明确币种时无法安全合计，交给用户手动填写。
  const hasJpy = /円|日元|\bJPY\b/i.test(text);
  const hasCny = /人民币|\bCNY\b|\bRMB\b|\d[\d,]*(?:\.\d+)?\s*元/i.test(text);
  if (hasJpy && hasCny) return null;

  if (!currency && /[¥￥]/.test(text)) {
    const japaneseTicketContext = /料金|金額|大人|小人|劇場|上映|座席|購入|ご予約|KINEZO|シネマ|チケット|松竹/i.test(text);
    const chineseTicketContext = /票价|金额|人民币|影城|影院|场次|座位|订单|购票/i.test(text);
    if (japaneseTicketContext && !chineseTicketContext) currency = "JPY";
    else if (chineseTicketContext && !japaneseTicketContext) currency = "CNY";
  }
  // ¥/￥ 本身同时用于人民币和日元；没有上下文就不擅自猜。
  if (!currency) return null;

  const pattern = currency === "JPY"
    ? /(?:JPY\s*|[¥￥]\s*)?([\d,]+(?:\.\d+)?)\s*(?:円|日元|JPY\b)?/gi
    : /(?:CNY\s*|RMB\s*|[¥￥]\s*)?([\d,]+(?:\.\d+)?)\s*(?:元|人民币|CNY\b|RMB\b)?/gi;
  const matches = [...text.matchAll(pattern)].filter((match) => {
    const raw = match[0];
    return currency === "JPY"
      ? /円|日元|JPY|[¥￥]/i.test(raw)
      : /元|人民币|CNY|RMB|[¥￥]/i.test(raw);
  });
  if (!matches.length) return null;
  const amounts = matches
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!amounts.length) return null;
  const amount = amounts.length === 1 ? amounts[0] : amounts.reduce((sum, n) => sum + n, 0);
  const explicitCounts = [...text.matchAll(/(\d+)\s*枚/g)]
    .map((match) => Number(match[1]))
    .filter((count) => Number.isInteger(count) && count > 0);
  const count = explicitCounts.length ? Math.max(...explicitCounts) : amounts.length;
  return { amount, currency, count };
}

function computeDurationMinutes(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

// ─── 字段候选识别 ────────────────────────────────────────────────────────────

/**
 * 同一语义允许不同影院使用不同标签和分隔符；这里仅识别字段，不在这一层解释字段内容。
 * priority 越小越明确，例如「上映作品」优先于泛化的「作品」。
 */
const TICKET_FIELD_DEFINITIONS = [
  { key: "title", labels: [["上映作品", 0], ["作品名", 1], ["映画名", 1], ["タイトル", 1], ["影片", 1], ["电影", 1], ["作品", 2]] },
  { key: "auditorium", labels: [["上映スクリーン", 0], ["上映劇場", 0], ["シアター名", 1], ["スクリーン名", 1], ["影厅", 1], ["厅号", 1]] },
  { key: "cinema", labels: [["劇場名", 0], ["映画館", 1], ["电影院", 1], ["影院", 1], ["影城", 1], ["劇場", 2]] },
  { key: "datetime", labels: [["日時", 0]] },
  { key: "date", labels: [["上映日", 0], ["観賞日", 1], ["鑑賞日", 1]] },
  { key: "time_range", labels: [["上映時間", 0]] },
  { key: "start_time", labels: [["開映時間", 0], ["開映", 1]] },
  { key: "end_time", labels: [["終映時間", 0], ["終映", 1]] },
  { key: "seat", labels: [["座席番号", 0], ["お座席", 1], ["席番", 1], ["座席", 2]] },
  { key: "ticket", labels: [["チケット", 0], ["券種", 1]] },
  { key: "format", labels: [["上映方式", 0], ["放映方式", 0], ["制式", 1]] },
  { key: "language", labels: [["语言", 0], ["语种", 0], ["言語", 0]] },
  { key: "quantity", labels: [["张数", 0], ["数量", 1], ["購入枚数", 1]] },
  { key: "price", labels: [["購入金額", 0], ["料金", 1], ["金額", 1], ["合計", 2]] }
];

function stripFieldMarker(line) {
  return String(line || "").replace(/^[ \t　]*[▼▽■◆◇●○・▶►][ \t　]*/u, "").trim();
}

function matchTicketFieldLine(line) {
  const clean = stripFieldMarker(line);
  for (const definition of TICKET_FIELD_DEFINITIONS) {
    const labels = definition.labels.slice().sort((a, b) => b[0].length - a[0].length);
    for (const [label, priority] of labels) {
      if (!clean.startsWith(label)) continue;
      const remainder = clean.slice(label.length);
      const match = remainder.match(/^(?:[ \t　]*[：:][ \t　]*|[ \t　]+)(.+)$/u);
      if (match?.[1]?.trim()) return { key: definition.key, label, priority, value: match[1].trim() };
    }
  }
  return null;
}

function extractTicketFields(segment) {
  const fields = {};
  String(segment || "").split(/\r?\n/).forEach((line, lineIndex) => {
    const match = matchTicketFieldLine(line);
    if (!match) return;
    fields[match.key] ||= [];
    fields[match.key].push({ ...match, lineIndex });
  });
  return fields;
}

function pickTicketField(fields, key) {
  return (fields[key] || [])
    .slice()
    .sort((a, b) => a.priority - b.priority || a.lineIndex - b.lineIndex)[0]?.value || null;
}

function normalizeFormatCandidates(detailsCandidates) {
  const candidates = detailsCandidates.filter(Boolean);
  const selected = candidates.find((item) => item.format && item.format !== "普通")
    || candidates.find((item) => item.format)
    || normalizeCinemaFormat(null);
  return {
    format: selected.format,
    formatNote: selected.formatNote,
    is3D: candidates.some((item) => item.is3D)
  };
}

function cleanCinemaField(value, { ocr = false } = {}) {
  let cinema = String(value || "").trim();
  for (const candidate of extractCinemaFormatCandidates(cinema)) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cinema = cinema.replace(new RegExp(`[ \\t　]*(?:【|\\[)?${escaped}(?:】|\\])?[ \\t　]*$`, "i"), "").trim();
  }
  if (ocr) cinema = cleanOcrCinemaCandidate(cinema);
  return cinema || null;
}

function parseTicketType(value) {
  if (!value) return null;
  return String(value)
    .trim()
    .replace(/[ \t　]+[¥￥]?[\d,]+(?:\.\d+)?\s*(?:円|日元|JPY|元|CNY|RMB)(?:\s*[/／]\s*\d+\s*枚)?\s*$/i, "")
    .replace(/[ \t　]+\d+\s*枚\s*$/, "")
    .trim() || null;
}

/**
 * 无字段标签的简式票据常按“一行一个语义”排列。这里仅判断结构性元数据，
 * 让标题 fallback 排除影院、日期、时间、规格、影厅和座位，而不是依赖行长度。
 */
function isLikelyCinemaLine(line) {
  const value = String(line || "").trim();
  if (!value || /[：:]/.test(value)) return false;
  return /(?:电影院|电影城|国际影城|影城|影院|剧院|影业|Cinema|劇場|劇院|シネマ|MOVIX|TOHO|109シネマズ)/iu.test(value);
}

function extractAuditoriumCandidate(line) {
  const value = String(line || "").trim();
  const match = value.match(/(?:IMAX|杜比|激光|巨幕|中国巨幕|VIP|普通)?[\p{Script=Han}A-Za-z]*\d+[\s　]*(?:号)?[\s　]*(?:厅|館)/iu);
  return match?.[0]?.replace(/[\s　]+/gu, "") || null;
}

function isLikelyChineseSeatLine(line) {
  return /^\d+[\s　]*排[\s　]*\d+[\s　]*(?:座|号)(?:[\s　]*[,，、][\s　]*\d+[\s　]*(?:座|号))*$/u.test(String(line || "").trim());
}

function extractUnlabeledFormat(line) {
  const value = String(line || "").trim();
  if (!/^(?:(?:国语|普通话|粤语|英语|日语|韩语|原声|中文|外语)[\s　]*)?(?:2D|3D|IMAX(?:[\s　]*(?:GT|3D))?|Dolby[\s　]*Cinema|杜比影院|4DX|MX4D|ScreenX)(?:[\s　]*\d+[\s　]*张)?$/iu.test(value)) return null;
  return value.match(/IMAX(?:[\s　]*(?:GT|3D))?|Dolby[\s　]*Cinema|杜比影院|4DX|MX4D|ScreenX|[23]D/iu)?.[0] || null;
}

function isLikelyTicketMetadataLine(line) {
  const value = String(line || "").trim();
  return !value
    || Boolean(matchTicketFieldLine(value))
    || isLikelyCinemaLine(value)
    || Boolean(extractAuditoriumCandidate(value))
    || isLikelyChineseSeatLine(value)
    || Boolean(extractUnlabeledFormat(value))
    || /^\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}[日]?/u.test(value)
    || /^\d{1,2}:\d{2}\s*[～〜~]\s*\d{1,2}:\d{2}$/u.test(value)
    || /^(?:合计|合計)?[¥￥]?[\d,]+(?:\.\d+)?\s*(?:円|元|JPY|CNY)?$/iu.test(value)
    || /^https?:\/\//iu.test(value)
    || /REDACTED/u.test(value);
}

function extractViewingLanguage(segment) {
  const labeled = pickTicketField(extractTicketFields(segment), "language");
  const tokenPattern = /(国语|普通话|粤语|英语|英文|日语|日文|韩语|韩文|原声|中文|外语)/u;
  if (labeled) return labeled.match(tokenPattern)?.[1] || null;
  for (const line of String(segment || "").split(/\r?\n/)) {
    const match = line.match(/(?:^|[\s　/／·])(国语|普通话|粤语|英语|英文|日语|日文|韩语|韩文|原声|中文|外语)(?=$|[\s　/／·]|[23]D|\d+\s*(?:张|枚))/u);
    if (match) return match[1];
  }
  return null;
}

function extractTicketQuantity(segment, seats, ticketPrice) {
  const labeled = pickTicketField(extractTicketFields(segment), "quantity");
  const explicit = (labeled || String(segment || "")).match(/(?:^|\s)(\d+)\s*(?:张|枚)(?:\s|$|[／/])/u);
  if (explicit) return Math.max(1, Number(explicit[1]) || 1);
  if (Number(ticketPrice?.count) > 0) return Number(ticketPrice.count);
  if (seats.length) return seats.length;
  return null;
}

function scoreTitleCandidate(line, index, { ocr = false } = {}) {
  let value = String(line || "").trim();
  if (ocr) value = cleanOcrTitleCandidate(value);
  if (value.length < 2 || isLikelyTicketMetadataLine(value)) return null;
  if (isLikelyCinemaLine(value)) return null;
  if (/^(?:国语|普通话|粤语|英语|英文|日语|日文|韩语|韩文|原声|中文|外语)(?:\s|[23]D|\d+张|\d+枚|$)/iu.test(value)) return null;

  const cjkCount = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const letterCount = (value.match(/[\p{L}\p{N}]/gu) || []).length;
  let score = Math.min(letterCount, 30) + Math.min(cjkCount, 16) * 1.5;
  if (/[：:《》「」『』・·]/u.test(value)) score += 2;
  if (letterCount / Math.max(value.length, 1) < 0.45) score -= 8;
  score -= index * 0.05; // 仅作同分项；位置不再决定 title。
  return { value, score };
}

function selectTitleCandidate(lines, options) {
  return lines
    .map((line, index) => scoreTitleCandidate(line, index, options))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0]?.value || null;
}

// ─── 4. 单段邮件字段解析 ─────────────────────────────────────────────────────

/**
 * 从日文 SMT 购票邮件中提取放映场次字段
 *
 * 支持字段：作品名、观影日期、开始/结束时间、影院、制式、活动、座位、票价
 * 不提取：姓名、邮箱、订单号、QR、支付信息（这些已在脱敏阶段移除）
 * 票价通过 parseTicketPrice 单独提取并保留（R1 红线变更：票价不再脱敏）
 *
 * @param {string} segment 已脱敏的单段邮件文本
 * @returns {ScreeningDraft | null}
 */
export function parseScreeningSegment(segment, options = {}) {
  const fields = extractTicketFields(segment);
  const ticketLines = String(segment || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  // ── 片名 ──────────────────────────────────────────────────────────────────
  // 明确字段必须先于任何 heuristic；「上映作品」是影院票据中最高优先级的作品字段。
  const heuristicTitlePatterns = [
    /(?:^|\n)[ \t　]*((?:【[^】]*】|\[[^\]]*\])+[ \t　]*[^\n]+)/m,
    /(?:^|\n)(劇場版[^\n]+)/m,
    /(?:^|\n)([^\n]*(?:劇場版|THE MOVIE|movie)[^\n]*)/im
  ];
  let rawTitle = pickTicketField(fields, "title");
  if (!rawTitle) {
    for (const pattern of heuristicTitlePatterns) {
      const m = segment.match(pattern);
      if (m) { rawTitle = m[1].trim(); break; }
    }
  }
  // 只有完全不存在明确作品字段时才 fallback；所有票务元数据行均不得成为标题。
  if (!rawTitle) {
    rawTitle = selectTitleCandidate(ticketLines, options);
  }
  if (!rawTitle) return null;
  if (options.ocr) rawTitle = cleanOcrTitleCandidate(rawTitle);

  const {
    movieTitle,
    version,
    format: formatFromTitle,
    formatNote: formatNoteFromTitle,
    is3D: is3DFromTitle,
    eventTypes: eventTypesFromTitle
  } = extractFormatAndTitle(rawTitle);

  // ── 日期与时間 ────────────────────────────────────────────────────────────
  // 格式：2026/7/18、2026-07-18、2026年7月18日
  const dateMatch = segment.match(
    /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})[日]?/
  );
  const viewedOn = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : null;

  // 时间区间（同一行）：12:35～14:40、12:35〜14:40
  const timeRangeMatch = segment.match(
    /(\d{1,2}:\d{2})\s*[～〜~]\s*(\d{1,2}:\d{2})/
  );
  // 开始时间（独立行）：「開映時間：9:50」或「開映：9:50」
  const startTimeMatch = !timeRangeMatch && segment.match(
    /開映(?:時間)?[：:]\s*(\d{1,2}:\d{2})/
  );
  // 结束时间（独立行）：「終映時間：12:10」或「終映：12:10」
  const endTimeMatch = segment.match(
    /終映(?:時間)?[：:]\s*(\d{1,2}:\d{2})/
  );

  let screeningAt = null;
  let screeningEndsAt = null;

  if (viewedOn && timeRangeMatch) {
    screeningAt = toISO(viewedOn, timeRangeMatch[1]);
    screeningEndsAt = toISO(viewedOn, timeRangeMatch[2]);
  } else if (viewedOn && startTimeMatch) {
    screeningAt = toISO(viewedOn, startTimeMatch[1]);
    if (endTimeMatch) screeningEndsAt = toISO(viewedOn, endTimeMatch[1]);
  }

  // ── 影院 ──────────────────────────────────────────────────────────────────
  // 注意：先用带标签的精确模式，避免匹配到「劇場版」「シアターズ」等非影院名
  const rawCinemaField = pickTicketField(fields, "cinema");
  const cinemaPatterns = [
    /(MOVIX\S+)/i,
    /(TOHOシネマズ\S+)/i,
    /(イオンシネマ\S+)/i,
    /(ユナイテッド・シネマ\S+)/i,
    /([^\n]*(?:シネマ|シアター)[^\n]*(?:京都|大阪|東京|名古屋|福岡|仙台|札幌)[^\n]*)/i
  ];
  const unlabeledCinemaLine = ticketLines.find(isLikelyCinemaLine) || null;
  let cinemaName = cleanCinemaField(rawCinemaField || unlabeledCinemaLine, options);
  if (!cinemaName) {
    for (const pattern of cinemaPatterns) {
      const m = segment.match(pattern);
      if (m) { cinemaName = cleanCinemaField(m[1], options); break; }
    }
  }

  // 「上映劇場」在 109 シネマズ等票据中表示具体影厅，不能与「劇場名」混用。
  const auditorium = pickTicketField(fields, "auditorium")
    || ticketLines.map(extractAuditoriumCandidate).find(Boolean)
    || null;

  // 城市：从影院名推断
  let city = null;
  if (cinemaName) {
    const cityMatch = cinemaName.match(/京都|大阪|東京|名古屋|福岡|仙台|札幌|横浜|神戸|広島|长沙|北京|上海|广州|深圳|成都|重庆|武汉|西安|杭州|南京|苏州|天津|青岛|厦门/);
    if (cityMatch) city = cityMatch[0];
  }

  // ── 放映制式 ──────────────────────────────────────────────────────────────
  // 具体的银幕／放映规格排在前面，裸的 "Dolby"（可能只是 Dolby Atmos 音响系统，不代表
  // Dolby Cinema 银幕规格）放最后兜底，避免它在同一段文本里抢在 ScreenX/IMAX 等真正的
  // 银幕规格前面被误判（参见 src/event-types.js 顶部注释里的真实票务案例）。
  const formatDetailsCandidates = [];
  if (formatFromTitle) {
    formatDetailsCandidates.push({ format: formatFromTitle, formatNote: formatNoteFromTitle, is3D: is3DFromTitle });
  }
  const rawFormatSources = [pickTicketField(fields, "format"), rawCinemaField, segment];
  for (const source of rawFormatSources) {
    for (const candidate of extractCinemaFormatCandidates(source)) {
      formatDetailsCandidates.push(normalizeCinemaFormat(candidate));
    }
  }
  for (const line of ticketLines) {
    const candidate = extractUnlabeledFormat(line);
    if (candidate) formatDetailsCandidates.push(normalizeCinemaFormat(candidate));
  }
  const normalizedFormat = normalizeFormatCandidates(formatDetailsCandidates);

  // ── 座位 ──────────────────────────────────────────────────────────────────
  // 格式：J-11、J-12 或 J11 J12 或 「J-11・J-12」
  const seatMatch = segment.match(
    /(?:座席|席番|座席番号|お座席)[：:\s]*([^\n]+)/i
  ) || segment.match(/\b([A-Z]-?\d{1,3}(?:[・、\s,]+[A-Z]-?\d{1,3})*)\b/);
  let seats = [];
  if (seatMatch) {
    seats = (seatMatch[1].match(/[A-Z][ \t　]*-?[ \t　]*\d{1,3}/gi) || [])
      .map((seat) => seat.replace(/[ \t　]+/g, "").toUpperCase())
      .map((seat) => seat.includes("-") ? seat : seat.replace(/^([A-Z])(\d+)$/, "$1-$2"));
  }
  if (!seats.length) {
    seats = [...segment.matchAll(/(\d+)[\s　]*排[\s　]*(\d+)[\s　]*(?:座|号)/gu)]
      .map((match) => `${match[1]}排${match[2]}座`);
  }

  // ── 票务提供商 ────────────────────────────────────────────────────────────
  let ticketProvider = null;
  if (SMT_HEADER_RE.test(segment)) ticketProvider = "SMT";
  else if (/\bMOVIX/i.test(segment)) ticketProvider = "SMT";
  else if (/toho-cinemas\.com|TOHOシネマズ/i.test(segment)) ticketProvider = "TOHO";
  else if (/aeoncinema\.com|イオンシネマ/i.test(segment)) ticketProvider = "AEON";
  else if (/KINEZO|kinezo\.jp/i.test(segment)) ticketProvider = "KINEZO";
  else if (/tjoy\.jp|T・ジョイ/i.test(segment)) ticketProvider = "TJOY";

  // ── 活动（提案 I）───────────────────────────────────────────────────────────
  // 不只看片名【】前缀——舞台挨拶等信息常出现在正文
  const eventTypes = [...new Set([...(eventTypesFromTitle || []), ...extractEventTypes(segment)])];

  // ── 票价（R1 红线变更：不再脱敏，正常解析保留）────────────────────────────
  const ticketPrice = parseTicketPrice(segment);
  const ticketType = parseTicketType(pickTicketField(fields, "ticket"));
  const language = extractViewingLanguage(segment);
  const ticketQuantity = extractTicketQuantity(segment, seats, ticketPrice);

  return {
    movieTitle,
    rawTitle,
    version,
    viewedOn,
    screeningAt,
    screeningEndsAt,
    cinemaName,
    auditorium,
    city,
    format: normalizedFormat.format,
    formatNote: normalizedFormat.formatNote,
    is3D: normalizedFormat.is3D,
    eventTypes,
    seats,
    seatCount: seats.length,
    ticketProvider,
    ticketPrice,
    ticketType,
    language,
    ticketQuantity
  };
}

// ─── 5. 主入口 ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ScreeningDraft
 * @property {string}        movieTitle       片名（已移除制式前缀）
 * @property {string|null}   rawTitle         邮件原始片名
 * @property {string|null}   version          明确识别出的作品版本
 * @property {string|null}   viewedOn         观影日期 YYYY-MM-DD
 * @property {string|null}   screeningAt      放映开始 ISO 8601 +09:00
 * @property {string|null}   screeningEndsAt  放映结束 ISO 8601 +09:00
 * @property {string|null}   cinemaName       影院名
 * @property {string|null}   auditorium       影厅
 * @property {string|null}   city             城市（推断值，可修改）
 * @property {string|null}   format           放映制式
 * @property {string|null}   formatNote       规格备注
 * @property {boolean}       is3D             是否为 3D 放映
 * @property {string[]}      eventTypes       活动类型 key 数组（舞台挨拶／応援上映等，与制式分流）
 * @property {string[]}      seats            座位列表
 * @property {number}        seatCount        座位数
 * @property {string|null}   ticketProvider   票务提供商标识
 * @property {{amount:number,currency:"JPY"|"CNY",count?:number}|null} ticketPrice 票价（R1 起不再脱敏）
 * @property {string|null}   ticketType       票种
 * @property {string|null}   language         放映语言
 * @property {number|null}   ticketQuantity   张数（可独立于票价存在）
 */

/**
 * @typedef {Object} TicketParseResult
 * @property {number}           messagesDetected   检测到的邮件封数
 * @property {string[]}         sensitiveDataRemoved  已移除的敏感字段类型
 * @property {ScreeningDraft[]} screenings         按放映时间升序排列的场次列表
 * @property {false}            rawTicketTextSaved 票务原文不保存
 */

/**
 * 解析用户粘贴的票务文本（可含多封邮件）
 *
 * @param {string} rawInput 用户粘贴的原始文本（不得传入 AI）
 * @param {{ocr?:boolean,layout?:object|null}} [options] OCR 来源可携带临时布局信息
 * @returns {TicketParseResult}
 */
export function parseTicketText(rawInput, options = {}) {
  const parserInput = options.ocr
    ? normalizeOcrTicketInput(rawInput, options.layout).text
    : rawInput;
  // 第一步：按邮件边界拆分
  const segments = splitEmails(parserInput);

  // 第二步：每段独立脱敏（脱敏发生在解析之前，不返回脱敏后文本）
  const redactedSegments = segments.map(redactSensitiveInfo);

  // 第三步：逐段解析
  const screenings = redactedSegments
    .map((segment) => parseScreeningSegment(segment, options))
    .filter(Boolean);

  // 第四步：按放映开始时间升序排列（无时间的排在最后）
  screenings.sort((a, b) => {
    if (!a.screeningAt && !b.screeningAt) return 0;
    if (!a.screeningAt) return 1;
    if (!b.screeningAt) return -1;
    return a.screeningAt < b.screeningAt ? -1 : 1;
  });

  return {
    messagesDetected: segments.length,
    sensitiveDataRemoved: [
      "recipient_email",
      "customer_name",
      "ticket_qr_url",
      "ticket_qr_token",
      "member_login_url",
      "payment_method",
      "card_number"
    ],
    screenings,
    rawTicketTextSaved: false
  };
}

// ─── 6. ViewingEvent 工厂 ────────────────────────────────────────────────────

/**
 * 从解析结果创建 ViewingEvent 草稿（尚未写入 DB，等待用户确认）
 * @param {ScreeningDraft} draft
 * @param {string} workId   关联的 Work ID
 * @param {string} [recordId]  关联的记录 ID（可选，确认时填入）
 * @returns {object}
 */
export function draftViewingEvent(draft, workId, recordId = null) {
  const id = `ve_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    viewing_id: id,
    work_id: workId,
    record_id: recordId,
    viewed_on: draft.viewedOn,
    screening_at: draft.screeningAt,
    screening_ends_at: draft.screeningEndsAt,
    duration_minutes: computeDurationMinutes(draft.screeningAt, draft.screeningEndsAt),
    viewing_relation: null,      // 首看/重看 由系统按时间顺序推定（assignViewingRelations），此处不预设
    watch_index: null,
    location_type: "cinema",
    ticket_price: draft.ticketPrice || null,   // R1 红线变更：票价不再脱敏，正常记录
    source: "ticket_paste",
    screened_content: { kind: "full_movie", episode_start: null, episode_end: null, display_label: null },
    viewing_context: {
      cinema_name: draft.cinemaName,
      auditorium: draft.auditorium || null,
      city: draft.city,
      format: draft.format,
      version: draft.version || null,
      format_note: draft.formatNote || null,
      is_3d: Boolean(draft.is3D),
      seats: draft.seats,
      seat_count: draft.seatCount,
      ticket_provider: draft.ticketProvider,
      ticket_type: draft.ticketType || null,
      language: draft.language || null,
      ticket_count: draft.ticketQuantity || null,
      event_types: draft.eventTypes || [],
      bonus_note: null   // 特典描述格式过于自由，R1 只建字段，留给 R2 确认卡手填
    },
    confirmed_at: null,          // 用户确认后填入
    status: "pending_confirmation"
  };
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

/**
 * 把日期字符串和 HH:MM 组合为日本时区 ISO 8601 字符串
 * 支持日本影院惯例：24:25 表示当天深夜 = 次日 00:25
 * @param {string} date  YYYY-MM-DD
 * @param {string} time  HH:MM（允许 H≥24）
 * @returns {string}
 */
function toISO(date, time) {
  const [hStr, mStr = "00"] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (h >= 24) {
    // 24:25 → 次日 00:25；使用 Date.UTC 安全处理月末溢出
    const [y, mo, d] = date.split("-").map(Number);
    const nextDay = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
    return `${nextDay}T${String(h - 24).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;
  }
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;
}
