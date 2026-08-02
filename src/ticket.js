/**
 * C4 票务解析模块
 *
 * 处理顺序（严格执行）：
 *   浏览器本地拆分邮件 → 本地脱敏 → 确定性模板解析 → 输出 screenings 数组
 *
 * 票务原文默认不保存，不发给 AI，不进入导出或 GitHub。
 */

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
  // SMT / 一般购票系统的订单号（8–20 位纯数字，独立出现）
  {
    pattern: /(?<!\d)\d{8,20}(?!\d)/g,
    replacement: "[ORDER_REDACTED]"
  },
  // 票价（日元，有¥／円）
  {
    pattern: /[¥￥][\d,]+|[\d,]+\s*円/g,
    replacement: "[PRICE_REDACTED]"
  },
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
  const hasTitle = /(?:作品名|映画名|タイトル)[：:]\s*.{2,}/.test(segment);
  const hasCinema = /(?:劇場名?|上映劇場)[：:]/.test(segment);
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
 * 已知放映制式前缀（用于从电影名称中剥离）
 * 以日文全角方括号包裹为主
 */
const FORMAT_PREFIX_RE = /^[\s　]*【[^】]*】[\s　]*/u;

/**
 * 从邮件中提取的原始片名中分离制式前缀与片名
 * @param {string} raw 例如 "【DolbyCinema】劇場版 魔法少女まどか☆マギカ 前編"
 * @returns {{ movieTitle: string, format: string | null }}
 */
export function extractFormatAndTitle(raw) {
  const match = raw.match(/【([^】]*)】/u);
  const format = match ? match[1].trim() : null;
  const movieTitle = raw.replace(FORMAT_PREFIX_RE, "").trim();
  return { movieTitle, format };
}

// ─── 4. 单段邮件字段解析 ─────────────────────────────────────────────────────

/**
 * 从日文 SMT 购票邮件中提取放映场次字段
 *
 * 支持字段：作品名、观影日期、开始/结束时间、影院、制式、座位
 * 不提取：姓名、邮箱、订单号、QR、票价（这些已在脱敏阶段移除）
 *
 * @param {string} segment 已脱敏的单段邮件文本
 * @returns {ScreeningDraft | null}
 */
export function parseScreeningSegment(segment) {
  // ── 片名 ──────────────────────────────────────────────────────────────────
  // SMT 格式：「作品名」或"作品名"行，或含【制式】前缀的行
  const titlePatterns = [
    /(?:作品名|映画名|タイトル)[：:]\s*(.+)/i,
    /【[^】]*】(.+)/u,
    /(?:^|\n)(劇場版[^\n]+)/m,
    /(?:^|\n)([^\n]*(?:劇場版|THE MOVIE|movie)[^\n]*)/im
  ];
  let rawTitle = null;
  for (const pattern of titlePatterns) {
    const m = segment.match(pattern);
    if (m) { rawTitle = m[1].trim(); break; }
  }
  // 若无明确标签，尝试找最长的非元数据行
  if (!rawTitle) {
    const lines = segment.split("\n").map((l) => l.trim()).filter((l) => l.length > 4);
    const candidate = lines.find((l) =>
      !l.match(/^\d{4}[\\/\-年]/) &&
      !l.match(/[席座]/) &&
      !l.match(/REDACTED/) &&
      l.length > 8
    );
    rawTitle = candidate || null;
  }
  if (!rawTitle) return null;

  const { movieTitle, format: formatFromTitle } = extractFormatAndTitle(rawTitle);

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
    /(\d{1,2}:\d{2})\s*[～〜]\s*(\d{1,2}:\d{2})/
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
  const cinemaPatterns = [
    /(?:劇場名|上映劇場|映画館)[：:]\s*([^\n]+)/i,
    /劇場[：:]\s*([^\n]+)/i,           // 「劇場：MOVIX京都」，避免匹配「劇場版」
    /(MOVIX\S+)/i,
    /(TOHOシネマズ\S+)/i,
    /(イオンシネマ\S+)/i,
    /(ユナイテッド・シネマ\S+)/i,
    /([^\n]*(?:シネマ|シアター)[^\n]*(?:京都|大阪|東京|名古屋|福岡|仙台|札幌)[^\n]*)/i
  ];
  let cinemaName = null;
  for (const pattern of cinemaPatterns) {
    const m = segment.match(pattern);
    if (m) { cinemaName = m[1].trim(); break; }
  }

  // 城市：从影院名推断
  let city = null;
  if (cinemaName) {
    const cityMatch = cinemaName.match(/京都|大阪|東京|名古屋|福岡|仙台|札幌|横浜|神戸|広島/);
    if (cityMatch) city = cityMatch[0];
  }

  // ── 放映制式 ──────────────────────────────────────────────────────────────
  const formatPatterns = [
    /(?:上映方式|制式|スクリーン)[：:\s]*([^\n]+)/i,
    /(Dolby\s*(?:Cinema|Atmos|Vision)?)/i,
    /(IMAX(?:\s*レーザー)?)/i,
    /(4DX(?:SCREEN)?)/i,
    /(MX4D)/i,
    /(ScreenX)/i,
    /(TCX)/i,
    /(BESTIA)/i
  ];
  let screeningFormat = formatFromTitle;
  if (!screeningFormat) {
    for (const pattern of formatPatterns) {
      const m = segment.match(pattern);
      if (m) { screeningFormat = m[1].trim(); break; }
    }
  }

  // ── 座位 ──────────────────────────────────────────────────────────────────
  // 格式：J-11、J-12 或 J11 J12 或 「J-11・J-12」
  const seatMatch = segment.match(
    /(?:座席|席番|座席番号|お座席)[：:\s]*([^\n]+)/i
  ) || segment.match(/\b([A-Z]-?\d{1,3}(?:[・、\s,]+[A-Z]-?\d{1,3})*)\b/);
  let seats = [];
  if (seatMatch) {
    seats = seatMatch[1]
      .split(/[・、\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Z]-?\d+$/.test(s));
  }

  // ── 票务提供商 ────────────────────────────────────────────────────────────
  let ticketProvider = null;
  if (SMT_HEADER_RE.test(segment)) ticketProvider = "SMT";
  else if (/toho-cinemas\.com|TOHOシネマズ/i.test(segment)) ticketProvider = "TOHO";
  else if (/aeoncinema\.com|イオンシネマ/i.test(segment)) ticketProvider = "AEON";
  else if (/KINEZO|kinezo\.jp/i.test(segment)) ticketProvider = "KINEZO";
  else if (/tjoy\.jp|T・ジョイ/i.test(segment)) ticketProvider = "TJOY";

  return {
    movieTitle,
    rawTitle,
    viewedOn,
    screeningAt,
    screeningEndsAt,
    cinemaName,
    city,
    format: screeningFormat,
    seats,
    seatCount: seats.length,
    ticketProvider
  };
}

// ─── 5. 主入口 ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ScreeningDraft
 * @property {string}        movieTitle       片名（已移除制式前缀）
 * @property {string|null}   rawTitle         邮件原始片名
 * @property {string|null}   viewedOn         观影日期 YYYY-MM-DD
 * @property {string|null}   screeningAt      放映开始 ISO 8601 +09:00
 * @property {string|null}   screeningEndsAt  放映结束 ISO 8601 +09:00
 * @property {string|null}   cinemaName       影院名
 * @property {string|null}   city             城市（推断值，可修改）
 * @property {string|null}   format           放映制式
 * @property {string[]}      seats            座位列表
 * @property {number}        seatCount        座位数
 * @property {string|null}   ticketProvider   票务提供商标识
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
 * @returns {TicketParseResult}
 */
export function parseTicketText(rawInput) {
  // 第一步：按邮件边界拆分
  const segments = splitEmails(rawInput);

  // 第二步：每段独立脱敏（脱敏发生在解析之前，不返回脱敏后文本）
  const redactedSegments = segments.map(redactSensitiveInfo);

  // 第三步：逐段解析
  const screenings = redactedSegments
    .map(parseScreeningSegment)
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
      "ticket_price"
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
    viewing_relation: null,      // 首看/重看 由用户选择
    watch_index: null,
    location_type: "cinema",
    screened_content: { kind: "full_movie", episode_start: null, episode_end: null, display_label: null },
    viewing_context: {
      cinema_name: draft.cinemaName,
      city: draft.city,
      format: draft.format,
      seats: draft.seats,
      seat_count: draft.seatCount,
      ticket_provider: draft.ticketProvider
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
