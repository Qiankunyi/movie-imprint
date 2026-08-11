/**
 * 票务截图 OCR 适配层。
 *
 * 边界：这里只做 Image -> text/layout，不理解电影、影院或场次。业务结构化始终由
 * src/ticket.js 的 parseTicketText() 完成。截图、Canvas 与 OCR 原文都不持久化。
 */

export const TICKET_OCR_MAX_BYTES = 20 * 1024 * 1024;
export const TICKET_OCR_LANGUAGE_OPTIONS = [
  { value: "chi_sim+eng", label: "中文票务" },
  { value: "jpn+eng", label: "日文票务" },
  { value: "chi_sim+jpn+eng", label: "中日英混合（较慢）" }
];

const TESSERACT_VERSION = "7.0.0";
const TESSERACT_MODULE_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;
const TESSERACT_WORKER_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const TESSERACT_CORE_URL = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_VERSION}`;
const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSION_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"]
]);

let workerPromise = null;
let workerLanguages = null;
let activeProgressListener = null;

export function normalizeTicketOcrLanguage(value) {
  return TICKET_OCR_LANGUAGE_OPTIONS.some((item) => item.value === value)
    ? value
    : TICKET_OCR_LANGUAGE_OPTIONS[0].value;
}

export function ticketOcrLanguages(value) {
  return normalizeTicketOcrLanguage(value).split("+");
}

export function ticketOcrProgressLabel(message = {}) {
  const status = String(message.status || "").toLowerCase();
  if (status.includes("recognizing")) return "正在读取文字…";
  if (status.includes("loading") || status.includes("initializing")) return "正在准备识别…";
  return "正在识别票务信息…";
}

function detectedMimeType(file) {
  const declared = String(file?.type || "").toLowerCase();
  if (SUPPORTED_TYPES.has(declared)) return declared;
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  return EXTENSION_TYPES.get(extension) || null;
}

export function validateTicketImage(file, maxBytes = TICKET_OCR_MAX_BYTES) {
  if (!file) return { ok: false, code: "missing", message: "请选择票务截图。" };
  if (!detectedMimeType(file)) {
    return { ok: false, code: "unsupported", message: "暂不支持这种图片格式，请选择 PNG、JPG、JPEG 或 WEBP。" };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, code: "empty", message: "图片为空或无法读取，请重新选择。" };
  }
  if (file.size > maxBytes) {
    return { ok: false, code: "too_large", message: `图片超过 ${Math.round(maxBytes / 1024 / 1024)}MB，请先缩小后重试。` };
  }
  return { ok: true, code: null, message: null, mimeType: detectedMimeType(file) };
}

function scaledDimensions(width, height) {
  const maxWidth = 2000;
  const maxHeight = 6000;
  const maxPixels = 12_000_000;
  const scale = Math.min(
    1,
    maxWidth / width,
    maxHeight / height,
    Math.sqrt(maxPixels / (width * height))
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function loadImageElement(file, documentRef, urlApi) {
  const objectUrl = urlApi.createObjectURL(file);
  try {
    const image = documentRef.createElement("img");
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    urlApi.revokeObjectURL(objectUrl);
  }
}

export async function prepareTicketImage(file, options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const bitmapFactory = options.createImageBitmapFn || globalThis.createImageBitmap;
  const urlApi = options.urlApi || globalThis.URL;
  if (!documentRef?.createElement) throw new Error("image_decode_unavailable");

  let source;
  let closeSource = () => {};
  if (typeof bitmapFactory === "function") {
    source = await bitmapFactory(file, { imageOrientation: "from-image" });
    closeSource = () => source.close?.();
  } else {
    source = await loadImageElement(file, documentRef, urlApi);
  }

  try {
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("image_decode_failed");
    const dimensions = scaledDimensions(sourceWidth, sourceHeight);
    const canvas = documentRef.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("canvas_unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return {
      source: canvas,
      width: canvas.width,
      height: canvas.height,
      dispose() {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  } finally {
    closeSource();
  }
}

async function defaultCreateWorker(languages, logger) {
  const module = await import(TESSERACT_MODULE_URL);
  const createWorker = module.createWorker || module.default?.createWorker;
  if (typeof createWorker !== "function") throw new Error("ocr_engine_unavailable");
  return createWorker(languages, 1, {
    workerPath: TESSERACT_WORKER_URL,
    corePath: TESSERACT_CORE_URL,
    logger
  });
}

async function getWorker(language, createWorker) {
  const normalized = normalizeTicketOcrLanguage(language);
  if (workerPromise && workerLanguages === normalized) return workerPromise;
  if (workerPromise) await releaseTicketOcrWorker();
  workerLanguages = normalized;
  const factory = createWorker || defaultCreateWorker;
  workerPromise = Promise.resolve(factory(ticketOcrLanguages(normalized), (message) => activeProgressListener?.(message)))
    .catch((error) => {
      workerPromise = null;
      workerLanguages = null;
      throw error;
    });
  return workerPromise;
}

function compactBbox(value) {
  const bbox = value?.bbox || value;
  const x0 = Number(bbox?.x0);
  const y0 = Number(bbox?.y0);
  const x1 = Number(bbox?.x1);
  const y1 = Number(bbox?.y1);
  return [x0, y0, x1, y1].every(Number.isFinite) ? { x0, y0, x1, y1 } : null;
}

function compactWord(word) {
  const text = String(word?.text || "").trim();
  const bbox = compactBbox(word);
  return text && bbox ? { text, bbox, confidence: Number(word?.confidence) || null } : null;
}

function compactLine(line) {
  const words = (line?.words || []).map(compactWord).filter(Boolean);
  const text = String(line?.text || words.map((word) => word.text).join(" ")).trim();
  const bbox = compactBbox(line);
  return text && bbox ? { text, bbox, words } : null;
}

/**
 * Tesseract v6+ 把详细布局放在 data.blocks 下。这里只保留 parser 需要的行、词和坐标，
 * 不保留 Canvas、图片或完整引擎返回对象。
 */
function compactOcrLayout(data, fallbackWidth, fallbackHeight) {
  const sourceBlocks = Array.isArray(data?.blocks) ? data.blocks : [];
  const blocks = [];
  const lines = [];
  for (const block of sourceBlocks) {
    let blockLines = [];
    if (Array.isArray(block?.lines)) {
      blockLines = block.lines.map(compactLine).filter(Boolean);
    } else {
      for (const paragraph of block?.paragraphs || []) {
        blockLines.push(...(paragraph?.lines || []).map(compactLine).filter(Boolean));
      }
    }
    lines.push(...blockLines);
    blocks.push({
      text: String(block?.text || blockLines.map((line) => line.text).join("\n")).trim(),
      bbox: compactBbox(block),
      lines: blockLines
    });
  }
  return {
    width: Number(data?.imageWidth) || Number(fallbackWidth) || null,
    height: Number(data?.imageHeight) || Number(fallbackHeight) || null,
    blocks,
    lines
  };
}

export async function recognizeTicketImage(file, options = {}) {
  const validation = validateTicketImage(file, options.maxBytes);
  if (!validation.ok) {
    const error = new Error(validation.message);
    error.code = validation.code;
    throw error;
  }

  const prepared = await (options.prepareImage || prepareTicketImage)(file, options);
  activeProgressListener = options.onProgress || null;
  try {
    const worker = await getWorker(options.language, options.createWorker);
    const result = await worker.recognize(
      prepared.source,
      { rotateAuto: true },
      { text: true, blocks: true }
    );
    return {
      text: String(result?.data?.text || "").replace(/\r\n?/g, "\n").trim(),
      layout: compactOcrLayout(result?.data, prepared.width, prepared.height)
    };
  } finally {
    activeProgressListener = null;
    prepared.dispose?.();
  }
}

export async function releaseTicketOcrWorker() {
  const current = workerPromise;
  workerPromise = null;
  workerLanguages = null;
  activeProgressListener = null;
  if (!current) return;
  try {
    const worker = await current;
    await worker?.terminate?.();
  } catch {
    // 初始化失败时没有可释放的 worker。
  }
}
