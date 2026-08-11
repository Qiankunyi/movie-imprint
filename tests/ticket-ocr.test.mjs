import test from "node:test";
import assert from "node:assert/strict";

import {
  TICKET_OCR_MAX_BYTES,
  normalizeTicketOcrLanguage,
  recognizeTicketImage,
  releaseTicketOcrWorker,
  ticketOcrLanguages,
  ticketOcrProgressLabel,
  validateTicketImage
} from "../src/ticket-ocr.js";

const imageFile = (overrides = {}) => ({
  name: "ticket.png",
  type: "image/png",
  size: 1024,
  ...overrides
});

test("票务 OCR 只接受第一版支持的图片格式和大小", () => {
  assert.equal(validateTicketImage(imageFile()).ok, true);
  assert.equal(validateTicketImage(imageFile({ name: "ticket.jpeg", type: "" })).ok, true);
  assert.equal(validateTicketImage(imageFile({ name: "ticket.webp", type: "image/webp" })).ok, true);
  assert.equal(validateTicketImage(imageFile({ name: "ticket.heic", type: "image/heic" })).code, "unsupported");
  assert.equal(validateTicketImage(imageFile({ size: TICKET_OCR_MAX_BYTES + 1 })).code, "too_large");
});

test("OCR 语言配置限制为中文、日文和必要的英文组合", () => {
  assert.deepEqual(ticketOcrLanguages("chi_sim+eng"), ["chi_sim", "eng"]);
  assert.deepEqual(ticketOcrLanguages("jpn+eng"), ["jpn", "eng"]);
  assert.deepEqual(ticketOcrLanguages("chi_sim+jpn+eng"), ["chi_sim", "jpn", "eng"]);
  assert.equal(normalizeTicketOcrLanguage("fra+eng"), "chi_sim+eng");
});

test("技术性进度被转换为用户可理解的状态", () => {
  assert.equal(ticketOcrProgressLabel({ status: "loading language traineddata" }), "正在准备识别…");
  assert.equal(ticketOcrProgressLabel({ status: "recognizing text" }), "正在读取文字…");
});

test("OCR 适配层只返回普通文本，并在完成后释放临时图片", async () => {
  let disposed = false;
  let recognizedSource = null;
  let terminated = false;
  const progress = [];
  const worker = {
    async recognize(source) {
      recognizedSource = source;
      return { data: { text: "MOVIX京都\r\n作品名　魔女の宅急便\n" } };
    },
    async terminate() { terminated = true; }
  };

  const text = await recognizeTicketImage(imageFile(), {
    language: "jpn+eng",
    prepareImage: async () => ({
      source: "temporary-canvas",
      dispose() { disposed = true; }
    }),
    createWorker: async (languages, logger) => {
      assert.deepEqual(languages, ["jpn", "eng"]);
      logger({ status: "recognizing text", progress: 0.5 });
      return worker;
    },
    onProgress: (message) => progress.push(message.progress)
  });

  assert.equal(text, "MOVIX京都\n作品名　魔女の宅急便");
  assert.equal(recognizedSource, "temporary-canvas");
  assert.equal(disposed, true);
  assert.deepEqual(progress, [0.5]);
  await releaseTicketOcrWorker();
  assert.equal(terminated, true);
});
