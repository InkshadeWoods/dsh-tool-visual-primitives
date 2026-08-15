import { createVisualEvidence, isEvidenceValid } from "./evidence.mjs";
import { buildEvidenceCacheKey } from "./evidence-cache.mjs";
import { loadImageSource } from "./image-source.mjs";
import {
  detectVisionMode,
  normalizeOption,
  shouldUsePrimitives,
  VALID_DETAIL_LEVELS,
  VALID_PRIMITIVE_MODES,
  VALID_RETRY_MODES,
} from "./mode-policy.mjs";
import { buildRetryPrompt, buildVisionPrompt } from "./prompt-builder.mjs";
import { requestVisionCompletion } from "./transport.mjs";

export const DEFAULT_ANALYSIS_CONFIG = {
  apiKeyEnv: "VISION_API_KEY",
  baseUrlEnv: "VISION_BASE_URL",
  modelEnv: "VISION_MODEL",
  primitivesEnv: "VISION_PRIMITIVES",
  detailEnv: "VISION_DETAIL",
  retryEnv: "VISION_RETRY",
  maxImageBytesEnv: "VISION_MAX_IMAGE_BYTES",
  timeoutMsEnv: "VISION_TIMEOUT_MS",
  primitives: "auto",
  detail: "standard",
  retry: "off",
  maxImageBytes: 10 * 1024 * 1024,
  timeoutMs: 60000,
};

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
}

async function resolveCredential(ctx, ref) {
  const credentials = ctx.get?.("credentials");
  if (credentials?.resolve) {
    try {
      const hit = await credentials.resolve(ref);
      if (hit?.value) return hit.value;
    } catch {
      // Environment fallback below preserves existing DSH behaviour.
    }
  }
  return process.env[ref];
}

async function resolveSetting(ctx, ref, fallback) {
  const value = await resolveCredential(ctx, ref);
  return value === undefined || value === "" ? fallback : value;
}

export async function resolveRuntimeConfig(ctx, config) {
  const cfg = { ...DEFAULT_ANALYSIS_CONFIG, ...(config || {}) };
  const [apiKey, baseURL, model, primitivesValue, detailValue, retryValue, maxBytesValue, timeoutValue] = await Promise.all([
    resolveCredential(ctx, cfg.apiKeyEnv),
    resolveCredential(ctx, cfg.baseUrlEnv),
    resolveCredential(ctx, cfg.modelEnv),
    resolveSetting(ctx, cfg.primitivesEnv, cfg.primitives),
    resolveSetting(ctx, cfg.detailEnv, cfg.detail),
    resolveSetting(ctx, cfg.retryEnv, cfg.retry),
    resolveSetting(ctx, cfg.maxImageBytesEnv, cfg.maxImageBytes),
    resolveSetting(ctx, cfg.timeoutMsEnv, cfg.timeoutMs),
  ]);
  if (!apiKey) throw new Error(`vision credential "${cfg.apiKeyEnv}" is not configured`);
  if (!baseURL) throw new Error(`vision credential "${cfg.baseUrlEnv}" is not configured`);
  if (!model) throw new Error(`vision credential "${cfg.modelEnv}" is not configured`);
  const maxImageBytes = Number(maxBytesValue);
  const timeoutMs = Number(timeoutValue);
  assertPositiveInteger("maxImageBytes", maxImageBytes);
  assertPositiveInteger("timeoutMs", timeoutMs);
  return {
    apiKey,
    baseURL,
    model,
    primitives: normalizeOption(primitivesValue, "auto", VALID_PRIMITIVE_MODES),
    detail: normalizeOption(detailValue, "standard", VALID_DETAIL_LEVELS),
    retry: normalizeOption(retryValue, "off", VALID_RETRY_MODES),
    maxImageBytes,
    timeoutMs,
  };
}

export async function analyzeVision(ctx, request, config, cache) {
  const runtime = await resolveRuntimeConfig(ctx, config);
  const prompt = String(request.prompt || "请详细描述这张图片的内容。").trim();
  const mode = detectVisionMode(prompt);
  const detail = runtime.detail;
  const usesPrimitives = shouldUsePrimitives(mode, runtime.primitives, detail);
  const image = await loadImageSource(ctx, request.source, { maxBytes: runtime.maxImageBytes, signal: request.signal });
  const cacheKey = buildEvidenceCacheKey({ imageId: image.imageId, mode, detail, usesPrimitives, prompt });
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  const messages = [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: image.dataUrl } },
      { type: "text", text: buildVisionPrompt(prompt, { mode, detail, usesPrimitives }) },
    ],
  }];
  let text = await requestVisionCompletion({ ...runtime, messages, signal: request.signal });
  if (usesPrimitives && runtime.retry !== "off" && !isEvidenceValid(text, { mode, detail, usesPrimitives })) {
    const retryMessages = [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: image.dataUrl } },
        { type: "text", text: buildRetryPrompt(prompt, mode, text, detail, runtime.retry) },
      ],
    }];
    text = await requestVisionCompletion({ ...runtime, messages: retryMessages, signal: request.signal });
    if (!isEvidenceValid(text, { mode, detail, usesPrimitives })) {
      text += "\n\n[Vision Primitive Notice]\n模型未返回当前任务所需的完整视觉基元标记，以上结果按普通视觉分析返回。";
    }
  }
  const evidence = createVisualEvidence({ imageId: image.imageId, mode, detail, usesPrimitives, text });
  cache?.set(cacheKey, evidence);
  return evidence;
}
