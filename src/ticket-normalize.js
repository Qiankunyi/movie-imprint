/**
 * OCR 票务文本归一化与轻量布局行重建。
 *
 * 这里只修复 OCR 表达（异常空格、时间符号、同行碎片），不判断电影/影院业务字段。
 * 用户界面仍展示原始 OCR 文本；此模块产生的副本只供 ticket parser 使用。
 */

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";

export function normalizeOcrLineText(input) {
  let value = String(input || "").replace(/\r/g, "").trim();
  if (!value) return "";

  // 只在明确的时间区间中统一连接符，避免改动日期或正式作品标题里的连字符。
  value = value.replace(/(\d{1,2}:\d{2})\s*[~〜～]\s*(\d{1,2}:\d{2})/gu, "$1～$2");
  value = value.replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, "gu"), "$1");
  // 中日韩文字中夹着单个拉丁字母时通常是 OCR 对作品名的分词，例如「哆 啦 A 梦」。
  value = value.replace(new RegExp(`([${CJK}])\\s+([A-Za-z])\\s+(?=[${CJK}])`, "gu"), "$1$2");
  value = value.replace(/(\d)\s+(?=(?:号|厅|排|座|张|枚))/gu, "$1");
  value = value.replace(/(号|排)\s+(?=\d)/gu, "$1");
  value = value.replace(/(\d)\s+(?=[DK]\b)/giu, "$1");
  value = value.replace(/[ \t　]+/gu, " ").trim();
  return value;
}

function bboxOf(item = {}) {
  const bbox = item.bbox || item;
  const x0 = Number(bbox.x0 ?? bbox.left);
  const y0 = Number(bbox.y0 ?? bbox.top);
  const x1 = Number(bbox.x1 ?? (Number.isFinite(x0) ? x0 + Number(bbox.width) : NaN));
  const y1 = Number(bbox.y1 ?? (Number.isFinite(y0) ? y0 + Number(bbox.height) : NaN));
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function sameVisualRow(a, b) {
  const aBox = bboxOf(a);
  const bBox = bboxOf(b);
  if (!aBox || !bBox) return false;
  const overlap = Math.max(0, Math.min(aBox.y1, bBox.y1) - Math.max(aBox.y0, bBox.y0));
  const minHeight = Math.min(aBox.y1 - aBox.y0, bBox.y1 - bBox.y0);
  const centerDistance = Math.abs((aBox.y0 + aBox.y1) / 2 - (bBox.y0 + bBox.y1) / 2);
  const maxHeight = Math.max(aBox.y1 - aBox.y0, bBox.y1 - bBox.y0);
  return overlap / minHeight >= 0.45 || centerDistance <= maxHeight * 0.42;
}

function unionBbox(items) {
  const boxes = items.map(bboxOf).filter(Boolean);
  if (!boxes.length) return null;
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1))
  };
}

export function rowsFromOcrLayout(layout) {
  const sourceLines = Array.isArray(layout?.lines) ? layout.lines : [];
  const positioned = sourceLines
    .map((line) => ({ ...line, text: String(line?.text || "").trim(), bbox: bboxOf(line) }))
    .filter((line) => line.text && line.bbox)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  if (!positioned.length) return [];

  const groups = [];
  for (const line of positioned) {
    let group = null;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      if (groups[index].some((item) => sameVisualRow(item, line))) {
        group = groups[index];
        break;
      }
    }
    if (group) group.push(line);
    else groups.push([line]);
  }

  return groups.map((group) => {
    const ordered = group.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let text = "";
    let previous = null;
    for (const line of ordered) {
      if (previous) {
        const rowHeight = Math.max(previous.bbox.y1 - previous.bbox.y0, line.bbox.y1 - line.bbox.y0);
        text += line.bbox.x0 - previous.bbox.x1 > rowHeight * 0.35 ? " " : "";
      }
      text += line.text;
      previous = line;
    }
    return {
      text: normalizeOcrLineText(text),
      bbox: unionBbox(ordered),
      words: ordered.flatMap((line) => Array.isArray(line.words) ? line.words : [])
    };
  }).filter((row) => row.text);
}

export function normalizeOcrTicketInput(rawText, layout = null) {
  const layoutRows = rowsFromOcrLayout(layout);
  const sourceLines = layoutRows.length
    ? layoutRows
    : String(rawText || "").split(/\r?\n/).map((text) => ({ text, bbox: null, words: [] }));
  const lines = sourceLines
    .map((line) => ({ ...line, rawText: line.text, text: normalizeOcrLineText(line.text) }))
    .filter((line) => line.text);
  return { text: lines.map((line) => line.text).join("\n"), lines };
}

export function cleanOcrCinemaCandidate(input) {
  let value = normalizeOcrLineText(input);
  // 只有在明确影院词之后仅剩孤立导航符号/数字时才裁掉尾巴；不会删除普通名称里的 >。
  value = value.replace(/^(.+(?:电影院|电影城|国际影城|影城|影院|剧院|劇場|シネマ|Cinema))\s+(?:[>›»|=]\s*)?(?:\d\s*){1,4}$/iu, "$1");
  return value.trim();
}

export function cleanOcrTitleCandidate(input) {
  let value = normalizeOcrLineText(input);
  // 仅清理“较完整 CJK 标题 + 空格 + 1~3 个小写拉丁字母”的孤立尾巴。
  // A / AI / F1 / X / LOVE 等合法标题不会命中。
  if ((value.match(/\p{Script=Han}/gu) || []).length >= 4) {
    value = value.replace(/(?<=[\p{Script=Han}：:！？!?》】)])\s+[a-z]{1,3}$/u, "");
  }
  return value.trim();
}
