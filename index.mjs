import { registerVisionBridge } from "./adapters/bridge-adapter.mjs";
import { registerVisionTool } from "./adapters/tool-adapter.mjs";
import { DEFAULT_ANALYSIS_CONFIG, resolveCredential, resolveRuntimeConfig } from "./vision/analysis-core.mjs";
import { isMimo, requestVisionCompletion } from "./vision/transport.mjs";

export const name = "tool-visual-primitives";
export const inject = ["tools", "llm", "attachments"];

export const DEFAULT_CONFIG = {
  ...DEFAULT_ANALYSIS_CONFIG,
  upstream: "",
  visionProvider: true,
};

const TEST_ROUTE_PATH = "/visual-primitives/api/test-connection";
const MODEL_CATALOG_ROUTE_PATH = "/visual-primitives/api/models";
const SETTINGS_ROUTE_PATH = "/visual-primitives/api/settings";
const MODEL_MODALITIES_ROUTE_PATH = "/visual-primitives/api/model-modalities";

const CLIENT_SETTINGS = [
  ["baseUrl", "baseUrlEnv"],
  ["model", "modelEnv"],
  ["primitives", "primitivesEnv"],
  ["detail", "detailEnv"],
  ["retry", "retryEnv"],
  ["maxImageBytes", "maxImageBytesEnv"],
  ["timeoutMs", "timeoutMsEnv"],
  ["maxTokens", "maxTokensEnv"],
  ["logDiagnostics", "logDiagnosticsEnv"],
  ["enabledModels", "enabledModelsEnv"],
];

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  const source = typeof origin === "string" ? origin : referer;
  if (typeof source !== "string" || typeof host !== "string") return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function registerConnectionTestRoute(ctx, config) {
  return ctx.webServer.register({
    kind: "exact",
    path: TEST_ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!isSameOriginRequest(req)) {
        writeJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      const startedAt = Date.now();
      try {
        const runtime = await resolveRuntimeConfig(ctx, config);
        await requestVisionCompletion({
          ...runtime,
          // Industry-standard probe: a tiny plain-text ping over
          // /chat/completions with the real analysis token budget — a tiny
          // max_tokens cap starves reasoning-style providers into empty
          // responses. Provider-pool quirks beyond this shape are upstream
          // issues; real conversations remain the final check.
          messages: [{ role: "user", content: [{ type: "text", text: "Say OK" }] }],
          timeoutMs: Math.min(runtime.timeoutMs, 30_000),
        });
        writeJson(res, 200, { ok: true, elapsedMs: Date.now() - startedAt });
      } catch (error) {
        writeJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

function modelCatalogUrl(baseURL) {
  return `${String(baseURL).replace(/\/+$/, "")}/models`;
}

function modelCatalogHeaders(apiKey, baseURL) {
  const headers = { Accept: "application/json" };
  if (isMimo(baseURL)) headers["api-key"] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function extractModelIds(payload) {
  const candidates = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  return [...new Set(candidates
    .map((entry) => typeof entry === "string" ? entry : entry?.id ?? entry?.name ?? entry?.model)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim()))]
    .sort((left, right) => left.localeCompare(right));
}

const MODEL_CATALOG_MAX_BYTES = 2 * 1024 * 1024;

// A misbehaving upstream could answer /models with an unbounded body; read it
// in bounded chunks instead of buffering the whole response into memory.
async function readBoundedJson(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`模型目录响应超过 ${maxBytes} 字节上限`);
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`模型目录响应超过 ${maxBytes} 字节上限`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
}

function registerModelCatalogRoute(ctx, config) {
  return ctx.webServer.register({
    kind: "exact",
    path: MODEL_CATALOG_ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!isSameOriginRequest(req)) {
        writeJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      try {
        const cfg = { ...DEFAULT_ANALYSIS_CONFIG, ...(config || {}) };
        const [apiKey, baseURL] = await Promise.all([
          resolveCredential(ctx, cfg.apiKeyEnv),
          resolveCredential(ctx, cfg.baseUrlEnv),
        ]);
        if (!apiKey) throw new Error(`vision credential "${cfg.apiKeyEnv}" is not configured`);
        if (!baseURL) throw new Error(`vision credential "${cfg.baseUrlEnv}" is not configured`);
        const targetUrl = modelCatalogUrl(baseURL);
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: modelCatalogHeaders(apiKey, baseURL),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`模型目录请求失败（HTTP ${response.status}，${targetUrl}）`);
        const models = extractModelIds(await readBoundedJson(response, MODEL_CATALOG_MAX_BYTES));
        writeJson(res, 200, { ok: true, models });
      } catch (error) {
        writeJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

// The settings client must grey out models that already support image input
// natively: the bridge only serves text-only models, and the DSH model
// catalog RPC does not carry inputModalities.  This endpoint exposes the same
// per-model modalities the bridge adapter itself consults.
function registerModelModalitiesRoute(ctx) {
  return ctx.webServer.register({
    kind: "exact",
    path: MODEL_MODALITIES_ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!isSameOriginRequest(req)) {
        writeJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      try {
        const modalities = {};
        const llm = ctx.llm;
        if (llm?.listProviders && typeof llm.listModels === "function") {
          const providers = llm.listProviders().filter((provider) => provider.id !== "visual-primitives");
          await Promise.all(providers.map(async (provider) => {
            try {
              const models = await llm.listModels(provider.id);
              modalities[provider.id] = Object.fromEntries(
                models.map((model) => [model.id, Array.isArray(model.inputModalities) ? model.inputModalities : []]),
              );
            } catch {
              modalities[provider.id] = {};
            }
          }));
        }
        writeJson(res, 200, { ok: true, modalities });
      } catch (error) {
        writeJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

// The settings client must show the same values consumed by the runtime.  This
// endpoint resolves values in the credential store, but deliberately only
// returns non-secret settings and a boolean for the API key.
function registerSettingsRoute(ctx, config) {
  return ctx.webServer.register({
    kind: "exact",
    path: SETTINGS_ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!isSameOriginRequest(req)) {
        writeJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      try {
        const cfg = { ...DEFAULT_ANALYSIS_CONFIG, ...(config || {}) };
        const entries = [...CLIENT_SETTINGS, ["apiKey", "apiKeyEnv"]];
        const values = await Promise.all(entries.map(([, envKey]) => resolveCredential(ctx, cfg[envKey])));
        const settings = Object.fromEntries(
          CLIENT_SETTINGS.map(([key], index) => [key, values[index] ?? null]),
        );
        writeJson(res, 200, {
          ok: true,
          settings,
          apiKeyConfigured: Boolean(values[values.length - 1]),
        });
      } catch (error) {
        writeJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  registerVisionTool(ctx, cfg);

  const disposers = [];
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() => {
      const routeDisposers = [
        registerConnectionTestRoute(webCtx, cfg),
        registerModelCatalogRoute(webCtx, cfg),
        registerSettingsRoute(webCtx, cfg),
        registerModelModalitiesRoute(webCtx),
      ].filter((disposer) => typeof disposer === "function");
      return () => {
        for (const dispose of routeDisposers) dispose();
      };
    }, "tool-visual-primitives: web routes");
  });
  if (cfg.visionProvider !== false && typeof ctx.llm?.registerAdapter === "function") {
    const disposer = registerVisionBridge(ctx, cfg);
    if (typeof disposer === "function") disposers.push(disposer);
  }
  return () => {
    for (const disposer of disposers) disposer();
  };
}
