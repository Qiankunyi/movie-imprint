import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeTicketText, readClipboardTicketHint } from "../src/clipboard.js";

const REAL_TICKET_TEXT = `
松竹マルチプレックスシアターズ
作品名：【IMAX】劇場版○○
観賞日：2026/8/3
開映時間：19:20
終映時間：22:00
劇場：TOHOシネマズ新宿
座席：K-11・K-12
`.trim();

describe("looksLikeTicketText", () => {
  it("真实票务文本命中（日期+时间+影院+票务关键词，远超 2 项）", () => {
    assert.equal(looksLikeTicketText(REAL_TICKET_TEXT), true);
  });

  it("普通中文段落不命中", () => {
    const text = "今天看完这部电影，心里久久不能平静，最后那一幕真的很戳人。";
    assert.equal(looksLikeTicketText(text), false);
  });

  it("只含日期不含影院关键词不命中（避免误报）", () => {
    const text = "2026/8/3 是我朋友的生日，我们打算一起吃饭庆祝。";
    assert.equal(looksLikeTicketText(text), false);
  });

  it("只含时间不含其他关键词不命中", () => {
    const text = "今天 19:20 才下班，累到不想说话。";
    assert.equal(looksLikeTicketText(text), false);
  });

  it("空文本不命中", () => {
    assert.equal(looksLikeTicketText(""), false);
    assert.equal(looksLikeTicketText(null), false);
  });

  it("日期+影院关键词（无时间/票务词）也能命中 2 项", () => {
    const text = "2026/8/3 去 TOHO 看了场重映。";
    assert.equal(looksLikeTicketText(text), true);
  });
});

describe("readClipboardTicketHint", () => {
  it("真实票务文本 → 返回 looksLikeTicket: true", async () => {
    const nav = { clipboard: { readText: async () => REAL_TICKET_TEXT } };
    const result = await readClipboardTicketHint(nav);
    assert.ok(result);
    assert.equal(result.looksLikeTicket, true);
    assert.equal(result.text, REAL_TICKET_TEXT);
  });

  it("普通文本 → 返回 looksLikeTicket: false", async () => {
    const nav = { clipboard: { readText: async () => "随便写的一段话" } };
    const result = await readClipboardTicketHint(nav);
    assert.ok(result);
    assert.equal(result.looksLikeTicket, false);
  });

  it("权限被拒绝（readText 抛错）→ 返回 null，不抛错", async () => {
    const nav = { clipboard: { readText: async () => { throw new DOMException("denied", "NotAllowedError"); } } };
    await assert.doesNotReject(async () => {
      const result = await readClipboardTicketHint(nav);
      assert.equal(result, null);
    });
  });

  it("不支持 Clipboard API → 返回 null，不抛错", async () => {
    const result = await readClipboardTicketHint({});
    assert.equal(result, null);
  });

  it("剪贴板为空文本 → 返回 null", async () => {
    const nav = { clipboard: { readText: async () => "   " } };
    const result = await readClipboardTicketHint(nav);
    assert.equal(result, null);
  });
});
