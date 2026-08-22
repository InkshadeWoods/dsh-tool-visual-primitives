(() => {
  // client/index.js
  window.__ModuleLoader__.load({
    id: "dsh-tool-visual-primitives",
    factory: (require2) => {
      var module = { exports: {} };
      var exports = module.exports;
      const react = require2("react");
      const reactJsxRuntime = require2("react/jsx-runtime");
      const { useState, useEffect, useCallback, useRef } = react;
      const NS = "dsh-tool-visual-primitives.settings";
      const STORAGE_KEY = `${NS}.state`;
      const UI_PREFERENCES_KEY = `${NS}.ui`;
      const UI_PREFERENCES_VERSION = 2;
      const CONNECTION_TEST_KEY = `${NS}.connection-test`;
      const TEST_ROUTE_PATH = "/visual-primitives/api/test-connection";
      const VISION_MODEL_CATALOG_ROUTE_PATH = "/visual-primitives/api/models";
      const SETTINGS_ROUTE_PATH = "/visual-primitives/api/settings";
      const BYTES_PER_MEGABYTE = 1024 * 1024;
      const CREDENTIAL_SYNC_DELAY_MS = 400;
      const CONFIRM_ACTION_TIMEOUT_MS = 4e3;
      const MODEL_OPTION_PREVIEW_LIMIT = 100;
      const UI_MOTION_MS = 220;
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
        logDiagnostics: "off",
        enabledModels: []
      };
      const PERSISTED_KEYS = Object.keys(FALLBACKS).filter((key) => key !== "apiKey");
      const ANALYSIS_SETTING_KEYS = ["primitives", "detail", "retry", "maxImageBytes", "timeoutMs", "maxTokensMode", "maxTokens", "logDiagnostics"];
      let credentialSyncQueue = Promise.resolve();
      function normalizeEnabledModels(value) {
        let entries = value;
        if (typeof value === "string") {
          try {
            entries = JSON.parse(value);
          } catch {
            entries = [];
          }
        }
        if (!Array.isArray(entries)) return [];
        const seen = /* @__PURE__ */ new Set();
        return entries.flatMap((entry) => {
          const provider = typeof entry?.provider === "string" ? entry.provider.trim() : "";
          const model = typeof entry?.model === "string" ? entry.model.trim() : "";
          const key = routeKey(provider, model);
          if (!provider || !model || provider === "visual-primitives" || seen.has(key)) return [];
          seen.add(key);
          return [{ provider, model }];
        });
      }
      function normalizeNumber(value, fallback) {
        if (value === null || value === void 0 || String(value).trim() === "") return fallback;
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      }
      function normalizeOption(value, fallback, values) {
        const normalized = String(value ?? "").trim().toLowerCase();
        return values.includes(normalized) ? normalized : fallback;
      }
      function getConnectionRequirements(state, apiKeyConfigured, needsModel) {
        const missing = [];
        if (!apiKeyConfigured && !state.apiKey.trim()) missing.push("API Key");
        if (!state.baseUrl.trim()) missing.push("Base URL");
        if (needsModel && !state.model.trim()) missing.push("\u89C6\u89C9\u6A21\u578B");
        return missing;
      }
      function connectionFingerprint(state, apiKeyConfigured) {
        return JSON.stringify({
          apiKeyConfigured: apiKeyConfigured || Boolean(state.apiKey.trim()),
          baseUrl: state.baseUrl.trim(),
          model: state.model.trim()
        });
      }
      function loadConnectionTestStatus() {
        try {
          const parsed = JSON.parse(localStorage.getItem(CONNECTION_TEST_KEY) || "null");
          if (parsed?.kind === "ok" && typeof parsed.at === "number" && typeof parsed.fingerprint === "string") return parsed;
        } catch {
        }
        return { kind: "idle", fingerprint: "", at: null };
      }
      function saveConnectionTestStatus(status) {
        try {
          if (status.kind === "ok") localStorage.setItem(CONNECTION_TEST_KEY, JSON.stringify(status));
          else localStorage.removeItem(CONNECTION_TEST_KEY);
        } catch {
        }
      }
      function describeAdvancedChanges(state) {
        const changes = [];
        if (state.retry !== FALLBACKS.retry) changes.push(`\u91CD\u8BD5\uFF1A${state.retry === "format-only" ? "\u4EC5\u683C\u5F0F" : "\u5F00\u542F"}`);
        if (state.maxImageBytes !== FALLBACKS.maxImageBytes) changes.push(`\u56FE\u7247\uFF1A${Math.round(state.maxImageBytes / BYTES_PER_MEGABYTE)} MB`);
        if (state.timeoutMs !== FALLBACKS.timeoutMs) changes.push(`\u8D85\u65F6\uFF1A${Math.round(state.timeoutMs / 1e3)} \u79D2`);
        if (state.maxTokensMode !== FALLBACKS.maxTokensMode || state.maxTokens !== FALLBACKS.maxTokens) changes.push(`Token\uFF1A${state.maxTokensMode === "auto" ? "\u81EA\u52A8" : state.maxTokens}`);
        if (state.logDiagnostics !== FALLBACKS.logDiagnostics) changes.push(`\u8BCA\u65AD\u65E5\u5FD7\uFF1A${state.logDiagnostics === "on" ? "\u5F00\u542F" : "\u5173\u95ED"}`);
        return changes;
      }
      function loadSectionPreferences() {
        try {
          const raw = localStorage.getItem(UI_PREFERENCES_KEY);
          if (!raw) return { hasSavedPreference: false, sections: { connection: false, advanced: false, bridge: false } };
          const parsed = JSON.parse(raw);
          const hasCurrentPreference = parsed && typeof parsed === "object" && parsed.version === UI_PREFERENCES_VERSION;
          return {
            hasSavedPreference: hasCurrentPreference,
            sections: {
              connection: hasCurrentPreference && parsed.connection === true,
              advanced: hasCurrentPreference && parsed.advanced === true,
              bridge: hasCurrentPreference && parsed.bridge === true
            }
          };
        } catch {
          return { hasSavedPreference: false, sections: { connection: false, advanced: false, bridge: false } };
        }
      }
      function saveSectionPreferences(sections) {
        try {
          localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ version: UI_PREFERENCES_VERSION, ...sections }));
        } catch {
        }
      }
      function normalizeState(raw) {
        const persisted = raw && typeof raw === "object" ? raw : {};
        const maxTokensValue = persisted.maxTokens;
        const hasMaxTokensValue = maxTokensValue !== null && maxTokensValue !== void 0 && String(maxTokensValue).trim() !== "";
        const maxTokensMode = String(maxTokensValue ?? "").trim().toLowerCase() === "auto" ? "auto" : hasMaxTokensValue && Number.isFinite(Number(maxTokensValue)) ? "manual" : FALLBACKS.maxTokensMode;
        return {
          ...FALLBACKS,
          ...Object.fromEntries(PERSISTED_KEYS.map((key) => [key, persisted[key]]).filter(([, value]) => value !== void 0)),
          apiKey: "",
          primitives: normalizeOption(persisted.primitives, FALLBACKS.primitives, ["auto", "on", "off"]),
          detail: normalizeOption(persisted.detail, FALLBACKS.detail, ["brief", "standard", "verbose"]),
          retry: normalizeOption(persisted.retry, FALLBACKS.retry, ["off", "on", "format-only"]),
          logDiagnostics: normalizeOption(persisted.logDiagnostics, FALLBACKS.logDiagnostics, ["off", "on"]),
          enabledModels: normalizeEnabledModels(persisted.enabledModels),
          maxImageBytes: normalizeNumber(persisted.maxImageBytes, FALLBACKS.maxImageBytes),
          timeoutMs: normalizeNumber(persisted.timeoutMs, FALLBACKS.timeoutMs),
          maxTokensMode,
          maxTokens: normalizeNumber(maxTokensValue, FALLBACKS.maxTokens)
        };
      }
      function loadDraft() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return { state: { ...FALLBACKS }, dirtyKeys: /* @__PURE__ */ new Set() };
          const parsed = JSON.parse(raw);
          const dirtyKeys = new Set(
            Array.isArray(parsed.dirtyKeys) ? parsed.dirtyKeys.filter((key) => PERSISTED_KEYS.includes(key)) : []
          );
          return { state: normalizeState(parsed), dirtyKeys };
        } catch (error) {
          console.warn("[dsh-tool-visual-primitives] \u672C\u5730\u8349\u7A3F\u89E3\u6790\u5931\u8D25\uFF0C\u5DF2\u91CD\u7F6E\uFF1A", error);
          return { state: { ...FALLBACKS }, dirtyKeys: /* @__PURE__ */ new Set() };
        }
      }
      function saveDraft(state, dirtyKeys) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...state,
            apiKey: "",
            dirtyKeys: [...dirtyKeys].filter((key) => key !== "apiKey")
          }));
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
          ["VISION_LOG_DIAGNOSTICS", state.logDiagnostics, "logDiagnostics"],
          ["VISION_ENABLED_MODELS", JSON.stringify(state.enabledModels), "enabledModels"]
        ];
        for (const [ref, value, key] of entries) {
          if (!touchedKeys.has(key) && !(key === "maxTokens" && touchedKeys.has("maxTokensMode"))) continue;
          const trimmed = String(value || "").trim();
          if (!trimmed && key === "apiKey") continue;
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
      function queueCredentialUnset(api, ref) {
        if (!api?.unset) return Promise.reject(new Error("DSH \u51ED\u636E\u670D\u52A1\u6682\u4E0D\u53EF\u7528"));
        const run = credentialSyncQueue.catch(() => void 0).then(async () => {
          const response = await api.unset({ ref });
          if (!response?.result?.ok) throw new Error(response?.result?.error?.message || `\u65E0\u6CD5\u6E05\u9664 ${ref}`);
        });
        credentialSyncQueue = run.catch(() => void 0);
        return run;
      }
      async function loadPersistedSettings() {
        const response = await fetch(SETTINGS_ROUTE_PATH, { headers: { Accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.error || `\u8BBE\u7F6E\u8BFB\u53D6\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
        }
        return {
          state: normalizeState(payload.settings),
          apiKeyConfigured: payload.apiKeyConfigured === true
        };
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
      async function testConnection() {
        try {
          const res = await fetch(TEST_ROUTE_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
          return { ok: true, elapsedMs: data.elapsedMs ?? null };
        } catch (err) {
          throw new Error(err instanceof Error ? err.message : String(err));
        }
      }
      function VisionSettings() {
        const [initialDraft] = useState(loadDraft);
        const [initialSectionPreferences] = useState(loadSectionPreferences);
        const [initialConnectionTest] = useState(loadConnectionTestStatus);
        const [state, setState] = useState(() => initialDraft.state);
        const [expandedSections, setExpandedSections] = useState(() => initialSectionPreferences.sections);
        const [status, setStatus] = useState({ kind: "idle", text: "" });
        const [saveStatus, setSaveStatus] = useState({ kind: "idle", text: "" });
        const [testing, setTesting] = useState(false);
        const [connectionTestStatus, setConnectionTestStatus] = useState(() => initialConnectionTest);
        const [lastTestedApiKeyRevision, setLastTestedApiKeyRevision] = useState(null);
        const [connectionTransition, setConnectionTransition] = useState(null);
        const [confirmClear, setConfirmClear] = useState(false);
        const [confirmReset, setConfirmReset] = useState(false);
        const [settingsReady, setSettingsReady] = useState(false);
        const [saveRetry, setSaveRetry] = useState(0);
        const [touchedKeys, setTouchedKeys] = useState(() => new Set(initialDraft.dirtyKeys));
        const [apiKeyStatus, setApiKeyStatus] = useState({ kind: "loading", configured: false });
        const [modelSyncStatus, setModelSyncStatus] = useState({ kind: "idle", text: "" });
        const [modelGroups, setModelGroups] = useState([]);
        const [catalogStatus, setCatalogStatus] = useState({ kind: "loading", text: "\u6B63\u5728\u52A0\u8F7D\u53EF\u9009\u6A21\u578B\u2026" });
        const [visionModelOptions, setVisionModelOptions] = useState([]);
        const [visionModelStatus, setVisionModelStatus] = useState({ kind: "idle", text: "\u70B9\u51FB\u201C\u52A0\u8F7D\u6A21\u578B\u201D\u83B7\u53D6\u5F53\u524D\u89C6\u89C9\u670D\u52A1\u7684 /models \u5217\u8868\u3002" });
        const stateRef = useRef(state);
        const dirtyKeysRef = useRef(new Set(initialDraft.dirtyKeys));
        const revisionsRef = useRef(/* @__PURE__ */ new Map());
        const nextRevisionRef = useRef(0);
        const saveTimerRef = useRef(null);
        const retryTimerRef = useRef(null);
        const connectionTransitionTimerRef = useRef(null);
        const connectionRequirements = getConnectionRequirements(state, apiKeyStatus.configured, true);
        const canTestConnection = connectionRequirements.length === 0;
        const connectionReady = apiKeyStatus.configured && Boolean(state.baseUrl.trim()) && Boolean(state.model.trim());
        const currentConnectionFingerprint = connectionFingerprint(state, apiKeyStatus.configured);
        const apiKeyHasChangedSinceTest = lastTestedApiKeyRevision !== null && (revisionsRef.current.get("apiKey") || 0) > lastTestedApiKeyRevision;
        const connectionTestIsStale = connectionTestStatus.kind === "ok" && (connectionTestStatus.fingerprint !== currentConnectionFingerprint || apiKeyHasChangedSinceTest);
        const availableBridgeRoutes = catalogStatus.kind === "ready" ? new Set(modelGroups.flatMap((group) => (Array.isArray(group.models) ? group.models : []).map((model) => routeKey(group.id, model.id)))) : null;
        const unavailableEnabledModels = availableBridgeRoutes ? state.enabledModels.filter((entry) => !availableBridgeRoutes.has(routeKey(entry.provider, entry.model))) : [];
        const connectionHasPendingChanges = ["apiKey", "baseUrl", "model"].some((key) => touchedKeys.has(key));
        const commonHasPendingChanges = ["primitives", "detail"].some((key) => touchedKeys.has(key));
        const advancedHasPendingChanges = ANALYSIS_SETTING_KEYS.some((key) => touchedKeys.has(key));
        const bridgeHasPendingChanges = touchedKeys.has("enabledModels");
        const sectionSaveHint = (hasPendingChanges) => {
          if (!hasPendingChanges) return "";
          if (saveStatus.kind === "error") return " \xB7 \u4FDD\u5B58\u5931\u8D25";
          return saveStatus.kind === "saving" ? " \xB7 \u6B63\u5728\u4FDD\u5B58" : " \xB7 \u5F85\u4FDD\u5B58";
        };
        const pendingSnapshotRef = useRef(null);
        useEffect(() => {
          stateRef.current = state;
        }, [state]);
        useEffect(() => {
          saveSectionPreferences(expandedSections);
        }, [expandedSections]);
        useEffect(() => {
          saveConnectionTestStatus(connectionTestStatus);
        }, [connectionTestStatus]);
        useEffect(() => {
          if (initialSectionPreferences.hasSavedPreference || apiKeyStatus.kind !== "ready") return;
          setExpandedSections((previous) => ({ ...previous, connection: !connectionReady }));
        }, [apiKeyStatus.kind, connectionReady, initialSectionPreferences.hasSavedPreference]);
        const toggleSection = (section) => {
          setExpandedSections((previous) => ({ ...previous, [section]: !previous[section] }));
        };
        const toggleConnectionSection = useCallback(() => {
          if (connectionTransition) return;
          const opening = !expandedSections.connection;
          const reduceMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (connectionTransitionTimerRef.current) clearTimeout(connectionTransitionTimerRef.current);
          if (!reduceMotion) setConnectionTransition(opening ? "opening" : "closing");
          setExpandedSections((previous) => ({ ...previous, connection: !previous.connection }));
          if (!reduceMotion) {
            connectionTransitionTimerRef.current = setTimeout(() => {
              connectionTransitionTimerRef.current = null;
              setConnectionTransition(null);
            }, UI_MOTION_MS);
          }
        }, [connectionTransition, expandedSections.connection]);
        useEffect(() => () => {
          if (connectionTransitionTimerRef.current) clearTimeout(connectionTransitionTimerRef.current);
        }, []);
        const clearSavedKeys = useCallback((snapshot) => {
          setTouchedKeys((previous) => {
            const next = new Set(previous);
            for (const key of snapshot.touchedKeys) {
              if (revisionsRef.current.get(key) === snapshot.revisions.get(key)) {
                next.delete(key);
                dirtyKeysRef.current.delete(key);
              }
            }
            return next;
          });
        }, []);
        const persistSnapshot = useCallback(async (snapshot) => {
          setSaveStatus({ kind: "saving", text: "\u6B63\u5728\u4FDD\u5B58\u2026" });
          try {
            await queueCredentialSync(credentialApi, snapshot.state, snapshot.touchedKeys);
            clearSavedKeys(snapshot);
            if (retryTimerRef.current) {
              clearTimeout(retryTimerRef.current);
              retryTimerRef.current = null;
            }
            setSaveStatus({ kind: "saved", text: "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58" });
            if (snapshot.touchedKeys.has("enabledModels")) {
              setModelSyncStatus({ kind: "saved", text: "\u5DF2\u4FDD\u5B58\u5230 DSH\uFF1B\u91CD\u65B0\u6253\u5F00\u5BF9\u8BDD\u6A21\u578B\u5217\u8868\u5373\u53EF\u770B\u5230 [vision]\u3002" });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSaveStatus({ kind: "error", text: `\u4FDD\u5B58\u5931\u8D25\uFF1A${message}\uFF1B\u5C06\u5728 3 \u79D2\u540E\u91CD\u8BD5\u3002` });
            if (snapshot.touchedKeys.has("enabledModels")) {
              setModelSyncStatus({ kind: "error", text: `\u4FDD\u5B58\u5931\u8D25\uFF1A${message}` });
            }
            if (!retryTimerRef.current) {
              retryTimerRef.current = setTimeout(() => {
                retryTimerRef.current = null;
                setSaveRetry((value) => value + 1);
              }, 3e3);
            }
            throw error;
          }
        }, [clearSavedKeys]);
        const saveCurrentChanges = useCallback(async () => {
          const keys = new Set(dirtyKeysRef.current);
          if (keys.size === 0) return;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          const snapshot = {
            state: { ...stateRef.current },
            touchedKeys: keys,
            revisions: new Map([...keys].map((key) => [key, revisionsRef.current.get(key)]))
          };
          pendingSnapshotRef.current = null;
          await persistSnapshot(snapshot);
        }, [persistSnapshot]);
        const retrySaving = useCallback(() => {
          void saveCurrentChanges().catch(() => void 0);
        }, [saveCurrentChanges]);
        useEffect(() => {
          let cancelled = false;
          void loadPersistedSettings().then((remote) => {
            if (cancelled) return;
            setState((previous) => {
              const merged = { ...remote.state };
              for (const key of dirtyKeysRef.current) merged[key] = previous[key];
              return merged;
            });
            setApiKeyStatus({ kind: "ready", configured: remote.apiKeyConfigured });
            setSettingsReady(true);
          }).catch((error) => {
            if (cancelled) return;
            setApiKeyStatus({ kind: "unknown", configured: false });
            setStatus({ kind: "error", text: `\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u8BBE\u7F6E\uFF1A${error instanceof Error ? error.message : String(error)}\u3002\u53EF\u7EE7\u7EED\u7F16\u8F91\uFF0C\u6062\u590D\u540E\u4F1A\u81EA\u52A8\u91CD\u8BD5\u4FDD\u5B58\u3002` });
            setSettingsReady(true);
          });
          return () => {
            cancelled = true;
          };
        }, []);
        useEffect(() => {
          saveDraft(state, touchedKeys);
        }, [state, touchedKeys]);
        useEffect(() => {
          if (!settingsReady || touchedKeys.size === 0) {
            pendingSnapshotRef.current = null;
            return;
          }
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          const snapshot = {
            state: { ...state },
            touchedKeys: new Set(touchedKeys),
            revisions: new Map([...touchedKeys].map((key) => [key, revisionsRef.current.get(key)]))
          };
          pendingSnapshotRef.current = snapshot;
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            pendingSnapshotRef.current = null;
            void persistSnapshot(snapshot).catch(() => void 0);
          }, CREDENTIAL_SYNC_DELAY_MS);
          return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          };
        }, [state, touchedKeys, settingsReady, saveRetry, persistSnapshot]);
        useEffect(() => () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          const pending = pendingSnapshotRef.current;
          if (pending?.touchedKeys.has("apiKey")) {
            void queueCredentialSync(credentialApi, pending.state, pending.touchedKeys).catch(() => void 0);
          }
        }, []);
        const update = (key, value) => {
          nextRevisionRef.current += 1;
          revisionsRef.current.set(key, nextRevisionRef.current);
          dirtyKeysRef.current.add(key);
          setTouchedKeys((previous) => /* @__PURE__ */ new Set([...previous, key]));
          setState((prev) => ({ ...prev, [key]: value }));
        };
        const updateMany = (values) => {
          const entries = Object.entries(values);
          for (const [key] of entries) {
            nextRevisionRef.current += 1;
            revisionsRef.current.set(key, nextRevisionRef.current);
            dirtyKeysRef.current.add(key);
          }
          setTouchedKeys((previous) => /* @__PURE__ */ new Set([...previous, ...entries.map(([key]) => key)]));
          setState((previous) => ({ ...previous, ...values }));
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
          const missing = getConnectionRequirements(stateRef.current, apiKeyStatus.configured, false);
          if (missing.length > 0) {
            setVisionModelStatus({ kind: "error", text: `\u8BF7\u5148\u586B\u5199\u6216\u4FDD\u5B58\uFF1A${missing.join("\u3001")}\u3002` });
            return;
          }
          try {
            setVisionModelStatus({ kind: "loading", text: "\u6B63\u5728\u4FDD\u5B58\u8FDE\u63A5\u8BBE\u7F6E\u2026" });
            await saveCurrentChanges();
            setVisionModelStatus({ kind: "loading", text: "\u8FDE\u63A5\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u6B63\u5728\u8BFB\u53D6 /models\u2026" });
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
        }, [apiKeyStatus.configured, saveCurrentChanges]);
        const toggleVisionModel = (provider, model) => {
          const key = routeKey(provider, model);
          const exists = state.enabledModels.some((entry) => routeKey(entry.provider, entry.model) === key);
          const enabledModels = exists ? state.enabledModels.filter((entry) => routeKey(entry.provider, entry.model) !== key) : [...state.enabledModels, { provider, model }];
          update("enabledModels", enabledModels);
          setModelSyncStatus({ kind: "saving", text: "\u5C06\u5728\u77ED\u6682\u7F16\u8F91\u505C\u987F\u540E\u4FDD\u5B58\u5BF9\u8BDD\u89C6\u89C9\u6A21\u578B\u2026" });
        };
        const runConnectionTest = useCallback(async ({ saveFirst }) => {
          if (!canTestConnection) {
            setStatus({ kind: "error", text: `\u6D4B\u8BD5\u524D\u8BF7\u5148\u5B8C\u6210\uFF1A${connectionRequirements.join("\u3001")}\u3002` });
            return;
          }
          setTesting(true);
          setStatus({ kind: "loading", text: saveFirst ? "\u6B63\u5728\u4FDD\u5B58\u5E76\u6D4B\u8BD5\u8FDE\u63A5\u2026" : "\u6B63\u5728\u6D4B\u8BD5\u5DF2\u4FDD\u5B58\u7684\u8FDE\u63A5\u2026" });
          const testFingerprint = connectionFingerprint(stateRef.current, apiKeyStatus.configured);
          try {
            if (saveFirst) {
              try {
                await saveCurrentChanges();
              } catch (error) {
                throw new Error(`\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
              }
            }
            const result = await testConnection();
            const currentFingerprint = connectionFingerprint(stateRef.current, apiKeyStatus.configured);
            if (currentFingerprint === testFingerprint) {
              setConnectionTestStatus({ kind: "ok", fingerprint: testFingerprint, at: Date.now(), elapsedMs: result.elapsedMs });
              setLastTestedApiKeyRevision(revisionsRef.current.get("apiKey") || 0);
              setStatus({ kind: "ok", text: `\u8FDE\u63A5\u6B63\u5E38${result.elapsedMs === null ? "" : ` \xB7 ${result.elapsedMs}ms`}` });
            } else {
              setStatus({ kind: "ok", text: "\u8FDE\u63A5\u5DF2\u6D4B\u8BD5\uFF0C\u4F46\u914D\u7F6E\u5DF2\u5728\u6D4B\u8BD5\u671F\u95F4\u4FEE\u6539\uFF1B\u8BF7\u91CD\u65B0\u6D4B\u8BD5\u3002" });
            }
            await refreshApiKeyStatus();
          } catch (error) {
            setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
          } finally {
            setTesting(false);
          }
        }, [apiKeyStatus.configured, canTestConnection, connectionRequirements, saveCurrentChanges, refreshApiKeyStatus]);
        const onTestSavedConnection = useCallback(async () => {
          if (connectionHasPendingChanges) {
            setStatus({ kind: "error", text: "\u8FDE\u63A5\u8BBE\u7F6E\u5C1A\u672A\u4FDD\u5B58\uFF1B\u8BF7\u5C55\u5F00\u540E\u4F7F\u7528\u300C\u4FDD\u5B58\u5E76\u6D4B\u8BD5\u8FDE\u63A5\u300D\u3002" });
            return;
          }
          await runConnectionTest({ saveFirst: false });
        }, [connectionHasPendingChanges, runConnectionTest]);
        const onSaveAndTestConnection = useCallback(async () => {
          await runConnectionTest({ saveFirst: true });
        }, [runConnectionTest]);
        const clearApiKey = useCallback(async () => {
          if (!confirmClear) {
            setConfirmClear(true);
            return;
          }
          setConfirmClear(false);
          try {
            await queueCredentialUnset(credentialApi, "VISION_API_KEY");
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            pendingSnapshotRef.current = null;
            setState((previous) => ({ ...previous, apiKey: "" }));
            dirtyKeysRef.current.delete("apiKey");
            setTouchedKeys((previous) => {
              const next = new Set(previous);
              next.delete("apiKey");
              return next;
            });
            setStatus({ kind: "ok", text: "\u5DF2\u6E05\u9664\u4FDD\u5B58\u7684 API Key" });
            await refreshApiKeyStatus();
          } catch (error) {
            setStatus({ kind: "error", text: `\u6E05\u9664\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
          }
        }, [confirmClear, refreshApiKeyStatus]);
        useEffect(() => {
          if (!confirmClear) return;
          const timer = setTimeout(() => setConfirmClear(false), CONFIRM_ACTION_TIMEOUT_MS);
          return () => clearTimeout(timer);
        }, [confirmClear]);
        const resetAnalysisSettings = useCallback(() => {
          if (!confirmReset) {
            setConfirmReset(true);
            setExpandedSections((previous) => ({ ...previous, advanced: true }));
            return;
          }
          setConfirmReset(false);
          updateMany(Object.fromEntries(ANALYSIS_SETTING_KEYS.map((key) => [key, FALLBACKS[key]])));
          setStatus({ kind: "ok", text: "\u5206\u6790\u53C2\u6570\u5DF2\u6062\u590D\u9ED8\u8BA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u3002" });
        }, [confirmReset]);
        useEffect(() => {
          if (!confirmReset) return;
          const timer = setTimeout(() => setConfirmReset(false), CONFIRM_ACTION_TIMEOUT_MS);
          return () => clearTimeout(timer);
        }, [confirmReset]);
        return /* @__PURE__ */ reactJsxRuntime.jsxs(
          "div",
          {
            className: "vision-settings",
            style: {
              padding: "20px 24px",
              maxWidth: 720,
              margin: "0 auto",
              color: "var(--dsw-alias-label-primary, #e0e0e0)",
              fontFamily: "var(--dsw-alias-font-body, system-ui, sans-serif)"
            },
            children: [
              /* @__PURE__ */ reactJsxRuntime.jsx(SettingsUiStyles, {}),
              /* header */
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 20
                },
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                    children: [
                      /* @__PURE__ */ reactJsxRuntime.jsx("h2", {
                        style: {
                          margin: 0,
                          fontSize: 18,
                          fontWeight: 600,
                          color: "var(--dsw-alias-label-primary, #e0e0e0)"
                        },
                        children: "\u89C6\u89C9\u5206\u6790"
                      }),
                      /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                        style: { margin: "4px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "\u4E3A\u4E0D\u652F\u6301\u56FE\u7247\u7684\u5BF9\u8BDD\u6A21\u578B\u8865\u5145\u53EF\u5F15\u7528\u7684\u89C6\u89C9\u8BC1\u636E\u3002"
                      })
                    ]
                  }),
                  /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                    style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 },
                    children: [
                      saveStatus.kind !== "idle" && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        role: "status",
                        "aria-live": "polite",
                        className: "vision-save-status",
                        style: {
                          display: "inline-flex",
                          alignItems: "center",
                          minHeight: 28,
                          padding: "4px 8px",
                          border: "1px solid " + (saveStatus.kind === "saved" ? "rgba(74,222,128,0.34)" : saveStatus.kind === "error" ? "rgba(248,113,113,0.44)" : "var(--dsw-alias-border-l2, #444)"),
                          borderRadius: 999,
                          background: saveStatus.kind === "saved" ? "rgba(34,197,94,0.08)" : saveStatus.kind === "error" ? "rgba(239,68,68,0.09)" : "var(--dsw-alias-bg-layer-2, #2a2a2a)",
                          fontSize: 12,
                          color: saveStatus.kind === "saved" ? "#4ade80" : saveStatus.kind === "error" ? "#f87171" : "var(--dsw-alias-label-tertiary, #888)"
                        },
                        children: saveStatus.text
                      }),
                      saveStatus.kind === "error" && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                        type: "button",
                        onClick: retrySaving,
                        style: {
                          minHeight: 28,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(248,113,113,0.6)",
                          background: "transparent",
                          color: "#fca5a5",
                          cursor: "pointer",
                          fontSize: 12,
                          whiteSpace: "nowrap"
                        },
                        children: "\u7ACB\u5373\u91CD\u8BD5"
                      })
                    ]
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
                role: status.kind === "error" ? "alert" : "status",
                "aria-live": status.kind === "error" ? "assertive" : "polite",
                children: status.text
              }),
              apiKeyStatus.kind === "ready" && /* @__PURE__ */ reactJsxRuntime.jsx(SetupGuide, {
                state,
                apiKeyConfigured: apiKeyStatus.configured
              }),
              /* connection: concise status by default, editable only on demand */
              /* @__PURE__ */ reactJsxRuntime.jsx(SettingsSection, {
                id: "vision-connection-settings",
                title: "\u8FDE\u63A5\u8BBE\u7F6E",
                summary: (connectionReady ? connectionTestIsStale ? `\u914D\u7F6E\u5DF2\u53D8\u66F4 \xB7 \u5F85\u91CD\u65B0\u6D4B\u8BD5 \xB7 ${state.model}` : connectionTestStatus.kind === "ok" ? `\u5DF2\u9A8C\u8BC1 \xB7 ${state.model} \xB7 ${state.baseUrl.replace(/^https?:\/\//, "")} \xB7 ${new Date(connectionTestStatus.at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : `\u5F85\u9A8C\u8BC1 \xB7 ${state.model} \xB7 ${state.baseUrl.replace(/^https?:\/\//, "")}` : "\u5B8C\u6210 API Key\u3001Base URL \u4E0E\u89C6\u89C9\u6A21\u578B\u540E\u5373\u53EF\u4F7F\u7528") + sectionSaveHint(connectionHasPendingChanges),
                expanded: expandedSections.connection,
                onToggle: toggleConnectionSection,
                contentVisible: expandedSections.connection || connectionTransition === "closing",
                contentTransition: connectionTransition,
                action: (!expandedSections.connection || connectionTransition === "opening" || connectionTransition === "closing") && connectionReady ? /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  className: "vision-primary-action vision-connection-header-test" + (connectionTransition === "opening" ? " vision-action-fade-out" : connectionTransition === "closing" ? " vision-action-fade-in" : ""),
                  onClick: onTestSavedConnection,
                  disabled: testing || !canTestConnection || connectionHasPendingChanges || connectionTransition === "opening",
                  title: connectionHasPendingChanges ? "\u8FDE\u63A5\u8BBE\u7F6E\u6B63\u5728\u4FDD\u5B58\uFF1B\u5982\u9700\u7ACB\u5373\u9A8C\u8BC1\uFF0C\u8BF7\u5C55\u5F00\u540E\u4F7F\u7528\u201C\u4FDD\u5B58\u5E76\u6D4B\u8BD5\u8FDE\u63A5\u201D" : canTestConnection ? "\u6D4B\u8BD5\u5F53\u524D\u5DF2\u4FDD\u5B58\u7684\u8FDE\u63A5" : `\u8BF7\u5148\u5B8C\u6210\uFF1A${connectionRequirements.join("\u3001")}`,
                  style: { minHeight: 34, padding: "6px 10px", borderRadius: 7, cursor: testing || !canTestConnection ? "not-allowed" : "pointer", fontSize: 12, whiteSpace: "nowrap" },
                  children: testing ? "\u6D4B\u8BD5\u4E2D\u2026" : connectionHasPendingChanges ? saveStatus.kind === "error" ? "\u4FDD\u5B58\u5931\u8D25" : "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u6D4B\u8BD5\u8FDE\u63A5"
                }) : null,
                children: /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx(ConnectionOverview, {
                      state,
                      apiKeyConfigured: apiKeyStatus.configured,
                      apiKeyStatus: apiKeyStatus.kind,
                      pendingKeys: touchedKeys
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx(TextField, {
                      id: "vision-api-key",
                      label: "API Key",
                      labelHint: apiKeyStatus.kind === "ready" ? apiKeyStatus.configured ? "\u5DF2\u4FDD\u5B58" : "\u672A\u914D\u7F6E" : "\u6B63\u5728\u68C0\u67E5\u2026",
                      value: state.apiKey,
                      placeholder: apiKeyStatus.configured ? "\u5DF2\u4FDD\u5B58\uFF1B\u8F93\u5165\u65B0 Key \u53EF\u66FF\u6362" : "sk-\u2026",
                      password: true,
                      onChange: (value) => update("apiKey", value)
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                      style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "-2px 0 12px", fontSize: 12 },
                      role: "status",
                      "aria-live": "polite",
                      children: [
                        apiKeyStatus.kind === "loading" && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                          style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                          children: "\u6B63\u5728\u68C0\u67E5 API Key \u914D\u7F6E\u72B6\u6001\u2026"
                        }),
                        apiKeyStatus.kind === "ready" && apiKeyStatus.configured && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                          style: { color: "#4ade80" },
                          children: "\u5BC6\u94A5\u4EC5\u5B58\u50A8\u5728 DSH \u51ED\u636E\u4E2D\u3002"
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
                          className: "vision-danger-action",
                          onClick: clearApiKey,
                          style: {
                            flex: "0 0 auto",
                            padding: "3px 8px",
                            borderRadius: 5,
                            border: "1px solid rgba(248,113,113," + (confirmClear ? "0.9" : "0.5") + ")",
                            background: confirmClear ? "rgba(248,113,113,0.15)" : "transparent",
                            color: "#f87171",
                            cursor: "pointer",
                            fontSize: 12,
                            whiteSpace: "nowrap"
                          },
                          children: confirmClear ? "\u786E\u8BA4\u6E05\u9664\uFF1F" : "\u6E05\u9664 API Key"
                        }),
                        confirmClear && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                          type: "button",
                          onClick: () => setConfirmClear(false),
                          style: {
                            flex: "0 0 auto",
                            padding: "3px 8px",
                            borderRadius: 5,
                            border: "1px solid var(--dsw-alias-border-l2, #444)",
                            background: "transparent",
                            color: "var(--dsw-alias-label-secondary, #aaa)",
                            cursor: "pointer",
                            fontSize: 12,
                            whiteSpace: "nowrap"
                          },
                          children: "\u53D6\u6D88"
                        })
                      ]
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx(TextField, {
                      id: "vision-base-url",
                      label: "Base URL",
                      value: state.baseUrl,
                      placeholder: "https://api.example.com/v1",
                      onChange: (value) => update("baseUrl", value)
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelPicker, {
                      value: state.model,
                      onChange: (value) => update("model", value),
                      options: visionModelOptions,
                      status: visionModelStatus,
                      onRefresh: refreshVisionModelCatalog
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                      className: "vision-connection-verify",
                      style: { marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--dsw-alias-border-l2, #333)" },
                      children: [
                        /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                          style: { marginBottom: 8, color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 12, fontWeight: 600 },
                          children: "\u9A8C\u8BC1\u6B64\u914D\u7F6E"
                        }),
                        /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                          style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
                          children: [
                            /* @__PURE__ */ reactJsxRuntime.jsx(ConnectionTestStatus, {
                              requirements: connectionRequirements,
                              testStatus: connectionTestStatus,
                              testIsStale: connectionTestIsStale
                            }),
                            /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                              type: "button",
                              className: "vision-primary-action vision-connection-footer-test" + (connectionTransition === "opening" ? " vision-action-fade-in" : connectionTransition === "closing" ? " vision-action-fade-out" : ""),
                              onClick: onSaveAndTestConnection,
                              disabled: testing || !canTestConnection,
                              title: canTestConnection ? "\u4FDD\u5B58\u5F53\u524D\u7F16\u8F91\u5E76\u6D4B\u8BD5\u8FDE\u63A5" : `\u8BF7\u5148\u5B8C\u6210\uFF1A${connectionRequirements.join("\u3001")}`,
                              style: { minHeight: 38, padding: "7px 12px", borderRadius: 7, cursor: testing || !canTestConnection ? "not-allowed" : "pointer", fontSize: 12, whiteSpace: "nowrap" },
                              children: testing ? "\u6D4B\u8BD5\u4E2D\u2026" : "\u4FDD\u5B58\u5E76\u6D4B\u8BD5\u8FDE\u63A5"
                            })
                          ]
                        })
                      ]
                    })
                  ]
                })
              }),
              /* common path is open; lower-frequency controls stay out of the way */
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsxs(SettingsSection, {
                    id: "vision-common-settings",
                    title: "\u5E38\u7528\u7B56\u7565",
                    summary: `\u89C6\u89C9\u57FA\u5143\uFF1A${state.primitives === "auto" ? "\u81EA\u52A8" : state.primitives === "on" ? "\u59CB\u7EC8\u5F00\u542F" : "\u5173\u95ED"} \xB7 \u5206\u6790\u7EC6\u8282\uFF1A${state.detail === "standard" ? "\u6807\u51C6" : state.detail === "brief" ? "\u7B80\u77ED" : "\u8BE6\u7EC6"}` + sectionSaveHint(commonHasPendingChanges),
                    expanded: true,
                    onToggle: null,
                    children: [
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
                        "\u51B3\u5B9A\u662F\u5426\u8F93\u51FA\u5E26\u5750\u6807\u7684\u53EF\u5F15\u7528\u89C6\u89C9\u8BC1\u636E\u3002",
                        {
                          auto: "\u81EA\u52A8\uFF1A\u4EC5\u5728\u5B9A\u4F4D\u3001\u754C\u9762\u4E0E\u8BA1\u6570\u7B49\u4EFB\u52A1\u4E2D\u542F\u7528\u3002",
                          on: "\u59CB\u7EC8\u5F00\u542F\uFF1A\u56DE\u7B54\u4F1A\u66F4\u957F\uFF0C\u4F46\u66F4\u9002\u5408\u540E\u7EED\u5B9A\u4F4D\u3002",
                          off: "\u5173\u95ED\uFF1A\u4EC5\u8FD4\u56DE\u81EA\u7136\u8BED\u8A00\u6982\u8FF0\u3002"
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
                        "\u63A7\u5236\u56DE\u7B54\u7684\u5C55\u5F00\u7A0B\u5EA6\u3001\u5EF6\u8FDF\u4E0E Token \u6D88\u8017\u3002",
                        {
                          brief: "\u7B80\u77ED\uFF1A\u9002\u5408\u5FEB\u901F\u786E\u8BA4\u3002",
                          standard: "\u6807\u51C6\uFF1A\u9002\u5408\u5927\u591A\u6570\u5BF9\u8BDD\u3002",
                          verbose: "\u8BE6\u7EC6\uFF1A\u9002\u5408\u590D\u6742\u754C\u9762\u548C\u6587\u6863\u5BA1\u9605\u3002"
                        }[state.detail]
                      )
                    ]
                  }),
                  /* @__PURE__ */ reactJsxRuntime.jsx(SettingsSection, {
                    id: "vision-advanced-settings",
                    title: "\u9AD8\u7EA7\u63A7\u5236",
                    summary: (describeAdvancedChanges(state).length > 0 ? `\u5DF2\u8C03\u6574\uFF1A${describeAdvancedChanges(state).join(" \xB7 ")}` : "\u5168\u90E8\u4F7F\u7528\u63A8\u8350\u9ED8\u8BA4\u503C") + sectionSaveHint(advancedHasPendingChanges),
                    expanded: expandedSections.advanced,
                    onToggle: () => toggleSection("advanced"),
                    action: /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                      style: { display: "flex", alignItems: "center", gap: 6 },
                      children: [
                        /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                          type: "button",
                          className: "vision-danger-action",
                          onClick: resetAnalysisSettings,
                          style: {
                            minHeight: 30,
                            padding: "5px 9px",
                            borderRadius: 6,
                            border: "1px solid " + (confirmReset ? "rgba(248,113,113,0.9)" : "var(--dsw-alias-border-l2, #444)"),
                            background: confirmReset ? "rgba(248,113,113,0.12)" : "transparent",
                            color: confirmReset ? "#f87171" : "var(--dsw-alias-label-secondary, #aaa)",
                            cursor: "pointer",
                            fontSize: 12,
                            whiteSpace: "nowrap"
                          },
                          children: confirmReset ? "\u786E\u8BA4\u6062\u590D\u9ED8\u8BA4\uFF1F" : "\u6062\u590D\u9ED8\u8BA4"
                        }),
                        confirmReset && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                          type: "button",
                          onClick: () => setConfirmReset(false),
                          style: { minHeight: 30, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #444)", background: "transparent", color: "var(--dsw-alias-label-secondary, #aaa)", cursor: "pointer", fontSize: 12 },
                          children: "\u53D6\u6D88"
                        })
                      ]
                    }),
                    children: /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                      children: [
                        confirmReset && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                          role: "status",
                          "aria-live": "polite",
                          style: { margin: "12px 0", padding: "8px 10px", borderRadius: 7, background: "rgba(248,113,113,0.08)", color: "#fbbf24", fontSize: 12, lineHeight: 1.5 },
                          children: "\u5C06\u6062\u590D\u91CD\u8BD5\u6A21\u5F0F\u3001\u56FE\u7247\u5927\u5C0F\u3001\u8D85\u65F6\u548C Token \u9884\u7B97\u4E3A\u63A8\u8350\u9ED8\u8BA4\u503C\uFF1B\u8FDE\u63A5\u8BBE\u7F6E\u4E0E\u5DF2\u542F\u7528\u6A21\u578B\u4E0D\u4F1A\u6539\u53D8\u3002"
                        }),
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
                          "\u4EC5\u5728\u7ED3\u679C\u7684\u7ED3\u6784\u6216\u683C\u5F0F\u4E0D\u5B8C\u6574\u65F6\uFF0C\u662F\u5426\u518D\u8BF7\u6C42\u4E00\u6B21\u6A21\u578B\u3002",
                          {
                            off: "\u5173\u95ED\uFF1A\u901F\u5EA6\u4E0E\u8D39\u7528\u6700\u53EF\u63A7\u3002",
                            "format-only": "\u4EC5\u683C\u5F0F\uFF1A\u4E3A\u5750\u6807\u5316\u5DE5\u4F5C\u6D41\u8865\u4E00\u6B21\u8BF7\u6C42\u3002",
                            on: "\u5F00\u542F\uFF1A\u4F18\u5148\u4FDD\u8BC1\u7ED3\u6784\u5B8C\u6574\uFF0C\u53EF\u80FD\u589E\u52A0\u8017\u65F6\u4E0E\u8D39\u7528\u3002"
                          }[state.retry]
                        ),
                        selectField(
                          "\u8BCA\u65AD\u65E5\u5FD7",
                          "logDiagnostics",
                          state.logDiagnostics,
                          update,
                          [
                            { value: "off", label: "\u5173\u95ED\uFF08\u9ED8\u8BA4\uFF09" },
                            { value: "on", label: "\u5F00\u542F" }
                          ],
                          "\u5F00\u542F\u540E\u5728 DSH \u540E\u53F0\u63A7\u5236\u53F0\u8F93\u51FA\u63D2\u4EF6\u7684\u8FD0\u884C\u65E5\u5FD7\uFF08\u8BF7\u6C42\u3001\u7F13\u5B58\u3001\u9519\u8BEF\u660E\u7EC6\uFF09\u3002",
                          {
                            off: "\u5173\u95ED\uFF1A\u63A7\u5236\u53F0\u4E0D\u8F93\u51FA\u63D2\u4EF6\u8FD0\u884C\u65E5\u5FD7\u3002",
                            on: "\u5F00\u542F\uFF1A\u8F93\u51FA bridge_stream / analysis_start / success / error \u7B49\u8BCA\u65AD\u65E5\u5FD7\u3002"
                          }[state.logDiagnostics]
                        ),
                        /* @__PURE__ */ reactJsxRuntime.jsx(NumberField, {
                          id: "vision-max-image-bytes",
                          label: "\u6700\u5927\u56FE\u7247\u5927\u5C0F\uFF08MB\uFF09",
                          value: state.maxImageBytes / BYTES_PER_MEGABYTE,
                          min: 1,
                          max: 50,
                          step: 1,
                          description: "\u8D85\u8FC7\u6B64\u5927\u5C0F\u7684\u56FE\u7247\u4F1A\u5728\u672C\u5730\u62D2\u7EDD\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u3002",
                          recommendation: "\u5EFA\u8BAE\u4FDD\u6301 5\u201310 MB\uFF1A\u8FC7\u5927\u56FE\u7247\u4F1A\u663E\u8457\u589E\u52A0\u7F16\u7801\u4F53\u79EF\u3001\u4F20\u8F93\u65F6\u95F4\u4E0E\u8D85\u65F6\u6982\u7387\u3002",
                          onChange: (value) => update("maxImageBytes", value * BYTES_PER_MEGABYTE)
                        }),
                        /* @__PURE__ */ reactJsxRuntime.jsx(NumberField, {
                          id: "vision-timeout-ms",
                          label: "\u89C6\u89C9\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
                          value: state.timeoutMs,
                          min: 5e3,
                          max: 3e5,
                          step: 1e3,
                          description: "\u89C6\u89C9\u6A21\u578B\u5728\u6B64\u65F6\u95F4\u5185\u672A\u8FD4\u56DE\u65F6\uFF0C\u672C\u6B21\u5206\u6790\u4F1A\u505C\u6B62\u3002",
                          recommendation: "\u9ED8\u8BA4 180000\uFF083 \u5206\u949F\uFF09\u3002\u672C\u5730\u6216\u8F83\u6162\u6A21\u578B\u5EFA\u8BAE\u4E0D\u4F4E\u4E8E 60000\uFF1B\u4E0D\u8981\u65E0\u9650\u8C03\u5927\uFF0C\u4EE5\u514D\u5BF9\u8BDD\u957F\u671F\u65E0\u54CD\u5E94\u3002",
                          onChange: (value) => update("timeoutMs", value)
                        }),
                        selectField(
                          "\u8F93\u51FA Token \u9884\u7B97",
                          "maxTokensMode",
                          state.maxTokensMode,
                          update,
                          [
                            { value: "auto", label: "\u81EA\u52A8\uFF08\u63A8\u8350\uFF09" },
                            { value: "manual", label: "\u624B\u52A8\u6307\u5B9A" }
                          ],
                          "\u9650\u5236\u4E00\u6B21\u89C6\u89C9\u5206\u6790\u7684\u6700\u5927\u8F93\u51FA\u957F\u5EA6\u3002",
                          state.maxTokensMode === "auto" ? "\u81EA\u52A8\uFF1A\u6309\u5206\u6790\u7EC6\u8282\u5206\u914D\u9884\u7B97\u3002" : "\u624B\u52A8\uFF1A\u4E3A\u6240\u6709\u4EFB\u52A1\u4F7F\u7528\u56FA\u5B9A\u4E0A\u9650\u3002"
                        ),
                        state.maxTokensMode === "auto" ? /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                          style: { margin: "-2px 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-tertiary, #888)" },
                          children: "\u81EA\u52A8\u9884\u7B97\uFF1A\u7B80\u77ED 1024 / \u6807\u51C6 2048 / \u8BE6\u7EC6 4096\u3002"
                        }) : /* @__PURE__ */ reactJsxRuntime.jsx(NumberField, {
                          id: "vision-max-tokens",
                          label: "\u6700\u5927\u8F93\u51FA Token",
                          value: state.maxTokens,
                          min: 256,
                          max: 65536,
                          step: 256,
                          description: "\u6570\u503C\u8D8A\u9AD8\uFF0C\u7ED3\u679C\u66F4\u5B8C\u6574\uFF0C\u4F46\u54CD\u5E94\u53EF\u80FD\u66F4\u6162\u3002",
                          recommendation: "\u666E\u901A\u622A\u56FE 1024\u20132048\uFF1B\u590D\u6742\u754C\u9762\u6216\u6587\u6863 2048\u20134096\u3002",
                          onChange: (value) => update("maxTokens", value)
                        })
                      ]
                    })
                  })
                ]
              }),
              /* bridge models are a separate enhancement, not a prerequisite */
              /* @__PURE__ */ reactJsxRuntime.jsx(SettingsSection, {
                id: "vision-bridge-settings",
                title: "\u5BF9\u8BDD\u589E\u5F3A",
                summary: (state.enabledModels.length > 0 ? unavailableEnabledModels.length > 0 ? `\u5DF2\u542F\u7528 ${state.enabledModels.length} \u4E2A\u6A21\u578B \xB7 ${unavailableEnabledModels.length} \u4E2A\u5F53\u524D\u4E0D\u53EF\u7528` : `\u5DF2\u542F\u7528 ${state.enabledModels.length} \u4E2A\u6A21\u578B` : "\u5C1A\u672A\u542F\u7528\u5BF9\u8BDD\u589E\u5F3A\u6A21\u578B") + sectionSaveHint(bridgeHasPendingChanges),
                expanded: expandedSections.bridge,
                onToggle: () => toggleSection("bridge"),
                children: /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelSelector, {
                  groups: modelGroups,
                  enabledModels: state.enabledModels,
                  catalogStatus,
                  modelSyncStatus,
                  toggleModel: toggleVisionModel,
                  refreshCatalog: refreshModelCatalog,
                  unavailableEnabledModels,
                  embedded: true
                })
              }),
              /* footer hint */
              /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                style: {
                  fontSize: 12,
                  color: "var(--dsw-alias-label-tertiary, #888)",
                  margin: 0,
                  lineHeight: 1.6
                },
                children: "\u8BBE\u7F6E\u4F1A\u81EA\u52A8\u4FDD\u5B58\u5230 DSH \u51ED\u636E\u5B58\u50A8\uFF0C\u5E76\u5728\u4E0B\u4E00\u6B21\u89C6\u89C9\u5206\u6790\u8BF7\u6C42\u4E2D\u751F\u6548\u3002API Key \u4E0D\u4F1A\u4FDD\u5B58\u5728\u6D4F\u89C8\u5668\u672C\u5730\u5B58\u50A8\uFF1B\u8F93\u5165\u65B0\u503C\u5373\u53EF\u66FF\u6362\uFF0C\u79FB\u9664\u8BF7\u4F7F\u7528\u300C\u6E05\u9664 API Key\u300D\u3002"
              })
            ]
          }
        );
      }
      function SettingsUiStyles() {
        return /* @__PURE__ */ reactJsxRuntime.jsx("style", {
          children: `
          .vision-settings { box-sizing: border-box; }
          .vision-settings *, .vision-settings *::before, .vision-settings *::after { box-sizing: border-box; }
          .vision-settings button, .vision-settings input, .vision-settings select { transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease; }
          .vision-settings button { min-height: 34px; }
          .vision-settings button:not(:disabled) { touch-action: manipulation; }
          .vision-settings button:not(:disabled):hover { border-color: rgba(147, 197, 253, 0.78) !important; }
          .vision-settings button:disabled { opacity: 0.62; }
          .vision-settings button:focus-visible, .vision-settings input:focus-visible, .vision-settings select:focus-visible { outline: 2px solid #60a5fa !important; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.18); }
          .vision-settings input:not([type="checkbox"]), .vision-settings select { min-height: 40px; }
          .vision-settings input::placeholder { color: var(--dsw-alias-label-tertiary, #888); opacity: 1; }
          .vision-settings .vision-section { box-shadow: 0 1px 0 rgba(255,255,255,0.025); transition: border-color ${UI_MOTION_MS}ms ease, box-shadow ${UI_MOTION_MS}ms ease, background-color ${UI_MOTION_MS}ms ease; }
          .vision-settings .vision-section[data-expanded="true"] { border-color: rgba(148, 163, 184, 0.32); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.12); }
          .vision-settings .vision-section-trigger:hover { background: rgba(255, 255, 255, 0.025) !important; }
          .vision-settings .vision-section-content { animation: vision-reveal ${UI_MOTION_MS}ms cubic-bezier(0.22, 1, 0.36, 1); }
          .vision-settings .vision-section-content.vision-content-closing { animation: vision-conceal ${UI_MOTION_MS}ms ease forwards; pointer-events: none; }
          .vision-settings .vision-disclosure-icon { transition: transform ${UI_MOTION_MS}ms cubic-bezier(0.22, 1, 0.36, 1); }
          .vision-settings .vision-model-options, .vision-settings .vision-provider-panel { animation: vision-reveal 180ms cubic-bezier(0.22, 1, 0.36, 1); }
          @keyframes vision-reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes vision-conceal { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-4px); } }
          .vision-settings .vision-action-fade-in { animation: vision-action-fade-in ${UI_MOTION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both; }
          .vision-settings .vision-action-fade-out { animation: vision-action-fade-out ${UI_MOTION_MS}ms ease both; pointer-events: none; }
          @keyframes vision-action-fade-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes vision-action-fade-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-3px); } }
          .vision-settings .vision-section-summary { max-width: 100%; }
          .vision-settings .vision-primary-action { border-color: rgba(96,165,250,0.78) !important; background: rgba(59,130,246,0.22) !important; color: #dbeafe !important; }
          .vision-settings .vision-primary-action:not(:disabled):hover { background: rgba(59,130,246,0.32) !important; }
          .vision-settings .vision-secondary-action { min-height: 34px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2, #444); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #2a2a2a); color: var(--dsw-alias-label-primary, #e0e0e0); font-size: 12px; line-height: 1.2; cursor: pointer; white-space: nowrap; }
          .vision-settings .vision-secondary-action:not(:disabled):hover { background: rgba(96,165,250,0.12); border-color: rgba(96,165,250,0.72) !important; color: #dbeafe; }
          .vision-settings .vision-secondary-action[aria-expanded="true"] { border-color: rgba(96,165,250,0.72); background: rgba(96,165,250,0.14); color: #dbeafe; }
          .vision-settings .vision-danger-action:not(:disabled):hover { border-color: rgba(248,113,113,0.95) !important; background: rgba(248,113,113,0.12) !important; }
          .vision-settings .vision-selected-hint { border-left-color: #60a5fa !important; background: rgba(59,130,246,0.10) !important; }
          .vision-settings .vision-recommendation { padding-left: 9px; border-left: 2px solid rgba(148,163,184,0.48); }
          .vision-settings .vision-field > p { color: var(--dsw-alias-label-secondary, #aaa) !important; }
          .vision-settings .vision-model-picker [role="option"] { overflow-wrap: anywhere; }
          .vision-settings .vision-model-disclosure:not(:disabled):hover { background: rgba(96,165,250,0.22) !important; color: #dbeafe !important; }
          .vision-settings .vision-model-selector label span { overflow-wrap: anywhere; }
          .vision-settings .vision-model-check-row { min-height: 38px; border-radius: 6px; transition: background-color 160ms ease; }
          .vision-settings .vision-model-check-row:hover { background: rgba(255,255,255,0.035); }
          .vision-settings .vision-model-selector input[type="checkbox"] { width: 16px; height: 16px; margin: 0; flex: 0 0 auto; accent-color: #60a5fa; }
          @media (max-width: 600px) {
            .vision-settings { padding: 16px !important; }
            .vision-settings .vision-section-header { align-items: flex-start !important; }
            .vision-settings .vision-section-action { margin-top: 2px; }
            .vision-settings .vision-section-summary { white-space: normal !important; }
            .vision-settings .vision-connection-overview-grid { grid-template-columns: 1fr !important; }
          }
          @media (max-width: 440px) {
            .vision-settings .vision-section-header { flex-wrap: wrap; }
            .vision-settings .vision-section-action { width: 100%; }
            .vision-settings .vision-section-action > button { width: 100%; }
            .vision-settings .vision-section-action > div { justify-content: flex-end; }
            .vision-settings .vision-model-combobox-row { flex-wrap: wrap; }
            .vision-settings .vision-model-combobox-row > div { flex-basis: 100%; }
            .vision-settings .vision-model-combobox-row > button { width: 100%; }
            .vision-settings .vision-connection-verify .vision-primary-action { width: 100%; }
          }
          @media (prefers-reduced-motion: reduce) {
            .vision-settings *, .vision-settings *::before, .vision-settings *::after { transition-duration: 0.01ms !important; }
            .vision-settings .vision-section-content, .vision-settings .vision-model-options, .vision-settings .vision-provider-panel, .vision-settings .vision-action-fade-in, .vision-settings .vision-action-fade-out { animation: none !important; }
          }
        `
        });
      }
      function SettingsSection({ id, title, summary, expanded, onToggle, action, contentVisible = expanded, contentTransition, children }) {
        const collapsible = typeof onToggle === "function";
        const contentId = `${id}-content`;
        return /* @__PURE__ */ reactJsxRuntime.jsxs("section", {
          "aria-labelledby": `${id}-heading`,
          className: "vision-section",
          "data-expanded": expanded,
          style: {
            background: "var(--dsw-alias-bg-layer-3, #1e1e1e)",
            border: "1px solid var(--dsw-alias-border-l2, #333)",
            borderRadius: 12,
            marginBottom: 12,
            overflow: "hidden"
          },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              className: "vision-section-header",
              style: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" },
              children: [
                collapsible ? /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
                  type: "button",
                  className: "vision-section-trigger",
                  onClick: onToggle,
                  "aria-expanded": expanded,
                  "aria-controls": contentId,
                  style: {
                    display: "flex",
                    flex: "1 1 180px",
                    minWidth: 0,
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    textAlign: "left"
                  },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsxs("span", {
                      style: { minWidth: 0 },
                      children: [
                        /* @__PURE__ */ reactJsxRuntime.jsx("h3", {
                          id: `${id}-heading`,
                          style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e0e0e0)" },
                          children: title
                        }),
                        summary && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                          className: "vision-section-summary",
                          style: { display: "block", marginTop: 3, overflow: "hidden", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, lineHeight: 1.4, textOverflow: "ellipsis", whiteSpace: "nowrap" },
                          children: summary
                        })
                      ]
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                      className: "vision-disclosure-icon",
                      "aria-hidden": true,
                      style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" },
                      children: "\u25BE"
                    })
                  ]
                }) : /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { flex: "1 1 180px", minWidth: 0 },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("h3", {
                      id: `${id}-heading`,
                      style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e0e0e0)" },
                      children: title
                    }),
                    summary && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      className: "vision-section-summary",
                      style: { marginTop: 3, color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, lineHeight: 1.4 },
                      children: summary
                    })
                  ]
                }),
                action && /* @__PURE__ */ reactJsxRuntime.jsx("div", { className: "vision-section-action", style: { flex: "0 0 auto" }, children: action })
              ]
            }),
            contentVisible && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              id: contentId,
              className: "vision-section-content" + (contentTransition === "closing" ? " vision-content-closing" : ""),
              "aria-hidden": contentTransition === "closing" || void 0,
              style: { padding: "0 14px 14px", borderTop: "1px solid var(--dsw-alias-border-l2, #333)" },
              children
            })
          ]
        });
      }
      function ConnectionTestStatus({ requirements, testStatus, testIsStale }) {
        const testText = requirements.length > 0 ? `\u5F85\u5B8C\u6210\uFF1A${requirements.join("\u3001")}` : testIsStale ? "\u914D\u7F6E\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u6D4B\u8BD5" : testStatus.kind === "ok" ? `\u4E0A\u6B21\u6D4B\u8BD5\u6B63\u5E38 \xB7 ${new Date(testStatus.at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "\u5C1A\u672A\u6D4B\u8BD5\u8FDE\u63A5";
        const testColor = requirements.length > 0 || testIsStale ? "#fbbf24" : testStatus.kind === "ok" ? "#4ade80" : "var(--dsw-alias-label-tertiary, #888)";
        return /* @__PURE__ */ reactJsxRuntime.jsx("div", {
          role: "status",
          "aria-live": "polite",
          style: { flex: "1 1 220px", minWidth: 0, color: testColor, fontSize: 12, lineHeight: 1.45 },
          children: testText
        });
      }
      function ConnectionOverview({ state, apiKeyConfigured, apiKeyStatus, pendingKeys }) {
        const apiKeyPending = pendingKeys.has("apiKey");
        const baseUrlPending = pendingKeys.has("baseUrl");
        const modelPending = pendingKeys.has("model");
        const entries = [
          {
            label: "API Key",
            value: apiKeyStatus === "loading" ? "\u6B63\u5728\u68C0\u67E5\u2026" : apiKeyPending ? "\u5F85\u4FDD\u5B58" : apiKeyConfigured ? "\u5DF2\u4FDD\u5B58" : "\u672A\u914D\u7F6E",
            tone: apiKeyPending ? "#fbbf24" : apiKeyConfigured ? "#4ade80" : "var(--dsw-alias-label-tertiary, #888)"
          },
          {
            label: "Base URL",
            value: state.baseUrl.trim() ? state.baseUrl.trim().replace(/^https?:\/\//, "") : "\u672A\u586B\u5199",
            meta: baseUrlPending ? "\u5F85\u4FDD\u5B58" : state.baseUrl.trim() ? "\u5DF2\u586B\u5199" : "\u672A\u914D\u7F6E",
            tone: baseUrlPending ? "#fbbf24" : "var(--dsw-alias-label-primary, #e0e0e0)"
          },
          {
            label: "\u89C6\u89C9\u6A21\u578B",
            value: state.model.trim() || "\u672A\u9009\u62E9",
            meta: modelPending ? "\u5F85\u4FDD\u5B58" : state.model.trim() ? "\u5DF2\u9009\u62E9" : "\u672A\u914D\u7F6E",
            tone: modelPending ? "#fbbf24" : "var(--dsw-alias-label-primary, #e0e0e0)"
          }
        ];
        return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
          className: "vision-connection-overview",
          style: { margin: "12px 0 16px" },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { marginBottom: 8, color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 12, fontWeight: 600 },
              children: "\u5F53\u524D\u914D\u7F6E"
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              className: "vision-connection-overview-grid",
              style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 },
              children: entries.map(
                (entry) => /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { minWidth: 0, padding: "8px 9px", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 7, background: "var(--dsw-alias-bg-layer-2, #2a2a2a)" },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("div", { style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 11 }, children: entry.label }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("div", { title: entry.value, style: { marginTop: 3, overflow: "hidden", color: entry.tone, fontSize: 12, fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: entry.value }),
                    entry.meta && /* @__PURE__ */ reactJsxRuntime.jsx("div", { style: { marginTop: 2, color: entry.meta === "\u5F85\u4FDD\u5B58" ? "#fbbf24" : "var(--dsw-alias-label-tertiary, #888)", fontSize: 11 }, children: entry.meta })
                  ]
                }, entry.label)
              )
            })
          ]
        });
      }
      function SetupGuide({ state, apiKeyConfigured }) {
        const missing = getConnectionRequirements(state, apiKeyConfigured, true);
        if (missing.length === 0) return null;
        const steps = [
          { key: "api", label: "\u4FDD\u5B58 API Key", done: apiKeyConfigured || Boolean(state.apiKey.trim()) },
          { key: "base", label: "\u586B\u5199 Base URL", done: Boolean(state.baseUrl.trim()) },
          { key: "model", label: "\u9009\u62E9\u6216\u586B\u5199\u89C6\u89C9\u6A21\u578B", done: Boolean(state.model.trim()) },
          { key: "test", label: "\u6D4B\u8BD5\u8FDE\u63A5", done: false }
        ];
        return /* @__PURE__ */ reactJsxRuntime.jsxs("section", {
          "aria-labelledby": "vision-setup-guide-heading",
          style: {
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid rgba(96,165,250,0.32)",
            background: "rgba(96,165,250,0.08)"
          },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsx("h3", {
              id: "vision-setup-guide-heading",
              style: { margin: "0 0 5px", fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e0e0e0)" },
              children: "\u5F00\u59CB\u914D\u7F6E\u89C6\u89C9\u5206\u6790"
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: { margin: "0 0 9px", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary, #aaa)" },
              children: `\u8FD8\u7F3A\u5C11\uFF1A${missing.join("\u3001")}\u3002\u5B8C\u6210\u4EE5\u4E0B\u6B65\u9AA4\u540E\u5373\u53EF\u6D4B\u8BD5\u8FDE\u63A5\u3002`
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("ol", {
              style: { display: "flex", flexWrap: "wrap", gap: "5px 14px", margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" },
              children: steps.map(
                (step) => /* @__PURE__ */ reactJsxRuntime.jsx("li", {
                  style: { color: step.done ? "#4ade80" : "var(--dsw-alias-label-secondary, #aaa)" },
                  children: `${step.done ? "\u5DF2\u5B8C\u6210\uFF1A" : ""}${step.label}`
                }, step.key)
              )
            })
          ]
        });
      }
      function TextField({ id, label, labelHint, value, placeholder, password, onChange }) {
        const [show, setShow] = useState(false);
        return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
          className: "vision-field",
          style: { marginBottom: 10 },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsxs("label", {
              htmlFor: id,
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 12,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                marginBottom: 4
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("span", { children: label }),
                labelHint && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                  className: "vision-field-status",
                  style: { color: labelHint === "\u5DF2\u4FDD\u5B58" ? "#4ade80" : "var(--dsw-alias-label-tertiary, #888)", fontSize: 11 },
                  children: labelHint
                })
              ]
            }),
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: { position: "relative" },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("input", {
                  id,
                  className: "vision-control",
                  type: password && !show ? "password" : "text",
                  value,
                  placeholder,
                  onChange: (e) => onChange(e.target.value),
                  style: {
                    width: "100%",
                    padding: "7px 10px",
                    paddingRight: password ? 56 : 10,
                    borderRadius: 6,
                    border: "1px solid var(--dsw-alias-border-l2, #444)",
                    background: "var(--dsw-alias-bg-layer-1, #252525)",
                    color: "var(--dsw-alias-label-primary, #e0e0e0)",
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box"
                  }
                }),
                password && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  className: "vision-inline-action",
                  onClick: () => setShow((previous) => !previous),
                  "aria-label": show ? "\u9690\u85CF API Key" : "\u663E\u793A API Key",
                  "aria-pressed": show,
                  style: {
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    padding: "2px 8px",
                    borderRadius: 5,
                    border: "1px solid var(--dsw-alias-border-l2, #444)",
                    background: "var(--dsw-alias-bg-layer-2, #2a2a2a)",
                    color: "var(--dsw-alias-label-secondary, #aaa)",
                    cursor: "pointer",
                    fontSize: 12
                  },
                  children: show ? "\u9690\u85CF" : "\u663E\u793A"
                })
              ]
            })
          ]
        });
      }
      function selectField(label, key, value, onChange, options, description, selectedHint) {
        const fieldId = `vision-${key}`;
        const descriptionId = description ? `${fieldId}-description` : void 0;
        const hintId = selectedHint ? `${fieldId}-hint` : void 0;
        return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
          className: "vision-field",
          style: { marginBottom: 16 },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsx("label", {
              htmlFor: fieldId,
              style: {
                display: "block",
                fontSize: 12,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                marginBottom: 4
              },
              children: label
            }),
            description && /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              id: descriptionId,
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)"
              },
              children: description
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("select", {
              id: fieldId,
              className: "vision-control",
              "aria-describedby": [descriptionId, hintId].filter(Boolean).join(" ") || void 0,
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
              id: hintId,
              className: "vision-selected-hint",
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
      function NumberField({ id, label, value, min, max, step, description, recommendation, onChange }) {
        const descriptionId = description ? `${id}-description` : void 0;
        const recommendationId = recommendation ? `${id}-recommendation` : void 0;
        const validationId = `${id}-validation`;
        const [draft, setDraft] = useState(null);
        const [validationMessage, setValidationMessage] = useState("");
        const [correction, setCorrection] = useState(null);
        const commit = () => {
          if (draft === null) return;
          const raw = draft.trim();
          if (!raw) {
            setCorrection(null);
            setValidationMessage(`\u8BF7\u8F93\u5165 ${min} \u5230 ${max} \u4E4B\u95F4\u7684\u6574\u6570\u3002`);
            return;
          }
          const parsed = Number(draft);
          if (!Number.isFinite(parsed)) {
            setCorrection(null);
            setValidationMessage("\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57\u3002");
            return;
          }
          const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
          setDraft(null);
          if (clamped !== value) onChange(clamped);
          if (clamped === parsed) {
            setCorrection(null);
            setValidationMessage("");
          } else {
            setCorrection({ previous: value, applied: clamped });
            setValidationMessage(`\u8F93\u5165\u503C\u5DF2\u8C03\u6574\u4E3A\u5141\u8BB8\u8303\u56F4\u5185\u7684 ${clamped}\u3002`);
          }
        };
        return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
          className: "vision-field",
          style: { marginBottom: 16 },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsx("label", {
              htmlFor: id,
              style: {
                display: "block",
                fontSize: 12,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                marginBottom: 4
              },
              children: label
            }),
            description && /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              id: descriptionId,
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)"
              },
              children: description
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("input", {
              id,
              className: "vision-control",
              "aria-describedby": [descriptionId, recommendationId, validationMessage ? validationId : void 0].filter(Boolean).join(" ") || void 0,
              "aria-invalid": validationMessage && !correction ? true : void 0,
              type: "number",
              value: draft === null ? value : draft,
              min,
              max,
              step,
              onChange: (e) => setDraft(e.target.value),
              onBlur: commit,
              onKeyDown: (e) => {
                if (e.key === "Enter") commit();
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
            validationMessage && /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              id: validationId,
              role: "status",
              "aria-live": "polite",
              style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6, fontSize: 12, lineHeight: 1.45, color: "#fbbf24" },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsx("span", { children: validationMessage }),
                correction && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  onClick: () => {
                    onChange(correction.previous);
                    setCorrection(null);
                    setValidationMessage("\u5DF2\u8FD8\u539F\u4E3A\u4FEE\u6539\u524D\u7684\u503C\u3002");
                  },
                  style: { minHeight: 26, padding: "3px 7px", borderRadius: 5, border: "1px solid rgba(251,191,36,0.6)", background: "transparent", color: "#fcd34d", cursor: "pointer", fontSize: 12 },
                  children: "\u8FD8\u539F"
                })
              ]
            }),
            recommendation && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              id: recommendationId,
              className: "vision-recommendation",
              style: {
                marginTop: 7,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                fontSize: 12,
                lineHeight: 1.55
              },
              children: recommendation
            })
          ]
        });
      }
      function VisionModelPicker({ value, onChange, options, status, onRefresh }) {
        const [open, setOpen] = useState(false);
        const [activeIndex, setActiveIndex] = useState(0);
        const [filterQuery, setFilterQuery] = useState("");
        const rootRef = useRef(null);
        const inputRef = useRef(null);
        const listboxId = "vision-model-options";
        const normalizedQuery = filterQuery.trim().toLowerCase();
        const matchingOptions = options.filter((model) => model.toLowerCase().includes(normalizedQuery));
        const selectedModel = options.find((model) => model === value.trim());
        const orderedOptions = normalizedQuery ? matchingOptions : [
          ...selectedModel ? [selectedModel] : [],
          ...options.filter((model) => model !== selectedModel)
        ];
        const visibleOptions = orderedOptions.slice(0, MODEL_OPTION_PREVIEW_LIMIT);
        const hasMoreOptions = orderedOptions.length > visibleOptions.length;
        const usingManualModel = Boolean(value.trim()) && options.length > 0 && !options.includes(value.trim());
        useEffect(() => {
          if (!open) return;
          const onPointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
          };
          const onKeyDown = (event) => {
            if (event.key === "Escape" && rootRef.current?.contains(event.target)) {
              event.stopPropagation();
              setOpen(false);
              inputRef.current?.focus();
            }
          };
          document.addEventListener("mousedown", onPointerDown);
          document.addEventListener("keydown", onKeyDown);
          return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
          };
        }, [open]);
        useEffect(() => {
          if (!open) return;
          setActiveIndex((previous) => Math.max(0, Math.min(previous, Math.max(0, visibleOptions.length - 1))));
        }, [open, visibleOptions.length]);
        const selectModel = (model) => {
          onChange(model);
          setFilterQuery("");
          setOpen(false);
          inputRef.current?.focus();
        };
        const handleInputKeyDown = (event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            if (visibleOptions.length === 0) return;
            const offset = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((previous) => (previous + offset + visibleOptions.length) % visibleOptions.length);
            return;
          }
          if (event.key === "Enter" && open && visibleOptions[activeIndex]) {
            event.preventDefault();
            selectModel(visibleOptions[activeIndex]);
          }
        };
        const toggleOptions = () => {
          if (options.length === 0 && status.kind !== "loading") void onRefresh();
          const willOpen = !open;
          if (willOpen) {
            setFilterQuery("");
            setTimeout(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            }, 0);
          }
          setOpen(willOpen);
        };
        const refreshOptions = () => {
          setFilterQuery("");
          setOpen(true);
          void onRefresh();
        };
        const statusText = status.kind === "idle" ? "\u53EF\u76F4\u63A5\u8F93\u5165\u6A21\u578B ID\uFF0C\u6216\u8BFB\u53D6\u5F53\u524D\u670D\u52A1\u7684\u53EF\u7528\u6A21\u578B\u3002" : status.text;
        return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
          className: "vision-model-picker",
          style: { marginBottom: 16 },
          ref: rootRef,
          onKeyDownCapture: (event) => {
            if (open && event.key === "Escape") event.stopPropagation();
          },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsx("label", {
              htmlFor: "vision-model-combobox",
              style: { display: "block", fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)", marginBottom: 4 },
              children: "\u89C6\u89C9\u6A21\u578B"
            }),
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              className: "vision-model-combobox-row",
              style: { display: "flex", alignItems: "stretch", gap: 8 },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { position: "relative", flex: "1 1 auto", minWidth: 0 },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("input", {
                      id: "vision-model-combobox",
                      ref: inputRef,
                      type: "text",
                      className: "vision-control",
                      value,
                      placeholder: "\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B ID",
                      onChange: (event) => {
                        const nextValue = event.target.value;
                        onChange(nextValue);
                        setFilterQuery(nextValue);
                        if (options.length > 0) setOpen(true);
                      },
                      onKeyDown: handleInputKeyDown,
                      role: "combobox",
                      "aria-autocomplete": "list",
                      "aria-expanded": open,
                      "aria-controls": open ? listboxId : void 0,
                      "aria-activedescendant": open && visibleOptions[activeIndex] ? `vision-model-option-${activeIndex}` : void 0,
                      style: {
                        width: "100%",
                        padding: "7px 42px 7px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--dsw-alias-border-l2, #444)",
                        background: "var(--dsw-alias-bg-layer-1, #252525)",
                        color: "var(--dsw-alias-label-primary, #e0e0e0)",
                        fontSize: 13,
                        outline: "none",
                        boxSizing: "border-box"
                      }
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                      type: "button",
                      className: "vision-model-disclosure",
                      onClick: toggleOptions,
                      disabled: status.kind === "loading",
                      "aria-label": options.length > 0 ? "\u6253\u5F00\u6A21\u578B\u5217\u8868" : "\u8BFB\u53D6\u5E76\u6253\u5F00\u6A21\u578B\u5217\u8868",
                      "aria-haspopup": "listbox",
                      "aria-expanded": open,
                      "aria-controls": open ? listboxId : void 0,
                      title: options.length > 0 ? "\u6D4F\u89C8\u6A21\u578B" : "\u8BFB\u53D6\u6A21\u578B",
                      style: { position: "absolute", top: 3, right: 3, minWidth: 34, height: 34, padding: 0, border: "none", borderRadius: 5, background: open ? "rgba(96,165,250,0.16)" : "transparent", color: "var(--dsw-alias-label-secondary, #aaa)", cursor: status.kind === "loading" ? "not-allowed" : "pointer", fontSize: 14 },
                      children: status.kind === "loading" ? "\u2026" : open ? "\u25B4" : "\u25BE"
                    })
                  ]
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  className: "vision-secondary-action",
                  onClick: refreshOptions,
                  disabled: status.kind === "loading",
                  style: { flex: "0 0 auto", cursor: status.kind === "loading" ? "not-allowed" : "pointer" },
                  children: status.kind === "loading" ? "\u8BFB\u53D6\u4E2D\u2026" : options.length > 0 ? "\u5237\u65B0" : "\u8BFB\u53D6\u6A21\u578B"
                })
              ]
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: status.kind === "error" ? "alert" : "status",
              "aria-live": status.kind === "error" ? "assertive" : "polite",
              style: { marginTop: 7, color: status.kind === "error" ? "#f87171" : usingManualModel ? "#fbbf24" : "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, lineHeight: 1.5 },
              children: status.kind === "ready" && usingManualModel ? `\u76EE\u5F55\u4E2D\u672A\u627E\u5230\u201C${value.trim()}\u201D\uFF1B\u5C06\u4F7F\u7528\u624B\u52A8\u8F93\u5165\u7684\u6A21\u578B ID\u3002` : statusText
            }),
            open && /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              id: listboxId,
              className: "vision-model-options",
              role: "listbox",
              "aria-label": "\u89C6\u89C9\u6A21\u578B\u9009\u9879",
              style: { marginTop: 9, maxHeight: 220, overflowY: "auto", padding: 4, border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 8, background: "var(--dsw-alias-bg-layer-2, #2a2a2a)" },
              children: [
                options.length > 0 && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  role: "status",
                  style: { padding: "5px 6px 7px", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 11, lineHeight: 1.4 },
                  children: hasMoreOptions ? normalizedQuery ? `\u5339\u914D ${orderedOptions.length} \u4E2A\u6A21\u578B\uFF0C\u663E\u793A\u524D ${visibleOptions.length} \u4E2A\u3002\u7EE7\u7EED\u8F93\u5165\u53EF\u7F29\u5C0F\u8303\u56F4\u3002` : `\u5DF2\u52A0\u8F7D ${options.length} \u4E2A\u6A21\u578B\uFF1B\u5DF2\u7F6E\u9876\u5F53\u524D\u9009\u62E9\uFF0C\u663E\u793A\u524D ${visibleOptions.length} \u4E2A\u3002\u8F93\u5165\u53EF\u7B5B\u9009\u5168\u90E8\u76EE\u5F55\u3002` : normalizedQuery ? `\u627E\u5230 ${orderedOptions.length} \u4E2A\u5339\u914D\u6A21\u578B\u3002` : `\u5DF2\u52A0\u8F7D ${options.length} \u4E2A\u6A21\u578B\u3002`
                }),
                visibleOptions.length > 0 ? visibleOptions.map(
                  (model, index) => /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
                    id: `vision-model-option-${index}`,
                    role: "option",
                    type: "button",
                    onClick: () => selectModel(model),
                    "aria-selected": model === value,
                    style: { display: "flex", width: "100%", minHeight: 38, alignItems: "center", padding: "7px 9px", border: "none", borderRadius: 5, background: model === value || index === activeIndex ? "rgba(96,165,250,0.16)" : "transparent", color: "var(--dsw-alias-label-primary, #e0e0e0)", cursor: "pointer", textAlign: "left", fontSize: 13 },
                    children: [model, model === value && "  \u5DF2\u9009\u62E9"]
                  }, model)
                ) : /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  style: { padding: "12px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                  children: status.kind === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u76EE\u5F55\u2026" : options.length === 0 ? "\u5C1A\u672A\u8BFB\u53D6\u5230\u6A21\u578B\u3002\u53EF\u76F4\u63A5\u8F93\u5165\u6A21\u578B ID\uFF0C\u6216\u68C0\u67E5\u8FDE\u63A5\u540E\u91CD\u65B0\u8BFB\u53D6\u3002" : "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B\uFF0C\u53EF\u76F4\u63A5\u4F7F\u7528\u5F53\u524D\u8F93\u5165\u5185\u5BB9\u3002"
                })
              ]
            })
          ]
        });
      }
      function VisionModelSelector({ groups, enabledModels, catalogStatus, modelSyncStatus, toggleModel, refreshCatalog, unavailableEnabledModels, embedded }) {
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
        return /* @__PURE__ */ reactJsxRuntime.jsxs(embedded ? "div" : "section", {
          "aria-labelledby": "vision-dialog-models-heading",
          className: "vision-model-selector",
          style: {
            background: embedded ? "transparent" : "var(--dsw-alias-bg-layer-3, #1e1e1e)",
            border: embedded ? "none" : "1px solid var(--dsw-alias-border-l2, #333)",
            borderRadius: embedded ? 0 : 12,
            padding: embedded ? "12px 0 0" : "16px 18px",
            marginBottom: embedded ? 0 : 16
          },
          children: [
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 6 },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("h4", {
                      id: "vision-dialog-models-heading",
                      style: { margin: 0, fontSize: 13, fontWeight: 600 },
                      children: "\u9009\u62E9\u8981\u589E\u5F3A\u7684\u6A21\u578B"
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      style: { marginTop: 4, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                      children: `\u5DF2\u542F\u7528 ${enabled.size} \u4E2A\u6A21\u578B\uFF1B\u4EC5\u52FE\u9009\u7684\u6A21\u578B\u4F1A\u663E\u793A [vision]\u3002`
                    })
                  ]
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  className: "vision-secondary-action",
                  onClick: () => void refreshCatalog(),
                  disabled: catalogStatus.kind === "loading",
                  style: { cursor: catalogStatus.kind === "loading" ? "not-allowed" : "pointer" },
                  children: "\u5237\u65B0"
                })
              ]
            }),
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              style: { margin: "0 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-secondary, #aaa)" },
              children: "\u9009\u62E9\u9700\u8981\u7531\u5916\u90E8\u89C6\u89C9\u6A21\u578B\u589E\u5F3A\u7684\u7EAF\u6587\u672C\u5BF9\u8BDD\u6A21\u578B\u3002\u4FEE\u6539\u4F1A\u81EA\u52A8\u4FDD\u5B58\uFF1B\u91CD\u65B0\u6253\u5F00\u6A21\u578B\u5217\u8868\u540E\u5373\u53EF\u4F7F\u7528\u3002"
            }),
            unavailableEnabledModels.length > 0 && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: "alert",
              style: { margin: "0 0 12px", padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(251,191,36,0.36)", background: "rgba(251,191,36,0.08)", color: "#fcd34d", fontSize: 12, lineHeight: 1.5 },
              children: `\u5F53\u524D\u6A21\u578B\u76EE\u5F55\u4E2D\u627E\u4E0D\u5230 ${unavailableEnabledModels.length} \u4E2A\u5DF2\u542F\u7528\u6A21\u578B\uFF1A${unavailableEnabledModels.map((entry) => `${entry.provider}/${entry.model}`).join("\u3001")}\u3002\u8BF7\u786E\u8BA4 Provider \u914D\u7F6E\uFF0C\u6216\u53D6\u6D88\u52FE\u9009\u8FD9\u4E9B\u6A21\u578B\u3002`
            }),
            modelSyncStatus.text && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: modelSyncStatus.kind === "error" ? "alert" : "status",
              "aria-live": modelSyncStatus.kind === "error" ? "assertive" : "polite",
              style: {
                margin: "0 0 10px",
                fontSize: 12,
                color: modelSyncStatus.kind === "saved" ? "#4ade80" : modelSyncStatus.kind === "error" ? "#f87171" : "var(--dsw-alias-label-tertiary, #888)"
              },
              children: modelSyncStatus.text
            }),
            catalogStatus.kind === "loading" && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: "status",
              "aria-live": "polite",
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: catalogStatus.text
            }),
            catalogStatus.kind === "error" && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: "alert",
              style: { fontSize: 12, color: "#f87171", lineHeight: 1.5 },
              children: catalogStatus.text
            }),
            catalogStatus.kind === "ready" && groups.length === 0 && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: "\u5F53\u524D\u6CA1\u6709\u53EF\u9009\u62E9\u7684\u6A21\u578B\u3002\u8BF7\u5148\u5728\u201C\u6A21\u578B\u201D\u8BBE\u7F6E\u4E2D\u5B8C\u6210\u81F3\u5C11\u4E00\u4E2A Provider \u914D\u7F6E\u3002"
            }),
            catalogStatus.kind === "ready" && groups.map((group, groupIndex) => {
              const models = Array.isArray(group.models) ? group.models : [];
              const providerEnabledCount = models.filter((model) => enabled.has(routeKey(group.id, model.id))).length;
              const expanded = expandedProviders.has(group.id);
              const panelId = `vision-provider-${groupIndex}`;
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
                    "aria-controls": panelId,
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
                        className: "vision-disclosure-icon",
                        style: { color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 12, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" },
                        children: "\u25BE"
                      })
                    ]
                  }),
                  expanded && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    id: panelId,
                    className: "vision-provider-panel",
                    style: { padding: "6px 4px 2px" },
                    children: models.map((model) => {
                      const key = routeKey(group.id, model.id);
                      return /* @__PURE__ */ reactJsxRuntime.jsxs("label", {
                        className: "vision-model-check-row",
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
      exports.inject = ["slots", "connection"];
      return module.exports;
    }
  });
})();
