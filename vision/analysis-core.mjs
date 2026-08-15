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
import { requestVisionCompletion, VisionRequestError } from "./transport.mjs";

export const DEFAULT_ANALYSIS_CONFIG = {
  apiKeyEnv: "VISION_API_KEY",
  baseUrlEnv: "VISION_BASE_URL",
  modelEnv: "VISION_MODEL",
  primitivesEnv: "VISION_PRIMITIVES",
  detailEnv: "VISION_DETAIL",
  retryEnv: "VISION_RETRY",
  maxImageBytesEnv: "VISION_MAX_IMAGE_BYTES",
  timeoutMsEnv: "VISION_TIMEOUT_MS",
  maxTokensEnv: "VISION_MAX_TOKENS",
  enabledModelsEnv: "VISION_ENABLED_MODELS",
  primitives: "auto",
  detail: "standard",
  retry: "off",
  maxImageBytes: 10 * 1024 * 1024,
  timeoutMs: 180000,
  maxTokens: "auto",
};

const DETAIL_MAX_TOKENS = {
  brief: 1024,
  standard: 2048,
  verbose: 4096,
};

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
}

function resolveMaxTokens(value, detail) {
  if (String(value || "").trim().toLowerCase() === "auto") return DETAIL_MAX_TOKENS[detail];
  const maxTokens = Number(value);
  assertPositiveInteger("maxTokens", maxTokens);
  return maxTokens;
}

function createRequestId() {
  return `vision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function reportDiagnostic(event) {
  console.info("[tool-visual-primitives]", JSON.stringify(event));
}

function attachmentReadErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (/^ATTACHMENT_[A-Z_]+$/.test(code)) return code;
  if (error?.name === "AbortError") return "ATTACHMENT_READ_ABORTED";
  return "ATTACHMENT_READ_ERROR";
}

function attachmentReferenceDiagnostics(sources) {
  return sources
    .filter((source) => source?.kind === "attachment" && source.attachment)
    .map(({ attachment }) => ({
      attachmentIdPrefix: typeof attachment.attachmentId === "string" ? attachment.attachmentId.slice(0, 12) : undefined,
      mediaType: typeof attachment.mediaType === "string" ? attachment.mediaType : undefined,
      bytes: Number.isInteger(attachment.bytes) ? attachment.bytes : undefined,
      width: Number.isInteger(attachment.width) ? attachment.width : undefined,
      height: Number.isInteger(attachment.height) ? attachment.height : undefined,
    }));
}

export async function resolveCredential(ctx, ref) {
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
  const [apiKey, baseURL, model, primitivesValue, detailValue, retryValue, maxBytesValue, timeoutValue, maxTokensValue] = await Promise.all([
    resolveCredential(ctx, cfg.apiKeyEnv),
    resolveCredential(ctx, cfg.baseUrlEnv),
    resolveCredential(ctx, cfg.modelEnv),
    resolveSetting(ctx, cfg.primitivesEnv, cfg.primitives),
    resolveSetting(ctx, cfg.detailEnv, cfg.detail),
    resolveSetting(ctx, cfg.retryEnv, cfg.retry),
    resolveSetting(ctx, cfg.maxImageBytesEnv, cfg.maxImageBytes),
    resolveSetting(ctx, cfg.timeoutMsEnv, cfg.timeoutMs),
    resolveSetting(ctx, cfg.maxTokensEnv, cfg.maxTokens),
  ]);
  if (!apiKey) throw new Error(`vision credential "${cfg.apiKeyEnv}" is not configured`);
  if (!baseURL) throw new Error(`vision credential "${cfg.baseUrlEnv}" is not configured`);
  if (!model) throw new Error(`vision credential "${cfg.modelEnv}" is not configured`);
  const maxImageBytes = Number(maxBytesValue);
  const timeoutMs = Number(timeoutValue);
  const detail = normalizeOption(detailValue, "standard", VALID_DETAIL_LEVELS);
  const maxTokens = resolveMaxTokens(maxTokensValue, detail);
  assertPositiveInteger("maxImageBytes", maxImageBytes);
  assertPositiveInteger("timeoutMs", timeoutMs);
  assertPositiveInteger("maxTokens", maxTokens);
  return {
    apiKey,
    baseURL,
    model,
    primitives: normalizeOption(primitivesValue, "auto", VALID_PRIMITIVE_MODES),
    detail,
    retry: normalizeOption(retryValue, "off", VALID_RETRY_MODES),
    maxImageBytes,
    timeoutMs,
    maxTokens,
  };
}

export function getRuntimeScope(runtime) {
  return JSON.stringify({
    baseURL: runtime.baseURL,
    model: runtime.model,
    retry: runtime.retry,
    maxTokens: runtime.maxTokens,
  });
}

export async function analyzeVision(ctx, request, config, cache) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const runtime = request.runtime || await resolveRuntimeConfig(ctx, config);
  const prompt = String(request.prompt || "请详细描述这张图片的内容。").trim();
  const mode = detectVisionMode(prompt);
  const detail = runtime.detail;
  const usesPrimitives = shouldUsePrimitives(mode, runtime.primitives, detail);
  const sources = Array.isArray(request.sources) && request.sources.length > 0 ? request.sources : [request.source];
  if (sources.some((source) => !source)) throw new Error("at least one image source is required");
  const attachmentIds = sources
    .filter((source) => source.kind === "attachment" && source.attachment?.attachmentId)
    .map((source) => source.attachment.attachmentId);
  const attachmentStartedAt = Date.now();
  let images;
  try {
    images = await Promise.all(sources.map((source) => loadImageSource(ctx, source, {
      maxBytes: runtime.maxImageBytes,
      signal: request.signal,
    })));
  } catch (error) {
    const attachmentErrorCode = attachmentReadErrorCode(error);
    reportDiagnostic({
      requestId,
      outcome: "error",
      code: "VISION_ATTACHMENT_READ_FAILED",
      attachmentErrorCode,
      attachmentReferences: attachmentReferenceDiagnostics(sources),
      imageCount: sources.length,
      mode,
      detail,
      attachmentReadMs: Date.now() - attachmentStartedAt,
      totalMs: Date.now() - startedAt,
    });
    throw new VisionRequestError("VISION_ATTACHMENT_READ_FAILED", `图片附件读取失败（${attachmentErrorCode}）`, {
      elapsedMs: Date.now() - startedAt,
      attachmentErrorCode,
    });
  }
  const attachmentReadMs = Date.now() - attachmentStartedAt;
  const runtimeScope = getRuntimeScope(runtime);
  const imageId = images.map((image) => image.imageId);
  const cacheKey = buildEvidenceCacheKey({ imageId, mode, detail, usesPrimitives, prompt, runtimeScope });
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  const messages = [{
    role: "user",
    content: [
      ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
      { type: "text", text: buildVisionPrompt(prompt, { mode, detail, usesPrimitives }) },
    ],
  }];
  let text;
  const visionStartedAt = Date.now();
  try {
    text = await requestVisionCompletion({ ...runtime, messages, signal: request.signal });
  } catch (error) {
    reportDiagnostic({
      requestId,
      outcome: "error",
      code: error?.code || "VISION_RESPONSE_FORMAT_ERROR",
      imageBytes: images.reduce((total, image) => total + image.byteLength, 0),
      imageCount: images.length,
      mode,
      detail,
      attachmentReadMs,
      visionRequestMs: Date.now() - visionStartedAt,
      totalMs: Date.now() - startedAt,
      abortSource: error?.details?.abortSource,
      httpStatus: error?.details?.httpStatus,
    });
    throw error;
  }
  if (usesPrimitives && runtime.retry !== "off" && !isEvidenceValid(text, { mode, detail, usesPrimitives })) {
    const retryMessages = [{
      role: "user",
      content: [
        ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
        { type: "text", text: buildRetryPrompt(prompt, mode, text, detail, runtime.retry) },
      ],
    }];
    text = await requestVisionCompletion({ ...runtime, messages: retryMessages, signal: request.signal });
    if (!isEvidenceValid(text, { mode, detail, usesPrimitives })) {
      text += "\n\n[Vision Primitive Notice]\n模型未返回当前任务所需的完整视觉基元标记，以上结果按普通视觉分析返回。";
    }
  }
  const evidence = createVisualEvidence({ attachmentIds, imageId, mode, detail, usesPrimitives, text, runtimeScope });
  cache?.set(cacheKey, evidence);
  reportDiagnostic({
    requestId,
    outcome: "success",
    imageBytes: images.reduce((total, image) => total + image.byteLength, 0),
    imageCount: images.length,
    mode,
    detail,
    attachmentReadMs,
    visionRequestMs: Date.now() - visionStartedAt,
    totalMs: Date.now() - startedAt,
  });
  return evidence;
}
