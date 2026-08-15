import { analyzeVision } from "../vision/analysis-core.mjs";
import { createEvidenceCache } from "../vision/evidence-cache.mjs";
import { formatEvidenceForModel } from "../vision/evidence.mjs";

function contentHasImage(blocks) {
  return Array.isArray(blocks) && blocks.some((block) =>
    block?.type === "image" || (block?.type === "tool-result" && contentHasImage(block.content))
  );
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function latestUserPrompt(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const prompt = textFromContent(message.content);
    if (prompt) return prompt;
  }
  return "请建立这张图片中主要可引用对象的索引。";
}

async function convertBlocks(ctx, blocks, prompt, signal, config, cache) {
  const converted = [];
  for (const block of blocks) {
    if (block?.type === "image") {
      try {
        const evidence = await analyzeVision(ctx, {
          source: { kind: "attachment", attachment: block.attachment },
          prompt,
          signal,
        }, config, cache);
        converted.push({ type: "text", text: formatEvidenceForModel(evidence) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        converted.push({ type: "text", text: `[Image analysis failed: ${message}]` });
      }
    } else if (block?.type === "tool-result" && contentHasImage(block.content)) {
      converted.push({ ...block, content: await convertBlocks(ctx, block.content, prompt, signal, config, cache) });
    } else {
      converted.push(block);
    }
  }
  return converted;
}

async function convertImagesToEvidence(ctx, messages, signal, config, cache) {
  const prompt = latestUserPrompt(messages);
  const convertedMessages = [];
  for (const message of messages) {
    if (!contentHasImage(message.content)) {
      convertedMessages.push(message);
      continue;
    }
    convertedMessages.push({
      ...message,
      content: await convertBlocks(ctx, message.content, prompt, signal, config, cache),
    });
  }
  return convertedMessages;
}

export function registerVisionProvider(ctx, config) {
  const upstream = config.upstream || "deepseek-official";
  const providerId = "visual-primitives";
  const evidenceCache = createEvidenceCache();
  try {
    return ctx.llm.registerAdapter([providerId], {
      providerInfo: () => ({ id: providerId, name: "Visual Primitives" }),
      providerRetryPolicy: () => undefined,
      async listModels(_provider, signal) {
        try {
          const models = await ctx.llm.listModels(upstream, signal);
          return models
            .filter((model) => !model.inputModalities?.includes("image"))
            .map((model) => ({ ...model, name: `${model.name ?? model.id} [vision]`, inputModalities: ["text", "image"] }));
        } catch {
          return [];
        }
      },
      async resolveModel(_provider, _model, signal) {
        const info = await ctx.llm.resolveModelInfo(upstream, signal);
        return { ...info, inputModalities: ["text", "image"] };
      },
      stream(options) {
        return (async function* streamWithVisualEvidence() {
          const messages = await convertImagesToEvidence(ctx, options.messages, options.signal, config, evidenceCache);
          yield* ctx.llm.stream({ ...options, provider: upstream, messages });
        })();
      },
    });
  } catch (error) {
    console.error(`[tool-visual-primitives] vision provider registration skipped: ${error}`);
    return null;
  }
}
