import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactSensitiveInfo,
  splitEmails,
  extractFormatAndTitle,
  parseTicketText,
  draftViewingEvent
} from "../src/ticket.js";

// ─── 合成测试输入（基于 SMT 验证案例，已人工脱敏，不含真实私人数据）─────────

const SMT_EMAIL_1 = `
松竹マルチプレックスシアターズ
ご購入いただきありがとうございます。

作品名：【DolbyCinema】劇場版 魔法少女まどか☆マギカ 前編 始まりの物語
観賞日：2026/7/18
開映時間：9:50
終映時間：12:10
劇場：MOVIX京都
座席：K-11・K-12

QR取票：https://ticket.smt-cinema.com/qr?token=FAKE_TOKEN_1
会員ページ：https://member.smt-cinema.com/login
購入者：テスト 太郎 様
メール：testuser@example.com
`.trim();

const SMT_EMAIL_2 = `
松竹マルチプレックスシアターズ
ご購入いただきありがとうございます。

作品名：【DolbyCinema】劇場版 魔法少女まどか☆マギカ 後編 永遠の物語
観賞日：2026/7/18
開映時間：12:35
終映時間：14:40
劇場：MOVIX京都
座席：J-11・J-12

QR取票：https://ticket.smt-cinema.com/qr?token=FAKE_TOKEN_2
会員ページ：https://member.smt-cinema.com/login
購入者：テスト 太郎 様
メール：testuser@example.com
`.trim();

// 两封邮件粘在一起（模拟用户一次全选粘贴）
const SMT_COMBINED = SMT_EMAIL_1 + "\n\n" + SMT_EMAIL_2;

// ─── 脱敏测试 ────────────────────────────────────────────────────────────────

describe("redactSensitiveInfo", () => {
  it("移除 QR URL", () => {
    const result = redactSensitiveInfo("QR: https://ticket.smt-cinema.com/qr?token=ABC123");
    assert.ok(!result.includes("https://"), "QR URL 应被替换");
    assert.ok(result.includes("[TICKET_QR_REDACTED]"), "应有占位符");
  });

  it("移除邮箱地址", () => {
    const result = redactSensitiveInfo("メール：user@example.com");
    assert.ok(!result.includes("@example.com"), "邮箱应被移除");
    assert.ok(result.includes("[EMAIL_REDACTED]"), "应有占位符");
  });

  it("移除日文姓名称呼", () => {
    const result = redactSensitiveInfo("購入者：テスト太郎 様");
    assert.ok(!result.includes("テスト太郎"), "姓名应被移除");
  });

  it("移除票价", () => {
    const result = redactSensitiveInfo("料金：¥1,900");
    assert.ok(!result.includes("1,900"), "票价应被移除");
    assert.ok(result.includes("[PRICE_REDACTED]"), "应有占位符");
  });

  it("保留片名与影院名", () => {
    const result = redactSensitiveInfo("劇場版 魔法少女まどか☆マギカ MOVIX京都");
    assert.ok(result.includes("魔法少女まどか☆マギカ"), "片名应保留");
    assert.ok(result.includes("MOVIX京都"), "影院名应保留");
  });

  it("不保存票务原始文本的标志位", () => {
    const result = parseTicketText(SMT_EMAIL_1);
    assert.equal(result.rawTicketTextSaved, false);
  });
});

// ─── 拆分测试 ────────────────────────────────────────────────────────────────

describe("splitEmails", () => {
  it("单封邮件返回长度为 1 的数组", () => {
    const segments = splitEmails(SMT_EMAIL_1);
    assert.equal(segments.length, 1);
  });

  it("两封 SMT 邮件正确拆分为 2 段", () => {
    const segments = splitEmails(SMT_COMBINED);
    assert.equal(segments.length, 2, `拆分结果应为 2 段，实际为 ${segments.length}`);
  });

  it("两段内容分别包含前篇与后篇", () => {
    const segments = splitEmails(SMT_COMBINED);
    const combined = segments.join(" | ");
    assert.ok(combined.includes("前編"), "应包含前篇");
    assert.ok(combined.includes("後編"), "应包含后篇");
  });
});

// ─── 制式前缀清洗 ────────────────────────────────────────────────────────────

describe("extractFormatAndTitle", () => {
  it("提取 Dolby Cinema 制式并移除前缀", () => {
    const { movieTitle, format } = extractFormatAndTitle(
      "【DolbyCinema】劇場版 魔法少女まどか☆マギカ 前編 始まりの物語"
    );
    assert.equal(format, "DolbyCinema");
    assert.equal(movieTitle, "劇場版 魔法少女まどか☆マギカ 前編 始まりの物語");
    assert.ok(!movieTitle.includes("【"), "片名不应含制式括号");
  });

  it("前篇与后篇区分词必须保留", () => {
    const front = extractFormatAndTitle("【DolbyCinema】劇場版 魔法少女まどか☆マギカ 前編 始まりの物語");
    const back = extractFormatAndTitle("【DolbyCinema】劇場版 魔法少女まどか☆マギカ 後編 永遠の物語");
    assert.ok(front.movieTitle.includes("前編"), "前篇标识应保留");
    assert.ok(back.movieTitle.includes("後編"), "后篇标识应保留");
    assert.notEqual(front.movieTitle, back.movieTitle, "前后篇应为不同片名");
  });

  it("无制式前缀时 format 为 null", () => {
    const { movieTitle, format } = extractFormatAndTitle("劇場版 鬼滅の刃");
    assert.equal(format, null);
    assert.equal(movieTitle, "劇場版 鬼滅の刃");
  });
});

// ─── 完整解析：SMT 单封 ──────────────────────────────────────────────────────

describe("parseTicketText — SMT 单封邮件", () => {
  const result = parseTicketText(SMT_EMAIL_1);

  it("检测到 1 封邮件", () => {
    assert.equal(result.messagesDetected, 1);
  });

  it("解析出 1 个场次", () => {
    assert.equal(result.screenings.length, 1);
  });

  it("片名正确（已移除制式前缀）", () => {
    const { movieTitle } = result.screenings[0];
    assert.ok(movieTitle.includes("前編"), "前篇标识应保留");
    assert.ok(!movieTitle.includes("DolbyCinema"), "制式前缀应移除");
  });

  it("观影日期正确", () => {
    assert.equal(result.screenings[0].viewedOn, "2026-07-18");
  });

  it("放映开始时间含时区", () => {
    const at = result.screenings[0].screeningAt;
    assert.ok(at, "应有开始时间");
    assert.ok(at.includes("+09:00"), "应包含日本时区");
    assert.ok(at.includes("09:50"), "开始时间应为 09:50");
  });

  it("放映结束时间正确", () => {
    const ends = result.screenings[0].screeningEndsAt;
    assert.ok(ends, "应有结束时间");
    assert.ok(ends.includes("12:10"), "结束时间应为 12:10");
  });

  it("影院名正确", () => {
    assert.ok(result.screenings[0].cinemaName?.includes("MOVIX"), "影院应含 MOVIX");
  });

  it("制式为 Dolby Cinema", () => {
    const fmt = result.screenings[0].format;
    assert.ok(fmt, "应有制式字段");
    assert.ok(fmt.toLowerCase().includes("dolby"), "制式应含 Dolby");
  });

  it("座位已提取", () => {
    const { seats, seatCount } = result.screenings[0];
    assert.equal(seatCount, 2, "应有 2 个座位");
    assert.ok(seats.includes("K-11") || seats.includes("K11"), "应含 K-11");
  });

  it("票务提供商为 SMT", () => {
    assert.equal(result.screenings[0].ticketProvider, "SMT");
  });

  it("敏感字段类型列表完整", () => {
    const removed = result.sensitiveDataRemoved;
    assert.ok(removed.includes("recipient_email"), "应声明移除邮箱");
    assert.ok(removed.includes("ticket_qr_url"), "应声明移除 QR URL");
    assert.ok(removed.includes("ticket_price"), "应声明移除票价");
  });
});

// ─── 完整解析：SMT 双封 ──────────────────────────────────────────────────────

describe("parseTicketText — SMT 双封邮件", () => {
  const result = parseTicketText(SMT_COMBINED);

  it("检测到 2 封邮件", () => {
    assert.equal(result.messagesDetected, 2);
  });

  it("解析出 2 个场次", () => {
    assert.equal(result.screenings.length, 2, "应有 2 个场次");
  });

  it("按放映时间排序：前篇在前", () => {
    const [first, second] = result.screenings;
    assert.ok(first.movieTitle.includes("前編"), `第一场应为前篇，实际：${first.movieTitle}`);
    assert.ok(second.movieTitle.includes("後編"), `第二场应为后篇，实际：${second.movieTitle}`);
  });

  it("两场不因同日同影院同制式而合并", () => {
    assert.equal(result.screenings.length, 2, "不得合并为 1 场");
  });

  it("前篇与后篇片名不同", () => {
    const [first, second] = result.screenings;
    assert.notEqual(first.movieTitle, second.movieTitle, "前后篇片名必须不同");
  });

  it("两场均为 Dolby Cinema", () => {
    for (const s of result.screenings) {
      assert.ok(s.format?.toLowerCase().includes("dolby"), `制式应含 Dolby，实际：${s.format}`);
    }
  });

  it("座位分别正确（K 行 / J 行）", () => {
    const [first, second] = result.screenings;
    // 前篇应在 K 行
    assert.ok(
      first.seats.some((s) => s.startsWith("K")),
      `前篇座位应在 K 行，实际：${first.seats}`
    );
    // 后篇应在 J 行
    assert.ok(
      second.seats.some((s) => s.startsWith("J")),
      `后篇座位应在 J 行，实际：${second.seats}`
    );
  });

  it("原始票务文本不保存", () => {
    assert.equal(result.rawTicketTextSaved, false);
  });
});

// ─── ViewingEvent 工厂 ───────────────────────────────────────────────────────

describe("draftViewingEvent", () => {
  const result = parseTicketText(SMT_EMAIL_1);
  const draft = result.screenings[0];
  const event = draftViewingEvent(draft, "work_test123");

  it("生成稳定 ID", () => {
    assert.ok(event.id.startsWith("ve_"), "ID 应以 ve_ 开头");
  });

  it("关联 work_id", () => {
    assert.equal(event.work_id, "work_test123");
  });

  it("状态为待确认", () => {
    assert.equal(event.status, "pending_confirmation");
  });

  it("location_type 为 cinema", () => {
    assert.equal(event.location_type, "cinema");
  });

  it("screened_content 默认 full_movie", () => {
    assert.equal(event.screened_content.kind, "full_movie");
  });

  it("viewing_context 包含影院与制式", () => {
    assert.ok(event.viewing_context.cinema_name?.includes("MOVIX"), "应含影院名");
    assert.ok(event.viewing_context.format?.toLowerCase().includes("dolby"), "应含制式");
  });

  it("首看/重看不擅自设定", () => {
    assert.equal(event.viewing_relation, null, "viewing_relation 不应预设");
  });

  it("座位数量正确", () => {
    assert.equal(event.viewing_context.seat_count, 2);
  });
});
