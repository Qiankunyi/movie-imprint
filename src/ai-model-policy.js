export const GEMINI_FAST_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_QUALITY_MODEL = "gemini-3.6-flash";
export const ANALYSIS_SOURCE_UNIT_CHARACTERS = 600;

export const GEMINI_ANALYSIS_MODES = Object.freeze([
  {
    id: "auto",
    label: "自动选择",
    shortLabel: "自动",
    description: "短感想使用 Lite；长文或碎片较多时自动使用 3.6 Flash。"
  },
  {
    id: "fast",
    label: "Lite 快速整理",
    shortLabel: "Lite",
    model: GEMINI_FAST_MODEL,
    description: "适合较短、结构简单的感想，成本和等待时间更低。"
  },
  {
    id: "quality",
    label: "3.6 Flash 深度整理",
    shortLabel: "深度",
    model: GEMINI_QUALITY_MODEL,
    description: "适合长文和大量碎片，优先保证召回、归类与卡片质量。"
  }
]);

const MODE_IDS = new Set(GEMINI_ANALYSIS_MODES.map((mode) => mode.id));

export function normalizeAnalysisModelMode(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!MODE_IDS.has(normalized)) throw new Error("unsupported_ai_model_mode");
  return normalized;
}

export function isRichAnalysisInput({ totalCharacters = 0, sourceUnitCount = 0 } = {}) {
  return Number(sourceUnitCount) >= 6 || Number(totalCharacters) >= 600;
}

export function splitAnalysisTextIntoUnits(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const units = [];
  for (const line of lines) {
    if (line.length <= ANALYSIS_SOURCE_UNIT_CHARACTERS) {
      units.push(line);
      continue;
    }
    const sentences = line.match(/[^。！？!?；;]+[。！？!?；;]*/g) || [line];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > ANALYSIS_SOURCE_UNIT_CHARACTERS) {
        units.push(current);
        current = "";
      }
      if (sentence.length > ANALYSIS_SOURCE_UNIT_CHARACTERS) {
        if (current) units.push(current);
        current = "";
        for (let offset = 0; offset < sentence.length; offset += ANALYSIS_SOURCE_UNIT_CHARACTERS) {
          units.push(sentence.slice(offset, offset + ANALYSIS_SOURCE_UNIT_CHARACTERS));
        }
      } else {
        current += sentence;
      }
    }
    if (current) units.push(current);
  }
  return units;
}

export function resolveAnalysisModel({ provider, requestedMode, totalCharacters, sourceUnitCount, configuredModel }) {
  const normalizedMode = normalizeAnalysisModelMode(requestedMode);
  if (provider !== "gemini" || !normalizedMode) {
    return {
      requestedMode: normalizedMode || "provider_default",
      resolvedMode: "provider_default",
      model: configuredModel,
      reason: provider === "gemini" ? "legacy_or_provider_default" : "provider_does_not_support_per_run_model_switch"
    };
  }

  const resolvedMode = normalizedMode === "auto"
    ? (isRichAnalysisInput({ totalCharacters, sourceUnitCount }) ? "quality" : "fast")
    : normalizedMode;
  return {
    requestedMode: normalizedMode,
    resolvedMode,
    model: resolvedMode === "quality" ? GEMINI_QUALITY_MODEL : GEMINI_FAST_MODEL,
    reason: normalizedMode === "auto"
      ? (resolvedMode === "quality" ? "rich_input" : "short_input")
      : "user_selected"
  };
}
