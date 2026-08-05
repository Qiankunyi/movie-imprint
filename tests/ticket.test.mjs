import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactSensitiveInfo,
  splitEmails,
  extractFormatAndTitle,
  parseTicketText,
  parseTicketPrice,
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

  it("保留票价（R1 红线变更：不再脱敏）", () => {
    const result = redactSensitiveInfo("料金：¥1,900");
    assert.ok(result.includes("1,900"), "票价应保留");
    assert.ok(!result.includes("[PRICE_REDACTED]"), "不应再有票价占位符");
  });

  it("移除支付方式说明", () => {
    const result = redactSensitiveInfo("決済方法：クレジットカード");
    assert.ok(!result.includes("クレジットカード"), "支付方式应被移除");
    assert.ok(result.includes("[PAYMENT_METHOD_REDACTED]"), "应有占位符");
  });

  it("移除卡号（合成测试卡号，非真实数据）", () => {
    const result = redactSensitiveInfo("カード番号：4111-1111-1111-1111");
    assert.ok(!result.includes("4111-1111-1111-1111"), "卡号应被移除");
    assert.ok(result.includes("[CARD_NUMBER_REDACTED]"), "应有占位符");
  });

  it("移除邮箱与姓名（回归保护，票价红线变更不应影响其他脱敏规则）", () => {
    const result = redactSensitiveInfo("購入者：テスト太郎 様\nメール：testuser@example.com\n料金：¥1,900");
    assert.ok(!result.includes("テスト太郎"), "姓名仍应移除");
    assert.ok(!result.includes("testuser@example.com"), "邮箱仍应移除");
    assert.ok(result.includes("1,900"), "票价仍应保留");
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

  it("制式与活动分流：【IMAX】【舞台挨拶付き】各自归位，片名干净", () => {
    const { movieTitle, format, eventTypes } = extractFormatAndTitle("【IMAX】【舞台挨拶付き】劇場版○○");
    assert.equal(format, "IMAX");
    assert.deepEqual(eventTypes, ["stage_greeting"]);
    assert.equal(movieTitle, "劇場版○○");
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

  it("敏感字段类型列表完整，且不再包含票价", () => {
    const removed = result.sensitiveDataRemoved;
    assert.ok(removed.includes("recipient_email"), "应声明移除邮箱");
    assert.ok(removed.includes("ticket_qr_url"), "应声明移除 QR URL");
    assert.ok(!removed.includes("ticket_price"), "票价不应再被列为脱敏字段（R1 红线变更）");
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

  it("duration_minutes 由起止时间正确派生", () => {
    assert.equal(event.duration_minutes, 140, "09:50–12:10 应为 140 分钟");
  });

  it("duration_minutes 任一缺失则为 null", () => {
    const partial = draftViewingEvent({ screeningAt: "2026-01-01T09:50:00+09:00", screeningEndsAt: null }, "work_x");
    assert.equal(partial.duration_minutes, null);
    const partial2 = draftViewingEvent({ screeningAt: null, screeningEndsAt: "2026-01-01T12:10:00+09:00" }, "work_x");
    assert.equal(partial2.duration_minutes, null);
  });

  it("source 标记为 ticket_paste", () => {
    assert.equal(event.source, "ticket_paste");
  });

  it("ticket_price 由票务文本正确解析并保留（R1 红线变更）", () => {
    // SMT_EMAIL_1 本身不含票价字段，这里换用含票价的 KINEZO 场次单独验证
    const kinezoResult = parseTicketText(KINEZO_EMAIL);
    const kinezoEvent = draftViewingEvent(kinezoResult.screenings[0], "work_test123");
    assert.deepEqual(kinezoEvent.ticket_price, { amount: 2300, currency: "JPY", count: 1 });
  });

  it("viewing_context.event_types 默认为空数组（不是 null）", () => {
    assert.deepEqual(event.viewing_context.event_types, []);
  });
});

// ─── KINEZO 格式（合成，含跨午夜时间与分隔线）──────────────────────────────

const KINEZO_EMAIL = `
【KINEZO予約について

-------------------------------------------------------------------------------
このたびは、ご利用頂きましてありがとうございます。
是非アンケートにご協力をお願いいたします。
https://forms.example.com/survey

-------------------------------------------------------------------------------

≪ ご入場に関して ≫

発券せずに会員QRコードでそのままご入場いただけます。
https://tjoy.jp/t-joy_kyoto/guide/ticketless

≪ チケット発券方法に関して ≫

https://tjoy.jp/t-joy_kyoto/guide/howtoget
※発券用パスワードは生年月日の月日４桁です。
-------------------------------------------------------------------------------
予約番号：0805743383
劇場：T・ジョイ京都
日時：2026-08-05 21:45 ～ 24:25
タイトル：【SCREENX with DolbyAtmos・字幕】スパイダーマン：ブランド・ニュー・デイ
シアター名：シアター９
座席：J-16　購入枚数：1枚
購入金額：￥2,300
決済方法：クレジットカード

＜注意事項＞
■本上映回は、全席指定・定員入替制です。
■転売を目的としたご購入はお断りいたします。
-------------------------------------------------------------------------------
ご不明の点がありましたら、T・ジョイ京都 お問い合わせ先まで。

オンライン予約システム KINEZO】
`.trim();

describe("parseTicketText — KINEZO 单封邮件（含内部分隔线）", () => {
  const result = parseTicketText(KINEZO_EMAIL);

  it("不因内部分隔线产生多余场次", () => {
    assert.equal(result.screenings.length, 1,
      `应只解析出 1 个场次，实际为 ${result.screenings.length}`);
  });

  it("片名正确（已移除制式前缀）", () => {
    assert.equal(result.screenings[0].movieTitle, "スパイダーマン：ブランド・ニュー・デイ");
  });

  it("影院名正确", () => {
    assert.ok(result.screenings[0].cinemaName?.includes("T・ジョイ京都"),
      `影院名应含 T・ジョイ京都，实际：${result.screenings[0].cinemaName}`);
  });

  it("放映制式正确", () => {
    assert.ok(result.screenings[0].format?.includes("SCREENX"),
      `制式应含 SCREENX，实际：${result.screenings[0].format}`);
  });

  it("座位正确", () => {
    assert.deepEqual(result.screenings[0].seats, ["J-16"]);
  });

  it("票价被正确解析（R1 红线变更：不再脱敏）", () => {
    assert.deepEqual(result.screenings[0].ticketPrice, { amount: 2300, currency: "JPY", count: 1 });
  });

  it("支付方式仍被移除，不出现在解析结果附近文本中", () => {
    const redacted = redactSensitiveInfo(KINEZO_EMAIL);
    assert.ok(!redacted.includes("クレジットカード"));
  });

  it("event_types 为空数组（这封邮件没有活动信息）", () => {
    assert.deepEqual(result.screenings[0].eventTypes, []);
  });
});

describe("parseTicketPrice", () => {
  it("支持 ￥2,000 / 2000円 / ¥2000 等常见写法", () => {
    assert.deepEqual(parseTicketPrice("料金：￥2,000"), { amount: 2000, currency: "JPY", count: 1 });
    assert.deepEqual(parseTicketPrice("2000円"), { amount: 2000, currency: "JPY", count: 1 });
    assert.deepEqual(parseTicketPrice("¥2000"), { amount: 2000, currency: "JPY", count: 1 });
  });

  it("多笔金额（双人购票）→ 金额合计 + 张数，UI 据此写明「· N 张」", () => {
    const result = parseTicketPrice("大人 ￥2,250\n大人 ￥2,250");
    assert.deepEqual(result, { amount: 4500, currency: "JPY", count: 2 });
  });

  it("无价格信息时返回 null", () => {
    assert.equal(parseTicketPrice("没有价格的文本"), null);
    assert.equal(parseTicketPrice(""), null);
  });
});

describe("toISO — 24:xx 跨午夜时间处理", () => {
  it("24:25 解析为次日 00:25", () => {
    const result = parseTicketText(KINEZO_EMAIL);
    const endsAt = result.screenings[0].screeningEndsAt;
    assert.ok(endsAt, "应有结束时间");
    const d = new Date(endsAt);
    assert.ok(!isNaN(d.getTime()), `结束时间应是合法日期，实际：${endsAt}`);
    // 次日 00:25 JST = T00:25+09:00 → UTC T15:25 前一天
    assert.equal(d.getUTCDate(), 5,
      `UTC 日期应为 5，实际：${d.getUTCDate()}（JST 次日 00:25 = UTC 前日 15:25）`);
    assert.equal(d.getUTCHours(), 15,
      `UTC 小时应为 15，实际：${d.getUTCHours()}`);
    assert.equal(d.getUTCMinutes(), 25);
  });

  it("开始时间 21:45 正常解析", () => {
    const result = parseTicketText(KINEZO_EMAIL);
    const startAt = result.screenings[0].screeningAt;
    const d = new Date(startAt);
    assert.ok(!isNaN(d.getTime()), `开始时间应是合法日期，实际：${startAt}`);
  });
});

describe("splitEmails — 含内部分隔线的单封 KINEZO 不被拆分", () => {
  it("返回长度为 1", () => {
    const segments = splitEmails(KINEZO_EMAIL);
    assert.equal(segments.length, 1,
      `单封 KINEZO 邮件不应被拆分，实际拆成 ${segments.length} 段`);
  });
});
