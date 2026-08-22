import { analyzeVision, getRuntimeScope, refreshDiagnosticSwitch, reportDiagnostic, resolveCredential, resolveRuntimeConfig } from "../vision/analysis-core.mjs";
import { createEvidenceCache, createSessionEvidenceCaches, deriveCoverageRequirements } from "../vision/evidence-cache.mjs";
import { formatEvidenceForModel } from "../vision/evidence.mjs";
import { detectVisionMode, shouldUsePrimitives } from "../vision/mode-policy.mjs";

const BRIDGE_PROVIDER_ID = "visual-primitives";
const BRIDGE_PROVIDER_NAME = "Visual Primitives";
const VISION_MODEL_SUFFIX = " [vision]";
const ENABLED_MODELS_ENV = "VISION_ENABLED_MODELS";

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const DEFAULT_IMAGE_PROMPT = "请建立这张图片中主要可引用对象的索引。";

function collectImageAttachments(blocks, collected = []) {
  if (!Array.isArray(blocks)) return collected;
  for (const block of blocks) {
    if (block?.type === "image" && block.attachment?.attachmentId) collected.push(block.attachment);
    if (block?.type === "tool-result") collectImageAttachments(block.content, collected);
  }
  return collected;
}

function collectDirectImageAttachments(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block) => block?.type === "image" && block.attachment?.attachmentId ? [block.attachment] : []);
}

function isExplicitImageReference(prompt) {
  return /(?:这|那|上|前|刚才|刚刚).{0,4}(?:张|幅)?(?:图片|图|截图)|(?:图|图片|截图).{0,2}(?:中|里|上|内)|(?:看|分析|解释|描述|识别|比较|统计).{0,6}(?:图|图片|截图)|\b(?:this|that|the|previous|above)\s+(?:image|picture|screenshot)\b|\b(?:image|picture|screenshot)\s+(?:above|before)\b/i.test(prompt);
}

function findLatestUserMessage(messages) {
  return [...messages].reverse().find((message) => message?.role === "user" && (message.source?.kind === "user" || !message.source)) ?? null;
}

function indexHistoricalImages(messages, cache, currentMessageId) {
  for (const message of messages) {
    if (message?.id === currentMessageId) continue;
    for (const attachment of collectImageAttachments(message?.content)) cache.registerImage(attachment);
  }
}

function selectTargetAttachments(currentMessage, prompt, cache) {
  // With no current user message the prompt is our own fallback wording, not
  // a user's reference, so never spend a vision request from here.
  if (!currentMessage) return [];
  const currentAttachments = collectDirectImageAttachments(currentMessage?.content);
  if (currentAttachments.length > 0) {
    const hasNewAttachment = currentAttachments.some((attachment) => !cache.hasImage(attachment.attachmentId));
    for (const attachment of currentAttachments) cache.registerImage(attachment);
    // Some hosts retain historical attachments in later requests.  A repeated
    // attachment alone is not a new image turn; require an explicit reference
    // before spending another vision-model request on it.
    if (hasNewAttachment || isExplicitImageReference(prompt)) return currentAttachments;
    return [];
  }
  if (!isExplicitImageReference(prompt)) return [];
  const latest = cache.getLatestImage();
  return latest ? [latest] : [];
}

async function resolveVisualEvidence(ctx, attachments, prompt, signal, config, cache, promptCache) {
  if (attachments.length === 0) return null;
  const runtime = await resolveRuntimeConfig(ctx, config);
  const mode = detectVisionMode(prompt);
  const usesPrimitives = shouldUsePrimitives(mode, runtime.primitives, runtime.detail);
  const attachmentIds = attachments.map((attachment) => attachment.attachmentId);
  const reusable = cache.getEvidence(attachmentIds, {
    mode,
    detail: runtime.detail,
    primitives: usesPrimitives,
    requirements: deriveCoverageRequirements(prompt, mode),
    runtimeScope: getRuntimeScope(runtime),
  });
  if (reusable) {
    reportDiagnostic({
      outcome: "cache_hit",
      cacheHit: true,
      imageCount: attachmentIds.length,
      mode,
      detail: runtime.detail,
    });
    return reusable;
  }

  const evidence = await analyzeVision(ctx, {
    sources: attachments.map((attachment) => ({ kind: "attachment", attachment })),
    prompt,
    signal,
    runtime,
  }, config, promptCache);
  cache.setEvidence(attachmentIds, evidence);
  return evidence;
}

function convertContentForTextModel(blocks, selectedEvidence, cache) {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.flatMap((block) => {
    if (block?.type === "image") {
      const attachmentId = block.attachment?.attachmentId;
      const evidence = attachmentId ? selectedEvidence.get(attachmentId) || cache.getLatestEvidence(attachmentId) : null;
      return [{
        type: "text",
        text: evidence
          ? formatEvidenceForModel(evidence)
          : "[历史图片附件未用于当前问题，未提供视觉证据。]",
      }];
    }
    if (block?.type === "tool-result") {
      return [{ ...block, content: convertContentForTextModel(block.content, selectedEvidence, cache) }];
    }
    if (block?.type === "text" || block?.type === "reasoning" || block?.type === "tool-call") return [block];

    // A provider or plugin may surface an extension block that the selected
    // text-model adapter cannot serialize.  Never forward it as `unknown`:
    // OpenAI-compatible services reject the entire request in that case.
    reportDiagnostic({
      outcome: "dropped_unsupported_content_block",
      blockType: typeof block?.type === "string" ? block.type : "missing",
    });
    return [];
  });
}

function convertMessagesForTextModel(messages, selectedEvidence, cache) {
  return messages.map((message) => ({
    ...message,
    content: convertContentForTextModel(message.content, selectedEvidence, cache),
  }));
}

async function buildBridgeMessages(ctx, messages, signal, config, cache, promptCache) {
  const currentMessage = findLatestUserMessage(messages);
  indexHistoricalImages(messages, cache, currentMessage?.id);
  const prompt = textFromContent(currentMessage?.content) || DEFAULT_IMAGE_PROMPT;
  const attachments = selectTargetAttachments(currentMessage, prompt, cache);
  const selectedEvidence = new Map();
  if (attachments.length > 0) {
    try {
      const evidence = await resolveVisualEvidence(ctx, attachments, prompt, signal, config, cache, promptCache);
      for (const attachment of attachments) selectedEvidence.set(attachment.attachmentId, evidence);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown visual error";
      throw new Error(`视觉分析未完成：${message}`);
    }
  }
  return convertMessagesForTextModel(messages, selectedEvidence, cache);
}

function createBridgeModelId(provider, model) {
  return `${encodeURIComponent(provider)}/${encodeURIComponent(model)}`;
}

function parseBridgeModelId(id) {
  const separator = id.indexOf("/");
  if (separator < 1 || separator === id.length - 1) throw new Error("invalid visual bridge model id");
  try {
    const provider = decodeURIComponent(id.slice(0, separator));
    const model = decodeURIComponent(id.slice(separator + 1));
    if (!provider || !model) throw new Error("empty visual bridge route");
    return { provider, model };
  } catch {
    throw new Error("invalid visual bridge model id");
  }
}

function parseEnabledRoutes(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.flatMap((entry) => {
      const provider = typeof entry?.provider === "string" ? entry.provider.trim() : "";
      const model = typeof entry?.model === "string" ? entry.model.trim() : "";
      const key = `${provider}\u0000${model}`;
      if (!provider || !model || provider === BRIDGE_PROVIDER_ID || seen.has(key)) return [];
      seen.add(key);
      return [{ provider, model }];
    });
  } catch {
    return [];
  }
}

async function getEnabledRoutes(ctx, config) {
  const ref = config.enabledModelsEnv || ENABLED_MODELS_ENV;
  return parseEnabledRoutes(await resolveCredential(ctx, ref));
}

function createBridgedModel(route, model) {
  return {
    ...model,
    provider: BRIDGE_PROVIDER_ID,
    id: createBridgeModelId(route.provider, route.model),
    name: `${model.name ?? model.id}${VISION_MODEL_SUFFIX}`,
    inputModalities: ["text", "image"],
  };
}

export function registerVisionBridge(ctx, config) {
  const evidenceCaches = createSessionEvidenceCaches();
  const promptCache = createEvidenceCache();
  const streamWithVisualEvidence = (options) => (async function* bridgedStream() {
    await refreshDiagnosticSwitch(ctx, config);
    reportDiagnostic({
      outcome: "bridge_stream",
      sessionId: options.sessionId ?? null,
      model: options.model,
      purpose: options.purpose ?? null,
    });
    const route = parseBridgeModelId(options.model);
    const enabledRoutes = await getEnabledRoutes(ctx, config);
    if (!enabledRoutes.some((entry) => entry.provider === route.provider && entry.model === route.model)) {
      throw new Error("visual bridge model is not enabled");
    }
    const cache = evidenceCaches.get(options.sessionId);
    // Auxiliary calls (session titles, compaction) replay session content for
    // their own bookkeeping; they must not mint new visual evidence.  Their
    // image blocks fall back to evidence already produced by the main turn.
    if (options.purpose) {
      const replayed = convertMessagesForTextModel(options.messages, new Map(), cache);
      yield* ctx.llm.stream({ ...options, provider: route.provider, model: route.model, messages: replayed });
      return;
    }
    const messages = await buildBridgeMessages(ctx, options.messages, options.signal, config, cache, promptCache);
    yield* ctx.llm.stream({ ...options, provider: route.provider, model: route.model, messages });
  })();
  try {
    return ctx.llm.registerAdapter([BRIDGE_PROVIDER_ID], {
      providerInfo: () => ({ id: BRIDGE_PROVIDER_ID, name: BRIDGE_PROVIDER_NAME }),
      providerRetryPolicy: () => undefined,
      async listModels() {
        const routes = await getEnabledRoutes(ctx, config);
        const results = await Promise.all(routes.map(async (route) => {
          try {
            const models = await ctx.llm.listModels(route.provider);
            const model = models.find((candidate) => candidate.id === route.model);
            if (!model || model.inputModalities?.includes("image")) return null;
            return createBridgedModel(route, model);
          } catch {
            return null;
          }
        }));
        return results.filter(Boolean);
      },
      async resolveModel(_provider, model, signal) {
        const route = parseBridgeModelId(model);
        const enabledRoutes = await getEnabledRoutes(ctx, config);
        if (!enabledRoutes.some((entry) => entry.provider === route.provider && entry.model === route.model)) {
          throw new Error("visual bridge model is not enabled");
        }
        const info = await ctx.llm.resolveModelInfo(route.provider, route.model, signal);
        if (info.inputModalities?.includes("image")) throw new Error("visual bridge only supports text-only models");
        return {
          ...info,
          provider: BRIDGE_PROVIDER_ID,
          id: model,
          name: `${info.name ?? info.id}${VISION_MODEL_SUFFIX}`,
          inputModalities: ["text", "image"],
        };
      },
      // Pre-rc.8 hosts dispatch adapter.stream directly; rc.8+ hosts only use
      // the one-generation stream returned by prepareCall.
      stream(options) {
        return streamWithVisualEvidence(options);
      },
      // resolveModel must keep declaring "image" in inputModalities, or the
      // host projects image blocks away before this adapter ever sees them.
      async prepareCall(provider, model, signal) {
        return {
          model: await this.resolveModel(provider, model, signal),
          stream: (options) => streamWithVisualEvidence(options),
        };
      },
    });
  } catch (error) {
    console.error(`[tool-visual-primitives] vision provider registration skipped: ${error}`);
    return null;
  }
}
