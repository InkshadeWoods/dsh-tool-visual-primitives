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

    const { useState, useEffect, useCallback, useRef } = react;

    /* ── constants ──────────────────────────────────────────── */

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
    const CONFIRM_ACTION_TIMEOUT_MS = 4000;
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
      timeoutMs: 180000,
      maxTokensMode: "auto",
      maxTokens: 2048,
      enabledModels: [],
    };

    const PERSISTED_KEYS = Object.keys(FALLBACKS).filter((key) => key !== "apiKey");
    const ANALYSIS_SETTING_KEYS = ["primitives", "detail", "retry", "maxImageBytes", "timeoutMs", "maxTokensMode", "maxTokens"];
    let credentialSyncQueue = Promise.resolve();

    /* ── recovery draft (localStorage) ──────────────────────── */

    function normalizeEnabledModels(value) {
      let entries = value;
      if (typeof value === "string") {
        try { entries = JSON.parse(value); } catch { entries = []; }
      }
      if (!Array.isArray(entries)) return [];
      const seen = new Set();
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
      if (value === null || value === undefined || String(value).trim() === "") return fallback;
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
      if (needsModel && !state.model.trim()) missing.push("视觉模型");
      return missing;
    }

    function connectionFingerprint(state, apiKeyConfigured) {
      return JSON.stringify({
        apiKeyConfigured: apiKeyConfigured || Boolean(state.apiKey.trim()),
        baseUrl: state.baseUrl.trim(),
        model: state.model.trim(),
      });
    }

    function loadConnectionTestStatus() {
      try {
        const parsed = JSON.parse(localStorage.getItem(CONNECTION_TEST_KEY) || "null");
        if (parsed?.kind === "ok" && typeof parsed.at === "number" && typeof parsed.fingerprint === "string") return parsed;
      } catch {
        // Test history is an optional, non-secret convenience signal.
      }
      return { kind: "idle", fingerprint: "", at: null };
    }

    function saveConnectionTestStatus(status) {
      try {
        if (status.kind === "ok") localStorage.setItem(CONNECTION_TEST_KEY, JSON.stringify(status));
        else localStorage.removeItem(CONNECTION_TEST_KEY);
      } catch {
        // An unavailable local cache must not change connection behaviour.
      }
    }

    function describeAdvancedChanges(state) {
      const changes = [];
      if (state.retry !== FALLBACKS.retry) changes.push(`重试：${state.retry === "format-only" ? "仅格式" : "开启"}`);
      if (state.maxImageBytes !== FALLBACKS.maxImageBytes) changes.push(`图片：${Math.round(state.maxImageBytes / BYTES_PER_MEGABYTE)} MB`);
      if (state.timeoutMs !== FALLBACKS.timeoutMs) changes.push(`超时：${Math.round(state.timeoutMs / 1000)} 秒`);
      if (state.maxTokensMode !== FALLBACKS.maxTokensMode || state.maxTokens !== FALLBACKS.maxTokens) changes.push(`Token：${state.maxTokensMode === "auto" ? "自动" : state.maxTokens}`);
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
            bridge: hasCurrentPreference && parsed.bridge === true,
          },
        };
      } catch {
        return { hasSavedPreference: false, sections: { connection: false, advanced: false, bridge: false } };
      }
    }

    function saveSectionPreferences(sections) {
      try {
        localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ version: UI_PREFERENCES_VERSION, ...sections }));
      } catch {
        // Preferences only improve presentation; failing to persist them must not affect settings.
      }
    }

    function normalizeState(raw) {
      const persisted = raw && typeof raw === "object" ? raw : {};
      const maxTokensValue = persisted.maxTokens;
      const hasMaxTokensValue = maxTokensValue !== null && maxTokensValue !== undefined && String(maxTokensValue).trim() !== "";
      const maxTokensMode = String(maxTokensValue ?? "").trim().toLowerCase() === "auto"
        ? "auto"
        : hasMaxTokensValue && Number.isFinite(Number(maxTokensValue))
          ? "manual"
          : FALLBACKS.maxTokensMode;
      return {
        ...FALLBACKS,
        ...Object.fromEntries(PERSISTED_KEYS.map((key) => [key, persisted[key]]).filter(([, value]) => value !== undefined)),
        apiKey: "",
        primitives: normalizeOption(persisted.primitives, FALLBACKS.primitives, ["auto", "on", "off"]),
        detail: normalizeOption(persisted.detail, FALLBACKS.detail, ["brief", "standard", "verbose"]),
        retry: normalizeOption(persisted.retry, FALLBACKS.retry, ["off", "on", "format-only"]),
        enabledModels: normalizeEnabledModels(persisted.enabledModels),
        maxImageBytes: normalizeNumber(persisted.maxImageBytes, FALLBACKS.maxImageBytes),
        timeoutMs: normalizeNumber(persisted.timeoutMs, FALLBACKS.timeoutMs),
        maxTokensMode,
        maxTokens: normalizeNumber(maxTokensValue, FALLBACKS.maxTokens),
      };
    }

    function loadDraft() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { state: { ...FALLBACKS }, dirtyKeys: new Set() };
        const parsed = JSON.parse(raw);
        const dirtyKeys = new Set(
          Array.isArray(parsed.dirtyKeys)
            ? parsed.dirtyKeys.filter((key) => PERSISTED_KEYS.includes(key))
            : [],
        );
        return { state: normalizeState(parsed), dirtyKeys };
      } catch (error) {
        console.warn("[dsh-tool-visual-primitives] 本地草稿解析失败，已重置：", error);
        return { state: { ...FALLBACKS }, dirtyKeys: new Set() };
      }
    }

    function saveDraft(state, dirtyKeys) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...state,
          apiKey: "",
          dirtyKeys: [...dirtyKeys].filter((key) => key !== "apiKey"),
        }));
      } catch {
        // A recovery draft is best effort; runtime configuration remains in DSH credentials.
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
        // 清空输入框不应误删已保存的密钥；移除密钥必须走「清除 API Key」按钮。
        if (!trimmed && key === "apiKey") continue;
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

    function queueCredentialUnset(api, ref) {
      if (!api?.unset) return Promise.reject(new Error("DSH 凭据服务暂不可用"));
      const run = credentialSyncQueue
        .catch(() => undefined)
        .then(async () => {
          const response = await api.unset({ ref });
          if (!response?.result?.ok) throw new Error(response?.result?.error?.message || `无法清除 ${ref}`);
        });
      credentialSyncQueue = run.catch(() => undefined);
      return run;
    }

    async function loadPersistedSettings() {
      const response = await fetch(SETTINGS_ROUTE_PATH, { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || `设置读取失败（HTTP ${response.status}）`);
      }
      return {
        state: normalizeState(payload.settings),
        apiKeyConfigured: payload.apiKeyConfigured === true,
      };
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

    async function testConnection() {
      try {
        const res = await fetch(TEST_ROUTE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
        return { ok: true, elapsedMs: data.elapsedMs ?? null };
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    }

    /* ── VisionSettings component ───────────────────────────── */

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
      const [catalogStatus, setCatalogStatus] = useState({ kind: "loading", text: "正在加载可选模型…" });
      const [visionModelOptions, setVisionModelOptions] = useState([]);
      const [visionModelStatus, setVisionModelStatus] = useState({ kind: "idle", text: "点击“加载模型”获取当前视觉服务的 /models 列表。" });
      const stateRef = useRef(state);
      const dirtyKeysRef = useRef(new Set(initialDraft.dirtyKeys));
      const revisionsRef = useRef(new Map());
      const nextRevisionRef = useRef(0);
      const saveTimerRef = useRef(null);
      const retryTimerRef = useRef(null);
      const connectionTransitionTimerRef = useRef(null);

      const connectionRequirements = getConnectionRequirements(state, apiKeyStatus.configured, true);
      const canTestConnection = connectionRequirements.length === 0;
      const connectionReady = apiKeyStatus.configured && Boolean(state.baseUrl.trim()) && Boolean(state.model.trim());
      const currentConnectionFingerprint = connectionFingerprint(state, apiKeyStatus.configured);
      const apiKeyHasChangedSinceTest = lastTestedApiKeyRevision !== null
        && (revisionsRef.current.get("apiKey") || 0) > lastTestedApiKeyRevision;
      const connectionTestIsStale = connectionTestStatus.kind === "ok"
        && (connectionTestStatus.fingerprint !== currentConnectionFingerprint || apiKeyHasChangedSinceTest);
      const availableBridgeRoutes = catalogStatus.kind === "ready"
        ? new Set(modelGroups.flatMap((group) => (Array.isArray(group.models) ? group.models : []).map((model) => routeKey(group.id, model.id))))
        : null;
      const unavailableEnabledModels = availableBridgeRoutes
        ? state.enabledModels.filter((entry) => !availableBridgeRoutes.has(routeKey(entry.provider, entry.model)))
        : [];
      const connectionHasPendingChanges = ["apiKey", "baseUrl", "model"].some((key) => touchedKeys.has(key));
      const commonHasPendingChanges = ["primitives", "detail"].some((key) => touchedKeys.has(key));
      const advancedHasPendingChanges = ANALYSIS_SETTING_KEYS.some((key) => touchedKeys.has(key));
      const bridgeHasPendingChanges = touchedKeys.has("enabledModels");
      const sectionSaveHint = (hasPendingChanges) => {
        if (!hasPendingChanges) return "";
        if (saveStatus.kind === "error") return " · 保存失败";
        return saveStatus.kind === "saving" ? " · 正在保存" : " · 待保存";
      };
      const pendingSnapshotRef = useRef(null);

      useEffect(() => { stateRef.current = state; }, [state]);

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
        const reduceMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
        setSaveStatus({ kind: "saving", text: "正在保存…" });
        try {
          await queueCredentialSync(credentialApi, snapshot.state, snapshot.touchedKeys);
          clearSavedKeys(snapshot);
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          setSaveStatus({ kind: "saved", text: "设置已保存" });
          if (snapshot.touchedKeys.has("enabledModels")) {
            setModelSyncStatus({ kind: "saved", text: "已保存到 DSH；重新打开对话模型列表即可看到 [vision]。" });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSaveStatus({ kind: "error", text: `保存失败：${message}；将在 3 秒后重试。` });
          if (snapshot.touchedKeys.has("enabledModels")) {
            setModelSyncStatus({ kind: "error", text: `保存失败：${message}` });
          }
          if (!retryTimerRef.current) {
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              setSaveRetry((value) => value + 1);
            }, 3000);
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
          revisions: new Map([...keys].map((key) => [key, revisionsRef.current.get(key)])),
        };
        pendingSnapshotRef.current = null;
        await persistSnapshot(snapshot);
      }, [persistSnapshot]);

      const retrySaving = useCallback(() => {
        void saveCurrentChanges().catch(() => undefined);
      }, [saveCurrentChanges]);

      // The server's credential store is the source of truth.  localStorage is
      // only a non-secret recovery draft, reapplied solely for unsaved edits.
      useEffect(() => {
        let cancelled = false;
        void loadPersistedSettings()
          .then((remote) => {
            if (cancelled) return;
            setState((previous) => {
              const merged = { ...remote.state };
              for (const key of dirtyKeysRef.current) merged[key] = previous[key];
              return merged;
            });
            setApiKeyStatus({ kind: "ready", configured: remote.apiKeyConfigured });
            setSettingsReady(true);
          })
          .catch((error) => {
            if (cancelled) return;
            setApiKeyStatus({ kind: "unknown", configured: false });
            setStatus({ kind: "error", text: `无法读取已保存设置：${error instanceof Error ? error.message : String(error)}。可继续编辑，恢复后会自动重试保存。` });
            setSettingsReady(true);
          });
        return () => { cancelled = true; };
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
          revisions: new Map([...touchedKeys].map((key) => [key, revisionsRef.current.get(key)])),
        };
        pendingSnapshotRef.current = snapshot;
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          pendingSnapshotRef.current = null;
          void persistSnapshot(snapshot).catch(() => undefined);
        }, CREDENTIAL_SYNC_DELAY_MS);
        return () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
      }, [state, touchedKeys, settingsReady, saveRetry, persistSnapshot]);

      // Leaving this page does not discard the recovery draft.  For a typed API
      // key (which must never be written to localStorage), make one final save attempt.
      useEffect(() => () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        const pending = pendingSnapshotRef.current;
        if (pending?.touchedKeys.has("apiKey")) {
          void queueCredentialSync(credentialApi, pending.state, pending.touchedKeys).catch(() => undefined);
        }
      }, []);

      const update = (key, value) => {
        nextRevisionRef.current += 1;
        revisionsRef.current.set(key, nextRevisionRef.current);
        dirtyKeysRef.current.add(key);
        setTouchedKeys((previous) => new Set([...previous, key]));
        setState((prev) => ({ ...prev, [key]: value }));
      };

      const updateMany = (values) => {
        const entries = Object.entries(values);
        for (const [key] of entries) {
          nextRevisionRef.current += 1;
          revisionsRef.current.set(key, nextRevisionRef.current);
          dirtyKeysRef.current.add(key);
        }
        setTouchedKeys((previous) => new Set([...previous, ...entries.map(([key]) => key)]));
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
        const missing = getConnectionRequirements(stateRef.current, apiKeyStatus.configured, false);
        if (missing.length > 0) {
          setVisionModelStatus({ kind: "error", text: `请先填写或保存：${missing.join("、")}。` });
          return;
        }
        try {
          setVisionModelStatus({ kind: "loading", text: "正在保存连接设置…" });
          await saveCurrentChanges();
          setVisionModelStatus({ kind: "loading", text: "连接设置已保存，正在读取 /models…" });
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
      }, [apiKeyStatus.configured, saveCurrentChanges]);

      const toggleVisionModel = (provider, model) => {
        const key = routeKey(provider, model);
        const exists = state.enabledModels.some((entry) => routeKey(entry.provider, entry.model) === key);
        const enabledModels = exists
          ? state.enabledModels.filter((entry) => routeKey(entry.provider, entry.model) !== key)
          : [...state.enabledModels, { provider, model }];
        update("enabledModels", enabledModels);
        setModelSyncStatus({ kind: "saving", text: "将在短暂编辑停顿后保存对话视觉模型…" });
      };

      const runConnectionTest = useCallback(async ({ saveFirst }) => {
        if (!canTestConnection) {
          setStatus({ kind: "error", text: `测试前请先完成：${connectionRequirements.join("、")}。` });
          return;
        }
        setTesting(true);
        setStatus({ kind: "loading", text: saveFirst ? "正在保存并测试连接…" : "正在测试已保存的连接…" });
        const testFingerprint = connectionFingerprint(stateRef.current, apiKeyStatus.configured);
        try {
          if (saveFirst) {
            try {
              await saveCurrentChanges();
            } catch (error) {
              throw new Error(`保存设置失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }
          const result = await testConnection();
          const currentFingerprint = connectionFingerprint(stateRef.current, apiKeyStatus.configured);
          if (currentFingerprint === testFingerprint) {
            setConnectionTestStatus({ kind: "ok", fingerprint: testFingerprint, at: Date.now(), elapsedMs: result.elapsedMs });
            setLastTestedApiKeyRevision(revisionsRef.current.get("apiKey") || 0);
            setStatus({ kind: "ok", text: `连接正常${result.elapsedMs === null ? "" : ` · ${result.elapsedMs}ms`}` });
          } else {
            setStatus({ kind: "ok", text: "连接已测试，但配置已在测试期间修改；请重新测试。" });
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
          setStatus({ kind: "error", text: "连接设置尚未保存；请展开后使用「保存并测试连接」。" });
          return;
        }
        await runConnectionTest({ saveFirst: false });
      }, [connectionHasPendingChanges, runConnectionTest]);

      const onSaveAndTestConnection = useCallback(async () => {
        await runConnectionTest({ saveFirst: true });
      }, [runConnectionTest]);

      // 首次点击进入确认态（按钮文字变化），再次点击才真正清除；4 秒未确认自动取消。
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
          setStatus({ kind: "ok", text: "已清除保存的 API Key" });
          await refreshApiKeyStatus();
        } catch (error) {
          setStatus({ kind: "error", text: `清除失败：${error instanceof Error ? error.message : String(error)}` });
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
        setStatus({ kind: "ok", text: "分析参数已恢复默认，正在保存。" });
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
            fontFamily: "var(--dsw-alias-font-body, system-ui, sans-serif)",
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
                marginBottom: 20,
              },
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("h2", {
                      style: {
                        margin: 0,
                        fontSize: 18,
                        fontWeight: 600,
                        color: "var(--dsw-alias-label-primary, #e0e0e0)",
                      },
                      children: "视觉分析",
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                      style: { margin: "4px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #888)" },
                      children: "为不支持图片的对话模型补充可引用的视觉证据。",
                    }),
                  ],
                }),
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 },
                  children: [
                    saveStatus.kind !== "idle" &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
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
                          color:
                            saveStatus.kind === "saved"
                              ? "#4ade80"
                              : saveStatus.kind === "error"
                                ? "#f87171"
                                : "var(--dsw-alias-label-tertiary, #888)",
                        },
                        children: saveStatus.text,
                      }),
                    saveStatus.kind === "error" &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("button", {
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
                          whiteSpace: "nowrap",
                        },
                        children: "立即重试",
                      }),
                  ],
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
                role: status.kind === "error" ? "alert" : "status",
                "aria-live": status.kind === "error" ? "assertive" : "polite",
                children: status.text,
              }),

            apiKeyStatus.kind === "ready" &&
              /* @__PURE__ */ reactJsxRuntime.jsx(SetupGuide, {
                state,
                apiKeyConfigured: apiKeyStatus.configured,
              }),

            /* connection: concise status by default, editable only on demand */
            /* @__PURE__ */ reactJsxRuntime.jsx(SettingsSection, {
              id: "vision-connection-settings",
              title: "连接设置",
              summary: (connectionReady
                ? connectionTestIsStale
                  ? `配置已变更 · 待重新测试 · ${state.model}`
                  : connectionTestStatus.kind === "ok"
                    ? `已验证 · ${state.model} · ${state.baseUrl.replace(/^https?:\/\//, "")} · ${new Date(connectionTestStatus.at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                    : `待验证 · ${state.model} · ${state.baseUrl.replace(/^https?:\/\//, "")}`
                : "完成 API Key、Base URL 与视觉模型后即可使用") + sectionSaveHint(connectionHasPendingChanges),
              expanded: expandedSections.connection,
              onToggle: toggleConnectionSection,
              contentVisible: expandedSections.connection || connectionTransition === "closing",
              contentTransition: connectionTransition,
              action: (!expandedSections.connection || connectionTransition === "opening" || connectionTransition === "closing") && connectionReady
                ? /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  className: "vision-primary-action vision-connection-header-test" + (connectionTransition === "opening" ? " vision-action-fade-out" : connectionTransition === "closing" ? " vision-action-fade-in" : ""),
                  onClick: onTestSavedConnection,
                  disabled: testing || !canTestConnection || connectionHasPendingChanges || connectionTransition === "opening",
                  title: connectionHasPendingChanges
                    ? "连接设置正在保存；如需立即验证，请展开后使用“保存并测试连接”"
                    : canTestConnection ? "测试当前已保存的连接" : `请先完成：${connectionRequirements.join("、")}`,
                  style: { minHeight: 34, padding: "6px 10px", borderRadius: 7, cursor: testing || !canTestConnection ? "not-allowed" : "pointer", fontSize: 12, whiteSpace: "nowrap" },
                  children: testing ? "测试中…" : connectionHasPendingChanges ? saveStatus.kind === "error" ? "保存失败" : "正在保存…" : "测试连接",
                })
                : null,
              children: /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                children: [
                /* @__PURE__ */ reactJsxRuntime.jsx(ConnectionOverview, {
                  state,
                  apiKeyConfigured: apiKeyStatus.configured,
                  apiKeyStatus: apiKeyStatus.kind,
                  pendingKeys: touchedKeys,
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx(TextField, {
                  id: "vision-api-key",
                  label: "API Key",
                  labelHint: apiKeyStatus.kind === "ready" ? (apiKeyStatus.configured ? "已保存" : "未配置") : "正在检查…",
                  value: state.apiKey,
                  placeholder: apiKeyStatus.configured ? "已保存；输入新 Key 可替换" : "sk-…",
                  password: true,
                  onChange: (value) => update("apiKey", value),
                }),
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "-2px 0 12px", fontSize: 12 },
                  role: "status",
                  "aria-live": "polite",
                  children: [
                    apiKeyStatus.kind === "loading" &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "var(--dsw-alias-label-tertiary, #888)" },
                        children: "正在检查 API Key 配置状态…",
                      }),
                    apiKeyStatus.kind === "ready" && apiKeyStatus.configured &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                        style: { color: "#4ade80" },
                        children: "密钥仅存储在 DSH 凭据中。",
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
                          whiteSpace: "nowrap",
                        },
                        children: confirmClear ? "确认清除？" : "清除 API Key",
                      }),
                    confirmClear &&
                      /* @__PURE__ */ reactJsxRuntime.jsx("button", {
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
                          whiteSpace: "nowrap",
                        },
                        children: "取消",
                      }),
                  ],
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx(TextField, {
                  id: "vision-base-url",
                  label: "Base URL",
                  value: state.baseUrl,
                  placeholder: "https://api.example.com/v1",
                  onChange: (value) => update("baseUrl", value),
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx(VisionModelPicker, {
                  value: state.model,
                  onChange: (value) => update("model", value),
                  options: visionModelOptions,
                  status: visionModelStatus,
                  onRefresh: refreshVisionModelCatalog,
                }),
                /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  className: "vision-connection-verify",
                  style: { marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--dsw-alias-border-l2, #333)" },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      style: { marginBottom: 8, color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 12, fontWeight: 600 },
                      children: "验证此配置",
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                      style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
                      children: [
                        /* @__PURE__ */ reactJsxRuntime.jsx(ConnectionTestStatus, {
                          requirements: connectionRequirements,
                          testStatus: connectionTestStatus,
                          testIsStale: connectionTestIsStale,
                        }),
                        /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                          type: "button",
                          className: "vision-primary-action vision-connection-footer-test" + (connectionTransition === "opening" ? " vision-action-fade-in" : connectionTransition === "closing" ? " vision-action-fade-out" : ""),
                          onClick: onSaveAndTestConnection,
                          disabled: testing || !canTestConnection,
                          title: canTestConnection ? "保存当前编辑并测试连接" : `请先完成：${connectionRequirements.join("、")}`,
                          style: { minHeight: 38, padding: "7px 12px", borderRadius: 7, cursor: testing || !canTestConnection ? "not-allowed" : "pointer", fontSize: 12, whiteSpace: "nowrap" },
                          children: testing ? "测试中…" : "保存并测试连接",
                        }),
                      ],
                    }),
                  ],
                }),
                ],
              }),
            }),

            /* common path is open; lower-frequency controls stay out of the way */
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              children: [
                /* @__PURE__ */ reactJsxRuntime.jsxs(SettingsSection, {
                  id: "vision-common-settings",
                  title: "常用策略",
                  summary: `视觉基元：${state.primitives === "auto" ? "自动" : state.primitives === "on" ? "始终开启" : "关闭"} · 分析细节：${state.detail === "standard" ? "标准" : state.detail === "brief" ? "简短" : "详细"}` + sectionSaveHint(commonHasPendingChanges),
                  expanded: true,
                  onToggle: null,
                  children: [
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
                  "决定是否输出带坐标的可引用视觉证据。",
                  {
                    auto: "自动：仅在定位、界面与计数等任务中启用。",
                    on: "始终开启：回答会更长，但更适合后续定位。",
                    off: "关闭：仅返回自然语言概述。",
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
                  "控制回答的展开程度、延迟与 Token 消耗。",
                  {
                    brief: "简短：适合快速确认。",
                    standard: "标准：适合大多数对话。",
                    verbose: "详细：适合复杂界面和文档审阅。",
                  }[state.detail]
                ),
                  ],
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx(SettingsSection, {
                  id: "vision-advanced-settings",
                  title: "高级控制",
                  summary: (describeAdvancedChanges(state).length > 0 ? `已调整：${describeAdvancedChanges(state).join(" · ")}` : "全部使用推荐默认值") + sectionSaveHint(advancedHasPendingChanges),
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
                          whiteSpace: "nowrap",
                        },
                        children: confirmReset ? "确认恢复默认？" : "恢复默认",
                      }),
                      confirmReset && /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                        type: "button",
                        onClick: () => setConfirmReset(false),
                        style: { minHeight: 30, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #444)", background: "transparent", color: "var(--dsw-alias-label-secondary, #aaa)", cursor: "pointer", fontSize: 12 },
                        children: "取消",
                      }),
                    ],
                  }),
                  children: /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                    children: [
                confirmReset && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  role: "status",
                  "aria-live": "polite",
                  style: { margin: "12px 0", padding: "8px 10px", borderRadius: 7, background: "rgba(248,113,113,0.08)", color: "#fbbf24", fontSize: 12, lineHeight: 1.5 },
                  children: "将恢复重试模式、图片大小、超时和 Token 预算为推荐默认值；连接设置与已启用模型不会改变。",
                }),
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
                  "仅在结果的结构或格式不完整时，是否再请求一次模型。",
                  {
                    off: "关闭：速度与费用最可控。",
                    "format-only": "仅格式：为坐标化工作流补一次请求。",
                    on: "开启：优先保证结构完整，可能增加耗时与费用。",
                  }[state.retry]
                ),
                /* @__PURE__ */ reactJsxRuntime.jsx(NumberField, {
                  id: "vision-max-image-bytes",
                  label: "最大图片大小（MB）",
                  value: state.maxImageBytes / BYTES_PER_MEGABYTE,
                  min: 1,
                  max: 50,
                  step: 1,
                  description: "超过此大小的图片会在本地拒绝，不会上传。",
                  recommendation: "建议保持 5–10 MB：过大图片会显著增加编码体积、传输时间与超时概率。",
                  onChange: (value) => update("maxImageBytes", value * BYTES_PER_MEGABYTE),
                }),
                /* @__PURE__ */ reactJsxRuntime.jsx(NumberField, {
                  id: "vision-timeout-ms",
                  label: "视觉请求超时（毫秒）",
                  value: state.timeoutMs,
                  min: 5000,
                  max: 300000,
                  step: 1000,
                  description: "视觉模型在此时间内未返回时，本次分析会停止。",
                  recommendation: "默认 180000（3 分钟）。本地或较慢模型建议不低于 60000；不要无限调大，以免对话长期无响应。",
                  onChange: (value) => update("timeoutMs", value),
                }),
                selectField(
                  "输出 Token 预算",
                  "maxTokensMode",
                  state.maxTokensMode,
                  update,
                  [
                    { value: "auto", label: "自动（推荐）" },
                    { value: "manual", label: "手动指定" },
                  ],
                  "限制一次视觉分析的最大输出长度。",
                  state.maxTokensMode === "auto"
                    ? "自动：按分析细节分配预算。"
                    : "手动：为所有任务使用固定上限。"
                ),
                state.maxTokensMode === "auto"
                  ? /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                    style: { margin: "-2px 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-tertiary, #888)" },
                    children: "自动预算：简短 1024 / 标准 2048 / 详细 4096。",
                  })
                  : /* @__PURE__ */ reactJsxRuntime.jsx(NumberField, {
                    id: "vision-max-tokens",
                    label: "最大输出 Token",
                    value: state.maxTokens,
                    min: 256,
                    max: 65536,
                    step: 256,
                    description: "数值越高，结果更完整，但响应可能更慢。",
                    recommendation: "普通截图 1024–2048；复杂界面或文档 2048–4096。",
                    onChange: (value) => update("maxTokens", value),
                  }),
                    ],
                  }),
                }),
              ],
            }),

            /* bridge models are a separate enhancement, not a prerequisite */
            /* @__PURE__ */ reactJsxRuntime.jsx(SettingsSection, {
              id: "vision-bridge-settings",
              title: "对话增强",
              summary: (state.enabledModels.length > 0
                ? unavailableEnabledModels.length > 0
                  ? `已启用 ${state.enabledModels.length} 个模型 · ${unavailableEnabledModels.length} 个当前不可用`
                  : `已启用 ${state.enabledModels.length} 个模型`
                : "尚未启用对话增强模型") + sectionSaveHint(bridgeHasPendingChanges),
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
                embedded: true,
              }),
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
                "设置会自动保存到 DSH 凭据存储，并在下一次视觉分析请求中生效。API Key 不会保存在浏览器本地存储；输入新值即可替换，移除请使用「清除 API Key」。",
            }),
          ],
        }
      );
    }

    /* ── form field helpers ─────────────────────────────────── */

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
        `,
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
          overflow: "hidden",
        },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
            className: "vision-section-header",
            style: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" },
            children: [
              collapsible
                ? /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
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
                    textAlign: "left",
                  },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsxs("span", {
                      style: { minWidth: 0 },
                      children: [
                        /* @__PURE__ */ reactJsxRuntime.jsx("h3", {
                          id: `${id}-heading`,
                          style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e0e0e0)" },
                          children: title,
                        }),
                        summary && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                          className: "vision-section-summary",
                          style: { display: "block", marginTop: 3, overflow: "hidden", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, lineHeight: 1.4, textOverflow: "ellipsis", whiteSpace: "nowrap" },
                          children: summary,
                        }),
                      ],
                    }),
                    /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                      className: "vision-disclosure-icon",
                      "aria-hidden": true,
                      style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" },
                      children: "▾",
                    }),
                  ],
                })
                : /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                  style: { flex: "1 1 180px", minWidth: 0 },
                  children: [
                    /* @__PURE__ */ reactJsxRuntime.jsx("h3", {
                      id: `${id}-heading`,
                      style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e0e0e0)" },
                      children: title,
                    }),
                    summary && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                      className: "vision-section-summary",
                      style: { marginTop: 3, color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, lineHeight: 1.4 },
                      children: summary,
                    }),
                  ],
                }),
              action && /* @__PURE__ */ reactJsxRuntime.jsx("div", { className: "vision-section-action", style: { flex: "0 0 auto" }, children: action }),
            ],
          }),
          contentVisible && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
            id: contentId,
            className: "vision-section-content" + (contentTransition === "closing" ? " vision-content-closing" : ""),
            "aria-hidden": contentTransition === "closing" || undefined,
            style: { padding: "0 14px 14px", borderTop: "1px solid var(--dsw-alias-border-l2, #333)" },
            children,
          }),
        ],
      });
    }

    function ConnectionTestStatus({ requirements, testStatus, testIsStale }) {
      const testText = requirements.length > 0
        ? `待完成：${requirements.join("、")}`
        : testIsStale
          ? "配置已变更，请重新测试"
          : testStatus.kind === "ok"
            ? `上次测试正常 · ${new Date(testStatus.at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
            : "尚未测试连接";
      const testColor = requirements.length > 0 || testIsStale
        ? "#fbbf24"
        : testStatus.kind === "ok"
          ? "#4ade80"
          : "var(--dsw-alias-label-tertiary, #888)";
      return /* @__PURE__ */ reactJsxRuntime.jsx("div", {
        role: "status",
        "aria-live": "polite",
        style: { flex: "1 1 220px", minWidth: 0, color: testColor, fontSize: 12, lineHeight: 1.45 },
        children: testText,
      });
    }

    function ConnectionOverview({ state, apiKeyConfigured, apiKeyStatus, pendingKeys }) {
      const apiKeyPending = pendingKeys.has("apiKey");
      const baseUrlPending = pendingKeys.has("baseUrl");
      const modelPending = pendingKeys.has("model");
      const entries = [
        {
          label: "API Key",
          value: apiKeyStatus === "loading" ? "正在检查…" : apiKeyPending ? "待保存" : apiKeyConfigured ? "已保存" : "未配置",
          tone: apiKeyPending ? "#fbbf24" : apiKeyConfigured ? "#4ade80" : "var(--dsw-alias-label-tertiary, #888)",
        },
        {
          label: "Base URL",
          value: state.baseUrl.trim() ? state.baseUrl.trim().replace(/^https?:\/\//, "") : "未填写",
          meta: baseUrlPending ? "待保存" : state.baseUrl.trim() ? "已填写" : "未配置",
          tone: baseUrlPending ? "#fbbf24" : "var(--dsw-alias-label-primary, #e0e0e0)",
        },
        {
          label: "视觉模型",
          value: state.model.trim() || "未选择",
          meta: modelPending ? "待保存" : state.model.trim() ? "已选择" : "未配置",
          tone: modelPending ? "#fbbf24" : "var(--dsw-alias-label-primary, #e0e0e0)",
        },
      ];
      return /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
        className: "vision-connection-overview",
        style: { margin: "12px 0 16px" },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsx("div", {
            style: { marginBottom: 8, color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 12, fontWeight: 600 },
            children: "当前配置",
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("div", {
            className: "vision-connection-overview-grid",
            style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 },
            children: entries.map((entry) =>
              /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
                style: { minWidth: 0, padding: "8px 9px", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 7, background: "var(--dsw-alias-bg-layer-2, #2a2a2a)" },
                children: [
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", { style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 11 }, children: entry.label }),
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", { title: entry.value, style: { marginTop: 3, overflow: "hidden", color: entry.tone, fontSize: 12, fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: entry.value }),
                  entry.meta && /* @__PURE__ */ reactJsxRuntime.jsx("div", { style: { marginTop: 2, color: entry.meta === "待保存" ? "#fbbf24" : "var(--dsw-alias-label-tertiary, #888)", fontSize: 11 }, children: entry.meta }),
                ],
              }, entry.label)
            ),
          }),
        ],
      });
    }

    function SetupGuide({ state, apiKeyConfigured }) {
      const missing = getConnectionRequirements(state, apiKeyConfigured, true);
      if (missing.length === 0) return null;
      const steps = [
        { key: "api", label: "保存 API Key", done: apiKeyConfigured || Boolean(state.apiKey.trim()) },
        { key: "base", label: "填写 Base URL", done: Boolean(state.baseUrl.trim()) },
        { key: "model", label: "选择或填写视觉模型", done: Boolean(state.model.trim()) },
        { key: "test", label: "测试连接", done: false },
      ];
      return /* @__PURE__ */ reactJsxRuntime.jsxs("section", {
        "aria-labelledby": "vision-setup-guide-heading",
        style: {
          marginBottom: 16,
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid rgba(96,165,250,0.32)",
          background: "rgba(96,165,250,0.08)",
        },
        children: [
          /* @__PURE__ */ reactJsxRuntime.jsx("h3", {
            id: "vision-setup-guide-heading",
            style: { margin: "0 0 5px", fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e0e0e0)" },
            children: "开始配置视觉分析",
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("p", {
            style: { margin: "0 0 9px", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary, #aaa)" },
            children: `还缺少：${missing.join("、")}。完成以下步骤后即可测试连接。`,
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("ol", {
            style: { display: "flex", flexWrap: "wrap", gap: "5px 14px", margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" },
            children: steps.map((step) =>
              /* @__PURE__ */ reactJsxRuntime.jsx("li", {
                style: { color: step.done ? "#4ade80" : "var(--dsw-alias-label-secondary, #aaa)" },
                children: `${step.done ? "已完成：" : ""}${step.label}`,
              }, step.key)
            ),
          }),
        ],
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
              marginBottom: 4,
            },
            children: [
              /* @__PURE__ */ reactJsxRuntime.jsx("span", { children: label }),
              labelHint && /* @__PURE__ */ reactJsxRuntime.jsx("span", {
                className: "vision-field-status",
                style: { color: labelHint === "已保存" ? "#4ade80" : "var(--dsw-alias-label-tertiary, #888)", fontSize: 11 },
                children: labelHint,
              }),
            ],
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
                  boxSizing: "border-box",
                },
              }),
              password &&
                /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                  type: "button",
                  className: "vision-inline-action",
                  onClick: () => setShow((previous) => !previous),
                  "aria-label": show ? "隐藏 API Key" : "显示 API Key",
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
                    fontSize: 12,
                  },
                  children: show ? "隐藏" : "显示",
                }),
            ],
          }),
        ],
      });
    }

    function selectField(label, key, value, onChange, options, description, selectedHint) {
      const fieldId = `vision-${key}`;
      const descriptionId = description ? `${fieldId}-description` : undefined;
      const hintId = selectedHint ? `${fieldId}-hint` : undefined;
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
              marginBottom: 4,
            },
            children: label,
          }),
          description &&
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              id: descriptionId,
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)",
              },
              children: description,
            }),
          /* @__PURE__ */ reactJsxRuntime.jsx("select", {
            id: fieldId,
            className: "vision-control",
            "aria-describedby": [descriptionId, hintId].filter(Boolean).join(" ") || undefined,
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
                lineHeight: 1.55,
              },
              children: selectedHint,
            }),
        ],
      });
    }

    function NumberField({ id, label, value, min, max, step, description, recommendation, onChange }) {
      const descriptionId = description ? `${id}-description` : undefined;
      const recommendationId = recommendation ? `${id}-recommendation` : undefined;
      const validationId = `${id}-validation`;
      // draft 暂存输入过程中的任意中间态（空串、越界、非整数均可），失焦或回车时 clamp 后提交。
      const [draft, setDraft] = useState(null);
      const [validationMessage, setValidationMessage] = useState("");
      const [correction, setCorrection] = useState(null);
      const commit = () => {
        if (draft === null) return;
        const raw = draft.trim();
        if (!raw) {
          setCorrection(null);
          setValidationMessage(`请输入 ${min} 到 ${max} 之间的整数。`);
          return;
        }
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) {
          setCorrection(null);
          setValidationMessage("请输入有效数字。");
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
          setValidationMessage(`输入值已调整为允许范围内的 ${clamped}。`);
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
              marginBottom: 4,
            },
            children: label,
          }),
          description &&
            /* @__PURE__ */ reactJsxRuntime.jsx("p", {
              id: descriptionId,
              style: {
                margin: "0 0 7px",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-tertiary, #888)",
              },
              children: description,
            }),
          /* @__PURE__ */ reactJsxRuntime.jsx("input", {
            id,
            className: "vision-control",
            "aria-describedby": [descriptionId, recommendationId, validationMessage ? validationId : undefined].filter(Boolean).join(" ") || undefined,
            "aria-invalid": validationMessage && !correction ? true : undefined,
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
              boxSizing: "border-box",
            },
          }),
          validationMessage &&
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
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
                    setValidationMessage("已还原为修改前的值。");
                  },
                  style: { minHeight: 26, padding: "3px 7px", borderRadius: 5, border: "1px solid rgba(251,191,36,0.6)", background: "transparent", color: "#fcd34d", cursor: "pointer", fontSize: 12 },
                  children: "还原",
                }),
              ],
            }),
          recommendation &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              id: recommendationId,
              className: "vision-recommendation",
              style: {
                marginTop: 7,
                color: "var(--dsw-alias-label-secondary, #aaa)",
                fontSize: 12,
                lineHeight: 1.55,
              },
              children: recommendation,
            }),
        ],
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
      const orderedOptions = normalizedQuery
        ? matchingOptions
        : [
          ...(selectedModel ? [selectedModel] : []),
          ...options.filter((model) => model !== selectedModel),
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

      const statusText = status.kind === "idle"
        ? "可直接输入模型 ID，或读取当前服务的可用模型。"
        : status.text;

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
            children: "视觉模型",
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
                    placeholder: "选择或输入模型 ID",
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
                    "aria-controls": open ? listboxId : undefined,
                    "aria-activedescendant": open && visibleOptions[activeIndex] ? `vision-model-option-${activeIndex}` : undefined,
                    style: {
                      width: "100%",
                      padding: "7px 42px 7px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--dsw-alias-border-l2, #444)",
                      background: "var(--dsw-alias-bg-layer-1, #252525)",
                      color: "var(--dsw-alias-label-primary, #e0e0e0)",
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    },
                  }),
                  /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                    type: "button",
                    className: "vision-model-disclosure",
                    onClick: toggleOptions,
                    disabled: status.kind === "loading",
                    "aria-label": options.length > 0 ? "打开模型列表" : "读取并打开模型列表",
                    "aria-haspopup": "listbox",
                    "aria-expanded": open,
                    "aria-controls": open ? listboxId : undefined,
                    title: options.length > 0 ? "浏览模型" : "读取模型",
                    style: { position: "absolute", top: 3, right: 3, minWidth: 34, height: 34, padding: 0, border: "none", borderRadius: 5, background: open ? "rgba(96,165,250,0.16)" : "transparent", color: "var(--dsw-alias-label-secondary, #aaa)", cursor: status.kind === "loading" ? "not-allowed" : "pointer", fontSize: 14 },
                    children: status.kind === "loading" ? "…" : open ? "▴" : "▾",
                  }),
                ],
              }),
              /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                type: "button",
                className: "vision-secondary-action",
                onClick: refreshOptions,
                disabled: status.kind === "loading",
                style: { flex: "0 0 auto", cursor: status.kind === "loading" ? "not-allowed" : "pointer" },
                children: status.kind === "loading" ? "读取中…" : options.length > 0 ? "刷新" : "读取模型",
              }),
            ],
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("div", {
            role: status.kind === "error" ? "alert" : "status",
            "aria-live": status.kind === "error" ? "assertive" : "polite",
            style: { marginTop: 7, color: status.kind === "error" ? "#f87171" : usingManualModel ? "#fbbf24" : "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, lineHeight: 1.5 },
            children: status.kind === "ready" && usingManualModel ? `目录中未找到“${value.trim()}”；将使用手动输入的模型 ID。` : statusText,
          }),
          open &&
            /* @__PURE__ */ reactJsxRuntime.jsxs("div", {
              id: listboxId,
              className: "vision-model-options",
              role: "listbox",
              "aria-label": "视觉模型选项",
              style: { marginTop: 9, maxHeight: 220, overflowY: "auto", padding: 4, border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 8, background: "var(--dsw-alias-bg-layer-2, #2a2a2a)" },
              children: [
                options.length > 0 && /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  role: "status",
                  style: { padding: "5px 6px 7px", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 11, lineHeight: 1.4 },
                  children: hasMoreOptions
                    ? normalizedQuery
                      ? `匹配 ${orderedOptions.length} 个模型，显示前 ${visibleOptions.length} 个。继续输入可缩小范围。`
                      : `已加载 ${options.length} 个模型；已置顶当前选择，显示前 ${visibleOptions.length} 个。输入可筛选全部目录。`
                    : normalizedQuery
                      ? `找到 ${orderedOptions.length} 个匹配模型。`
                      : `已加载 ${options.length} 个模型。`,
                }),
                visibleOptions.length > 0
                  ? visibleOptions.map((model, index) =>
                  /* @__PURE__ */ reactJsxRuntime.jsxs("button", {
                    id: `vision-model-option-${index}`,
                    role: "option",
                    type: "button",
                    onClick: () => selectModel(model),
                    "aria-selected": model === value,
                    style: { display: "flex", width: "100%", minHeight: 38, alignItems: "center", padding: "7px 9px", border: "none", borderRadius: 5, background: model === value || index === activeIndex ? "rgba(96,165,250,0.16)" : "transparent", color: "var(--dsw-alias-label-primary, #e0e0e0)", cursor: "pointer", textAlign: "left", fontSize: 13 },
                    children: [model, model === value && "  已选择"],
                  }, model)
                )
                  : /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                  style: { padding: "12px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                  children: status.kind === "loading" ? "正在读取模型目录…" : options.length === 0 ? "尚未读取到模型。可直接输入模型 ID，或检查连接后重新读取。" : "没有匹配的模型，可直接使用当前输入内容。",
                }),
              ],
            }),
        ],
      });
    }

    function VisionModelSelector({ groups, enabledModels, catalogStatus, modelSyncStatus, toggleModel, refreshCatalog, unavailableEnabledModels, embedded }) {
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
      return /* @__PURE__ */ reactJsxRuntime.jsxs(embedded ? "div" : "section", {
        "aria-labelledby": "vision-dialog-models-heading",
        className: "vision-model-selector",
        style: {
          background: embedded ? "transparent" : "var(--dsw-alias-bg-layer-3, #1e1e1e)",
          border: embedded ? "none" : "1px solid var(--dsw-alias-border-l2, #333)",
          borderRadius: embedded ? 0 : 12,
          padding: embedded ? "12px 0 0" : "16px 18px",
          marginBottom: embedded ? 0 : 16,
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
                    children: "选择要增强的模型",
                  }),
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
                    style: { marginTop: 4, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
                    children: `已启用 ${enabled.size} 个模型；仅勾选的模型会显示 [vision]。`,
                  }),
                ],
              }),
              /* @__PURE__ */ reactJsxRuntime.jsx("button", {
                type: "button",
                className: "vision-secondary-action",
                onClick: () => void refreshCatalog(),
                disabled: catalogStatus.kind === "loading",
                style: { cursor: catalogStatus.kind === "loading" ? "not-allowed" : "pointer" },
                children: "刷新",
              }),
            ],
          }),
          /* @__PURE__ */ reactJsxRuntime.jsx("p", {
            style: { margin: "0 0 12px", fontSize: 12, lineHeight: 1.55, color: "var(--dsw-alias-label-secondary, #aaa)" },
            children: "选择需要由外部视觉模型增强的纯文本对话模型。修改会自动保存；重新打开模型列表后即可使用。",
          }),
          unavailableEnabledModels.length > 0 &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: "alert",
              style: { margin: "0 0 12px", padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(251,191,36,0.36)", background: "rgba(251,191,36,0.08)", color: "#fcd34d", fontSize: 12, lineHeight: 1.5 },
              children: `当前模型目录中找不到 ${unavailableEnabledModels.length} 个已启用模型：${unavailableEnabledModels.map((entry) => `${entry.provider}/${entry.model}`).join("、")}。请确认 Provider 配置，或取消勾选这些模型。`,
            }),
          modelSyncStatus.text &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: modelSyncStatus.kind === "error" ? "alert" : "status",
              "aria-live": modelSyncStatus.kind === "error" ? "assertive" : "polite",
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
              role: "status",
              "aria-live": "polite",
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: catalogStatus.text,
            }),
          catalogStatus.kind === "error" &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              role: "alert",
              style: { fontSize: 12, color: "#f87171", lineHeight: 1.5 },
              children: catalogStatus.text,
            }),
          catalogStatus.kind === "ready" && groups.length === 0 &&
            /* @__PURE__ */ reactJsxRuntime.jsx("div", {
              style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
              children: "当前没有可选择的模型。请先在“模型”设置中完成至少一个 Provider 配置。",
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
                paddingTop: 10,
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
                      className: "vision-disclosure-icon",
                      style: { color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 12, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" },
                      children: "▾",
                    }),
                  ],
                }),
                expanded &&
                  /* @__PURE__ */ reactJsxRuntime.jsx("div", {
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
