(() => {
  // client/index.js
  window.__ModuleLoader__.load({
    id: "dsh-external/dsh-tool-visual-primitives",
    factory: (require2) => {
      const react = require2("react");
      const reactJsxRuntime = require2("react/jsx-runtime");
      const { useState, useEffect, useCallback } = react;
      const NS = "dsh-tool-visual-primitives.settings";
      const STORAGE_KEY = `${NS}.state`;
      const FALLBACKS = {
        apiKey: "",
        baseUrl: "",
        model: "",
        primitives: "auto",
        detail: "standard",
        retry: "off",
        maxImageBytes: 10 * 1024 * 1024,
        timeoutMs: 6e4
      };
      function loadState() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return { ...FALLBACKS };
          const parsed = JSON.parse(raw);
          return { ...FALLBACKS, ...parsed };
        } catch {
          return { ...FALLBACKS };
        }
      }
      function saveState(state) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
        }
      }
      async function testConnection(state, setStatus) {
        setStatus({ kind: "loading", text: "\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026" });
        const start = Date.now();
        try {
          const url = state.baseUrl.replace(/\/?$/, "/") + "chat/completions";
          const headers = { "Content-Type": "application/json" };
          if (state.apiKey) {
            headers.Authorization = `Bearer ${state.apiKey}`;
          }
          const body = {
            model: state.model || "test",
            messages: [{ role: "user", content: "Say OK" }],
            max_tokens: 4,
            stream: false
          };
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(state.timeoutMs || 3e4)
          });
          const text = await res.text();
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
          const data = JSON.parse(text);
          const reply = data?.choices?.[0]?.message?.content?.trim() || "(empty)";
          const ms = Date.now() - start;
          setStatus({
            kind: "ok",
            text: `\u2705 \u8FDE\u63A5\u6B63\u5E38 \xB7 \u54CD\u5E94: "${reply}" \xB7 ${ms}ms`
          });
        } catch (err) {
          setStatus({
            kind: "error",
            text: `\u274C \u8FDE\u63A5\u5931\u8D25: ${err.message}`
          });
        }
      }
      function VisionSettings() {
        const [state, setState] = useState(loadState);
        const [status, setStatus] = useState({ kind: "idle", text: "" });
        useEffect(() => {
          saveState(state);
        }, [state]);
        const update = (key, value) => {
          setState((prev) => ({ ...prev, [key]: value }));
        };
        const onTest = useCallback(() => {
          testConnection(state, setStatus);
        }, [state]);
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
                    style: {
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--dsw-alias-border-l2, #444)",
                      background: "var(--dsw-alias-bg-layer-2, #2a2a2a)",
                      color: "var(--dsw-alias-label-primary, #e0e0e0)",
                      cursor: "pointer",
                      fontSize: 13
                    },
                    children: "\u6D4B\u8BD5\u8FDE\u63A5"
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
                  field("API Key", "apiKey", state.apiKey, update, "sk-\u2026", true),
                  field("Base URL", "baseUrl", state.baseUrl, update, "https://api.example.com/v1"),
                  field("Model", "model", state.model, update, "gpt-4o")
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
                    "Primitives Mode",
                    "primitives",
                    state.primitives,
                    update,
                    ["auto", "on", "off"]
                  ),
                  selectField(
                    "Detail Level",
                    "detail",
                    state.detail,
                    update,
                    ["brief", "standard", "verbose"]
                  ),
                  selectField(
                    "Retry Mode",
                    "retry",
                    state.retry,
                    update,
                    ["off", "on", "format-only"]
                  ),
                  numberField(
                    "Max Image Size (MB)",
                    "maxImageBytes",
                    state.maxImageBytes,
                    update,
                    1,
                    50,
                    1
                  ),
                  numberField(
                    "Timeout (ms)",
                    "timeoutMs",
                    state.timeoutMs,
                    update,
                    5e3,
                    3e5,
                    1e3
                  )
                ]
              }),
              /* footer hint */
              /* @__PURE__ */ reactJsxRuntime.jsx("p", {
                style: {
                  fontSize: 12,
                  color: "var(--dsw-alias-label-tertiary, #888)",
                  margin: 0,
                  lineHeight: 1.6
                },
                children: "\u914D\u7F6E\u81EA\u52A8\u4FDD\u5B58\u5230\u672C\u5730\u5B58\u50A8\u3002\u4FEE\u6539\u540E\u4E0B\u6B21\u4F7F\u7528 vision_analyze \u5DE5\u5177\u65F6\u751F\u6548\u3002"
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
      function selectField(label, key, value, onChange, options) {
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
              children: options.map(
                (opt) => /* @__PURE__ */ reactJsxRuntime.jsx(
                  "option",
                  { value: opt, children: opt },
                  opt
                )
              )
            })
          ]
        });
      }
      function numberField(label, key, value, onChange, min, max, step) {
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
              type: "number",
              value,
              min,
              max,
              step,
              onChange: (e) => onChange(key, Number(e.target.value)),
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
      function apply(ctx) {
        ctx.slots.inject(
          "settings.section",
          () => ctx.slots.register({
            name: "settings.section",
            id: "tool-visual-primitives",
            order: 100,
            label: () => "\u89C6\u89C9\u5206\u6790",
            inject: () => ({}),
            component: VisionSettings
          })
        );
      }
      exports.apply = apply;
      exports.inject = [];
      return module.exports;
    }
  });
})();
