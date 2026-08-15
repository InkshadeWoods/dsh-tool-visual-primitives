import { registerVisionProvider } from "./adapters/bridge-adapter.mjs";
import { registerVisionTool } from "./adapters/tool-adapter.mjs";
import { DEFAULT_ANALYSIS_CONFIG } from "./vision/analysis-core.mjs";

export const name = "tool-visual-primitives";
export const inject = ["tools"];

export const DEFAULT_CONFIG = {
  ...DEFAULT_ANALYSIS_CONFIG,
  upstream: "",
  visionProvider: true,
  bridgeMode: "append",
};

export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  registerVisionTool(ctx, cfg);

  const disposers = [];
  if (cfg.visionProvider !== false && typeof ctx.llm?.registerAdapter === "function") {
    const disposer = registerVisionProvider(ctx, cfg);
    if (typeof disposer === "function") disposers.push(disposer);
  }
  return () => {
    for (const disposer of disposers) disposer();
  };
}
