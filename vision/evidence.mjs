function hasTag(text, tag) {
  return new RegExp(`<\\s*${tag}\\b|<｜\\s*${tag}\\s*｜>`, "i").test(text);
}

function hasRequiredPrimitiveEvidence(text, mode, detail) {
  if (mode === "caption" && detail === "brief") return true;
  if (mode === "path_tracing" || mode === "topology") return hasTag(text, "point");
  if (["grounding", "ui_analysis", "spatial_relation", "document_visual"].includes(mode)) {
    return hasTag(text, "ref") && hasTag(text, "box");
  }
  return hasTag(text, "ref") || hasTag(text, "box") || hasTag(text, "point");
}

export function isEvidenceValid(text, { mode, detail, usesPrimitives }) {
  if (!text.trim()) return false;
  return !usesPrimitives || hasRequiredPrimitiveEvidence(text, mode, detail);
}

function stripModelModeHeader(text) {
  return String(text).replace(/^\s*\[Mode\]\s*\n[^\n]*(?:\n|$)/i, "").trim();
}

function inferCoverage(text, mode) {
  const normalized = String(text).toLowerCase();
  const hasBoxes = hasTag(text, "box");
  const hasPoints = hasTag(text, "point");
  return {
    layout: ["ui_analysis", "document_visual"].includes(mode),
    location: hasBoxes || hasPoints,
    counting: /(?:数量|总数|共计|count|number|\b\d+\s*(?:个|项|枚|个按钮))/i.test(normalized),
    readableText: /(?:标题|文字|文本|搜索|播放量|名称|内容|text)/i.test(normalized),
  };
}

export function createVisualEvidence({ attachmentIds = [], imageId, mode, detail, usesPrimitives, text, runtimeScope }) {
  const normalizedText = stripModelModeHeader(text);
  return {
    attachmentIds,
    imageId,
    mode,
    detail,
    usesPrimitives,
    runtimeScope,
    coverage: inferCoverage(normalizedText, mode),
    createdAt: Date.now(),
    text: normalizedText,
  };
}

export function formatEvidenceForModel(evidence) {
  const primitives = evidence.usesPrimitives ? "enabled" : "disabled";
  return [
    "[Vision Metadata]",
    `mode: ${evidence.mode}`,
    `detail: ${evidence.detail}`,
    `primitives: ${primitives}`,
    "",
    "[Model Evidence]",
    evidence.text,
  ].join("\n");
}
