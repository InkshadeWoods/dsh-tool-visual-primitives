import { analyzeVision, refreshDiagnosticSwitch } from "../vision/analysis-core.mjs";
import { createEvidenceCache } from "../vision/evidence-cache.mjs";

function parseToolInput(args) {
  const hasPath = typeof args.image_path === "string" && args.image_path.trim().length > 0;
  const hasUrl = typeof args.url === "string" && args.url.trim().length > 0;
  if (hasPath === hasUrl) throw new Error("provide exactly one of image_path or url");
  return {
    source: hasPath ? { kind: "path", path: args.image_path.trim() } : { kind: "url", url: args.url.trim() },
    prompt: args.prompt,
  };
}

export function registerVisionTool(ctx, config) {
  const evidenceCache = createEvidenceCache();
  ctx.tools.register({
    name: "vision_analyze",
    description: "Analyze an image through the visual-primitives pipeline and return pure-text evidence for a text-only model. Provide exactly one of image_path or url. The analysis mode is inferred from prompt; detail and visual-primitives format use the configured settings.",
    parameters: {
      image_path: { type: "string", description: "Local image file path (absolute). Omit when using url." },
      url: { type: "string", description: "Image URL (http/https). Omit when using image_path." },
      prompt: { type: "string", description: "Question or instruction about the image. Defaults to a general description request." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      await refreshDiagnosticSwitch(ctx, config);
      const request = parseToolInput(args);
      const evidence = await analyzeVision(ctx, { ...request, signal: exec.signal }, config, evidenceCache);
      return { text: evidence.text };
    },
  });
}
