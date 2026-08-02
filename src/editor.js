const LIST_MARKER = /^(\s*)(?:(\d+)\.\s|([-*+])\s)(.*)$/;

function clampSelection(text, start, end) {
  const safeStart = Math.max(0, Math.min(Number.isFinite(start) ? start : text.length, text.length));
  const safeEnd = Math.max(safeStart, Math.min(Number.isFinite(end) ? end : safeStart, text.length));
  return [safeStart, safeEnd];
}

function previousOrderedNumber(text, lineStart) {
  if (lineStart === 0) return 0;
  const before = text.slice(0, lineStart - 1);
  const previousLine = before.slice(before.lastIndexOf("\n") + 1);
  return Number(previousLine.match(/^\s*(\d+)\.\s/)?.[1] || 0);
}

export function applyListStyle(rawText, selectionStart, selectionEnd, style) {
  const text = String(rawText || "");
  if (style !== "ordered" && style !== "unordered") return null;
  const [start, end] = clampSelection(text, selectionStart, selectionEnd);
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const initialNumber = style === "ordered" ? previousOrderedNumber(text, lineStart) + 1 : 0;
  let orderedOffset = 0;
  const replacement = lines.map((line) => {
    if (lines.length > 1 && !line.trim()) return line;
    const existing = line.match(LIST_MARKER);
    const indent = existing?.[1] ?? line.match(/^\s*/)?.[0] ?? "";
    const content = existing?.[4] ?? line.slice(indent.length);
    if (style === "unordered") return `${indent}- ${content}`;
    const output = `${indent}${initialNumber + orderedOffset}. ${content}`;
    orderedOffset += 1;
    return output;
  }).join("\n");
  const nextText = `${text.slice(0, lineStart)}${replacement}${text.slice(lineEnd)}`;
  const collapsed = start === end;
  return {
    text: nextText,
    selectionStart: collapsed ? lineStart + replacement.length : lineStart,
    selectionEnd: lineStart + replacement.length
  };
}

export function continueListOnEnter(rawText, selectionStart, selectionEnd) {
  const text = String(rawText || "");
  const [start, end] = clampSelection(text, selectionStart, selectionEnd);
  if (start !== end) return null;
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", start);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const currentLine = text.slice(lineStart, lineEnd);
  const current = currentLine.match(LIST_MARKER);
  const beforeCaret = text.slice(lineStart, start);
  const prefixAtCaret = beforeCaret.match(/^(\s*)(?:(\d+)\.\s|([-*+])\s)/);
  if (!current || !prefixAtCaret) return null;

  if (!current[4].trim()) {
    const replacement = current[1];
    const nextText = `${text.slice(0, lineStart)}${replacement}${text.slice(lineEnd)}`;
    const cursor = lineStart + replacement.length;
    return { text: nextText, selectionStart: cursor, selectionEnd: cursor };
  }

  const marker = prefixAtCaret[2] ? `${Number(prefixAtCaret[2]) + 1}. ` : `${prefixAtCaret[3]} `;
  const insertion = `\n${prefixAtCaret[1]}${marker}`;
  const nextText = `${text.slice(0, start)}${insertion}${text.slice(start)}`;
  const cursor = start + insertion.length;
  return { text: nextText, selectionStart: cursor, selectionEnd: cursor };
}
