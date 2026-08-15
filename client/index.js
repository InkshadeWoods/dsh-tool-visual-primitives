/**
 * dsh-tool-visual-primitives — settings section client.
 *
 * Registers a "Vision Analysis" settings page in DSH's native settings surface.
 * Credentials and analysis settings are synchronized through DSH's credential
 * service so the backend reads the same effective configuration.
 */
window.__ModuleLoader__.load({
  id: "dsh-tool-visual-primitives",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require("react");
    const reactJsxRuntime = require("react/jsx-runtime");

    const { useState, useEffect, useCallback } = react;

    /* ── constants ──────────────────────────────────────────── */

    const NS = "dsh-tool-visual-primitives.settings";
    const STORAGE_KEY = `${NS}.state`;
    const TEST_ROUTE_PATH = "/visual-primitives/api/test-connection";
    const VISION_MODEL_CATALOG_ROUTE_PATH = "/visual-primitives/api/models";
    const BYTES_PER_MEGABYTE = 1024 * 1024;
    const CREDENTIAL_SYNC_DELAY_MS = 400;

    const FALLBACKS = {
      apiKey: "",
      baseUrl: "",
      model: "",
      primitives: "auto",
      detail: "standard",
      retry: "off",
      maxImageBytes: 10 * 1024 * 1024,
      timeoutMs: 180000,
      maxTokensMode: "auto",
      maxTokens: 2048,
      enabledModels: [],
    };

    const PERSISTED_KEYS = Object.keys(FALLBACKS).filter((key) => key !== "apiKey");
    let credentialSyncQueue = Promise.resolve();
    let pendingMigrationKeys = new Set();

    /* ── persistence (localStorage) ─────────────────────────── */

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...FALLBACKS };
        const parsed = JSON.parse(raw);
        const persisted = Object.fromEntries(
          PERSISTED_KEYS.map((key) => [key, parsed[key]]).filter(([, value]) => value !== undefined)
        );
        const migrated = {
          ...FALLBACKS,
          ...persisted,
          apiKey: "",
          enabledModels: Array.isArray(persisted.enabledModels) ? persisted.enabledModels : [],
        };
        if (persisted.timeoutMs === 60000) {
          migrated.timeoutMs = FALLBACKS.timeoutMs;
          pendingMigrationKeys.add("timeoutMs");
        }
        if (persisted.maxTokens === 8192 && persisted.maxTokensMode === undefined) {
          migrated.maxTokensMode = "auto";
          migrated.maxTokens = FALLBACKS.maxTokens;
          pendingMigrationKeys.add("maxTokens");
          pendingMigrationKeys.add("maxTokensMode");
        } else if (persisted.maxTokensMode === undefined) {
          migrated.maxTokensMode = "manual";
        }
        return migrated;
      } catch {
        return { ...FALLBACKS };
      }
    }

    function saveState(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, apiKey: "" }));
      } catch {
        // quota exceeded — silently ignore
      }
    }

    /* ── credential API bridge ─────────────────────────────── */

    let credentialApi = null;
    let connectionApi = null;

    function getCredentialApi(ctx) {
      try {
        const connection = ctx?.get?.("connection");
        return connection?.api?.credentials || null;
      } catch {
        return null;
      }
    }

    function getConnectionApi(ctx) {
      try {
        return ctx?.get?.("connection")?.api || null;
      } catch {
        return null;
      }
    }

    async function syncCredentials(api, state, touchedKeys) {
      if (!api?.set || !api?.unset) throw new Error("DSH 凭据服务暂不可用");
      const entries = [
        ["VISION_API_KEY", state.apiKey, "apiKey"],
        ["VISION_BASE_URL", state.baseUrl, "baseUrl"],
        ["VISION_MODEL", state.model, "model"],
        ["VISION_PRIMITIVES", state.primitives, "primitives"],
        ["VISION_DETAIL", state.detail, "detail"],
        ["VISION_RETRY", state.retry, "retry"],
        ["VISION_MAX_IMAGE_BYTES", state.maxImageBytes, "maxImageBytes"],
        ["VISION_TIMEOUT_MS", state.timeoutMs, "timeoutMs"],
        ["VISION_MAX_TOKENS", state.maxTokensMode === "auto" ? "auto" : state.maxTokens, "maxTokens"],
        ["VISION_ENABLED_MODELS", JSON.stringify(state.enabledModels), "enabledModels"],
      ];
      for (const [ref, value, key] of entries) {
        if (!touchedKeys.has(key) && !(key === "maxTokens" && touchedKeys.has("maxTokensMode"))) continue;
        const trimmed = String(value || "").trim();
        const response = trimmed
          ? await api.set({ ref, value: trimmed })
          : await api.unset({ ref });
        if (!response?.result?.ok) {
          throw new Error(response?.result?.error?.message || `无法保存 ${ref}`);
        }
      }
    }

    function queueCredentialSync(api, state, touchedKeys) {
      const snapshot = { ...state };
      const keys = new Set(touchedKeys);
      const run = credentialSyncQueue
        .catch(() => undefined)
        .then(() => syncCredentials(api, snapshot, keys));
      credentialSyncQueue = run.catch(() => undefined);
      return run;
    }

    async function loadModelCatalog(api) {
      if (!api?.llm?.models) throw new Error("DSH 模型目录暂不可用");
      const response = await api.llm.models({});
      if (!response?.result?.ok) {
        throw new Error(response?.result?.error?.message || "无法加载模型目录");
      }
      return response.result.value.groups.filter((group) => group.id !== "visual-primitives");
    }

    function routeKey(provider, model) {
      return `${provider}\u0000${model}`;
    }

    async function loadVisionModelCatalog() {
      const response = await fetch(VISION_MODEL_CATALOG_ROUTE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || `模型目录请求失败（HTTP ${response.status}）`);
      }
      return Array.isArray(payload.models) ? payload.models.filter((model) => typeof model === "string") : [];
    }

    /* ── test-connection helper ─────────────────────────────── */

    async function describeApiKey(api) {
      if (!api?.describe) return { kind: "unknown", configured: false };
      const response = await api.describe({ refs: ["VISION_API_KEY"] });
      if (!response?.result?.ok) {
        throw new Error(response?.result?.error?.message || "无法读取密钥配置状态");
      }
      return {
        kind: "ready",
        configured: response.result.value.credentials?.VISION_API_KEY?.configured === true,
      };
    }

    async function testConnection(setStatus) {
      setStatus({ kind: "loading", text: "正在测试连接…" });
      try {
        const res = await fetch(TEST_ROUTE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
        setStatus({
          kind: "ok",
          text: `✅ 已保存的 API Key 连接正常 · ${data.elapsedMs ?? ""}ms`,
        });
      } catch (err) {
        setStatus({
          kind: "error",
          text: `❌ 连接失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    /* ── VisionSettings component ───────────────────────────── */

    function VisionSettings() {
      const [state, setState] = useState(loadState);
      const [status, setStatus] = useState({ kind: "idle", text: "" });
      const [testing, setTesting] = useState(false);
      const [touchedKeys, setTouchedKeys] = useState(() => new Set());
      const [apiKeyStatus, setApiKeyStatus] = useState({ kind: "loading", configured: false });
      const [modelSyncStatus, setModelSyncStatus] = useState({ kind: "idle", text: "" });
      const [modelGroups, setModelGroups] = useState([]);
      const [catalogStatus, setCatalogStatus] = useState({ kind: "loading", text: "正在加载可选模型…" });
      const [visionModelOptions, setVisionModelOptions] = useState([]);
      const [visionModelStatus, setVisionModelStatus] = useState({ kind: "idle", text: "点击“加载模型”获取当前视觉服务的 /models 列表。" });

      // Persist non-secret UI state and serialize only user-initiated credential writes.
      useEffect(() => {
        saveState(state);
        const timer = setTimeout(() => {
          void queueCredentialSync(credentialApi, state, touchedKeys).catch(() => undefined);
        }, CREDENTIAL_SYNC_DELAY_MS);
        return () => clearTimeout(timer);
      }, [state, touchedKeys]);

      useEffect(() => {
        if (pendingMigrationKeys.size === 0) return;
        const migrationKeys = pendingMigrationKeys;
        pendingMigrationKeys = new Set();
        setTouchedKeys((previous) => new Set([...previous, ...migrationKeys]));
      }, []);

      const syncEnabledModels = useCallback(async (nextState) => {
        setModelSyncStatus({ kind: "saving", text: "正在保存对话视觉模型…" });
        try {
          await queueCredentialSync(credentialApi, nextState, new Set(["enabledModels"]));
          setModelSyncStatus({ kind: "saved", text: "✓ 已保存到 DSH；重新打开对话模型列表即可看到 [vision]。" });
        } catch (error) {
          setModelSyncStatus({
            kind: "error",
            text: `✕ 保存失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }, []);

      // Repair selections that were stored locally before the credential API call was fixed.
      useEffect(() => {
        if (state.enabledModels.length > 0) void syncEnabledModels(state);
      // This migration intentionally runs only for the state loaded when the page opens.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const update = (key, value) => {
        setTouchedKeys((previous) => new Set([...previous, key]));
        setState((prev) => ({ ...prev, [key]: value }));
      };

      const refreshApiKeyStatus = useCallback(async () => {
        setApiKeyStatus({ kind: "loading", configured: false });
        try {
          setApiKeyStatus(await describeApiKey(credentialApi));
        } catch {
          setApiKeyStatus({ kind: "unknown", configured: false });
        }
      }, []);

      useEffect(() => {
        void refreshApiKeyStatus();
      }, [refreshApiKeyStatus]);

      const refreshModelCatalog = useCallback(async () => {
        setCatalogStatus({ kind: "loading", text: "正在加载可选模型…" });
        try {
          const groups = await loadModelCatalog(connectionApi);
          setModelGroups(groups);
          setCatalogStatus({ kind: "ready", text: "" });
        } catch (error) {
          setCatalogStatus({
            kind: "error",
            text: `无法加载模型目录：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }, []);

      useEffect(() => {
        void refreshModelCatalog();
      }, [refreshModelCatalog]);

      const refreshVisionModelCatalog = useCallback(async () => {
        const pendingConnectionKeys = new Set(
          [...touchedKeys].filter((key) => key === "apiKey" || key === "baseUrl")
        );
        setVisionModelStatus({ kind: "loading", text: "正在从当前 Base URL 加载 /models…" });
        try {
          if (pendingConnectionKeys.size > 0) {
            await queueCredentialSync(credentialApi, state, pendingConnectionKeys);
          }
          const models = await loadVisionModelCatalog();
          setVisionModelOptions(models);
          setVisionModelStatus({
            kind: "ready",
            text: models.length > 0 ? `已加载 ${models.length} 个模型。` : "接口已连接，但未返回可选择的模型。",
          });
        } catch (error) {
          setVisionModelStatus({
            kind: "error",
            text: `无法加载模型：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }, [state, touchedKeys]);

      const toggleVisionModel = (provider, model) => {
        const key = routeKey(provider, model);
        const exists = state.enabledModels.some((entry) => routeKey(entry.provider, entry.model) === key);
        const enabledModels = exists
          ? state.enabledModels.filter((entry) => routeKey(entry.provider, entry.model) !== key)
          : [...state.enabledModels, { provider, model }];
        const nextState = { ...state, enabledModels };
        update("enabledModels", enabledModels);
        void syncEnabledModels(nextState);
      };

      const onTest = useCallback(async () => {
        setTesting(true);
        try {
          await queueCredentialSync(credentialApi, state, touchedKeys);
          await testConnection(setStatus);
          await refreshApiKeyStatus();
        } finally {
          setTesting(false);
        }
      }, [state, touchedKeys, refreshApiKeyStatus]);

      const clearApiKey = useCallback(async () => {
        if (!window.confirm("确定清除已保存的 API Key 吗？清除后视觉分析将无法调用外部视觉模型。")) return;
        try {
          const response = await credentialApi?.unset?.({ ref: "VISION_API_KEY" });
          if (!response?.result?.ok) throw new Error(response?.result?.error?.message || "无法清除 API Key");
          setState((previous) => ({ ...previous, apiKey: "" }));
          setTouchedKeys((previous) => new Set([...previous, "apiKey"]));
          setStatus({ kind: "ok", text: "✅ 已清除保存的 API Key" });
          await refreshApiKeyStatus();
        } catch (error) {
          setStatus({ kind: "error", text: `❌ 清除失败: ${error instanceof Error ? error.message : String(error)}` });
        }
      }, [refreshApiKeyStatus]);

      return /* @__PURE__ */ reactJsxRuntime.jsxs(
        "div",
        {
          style: {
            padding: "20px 24px",
            maxWidth: 720,
            margin: "0 auto",
            color: "var(--dsw-alias-label-primary, #e0e0e0)",
            fontFamily: "var(--dsw-alias-font-body, system-ui, sans-serif)",
          },
          children: [
            /* header */
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs("h2", {
                  style: {
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--dsw-alias-label-primary, #e0e0e0)",
                  },
                  children: ["👁️ 视觉分析"],
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  onClick: onTest,
                  disabled: testing,
                  style: {
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--dsw-alias-border-l2, #444)",
                    background: testing ? "var(--dsw-alias-bg-layer-3, #333)" : "var(--dsw-alias-bg-layer-2, #2a2a2a)",
                    color: testing ? "var(--dsw-alias-label-tertiary, #888)" : "var(--dsw-alias-label-primary, #e0e0e0)",
                    cursor: testing ? "not-allowed" : "pointer",
                    fontSize: 13,
                  },
                  children: testing ? "测试中..." : "测试连接",
                }),
              ],
            }),

            /* status banner */
            status.text &&
              /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                style: {
                  padding: "10px 14px",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background:
                    status.kind === "ok"
                      ? "rgba(34,197,94,0.12)"
                      : status.kind === "error"
                        ? "rgba(239,68,68,0.12)"
                        : "var(--dsw-alias-bg-layer-3, #333)",
                  border:
                    "1px solid " +
                    (status.kind === "ok"
                      ? "rgba(34,197,94,0.3)"
                      : status.kind === "error"
                        ? "rgba(239,68,68,0.3)"
                        : "var(--dsw-alias-border-l2, #444)"),
                  color:
                    status.kind === "ok"
                      ? "#4ade80"
                      : status.kind === "error"
                        ? "#f87171"
                        : "var(--dsw-alias-label-secondary, #aaa)",
                },
                children: status.text,
              }),

            /* API config card */
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: {
                background: "var(--dsw-alias-bg-layer-3, #1e1e1e)",
                border: "1px solid var(--dsw-alias-border-l2, #333)",
                borderRadius: 12,
                padding: "16px 18px",
                marginBottom: 16,
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  style: {
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                    color: "var(--dsw-alias-label-primary, #e0e0e0)",
                  },
                  children: "🔑 API 配置",
                }),
                field(
                  "API Key",
                  "apiKey",
                  state.apiKey,
                  update,
                  apiKeyStatus.configured ? "已保存；输入新 Key 可替换" : "sk-…",
                  true,
                ),
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 10, margin: "-2px 0 12px", fontSize: 12 },
                  children: [
                    apiKeyStatus.kind === "loading" &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "正在检查 API Key 配置状态…",
                      }),
                    apiKeyStatus.kind === "ready" && apiKeyStatus.configured &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "#4ade80" },
                        children: "✓ 已保存 API Key（不会显示或回传明文）",
                      }),
                    apiKeyStatus.kind === "ready" && !apiKeyStatus.configured &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "尚未保存 API Key",
                      }),
                    apiKeyStatus.kind === "unknown" &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "暂时无法确认 API Key 配置状态",
                      }),
                    apiKeyStatus.configured &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                        type: "button",
                        onClick: clearApiKey,
                        style: {
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: "1px solid rgba(248,113,113,0.5)",
                          background: "transparent",
                          color: "#f87171",
                          cursor: "pointer",
                          fontSize: 12,
                        },
                        children: "清除 API Key",
                      }),
                  ],
                }),
                field("Base URL", "baseUrl", state.baseUrl, update, "https://api.example.com/v1"),
                /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelPicker, {
                  value: state.model,
                  onChange: (value) => update("model", value),
                  options: visionModelOptions,
                  status: visionModelStatus,
                  onRefresh: refreshVisionModelCatalog,
                }),
              ],
            }),

            /* Analysis params card */
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: {
                background: "var(--dsw-alias-bg-layer-3, #1e1e1e)",
                border: "1px solid var(--dsw-alias-border-l2, #333)",
                borderRadius: 12,
                padding: "16px 18px",
                marginBottom: 16,
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  style: {
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                    color: "var(--dsw-alias-label-primary, #e0e0e0)",
                  },
                  children: "⚙️ 分析参数",
                }),
                selectField(
                  "视觉基元",
                  "primitives",
                  state.primitives,
                  update,
                  [
                    { value: "auto", label: "自动（推荐）" },
                    { value: "on", label: "始终开启" },
                    { value: "off", label: "关闭" },
                  ],
                  "决定视觉模型是否用坐标化的 <ref>、<box>、<point> 形式输出可引用证据。它不改变识图能力，只改变证据表达格式。",
                  {
                    auto: "当前为自动：界面、定位、计数等需要空间证据的任务会启用；纯描述任务会保持简洁。",
                    on: "当前为始终开启：适合经常需要定位、框选和后续追问的工作流，但回答会更长。",
                    off: "当前为关闭：适合只要自然语言概述的场景，不会输出坐标或视觉标签。",
                  }[state.primitives]
                ),
                selectField(
                  "分析细节",
                  "detail",
                  state.detail,
                  update,
                  [
                    { value: "brief", label: "简短（brief）" },
                    { value: "standard", label: "标准（standard，默认）" },
                    { value: "verbose", label: "详细（verbose）" },
                  ],
                  "控制视觉证据的信息密度。无论选择哪一项，系统都会先自动识别 11 种视觉任务模式；此项只决定回答展开程度。",
                  {
                    brief: "当前为简短：给结论、关键对象和必要坐标，适合快速确认。",
                    standard: "当前为标准：给关键证据、简短关系说明和结论，适合大多数对话。",
                    verbose: "当前为详细：增加状态、关系、限制和下一步建议，适合复杂界面或文档审阅。",
                  }[state.detail]
                ),
                selectField(
                  "重试模式",
                  "retry",
                  state.retry,
                  update,
                  [
                    { value: "off", label: "关闭（推荐）" },
                    { value: "format-only", label: "仅格式不完整时重试" },
                    { value: "on", label: "验证失败时重试" },
                  ],
                  "首次结果未满足视觉基元格式或完整性要求时，是否自动再请求一次视觉模型。它不会对网络 503 等上游服务错误无限重试。",
                  {
                    off: "当前为关闭：速度和费用最可控；模型格式偶发不完整时直接返回已有结果。",
                    "format-only": "当前为仅格式重试：只在需要视觉基元但标签不完整时补一次请求，适合坐标化工作流。",
                    on: "当前为验证失败重试：更看重结构完整性，但可能增加一次模型调用时间和费用。",
                  }[state.retry]
                ),
                numberField(
                  "最大图片大小（MB）",
                  "maxImageBytes",
                  state.maxImageBytes === "" ? "" : state.maxImageBytes / BYTES_PER_MEGABYTE,
                  (_key, value) => update("maxImageBytes", value === "" ? "" : value * BYTES_PER_MEGABYTE),
                  1,
                  50,
                  1,
                  "单张图片在送往视觉模型前允许读取的最大体积。超过限制会在本地拒绝，不会上传到视觉服务。",
                  "建议保持 5–10 MB：过大图片会显著增加编码体积、传输时间与超时概率。"
                ),
                numberField(
                  "视觉请求超时（毫秒）",
                  "timeoutMs",
                  state.timeoutMs,
                  update,
                  5000,
                  300000,
                  1000,
                  "外部视觉模型在此时间内未返回时，本次视觉分析会停止并向对话显示可解释的失败原因。",
                  "默认 180000（3 分钟）。本地或较慢模型建议不低于 60000；不要无限调大，以免对话长期无响应。"
                ),
                selectField(
                  "输出 Token 预算",
                  "maxTokensMode",
                  state.maxTokensMode,
                  update,
                  [
                    { value: "auto", label: "自动（推荐）" },
                    { value: "manual", label: "手动指定" },
                  ],
                  "限制视觉模型一次最多生成多少文本。它影响结果可展开程度、响应时间和费用，不限制原图大小。",
                  state.maxTokensMode === "auto"
                    ? "当前为自动：会按分析细节分配预算，避免简单问题生成过长证据。"
                    : "当前为手动：请按任务复杂度设置固定上限。"
                ),
                state.maxTokensMode === "auto"
                  ? /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                    style: { margin: "-2px 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-tertiary, #888)" },
                    children: "自动预算映射：简短 1024 / 标准 2048 / 详细 4096。",
                  })
                  : numberField(
                    "最大输出 Token",
                    "maxTokens",
                    state.maxTokens,
                    update,
                    256,
                    65536,
                    256,
                    "手动模式下的固定输出上限。数值越高，模型越有空间给出完整证据，但响应可能更慢。",
                    "建议：普通截图 1024–2048；复杂界面、密集文档或需要大量坐标时 2048–4096。"
                  ),
              ],
            }),

            /* footer hint */
            /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelSelector, {
              groups: modelGroups,
              enabledModels: state.enabledModels,
              catalogStatus,
              modelSyncStatus,
              toggleModel: toggleVisionModel,
              refreshCatalog: refreshModelCatalog,
            }),

            /* footer hint */
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: {
                fontSize: 12,
                color: "var(--dsw-alias-label-tertiary, #888)",
                margin: 0,
                lineHeight: 1.6,
              },
              children:
                "分析设置会同步到 DSH 凭据存储，并在下一次视觉分析请求中生效。API Key 不会保存在浏览器本地存储；清空并修改 API Key 会移除已保存的密钥。",
            }),
          ],
        }
      );
    }

    /* ── form field helpers ─────────────────────────────────── */

    function field(label, key, value, onChange, placeholder, isPassword) {
      return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
        style: { marginBottom: 10 },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsx("label", {
            style: {
              display: "block",
              fontSize: 12,
              color: "var(--dsw-alias-label-secondary, #aaa)",
              marginBottom: 4,
            },
            children: label,
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("input", {
            type: isPassword ? "password" : "text",
            value,
            placeholder,
            onChange: (e) => onChange(key, e.target.value),
            style: {
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--dsw-alias-border-l2, #444)",
              background: "var(--dsw-alias-bg-layer-1, #252525)",
              color: "var(--dsw-alias-label-primary, #e0e0e0)",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            },
          }),
        ],
      });
    }

    function selectField(label, key, value, onChange, options, description, selectedHint) {
      return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
        style: { marginBottom: 16 },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsx("label", {
            style: {
              display: "block",
              fontSize: 12,
              color: "var(--dsw-alias-label-secondary, #aaa)",
              marginBottom: 4,
            },
            children: label,
          }),
          description &&
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)",
              },
              children: description,
            }),
          /* @__PURE__ */ reactJsxRuntime.jsx("select", {
            value,
            onChange: (e) => onChange(key, e.target.value),
            style: {
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--dsw-alias-border-l2, #444)",
              background: "var(--dsw-alias-bg-layer-1, #252525)",
              color: "var(--dsw-alias-label-primary, #e0e0e0)",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            },
            children: options.map((opt) => {
              const v = typeof opt === "string" ? opt : opt.value;
              const labelText = typeof opt === "string" ? opt : opt.label;
              return /* @__PURE__ */ reactJsxRuntime.jsx(
                "option",
                { value: v, children: labelText },
                v
              );
            }),
          }),
          selectedHint &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                marginTop: 7,
                padding: "7px 9px",
                borderLeft: "2px solid rgba(96,165,250,0.75)",
                borderRadius: "0 6px 6px 0",
                background: "rgba(96,165,250,0.08)",
                color: "var(--dsw-alias-label-secondary, #aaa)",
                fontSize: 12,
                lineHeight: 1.55,
              },
              children: selectedHint,
            }),
        ],
      });
    }

    function numberField(label, key, value, onChange, min, max, step, description, recommendation) {
      return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
        style: { marginBottom: 16 },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsx("label", {
            style: {
              display: "block",
              fontSize: 12,
              color: "var(--dsw-alias-label-secondary, #aaa)",
              marginBottom: 4,
            },
            children: label,
          }),
          description &&
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)",
              },
              children: description,
            }),
          /* @__PURE__ */ reactJsxRuntime.jsx("input", {
            type: "number",
            value,
            min,
            max,
            step,
            onChange: (e) => {
              const raw = e.target.value;
              if (raw === "") return onChange(key, "");
              const next = Number(raw);
              if (Number.isInteger(next) && next >= min && next <= max && (next - min) % step === 0) {
                onChange(key, next);
              }
            },
            style: {
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--dsw-alias-border-l2, #444)",
              background: "var(--dsw-alias-bg-layer-1, #252525)",
              color: "var(--dsw-alias-label-primary, #e0e0e0)",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            },
          }),
          recommendation &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                marginTop: 7,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                fontSize: 12,
                lineHeight: 1.55,
              },
              children: `建议：${recommendation}`,
            }),
        ],
      });
    }

    function VisionModelPicker({ value, onChange, options, status, onRefresh }) {
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState("");
      const normalizedQuery = query.trim().toLowerCase();
      const filteredOptions = options.filter((model) => model.toLowerCase().includes(normalizedQuery));
      const selectModel = (model) => {
        onChange(model);
        setOpen(false);
        setQuery("");
      };

      return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
        style: { marginBottom: 16 },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsx("label", {
            style: { display: "block", fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)", marginBottom: 4 },
            children: "视觉模型",
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("p", {
            style: { margin: "0 0 8px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-tertiary, #888)" },
            children: "可从当前 Base URL 的 /models 获取模型并搜索选择；若服务不提供目录，也可在下方手动填写模型 ID。",
          }),
          /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
            style: { display: "flex", gap: 8, alignItems: "center" },
            children: [
              /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                type: "button",
                onClick: () => {
                  setOpen(true);
                  void onRefresh();
                },
                disabled: status.kind === "loading",
                style: {
                  minHeight: 34,
                  padding: "6px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--dsw-alias-border-l2, #444)",
                  background: "var(--dsw-alias-bg-layer-2, #2a2a2a)",
                  color: "var(--dsw-alias-label-primary, #e0e0e0)",
                  cursor: status.kind === "loading" ? "not-allowed" : "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                },
                children: status.kind === "loading" ? "加载中…" : options.length > 0 ? "刷新模型" : "加载模型",
              }),
              options.length > 0 &&
                /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  onClick: () => setOpen((previous) => !previous),
                  style: {
                    minHeight: 34,
                    padding: "6px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--dsw-alias-border-l2, #444)",
                    background: open ? "rgba(96,165,250,0.14)" : "transparent",
                    color: "var(--dsw-alias-label-secondary, #aaa)",
                    cursor: "pointer",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  },
                  children: `模型列表 (${options.length}) ${open ? "⌃" : "⌄"}`,
                }),
            ],
          }),
          status.text &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                marginTop: 7,
                color: status.kind === "error" ? "#f87171" : "var(--dsw-alias-label-tertiary, #888)",
                fontSize: 12,
                lineHeight: 1.5,
              },
              children: status.text,
            }),
          open &&
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: {
                marginTop: 9,
                border: "1px solid var(--dsw-alias-border-l2, #444)",
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--dsw-alias-bg-layer-2, #2a2a2a)",
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("input", {
                  type: "search",
                  value: query,
                  placeholder: "搜索模型名称或 ID…",
                  onChange: (event) => setQuery(event.target.value),
                  style: {
                    width: "100%",
                    padding: "9px 10px",
                    border: "none",
                    borderBottom: "1px solid var(--dsw-alias-border-l2, #444)",
                    background: "var(--dsw-alias-bg-layer-1, #252525)",
                    color: "var(--dsw-alias-label-primary, #e0e0e0)",
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  },
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  style: { maxHeight: 220, overflowY: "auto", padding: 4 },
                  children: filteredOptions.length > 0
                    ? filteredOptions.map((model) =>
                      /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
                        type: "button",
                        onClick: () => selectModel(model),
                        style: {
                          display: "flex",
                          width: "100%",
                          minHeight: 36,
                          alignItems: "center",
                          padding: "7px 9px",
                          border: "none",
                          borderRadius: 5,
                          background: model === value ? "rgba(96,165,250,0.16)" : "transparent",
                          color: "var(--dsw-alias-label-primary, #e0e0e0)",
                          cursor: "pointer",
                          textAlign: "left",
                          fontSize: 13,
                        },
                        children: [model, model === value && "  ✓"],
                      }, model)
                    )
                    : /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      style: { padding: "12px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                      children: options.length === 0 ? "尚未加载到模型。请检查 Base URL 和 API Key 后点击“加载模型”。" : "没有匹配的模型。",
                    }),
                }),
              ],
            }),
          /* @__PURE__ */ reactJsxRuntime.jsx("label", {
            style: { display: "block", marginTop: 10, fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" },
            children: "自定义模型 ID",
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("input", {
            type: "text",
            value,
            placeholder: "例如 vision-model 或 gpt-4o",
            onChange: (event) => onChange(event.target.value),
            style: {
              width: "100%",
              marginTop: 4,
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--dsw-alias-border-l2, #444)",
              background: "var(--dsw-alias-bg-layer-1, #252525)",
              color: "var(--dsw-alias-label-primary, #e0e0e0)",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            },
          }),
        ],
      });
    }

    function VisionModelSelector({ groups, enabledModels, catalogStatus, modelSyncStatus, toggleModel, refreshCatalog }) {
      const [expandedProviders, setExpandedProviders] = useState(() => new Set());
      const enabled = new Set(enabledModels.map((entry) => routeKey(entry.provider, entry.model)));
      const toggleProvider = (provider) => {
        setExpandedProviders((previous) => {
          const next = new Set(previous);
          if (next.has(provider)) next.delete(provider);
          else next.add(provider);
          return next;
        });
      };
      return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
        style: {
          background: "var(--dsw-alias-bg-layer-3, #1e1e1e)",
          border: "1px solid var(--dsw-alias-border-l2, #333)",
          borderRadius: 12,
          padding: "16px 18px",
          marginBottom: 16,
        },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
            style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 },
            children: [
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: { fontSize: 13, fontWeight: 600 },
                    children: "🪟 对话视觉模型",
                  }),
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: { marginTop: 4, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                    children: `已启用 ${enabled.size} 个模型；仅勾选的模型会显示 [vision]。`,
                  }),
                ],
              }),
              /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                type: "button",
                onClick: () => void refreshCatalog(),
                disabled: catalogStatus.kind === "loading",
                style: {
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--dsw-alias-border-l2, #444)",
                  background: "transparent",
                  color: "var(--dsw-alias-label-secondary, #aaa)",
                  cursor: catalogStatus.kind === "loading" ? "not-allowed" : "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                },
                children: "刷新",
              }),
            ],
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("p", {
            style: { margin: "0 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-secondary, #aaa)" },
            children: "选择需要由外部视觉模型增强的纯文本对话模型。选择会立即保存；重新打开模型列表后即可使用。",
          }),
          modelSyncStatus.text &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                margin: "0 0 10px",
                fontSize: 12,
                color:
                  modelSyncStatus.kind === "saved"
                    ? "#4ade80"
                    : modelSyncStatus.kind === "error"
                      ? "#f87171"
                      : "var(--dsw-alias-label-tertiary, #888)",
              },
              children: modelSyncStatus.text,
            }),
          catalogStatus.kind === "loading" &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: catalogStatus.text,
            }),
          catalogStatus.kind === "error" &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "#f87171", lineHeight: 1.5 },
              children: catalogStatus.text,
            }),
          catalogStatus.kind === "ready" && groups.length === 0 &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: "当前没有可选择的模型。请先在“模型”设置中完成至少一个 Provider 配置。",
            }),
          catalogStatus.kind === "ready" && groups.map((group) => {
            const models = Array.isArray(group.models) ? group.models : [];
            const providerEnabledCount = models.filter((model) => enabled.has(routeKey(group.id, model.id))).length;
            const expanded = expandedProviders.has(group.id);
            return /* @__PURE__ */ reactJsxRuntime.jsxs("section", {
              style: {
                borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
                marginTop: 10,
                paddingTop: 10,
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
                  type: "button",
                  onClick: () => toggleProvider(group.id),
                  "aria-expanded": expanded,
                  style: {
                    display: "flex",
                    width: "100%",
                    minHeight: 42,
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid " + (providerEnabledCount > 0 ? "rgba(74,222,128,0.35)" : "var(--dsw-alias-border-l2, #444)"),
                    borderRadius: 8,
                    background: providerEnabledCount > 0 ? "rgba(74,222,128,0.07)" : "var(--dsw-alias-bg-layer-2, #2a2a2a)",
                    color: "var(--dsw-alias-label-primary, #e0e0e0)",
                    cursor: "pointer",
                    textAlign: "left",
                  },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsxs("span", {
                      style: { display: "flex", minWidth: 0, flexDirection: "column", gap: 2 },
                      children: [
                        /* @__PURE__ */ reactJsxRuntime.jsx("span", { style: { fontSize: 13, fontWeight: 600 }, children: group.name || group.id }),
                        /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                          style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                          children: providerEnabledCount > 0 ? `${models.length} 个模型 · 已启用 ${providerEnabledCount} 个` : `${models.length} 个模型`,
                        }),
                      ],
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                      style: { color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 16 },
                      children: expanded ? "⌃" : "⌄",
                    }),
                  ],
                }),
                expanded &&
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: { padding: "6px 4px 2px" },
                    children: models.map((model) => {
                  const key = routeKey(group.id, model.id);
                  return /* @__PURE__ */ reactJsxRuntime.jsxs("label", {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 4px",
                      cursor: "pointer",
                      fontSize: 13,
                    },
                    children: [
                      /* @__PURE__ */ reactJsxRuntime.jsx("input", {
                        type: "checkbox",
                        checked: enabled.has(key),
                        onChange: () => toggleModel(group.id, model.id),
                      }),
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", { children: model.name }),
                      model.name !== model.id &&
                        /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                          style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12 },
                          children: `(${model.id})`,
                        }),
                    ],
                  }, key);
                    }),
                  }),
              ],
            }, group.id);
          }),
        ],
      });
    }

    /* ── Cordis registration ────────────────────────────────── */

    function apply(ctx) {
      credentialApi = getCredentialApi(ctx);
      connectionApi = getConnectionApi(ctx);
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "tool-visual-primitives",
            order: 100,
            label: () => "视觉分析",
          },
          VisionSettings,
        )
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
