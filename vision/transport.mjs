export const DEFAULT_MAX_TOKENS = 2048;

export class VisionRequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VisionRequestError";
    this.code = code;
    this.details = details;
  }
}

export function isMimo(baseURL) {
  return typeof baseURL === "string" && baseURL.toLowerCase().includes("xiaomimimo.com");
}

function buildHeaders(apiKey, mimo) {
  const headers = { "Content-Type": "application/json" };
  if (mimo) headers["api-key"] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function buildPayload(model, messages, maxTokens, mimo) {
  const base = { model, messages, stream: false };
  return mimo ? { ...base, max_completion_tokens: maxTokens } : { ...base, max_tokens: maxTokens };
}

function createRequestSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    timeoutSignal,
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  };
}

function classifyParentAbort(reason) {
  const text = String(reason?.message || reason || "").toLowerCase();
  return /(cancel|stop|用户|取消)/i.test(text) ? "VISION_USER_CANCELLED" : "VISION_PARENT_ABORTED";
}

export async function requestVisionCompletion({ baseURL, apiKey, model, messages, maxTokens = DEFAULT_MAX_TOKENS, timeoutMs = 60000, signal }) {
  const mimo = isMimo(baseURL);
  const url = baseURL.replace(/\/?$/, "/") + "chat/completions";
  const request = createRequestSignal(signal, timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(apiKey, mimo),
      body: JSON.stringify(buildPayload(model, messages, maxTokens, mimo)),
      signal: request.signal,
    });
    const data = await response.text();
    if (!response.ok) {
      throw new VisionRequestError("VISION_API_HTTP_ERROR", `vision API request failed with status ${response.status}`, {
        elapsedMs: Date.now() - startedAt,
        httpStatus: response.status,
      });
    }
    return extractResponseContent(data);
  } catch (error) {
    if (error instanceof VisionRequestError) throw error;
    if (request.timeoutSignal.aborted) {
      throw new VisionRequestError("VISION_PLUGIN_TIMEOUT", `视觉请求在 ${timeoutMs} 毫秒后超时`, {
        elapsedMs: Date.now() - startedAt,
        abortSource: "plugin_timeout",
      });
    }
    if (signal?.aborted) {
      const code = classifyParentAbort(signal.reason);
      throw new VisionRequestError(code, code === "VISION_USER_CANCELLED" ? "视觉请求已由用户取消" : "视觉请求被 DSH 上游请求中止", {
        elapsedMs: Date.now() - startedAt,
        abortSource: "parent_signal",
      });
    }
    throw new VisionRequestError("VISION_RESPONSE_FORMAT_ERROR", error instanceof Error ? error.message : "视觉请求失败", {
      elapsedMs: Date.now() - startedAt,
    });
  }
}

function extractResponseContent(data) {
  try {
    const parsed = JSON.parse(data);
    const message = parsed?.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content.map((item) => item?.text || item?.content || "").filter(Boolean).join("\n");
      if (text.trim()) return text;
    }
    if (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) return message.reasoning_content;
    if (typeof parsed?.output_text === "string" && parsed.output_text.trim()) return parsed.output_text;
  } catch {
    // Non-JSON OpenAI-compatible responses are returned as text below.
  }
  return data;
}
