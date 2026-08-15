import { createHash } from "node:crypto";

const DETAIL_RANK = { brief: 0, standard: 1, verbose: 2 };

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAttachmentId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isDetailAtLeast(actual, requested) {
  return (DETAIL_RANK[actual] ?? -1) >= (DETAIL_RANK[requested] ?? -1);
}

function includesAllTerms(text, terms) {
  return terms.every((term) => !term || text.includes(term));
}

export function createEvidenceCache(limit = 64) {
  const entries = new Map();
  return {
    get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key, value) {
      entries.set(key, value);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
    },
  };
}

export function deriveCoverageRequirements(prompt, mode) {
  const text = normalizeText(prompt);
  const requirements = {
    mode,
    layout: mode === "ui_analysis" || mode === "document_visual",
    location: /(在哪|位置|左边|右边|上方|下方|中间|附近|locate|where|position)/i.test(text),
    counting: /(几个|多少|数量|计数|count|how many|number)/i.test(text),
    readableText: /(文字|标题|写着|内容|播放量|名称|text|title|ocr|read)/i.test(text),
    terms: [],
  };
  const quotedTerms = [...text.matchAll(/[“"']([^“"']{1,32})[”"']/g)].map((match) => normalizeText(match[1]));
  const namedTerms = ["搜索框", "按钮", "菜单", "标题", "播放量", "输入框", "导航", "图标", "二维码"]
    .filter((term) => text.includes(term));
  requirements.terms = [...new Set([...quotedTerms, ...namedTerms])];
  return requirements;
}

export function isCoverageSufficient(evidence, { mode, detail, primitives, requirements, runtimeScope }) {
  if (!evidence || evidence.mode !== mode || evidence.usesPrimitives !== primitives) return false;
  if (!isDetailAtLeast(evidence.detail, detail)) return false;
  if (runtimeScope && evidence.runtimeScope !== runtimeScope) return false;
  const coverage = evidence.coverage;
  if (!coverage) return false;
  if (requirements.layout && !coverage.layout) return false;
  if (requirements.location && !coverage.location) return false;
  if (requirements.counting && !coverage.counting) return false;
  if (requirements.readableText && !coverage.readableText) return false;
  return includesAllTerms(normalizeText(evidence.text), requirements.terms);
}

function createSessionEvidenceCache(evidenceLimit) {
  const images = new Map();
  const evidences = new Map();
  return {
    registerImage(attachment) {
      const attachmentId = normalizeAttachmentId(attachment?.attachmentId);
      if (!attachmentId) return null;
      const image = {
        attachmentId,
        mediaType: attachment.mediaType,
        name: attachment.name,
        imageId: attachment.imageId,
        latestSeenAt: Date.now(),
      };
      images.set(attachmentId, image);
      return image;
    },
    getLatestImage() {
      return [...images.values()].at(-1) ?? null;
    },
    getEvidence(attachmentIds, options) {
      const key = attachmentIds.join("|");
      const candidates = evidences.get(key) || [];
      return [...candidates].reverse().find((entry) => isCoverageSufficient(entry, options)) ?? null;
    },
    getLatestEvidence(attachmentId) {
      const entries = [...evidences.entries()]
        .filter(([key]) => key.split("|").includes(attachmentId))
        .flatMap(([, value]) => value)
        .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
      return entries.at(-1) ?? null;
    },
    setEvidence(attachmentIds, evidence) {
      const key = attachmentIds.join("|");
      const entries = evidences.get(key) || [];
      evidences.set(key, [...entries, evidence].slice(-evidenceLimit));
      if (evidences.size > evidenceLimit) evidences.delete(evidences.keys().next().value);
    },
  };
}

export function createSessionEvidenceCaches({ sessionLimit = 32, evidenceLimit = 128 } = {}) {
  const sessions = new Map();
  return {
    get(sessionId) {
      const key = sessionId ? String(sessionId) : "__default__";
      let cache = sessions.get(key);
      if (cache) {
        sessions.delete(key);
        sessions.set(key, cache);
        return cache;
      }
      cache = createSessionEvidenceCache(evidenceLimit);
      sessions.set(key, cache);
      if (sessions.size > sessionLimit) sessions.delete(sessions.keys().next().value);
      return cache;
    },
  };
}

export function buildEvidenceCacheKey({ imageId, mode, detail, usesPrimitives, prompt, runtimeScope }) {
  return [
    Array.isArray(imageId) ? imageId.join("|") : imageId,
    mode,
    detail,
    usesPrimitives ? "primitives" : "plain",
    fingerprint(runtimeScope),
    fingerprint(prompt.trim()),
  ].join(":");
}
