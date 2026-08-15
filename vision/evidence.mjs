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

export function createVisualEvidence({ imageId, mode, detail, usesPrimitives, text }) {
  return { imageId, mode, detail, usesPrimitives, text };
}

export function formatEvidenceForModel(evidence) {
  const label = evidence.usesPrimitives ? "[Image analyzed by visual primitives]" : "[Image analyzed]";
  return `${label}\n${evidence.text}`;
}
