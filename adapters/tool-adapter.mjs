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

export const VISION_TOOL_NAME = "vision_analyze";

export function registerVisionTool(ctx, config) {
  const evidenceCache = createEvidenceCache();
  ctx.tools.register({
    name: VISION_TOOL_NAME,
    description: "Analyze an image through the external visual-primitives pipeline and return pure-text evidence. PRIORITY: this tool ranks BELOW read_image. For any local image file, call read_image first; only fall back to this tool when read_image is unavailable, has errored, or cannot handle the request. Call this tool directly when: (1) the image is a network URL (http/https) — read_image only reads local files and cannot fetch URLs; (2) you need a directed question answered about an image, such as a specific region, column, row, or detail that read_image could not resolve; (3) you need OCR-style text extraction from a local image and read_image could not provide it. Provide exactly one of image_path or url. Images pasted directly into the conversation are converted automatically and cannot be passed here. The analysis mode is inferred from prompt; detail and visual-primitives format use the configured settings.",
    // Standard JSON Schema (object root), matching what defineTool() compiles
    // to: the host projects tool.parameters verbatim to the model API, where
    // official endpoints reject schemas without an object root.
    parameters: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Local image file path (absolute). Omit when using url." },
        url: { type: "string", description: "Image URL (http/https). Omit when using image_path." },
        prompt: { type: "string", description: "Question or instruction about the image. Defaults to a general description request." },
      },
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
    // The tool-level timeout is fixed at registration, while the per-request
    // timeout is user-configurable up to 300s in the settings page.  Register
    // the ceiling so the host never kills an analysis the runtime still
    // allows; the configured timeout still applies inside the request.
    timeoutMs: Math.max(Number(config.timeoutMs) || 0, 300_000),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      await refreshDiagnosticSwitch(ctx, config);
      const request = parseToolInput(args);
      const evidence = await analyzeVision(ctx, { ...request, signal: exec.signal }, config, evidenceCache);
      return { text: evidence.text };
    },
  });
}
