(() => {
  // client/index.js
  window.__ModuleLoader__.load({
    id: "dsh-tool-visual-primitives",
    factory: (require2) => {
      var module = { exports: {} };
      var exports = module.exports;
      const react = require2("react");
      const reactJsxRuntime = require2("react/jsx-runtime");
      const { useState, useEffect, useCallback } = react;
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
        timeoutMs: 18e4,
        maxTokensMode: "auto",
        maxTokens: 2048,
        enabledModels: []
      };
      const PERSISTED_KEYS = Object.keys(FALLBACKS).filter((key) => key !== "apiKey");
      let credentialSyncQueue = Promise.resolve();
      let pendingMigrationKeys = /* @__PURE__ */ new Set();
      function loadState() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return { ...FALLBACKS };
          const parsed = JSON.parse(raw);
          const persisted = Object.fromEntries(
            PERSISTED_KEYS.map((key) => [key, parsed[key]]).filter(([, value]) => value !== void 0)
          );
          const migrated = {
            ...FALLBACKS,
            ...persisted,
            apiKey: "",
            enabledModels: Array.isArray(persisted.enabledModels) ? persisted.enabledModels : []
          };
          if (persisted.timeoutMs === 6e4) {
            migrated.timeoutMs = FALLBACKS.timeoutMs;
            pendingMigrationKeys.add("timeoutMs");
          }
          if (persisted.maxTokens === 8192 && persisted.maxTokensMode === void 0) {
            migrated.maxTokensMode = "auto";
            migrated.maxTokens = FALLBACKS.maxTokens;
            pendingMigrationKeys.add("maxTokens");
            pendingMigrationKeys.add("maxTokensMode");
          } else if (persisted.maxTokensMode === void 0) {
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
        }
      }
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
        if (!api?.set || !api?.unset) throw new Error("DSH \u51ED\u636E\u670D\u52A1\u6682\u4E0D\u53EF\u7528");
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
          ["VISION_ENABLED_MODELS", JSON.stringify(state.enabledModels), "enabledModels"]
        ];
        for (const [ref, value, key] of entries) {
          if (!touchedKeys.has(key) && !(key === "maxTokens" && touchedKeys.has("maxTokensMode"))) continue;
          const trimmed = String(value || "").trim();
          const response = trimmed ? await api.set({ ref, value: trimmed }) : await api.unset({ ref });
          if (!response?.result?.ok) {
            throw new Error(response?.result?.error?.message || `\u65E0\u6CD5\u4FDD\u5B58 ${ref}`);
          }
        }
      }
      function queueCredentialSync(api, state, touchedKeys) {
        const snapshot = { ...state };
        const keys = new Set(touchedKeys);
        const run = credentialSyncQueue.catch(() => void 0).then(() => syncCredentials(api, snapshot, keys));
        credentialSyncQueue = run.catch(() => void 0);
        return run;
      }
      async function loadModelCatalog(api) {
        if (!api?.llm?.models) throw new Error("DSH \u6A21\u578B\u76EE\u5F55\u6682\u4E0D\u53EF\u7528");
        const response = await api.llm.models({});
        if (!response?.result?.ok) {
          throw new Error(response?.result?.error?.message || "\u65E0\u6CD5\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55");
        }
        return response.result.value.groups.filter((group) => group.id !== "visual-primitives");
      }
      function routeKey(provider, model) {
        return `${provider}\0${model}`;
      }
      async function loadVisionModelCatalog() {
        const response = await fetch(VISION_MODEL_CATALOG_ROUTE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.error || `\u6A21\u578B\u76EE\u5F55\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
        }
        return Array.isArray(payload.models) ? payload.models.filter((model) => typeof model === "string") : [];
      }
      async function describeApiKey(api) {
        if (!api?.describe) return { kind: "unknown", configured: false };
        const response = await api.describe({ refs: ["VISION_API_KEY"] });
        if (!response?.result?.ok) {
          throw new Error(response?.result?.error?.message || "\u65E0\u6CD5\u8BFB\u53D6\u5BC6\u94A5\u914D\u7F6E\u72B6\u6001");
        }
        return {
          kind: "ready",
          configured: response.result.value.credentials?.VISION_API_KEY?.configured === true
        };
      }
      async function testConnection(setStatus) {
        setStatus({ kind: "loading", text: "\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026" });
        try {
          const res = await fetch(TEST_ROUTE_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
          setStatus({
            kind: "ok",
            text: `\u2705 \u5DF2\u4FDD\u5B58\u7684 API Key \u8FDE\u63A5\u6B63\u5E38 \xB7 ${data.elapsedMs ?? ""}ms`
          });
        } catch (err) {
          setStatus({
            kind: "error",
            text: `\u274C \u8FDE\u63A5\u5931\u8D25: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      }
      function VisionSettings() {
        const [state, setState] = useState(loadState);
        const [status, setStatus] = useState({ kind: "idle", text: "" });
        const [testing, setTesting] = useState(false);
        const [touchedKeys, setTouchedKeys] = useState(() => /* @__PURE__ */ new Set());
        const [apiKeyStatus, setApiKeyStatus] = useState({ kind: "loading", configured: false });
        const [modelSyncStatus, setModelSyncStatus] = useState({ kind: "idle", text: "" });
        const [modelGroups, setModelGroups] = useState([]);
        const [catalogStatus, setCatalogStatus] = useState({ kind: "loading", text: "\u6B63\u5728\u52A0\u8F7D\u53EF\u9009\u6A21\u578B\u2026" });
        const [visionModelOptions, setVisionModelOptions] = useState([]);
        const [visionModelStatus, setVisionModelStatus] = useState({ kind: "idle", text: "\u70B9\u51FB\u201C\u52A0\u8F7D\u6A21\u578B\u201D\u83B7\u53D6\u5F53\u524D\u89C6\u89C9\u670D\u52A1\u7684 /models \u5217\u8868\u3002" });
        useEffect(() => {
          saveState(state);
          const timer = setTimeout(() => {
            void queueCredentialSync(credentialApi, state, touchedKeys).catch(() => void 0);
          }, CREDENTIAL_SYNC_DELAY_MS);
          return () => clearTimeout(timer);
        }, [state, touchedKeys]);
        useEffect(() => {
          if (pendingMigrationKeys.size === 0) return;
          const migrationKeys = pendingMigrationKeys;
          pendingMigrationKeys = /* @__PURE__ */ new Set();
          setTouchedKeys((previous) => /* @__PURE__ */ new Set([...previous, ...migrationKeys]));
        }, []);
        const syncEnabledModels = useCallback(async (nextState) => {
          setModelSyncStatus({ kind: "saving", text: "\u6B63\u5728\u4FDD\u5B58\u5BF9\u8BDD\u89C6\u89C9\u6A21\u578B\u2026" });
          try {
            await queueCredentialSync(credentialApi, nextState, /* @__PURE__ */ new Set(["enabledModels"]));
            setModelSyncStatus({ kind: "saved", text: "\u2713 \u5DF2\u4FDD\u5B58\u5230 DSH\uFF1B\u91CD\u65B0\u6253\u5F00\u5BF9\u8BDD\u6A21\u578B\u5217\u8868\u5373\u53EF\u770B\u5230 [vision]\u3002" });
          } catch (error) {
            setModelSyncStatus({
              kind: "error",
              text: `\u2715 \u4FDD\u5B58\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
            });
          }
        }, []);
        useEffect(() => {
          if (state.enabledModels.length > 0) void syncEnabledModels(state);
        }, []);
        const update = (key, value) => {
          setTouchedKeys((previous) => /* @__PURE__ */ new Set([...previous, key]));
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
          setCatalogStatus({ kind: "loading", text: "\u6B63\u5728\u52A0\u8F7D\u53EF\u9009\u6A21\u578B\u2026" });
          try {
            const groups = await loadModelCatalog(connectionApi);
            setModelGroups(groups);
            setCatalogStatus({ kind: "ready", text: "" });
          } catch (error) {
            setCatalogStatus({
              kind: "error",
              text: `\u65E0\u6CD5\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55\uFF1A${error instanceof Error ? error.message : String(error)}`
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
          setVisionModelStatus({ kind: "loading", text: "\u6B63\u5728\u4ECE\u5F53\u524D Base URL \u52A0\u8F7D /models\u2026" });
          try {
            if (pendingConnectionKeys.size > 0) {
              await queueCredentialSync(credentialApi, state, pendingConnectionKeys);
            }
            const models = await loadVisionModelCatalog();
            setVisionModelOptions(models);
            setVisionModelStatus({
              kind: "ready",
              text: models.length > 0 ? `\u5DF2\u52A0\u8F7D ${models.length} \u4E2A\u6A21\u578B\u3002` : "\u63A5\u53E3\u5DF2\u8FDE\u63A5\uFF0C\u4F46\u672A\u8FD4\u56DE\u53EF\u9009\u62E9\u7684\u6A21\u578B\u3002"
            });
          } catch (error) {
            setVisionModelStatus({
              kind: "error",
              text: `\u65E0\u6CD5\u52A0\u8F7D\u6A21\u578B\uFF1A${error instanceof Error ? error.message : String(error)}`
            });
          }
        }, [state, touchedKeys]);
        const toggleVisionModel = (provider, model) => {
          const key = routeKey(provider, model);
          const exists = state.enabledModels.some((entry) => routeKey(entry.provider, entry.model) === key);
          const enabledModels = exists ? state.enabledModels.filter((entry) => routeKey(entry.provider, entry.model) !== key) : [...state.enabledModels, { provider, model }];
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
          if (!window.confirm("\u786E\u5B9A\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684 API Key \u5417\uFF1F\u6E05\u9664\u540E\u89C6\u89C9\u5206\u6790\u5C06\u65E0\u6CD5\u8C03\u7528\u5916\u90E8\u89C6\u89C9\u6A21\u578B\u3002")) return;
          try {
            const response = await credentialApi?.unset?.({ ref: "VISION_API_KEY" });
            if (!response?.result?.ok) throw new Error(response?.result?.error?.message || "\u65E0\u6CD5\u6E05\u9664 API Key");
            setState((previous) => ({ ...previous, apiKey: "" }));
            setTouchedKeys((previous) => /* @__PURE__ */ new Set([...previous, "apiKey"]));
            setStatus({ kind: "ok", text: "\u2705 \u5DF2\u6E05\u9664\u4FDD\u5B58\u7684 API Key" });
            await refreshApiKeyStatus();
          } catch (error) {
            setStatus({ kind: "error", text: `\u274C \u6E05\u9664\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}` });
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
              fontFamily: "var(--dsw-alias-font-body, system-ui, sans-serif)"
            },
            children: [
              /* header */
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20
                },
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsxs("h2", {
                    style: {
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--dsw-alias-label-primary, #e0e0e0)"
                    },
                    children: ["\u{1F441}\uFE0F \u89C6\u89C9\u5206\u6790"]
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
                      fontSize: 13
                    },
                    children: testing ? "\u6D4B\u8BD5\u4E2D..." : "\u6D4B\u8BD5\u8FDE\u63A5"
                  })
                ]
              }),
              /* status banner */
              status.text && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                style: {
                  padding: "10px 14px",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: status.kind === "ok" ? "rgba(34,197,94,0.12)" : status.kind === "error" ? "rgba(239,68,68,0.12)" : "var(--dsw-alias-bg-layer-3, #333)",
                  border: "1px solid " + (status.kind === "ok" ? "rgba(34,197,94,0.3)" : status.kind === "error" ? "rgba(239,68,68,0.3)" : "var(--dsw-alias-border-l2, #444)"),
                  color: status.kind === "ok" ? "#4ade80" : status.kind === "error" ? "#f87171" : "var(--dsw-alias-label-secondary, #aaa)"
                },
                children: status.text
              }),
              /* API config card */
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                style: {
                  background: "var(--dsw-alias-bg-layer-3, #1e1e1e)",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  marginBottom: 16
                },
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: {
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 12,
                      color: "var(--dsw-alias-label-primary, #e0e0e0)"
                    },
                    children: "\u{1F511} API \u914D\u7F6E"
                  }),
                  field(
                    "API Key",
                    "apiKey",
                    state.apiKey,
                    update,
                    apiKeyStatus.configured ? "\u5DF2\u4FDD\u5B58\uFF1B\u8F93\u5165\u65B0 Key \u53EF\u66FF\u6362" : "sk-\u2026",
                    true
                  ),
                  /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                    style: { display: "flex", alignItems: "center", gap: 10, margin: "-2px 0 12px", fontSize: 12 },
                    children: [
                      apiKeyStatus.kind === "loading" && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "\u6B63\u5728\u68C0\u67E5 API Key \u914D\u7F6E\u72B6\u6001\u2026"
                      }),
                      apiKeyStatus.kind === "ready" && apiKeyStatus.configured && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "#4ade80" },
                        children: "\u2713 \u5DF2\u4FDD\u5B58 API Key\uFF08\u4E0D\u4F1A\u663E\u793A\u6216\u56DE\u4F20\u660E\u6587\uFF09"
                      }),
                      apiKeyStatus.kind === "ready" && !apiKeyStatus.configured && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "\u5C1A\u672A\u4FDD\u5B58 API Key"
                      }),
                      apiKeyStatus.kind === "unknown" && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4 API Key \u914D\u7F6E\u72B6\u6001"
                      }),
                      apiKeyStatus.configured && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                        type: "button",
                        onClick: clearApiKey,
                        style: {
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: "1px solid rgba(248,113,113,0.5)",
                          background: "transparent",
                          color: "#f87171",
                          cursor: "pointer",
                          fontSize: 12
                        },
                        children: "\u6E05\u9664 API Key"
                      })
                    ]
                  }),
                  field("Base URL", "baseUrl", state.baseUrl, update, "https://api.example.com/v1"),
                  /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelPicker, {
                    value: state.model,
                    onChange: (value) => update("model", value),
                    options: visionModelOptions,
                    status: visionModelStatus,
                    onRefresh: refreshVisionModelCatalog
                  })
                ]
              }),
              /* Analysis params card */
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                style: {
                  background: "var(--dsw-alias-bg-layer-3, #1e1e1e)",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  marginBottom: 16
                },
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: {
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 12,
                      color: "var(--dsw-alias-label-primary, #e0e0e0)"
                    },
                    children: "\u2699\uFE0F \u5206\u6790\u53C2\u6570"
                  }),
                  selectField(
                    "\u89C6\u89C9\u57FA\u5143",
                    "primitives",
                    state.primitives,
                    update,
                    [
                      { value: "auto", label: "\u81EA\u52A8\uFF08\u63A8\u8350\uFF09" },
                      { value: "on", label: "\u59CB\u7EC8\u5F00\u542F" },
                      { value: "off", label: "\u5173\u95ED" }
                    ],
                    "\u51B3\u5B9A\u89C6\u89C9\u6A21\u578B\u662F\u5426\u7528\u5750\u6807\u5316\u7684 <ref>\u3001<box>\u3001<point> \u5F62\u5F0F\u8F93\u51FA\u53EF\u5F15\u7528\u8BC1\u636E\u3002\u5B83\u4E0D\u6539\u53D8\u8BC6\u56FE\u80FD\u529B\uFF0C\u53EA\u6539\u53D8\u8BC1\u636E\u8868\u8FBE\u683C\u5F0F\u3002",
                    {
                      auto: "\u5F53\u524D\u4E3A\u81EA\u52A8\uFF1A\u754C\u9762\u3001\u5B9A\u4F4D\u3001\u8BA1\u6570\u7B49\u9700\u8981\u7A7A\u95F4\u8BC1\u636E\u7684\u4EFB\u52A1\u4F1A\u542F\u7528\uFF1B\u7EAF\u63CF\u8FF0\u4EFB\u52A1\u4F1A\u4FDD\u6301\u7B80\u6D01\u3002",
                      on: "\u5F53\u524D\u4E3A\u59CB\u7EC8\u5F00\u542F\uFF1A\u9002\u5408\u7ECF\u5E38\u9700\u8981\u5B9A\u4F4D\u3001\u6846\u9009\u548C\u540E\u7EED\u8FFD\u95EE\u7684\u5DE5\u4F5C\u6D41\uFF0C\u4F46\u56DE\u7B54\u4F1A\u66F4\u957F\u3002",
                      off: "\u5F53\u524D\u4E3A\u5173\u95ED\uFF1A\u9002\u5408\u53EA\u8981\u81EA\u7136\u8BED\u8A00\u6982\u8FF0\u7684\u573A\u666F\uFF0C\u4E0D\u4F1A\u8F93\u51FA\u5750\u6807\u6216\u89C6\u89C9\u6807\u7B7E\u3002"
                    }[state.primitives]
                  ),
                  selectField(
                    "\u5206\u6790\u7EC6\u8282",
                    "detail",
                    state.detail,
                    update,
                    [
                      { value: "brief", label: "\u7B80\u77ED\uFF08brief\uFF09" },
                      { value: "standard", label: "\u6807\u51C6\uFF08standard\uFF0C\u9ED8\u8BA4\uFF09" },
                      { value: "verbose", label: "\u8BE6\u7EC6\uFF08verbose\uFF09" }
                    ],
                    "\u63A7\u5236\u89C6\u89C9\u8BC1\u636E\u7684\u4FE1\u606F\u5BC6\u5EA6\u3002\u65E0\u8BBA\u9009\u62E9\u54EA\u4E00\u9879\uFF0C\u7CFB\u7EDF\u90FD\u4F1A\u5148\u81EA\u52A8\u8BC6\u522B 11 \u79CD\u89C6\u89C9\u4EFB\u52A1\u6A21\u5F0F\uFF1B\u6B64\u9879\u53EA\u51B3\u5B9A\u56DE\u7B54\u5C55\u5F00\u7A0B\u5EA6\u3002",
                    {
                      brief: "\u5F53\u524D\u4E3A\u7B80\u77ED\uFF1A\u7ED9\u7ED3\u8BBA\u3001\u5173\u952E\u5BF9\u8C61\u548C\u5FC5\u8981\u5750\u6807\uFF0C\u9002\u5408\u5FEB\u901F\u786E\u8BA4\u3002",
                      standard: "\u5F53\u524D\u4E3A\u6807\u51C6\uFF1A\u7ED9\u5173\u952E\u8BC1\u636E\u3001\u7B80\u77ED\u5173\u7CFB\u8BF4\u660E\u548C\u7ED3\u8BBA\uFF0C\u9002\u5408\u5927\u591A\u6570\u5BF9\u8BDD\u3002",
                      verbose: "\u5F53\u524D\u4E3A\u8BE6\u7EC6\uFF1A\u589E\u52A0\u72B6\u6001\u3001\u5173\u7CFB\u3001\u9650\u5236\u548C\u4E0B\u4E00\u6B65\u5EFA\u8BAE\uFF0C\u9002\u5408\u590D\u6742\u754C\u9762\u6216\u6587\u6863\u5BA1\u9605\u3002"
                    }[state.detail]
                  ),
                  selectField(
                    "\u91CD\u8BD5\u6A21\u5F0F",
                    "retry",
                    state.retry,
                    update,
                    [
                      { value: "off", label: "\u5173\u95ED\uFF08\u63A8\u8350\uFF09" },
                      { value: "format-only", label: "\u4EC5\u683C\u5F0F\u4E0D\u5B8C\u6574\u65F6\u91CD\u8BD5" },
                      { value: "on", label: "\u9A8C\u8BC1\u5931\u8D25\u65F6\u91CD\u8BD5" }
                    ],
                    "\u9996\u6B21\u7ED3\u679C\u672A\u6EE1\u8DB3\u89C6\u89C9\u57FA\u5143\u683C\u5F0F\u6216\u5B8C\u6574\u6027\u8981\u6C42\u65F6\uFF0C\u662F\u5426\u81EA\u52A8\u518D\u8BF7\u6C42\u4E00\u6B21\u89C6\u89C9\u6A21\u578B\u3002\u5B83\u4E0D\u4F1A\u5BF9\u7F51\u7EDC 503 \u7B49\u4E0A\u6E38\u670D\u52A1\u9519\u8BEF\u65E0\u9650\u91CD\u8BD5\u3002",
                    {
                      off: "\u5F53\u524D\u4E3A\u5173\u95ED\uFF1A\u901F\u5EA6\u548C\u8D39\u7528\u6700\u53EF\u63A7\uFF1B\u6A21\u578B\u683C\u5F0F\u5076\u53D1\u4E0D\u5B8C\u6574\u65F6\u76F4\u63A5\u8FD4\u56DE\u5DF2\u6709\u7ED3\u679C\u3002",
                      "format-only": "\u5F53\u524D\u4E3A\u4EC5\u683C\u5F0F\u91CD\u8BD5\uFF1A\u53EA\u5728\u9700\u8981\u89C6\u89C9\u57FA\u5143\u4F46\u6807\u7B7E\u4E0D\u5B8C\u6574\u65F6\u8865\u4E00\u6B21\u8BF7\u6C42\uFF0C\u9002\u5408\u5750\u6807\u5316\u5DE5\u4F5C\u6D41\u3002",
                      on: "\u5F53\u524D\u4E3A\u9A8C\u8BC1\u5931\u8D25\u91CD\u8BD5\uFF1A\u66F4\u770B\u91CD\u7ED3\u6784\u5B8C\u6574\u6027\uFF0C\u4F46\u53EF\u80FD\u589E\u52A0\u4E00\u6B21\u6A21\u578B\u8C03\u7528\u65F6\u95F4\u548C\u8D39\u7528\u3002"
                    }[state.retry]
                  ),
                  numberField(
                    "\u6700\u5927\u56FE\u7247\u5927\u5C0F\uFF08MB\uFF09",
                    "maxImageBytes",
                    state.maxImageBytes === "" ? "" : state.maxImageBytes / BYTES_PER_MEGABYTE,
                    (_key, value) => update("maxImageBytes", value === "" ? "" : value * BYTES_PER_MEGABYTE),
                    1,
                    50,
                    1,
                    "\u5355\u5F20\u56FE\u7247\u5728\u9001\u5F80\u89C6\u89C9\u6A21\u578B\u524D\u5141\u8BB8\u8BFB\u53D6\u7684\u6700\u5927\u4F53\u79EF\u3002\u8D85\u8FC7\u9650\u5236\u4F1A\u5728\u672C\u5730\u62D2\u7EDD\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u5230\u89C6\u89C9\u670D\u52A1\u3002",
                    "\u5EFA\u8BAE\u4FDD\u6301 5\u201310 MB\uFF1A\u8FC7\u5927\u56FE\u7247\u4F1A\u663E\u8457\u589E\u52A0\u7F16\u7801\u4F53\u79EF\u3001\u4F20\u8F93\u65F6\u95F4\u4E0E\u8D85\u65F6\u6982\u7387\u3002"
                  ),
                  numberField(
                    "\u89C6\u89C9\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
                    "timeoutMs",
                    state.timeoutMs,
                    update,
                    5e3,
                    3e5,
                    1e3,
                    "\u5916\u90E8\u89C6\u89C9\u6A21\u578B\u5728\u6B64\u65F6\u95F4\u5185\u672A\u8FD4\u56DE\u65F6\uFF0C\u672C\u6B21\u89C6\u89C9\u5206\u6790\u4F1A\u505C\u6B62\u5E76\u5411\u5BF9\u8BDD\u663E\u793A\u53EF\u89E3\u91CA\u7684\u5931\u8D25\u539F\u56E0\u3002",
                    "\u9ED8\u8BA4 180000\uFF083 \u5206\u949F\uFF09\u3002\u672C\u5730\u6216\u8F83\u6162\u6A21\u578B\u5EFA\u8BAE\u4E0D\u4F4E\u4E8E 60000\uFF1B\u4E0D\u8981\u65E0\u9650\u8C03\u5927\uFF0C\u4EE5\u514D\u5BF9\u8BDD\u957F\u671F\u65E0\u54CD\u5E94\u3002"
                  ),
                  selectField(
                    "\u8F93\u51FA Token \u9884\u7B97",
                    "maxTokensMode",
                    state.maxTokensMode,
                    update,
                    [
                      { value: "auto", label: "\u81EA\u52A8\uFF08\u63A8\u8350\uFF09" },
                      { value: "manual", label: "\u624B\u52A8\u6307\u5B9A" }
                    ],
                    "\u9650\u5236\u89C6\u89C9\u6A21\u578B\u4E00\u6B21\u6700\u591A\u751F\u6210\u591A\u5C11\u6587\u672C\u3002\u5B83\u5F71\u54CD\u7ED3\u679C\u53EF\u5C55\u5F00\u7A0B\u5EA6\u3001\u54CD\u5E94\u65F6\u95F4\u548C\u8D39\u7528\uFF0C\u4E0D\u9650\u5236\u539F\u56FE\u5927\u5C0F\u3002",
                    state.maxTokensMode === "auto" ? "\u5F53\u524D\u4E3A\u81EA\u52A8\uFF1A\u4F1A\u6309\u5206\u6790\u7EC6\u8282\u5206\u914D\u9884\u7B97\uFF0C\u907F\u514D\u7B80\u5355\u95EE\u9898\u751F\u6210\u8FC7\u957F\u8BC1\u636E\u3002" : "\u5F53\u524D\u4E3A\u624B\u52A8\uFF1A\u8BF7\u6309\u4EFB\u52A1\u590D\u6742\u5EA6\u8BBE\u7F6E\u56FA\u5B9A\u4E0A\u9650\u3002"
                  ),
                  state.maxTokensMode === "auto" ? /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                    style: { margin: "-2px 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-tertiary, #888)" },
                    children: "\u81EA\u52A8\u9884\u7B97\u6620\u5C04\uFF1A\u7B80\u77ED 1024 / \u6807\u51C6 2048 / \u8BE6\u7EC6 4096\u3002"
                  }) : numberField(
                    "\u6700\u5927\u8F93\u51FA Token",
                    "maxTokens",
                    state.maxTokens,
                    update,
                    256,
                    65536,
                    256,
                    "\u624B\u52A8\u6A21\u5F0F\u4E0B\u7684\u56FA\u5B9A\u8F93\u51FA\u4E0A\u9650\u3002\u6570\u503C\u8D8A\u9AD8\uFF0C\u6A21\u578B\u8D8A\u6709\u7A7A\u95F4\u7ED9\u51FA\u5B8C\u6574\u8BC1\u636E\uFF0C\u4F46\u54CD\u5E94\u53EF\u80FD\u66F4\u6162\u3002",
                    "\u5EFA\u8BAE\uFF1A\u666E\u901A\u622A\u56FE 1024\u20132048\uFF1B\u590D\u6742\u754C\u9762\u3001\u5BC6\u96C6\u6587\u6863\u6216\u9700\u8981\u5927\u91CF\u5750\u6807\u65F6 2048\u20134096\u3002"
                  )
                ]
              }),
              /* footer hint */
              /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelSelector, {
                groups: modelGroups,
                enabledModels: state.enabledModels,
                catalogStatus,
                modelSyncStatus,
                toggleModel: toggleVisionModel,
                refreshCatalog: refreshModelCatalog
              }),
              /* footer hint */
              /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                style: {
                  fontSize: 12,
                  color: "var(--dsw-alias-label-tertiary, #888)",
                  margin: 0,
                  lineHeight: 1.6
                },
                children: "\u5206\u6790\u8BBE\u7F6E\u4F1A\u540C\u6B65\u5230 DSH \u51ED\u636E\u5B58\u50A8\uFF0C\u5E76\u5728\u4E0B\u4E00\u6B21\u89C6\u89C9\u5206\u6790\u8BF7\u6C42\u4E2D\u751F\u6548\u3002API Key \u4E0D\u4F1A\u4FDD\u5B58\u5728\u6D4F\u89C8\u5668\u672C\u5730\u5B58\u50A8\uFF1B\u6E05\u7A7A\u5E76\u4FEE\u6539 API Key \u4F1A\u79FB\u9664\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\u3002"
              })
            ]
          }
        );
      }
      function field(label, key, value, onChange, placeholder, isPassword) {
        return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
          style: { marginBottom: 10 },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsx("label", {
              style: {
                display: "block",
                fontSize: 12,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                marginBottom: 4
              },
              children: label
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
                boxSizing: "border-box"
              }
            })
          ]
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
                marginBottom: 4
              },
              children: label
            }),
            description && /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)"
              },
              children: description
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
                boxSizing: "border-box"
              },
              children: options.map((opt) => {
                const v = typeof opt === "string" ? opt : opt.value;
                const labelText = typeof opt === "string" ? opt : opt.label;
                return /* @__PURE__ */ reactJsxRuntime.jsx(
                  "option",
                  { value: v, children: labelText },
                  v
                );
              })
            }),
            selectedHint && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                marginTop: 7,
                padding: "7px 9px",
                borderLeft: "2px solid rgba(96,165,250,0.75)",
                borderRadius: "0 6px 6px 0",
                background: "rgba(96,165,250,0.08)",
                color: "var(--dsw-alias-label-secondary, #aaa)",
                fontSize: 12,
                lineHeight: 1.55
              },
              children: selectedHint
            })
          ]
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
                marginBottom: 4
              },
              children: label
            }),
            description && /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)"
              },
              children: description
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
                boxSizing: "border-box"
              }
            }),
            recommendation && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                marginTop: 7,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                fontSize: 12,
                lineHeight: 1.55
              },
              children: `\u5EFA\u8BAE\uFF1A${recommendation}`
            })
          ]
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
              children: "\u89C6\u89C9\u6A21\u578B"
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: { margin: "0 0 8px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: "\u53EF\u4ECE\u5F53\u524D Base URL \u7684 /models \u83B7\u53D6\u6A21\u578B\u5E76\u641C\u7D22\u9009\u62E9\uFF1B\u82E5\u670D\u52A1\u4E0D\u63D0\u4F9B\u76EE\u5F55\uFF0C\u4E5F\u53EF\u5728\u4E0B\u65B9\u624B\u52A8\u586B\u5199\u6A21\u578B ID\u3002"
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
                    whiteSpace: "nowrap"
                  },
                  children: status.kind === "loading" ? "\u52A0\u8F7D\u4E2D\u2026" : options.length > 0 ? "\u5237\u65B0\u6A21\u578B" : "\u52A0\u8F7D\u6A21\u578B"
                }),
                options.length > 0 && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
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
                    whiteSpace: "nowrap"
                  },
                  children: `\u6A21\u578B\u5217\u8868 (${options.length}) ${open ? "\u2303" : "\u2304"}`
                })
              ]
            }),
            status.text && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                marginTop: 7,
                color: status.kind === "error" ? "#f87171" : "var(--dsw-alias-label-tertiary, #888)",
                fontSize: 12,
                lineHeight: 1.5
              },
              children: status.text
            }),
            open && /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: {
                marginTop: 9,
                border: "1px solid var(--dsw-alias-border-l2, #444)",
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--dsw-alias-bg-layer-2, #2a2a2a)"
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("input", {
                  type: "search",
                  value: query,
                  placeholder: "\u641C\u7D22\u6A21\u578B\u540D\u79F0\u6216 ID\u2026",
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
                    boxSizing: "border-box"
                  }
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  style: { maxHeight: 220, overflowY: "auto", padding: 4 },
                  children: filteredOptions.length > 0 ? filteredOptions.map(
                    (model) => /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
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
                        fontSize: 13
                      },
                      children: [model, model === value && "  \u2713"]
                    }, model)
                  ) : /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: { padding: "12px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                    children: options.length === 0 ? "\u5C1A\u672A\u52A0\u8F7D\u5230\u6A21\u578B\u3002\u8BF7\u68C0\u67E5 Base URL \u548C API Key \u540E\u70B9\u51FB\u201C\u52A0\u8F7D\u6A21\u578B\u201D\u3002" : "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B\u3002"
                  })
                })
              ]
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("label", {
              style: { display: "block", marginTop: 10, fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" },
              children: "\u81EA\u5B9A\u4E49\u6A21\u578B ID"
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("input", {
              type: "text",
              value,
              placeholder: "\u4F8B\u5982 vision-model \u6216 gpt-4o",
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
                boxSizing: "border-box"
              }
            })
          ]
        });
      }
      function VisionModelSelector({ groups, enabledModels, catalogStatus, modelSyncStatus, toggleModel, refreshCatalog }) {
        const [expandedProviders, setExpandedProviders] = useState(() => /* @__PURE__ */ new Set());
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
            marginBottom: 16
          },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      style: { fontSize: 13, fontWeight: 600 },
                      children: "\u{1FA9F} \u5BF9\u8BDD\u89C6\u89C9\u6A21\u578B"
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      style: { marginTop: 4, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                      children: `\u5DF2\u542F\u7528 ${enabled.size} \u4E2A\u6A21\u578B\uFF1B\u4EC5\u52FE\u9009\u7684\u6A21\u578B\u4F1A\u663E\u793A [vision]\u3002`
                    })
                  ]
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
                    whiteSpace: "nowrap"
                  },
                  children: "\u5237\u65B0"
                })
              ]
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: { margin: "0 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-secondary, #aaa)" },
              children: "\u9009\u62E9\u9700\u8981\u7531\u5916\u90E8\u89C6\u89C9\u6A21\u578B\u589E\u5F3A\u7684\u7EAF\u6587\u672C\u5BF9\u8BDD\u6A21\u578B\u3002\u9009\u62E9\u4F1A\u7ACB\u5373\u4FDD\u5B58\uFF1B\u91CD\u65B0\u6253\u5F00\u6A21\u578B\u5217\u8868\u540E\u5373\u53EF\u4F7F\u7528\u3002"
            }),
            modelSyncStatus.text && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: {
                margin: "0 0 10px",
                fontSize: 12,
                color: modelSyncStatus.kind === "saved" ? "#4ade80" : modelSyncStatus.kind === "error" ? "#f87171" : "var(--dsw-alias-label-tertiary, #888)"
              },
              children: modelSyncStatus.text
            }),
            catalogStatus.kind === "loading" && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: catalogStatus.text
            }),
            catalogStatus.kind === "error" && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "#f87171", lineHeight: 1.5 },
              children: catalogStatus.text
            }),
            catalogStatus.kind === "ready" && groups.length === 0 && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: "\u5F53\u524D\u6CA1\u6709\u53EF\u9009\u62E9\u7684\u6A21\u578B\u3002\u8BF7\u5148\u5728\u201C\u6A21\u578B\u201D\u8BBE\u7F6E\u4E2D\u5B8C\u6210\u81F3\u5C11\u4E00\u4E2A Provider \u914D\u7F6E\u3002"
            }),
            catalogStatus.kind === "ready" && groups.map((group) => {
              const models = Array.isArray(group.models) ? group.models : [];
              const providerEnabledCount = models.filter((model) => enabled.has(routeKey(group.id, model.id))).length;
              const expanded = expandedProviders.has(group.id);
              return /* @__PURE__ */ reactJsxRuntime.jsxs("section", {
                style: {
                  borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
                  marginTop: 10,
                  paddingTop: 10
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
                      textAlign: "left"
                    },
                    children: [
                      /* @__PURE__ */ reactJsxRuntime.jsxs("span", {
                        style: { display: "flex", minWidth: 0, flexDirection: "column", gap: 2 },
                        children: [
                          /* @__PURE__ */ reactJsxRuntime.jsx("span", { style: { fontSize: 13, fontWeight: 600 }, children: group.name || group.id }),
                          /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                            style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                            children: providerEnabledCount > 0 ? `${models.length} \u4E2A\u6A21\u578B \xB7 \u5DF2\u542F\u7528 ${providerEnabledCount} \u4E2A` : `${models.length} \u4E2A\u6A21\u578B`
                          })
                        ]
                      }),
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 16 },
                        children: expanded ? "\u2303" : "\u2304"
                      })
                    ]
                  }),
                  expanded && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
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
                          fontSize: 13
                        },
                        children: [
                          /* @__PURE__ */ reactJsxRuntime.jsx("input", {
                            type: "checkbox",
                            checked: enabled.has(key),
                            onChange: () => toggleModel(group.id, model.id)
                          }),
                          /* @__PURE__ */ reactJsxRuntime.jsx("span", { children: model.name }),
                          model.name !== model.id && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                            style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12 },
                            children: `(${model.id})`
                          })
                        ]
                      }, key);
                    })
                  })
                ]
              }, group.id);
            })
          ]
        });
      }
      function apply(ctx) {
        credentialApi = getCredentialApi(ctx);
        connectionApi = getConnectionApi(ctx);
        ctx.slots.inject(
          "settings.section",
          () => ctx.slots.register(
            {
              name: "settings.section",
              id: "tool-visual-primitives",
              order: 100,
              label: () => "\u89C6\u89C9\u5206\u6790"
            },
            VisionSettings
          )
        );
      }
      exports.apply = apply;
      exports.inject = ["slots"];
      return module.exports;
    }
  });
})();
