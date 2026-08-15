export const DEFAULT_MAX_TOKENS = 65536;

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

export async function requestVisionCompletion({ baseURL, apiKey, model, messages, signal }) {
  const mimo = isMimo(baseURL);
  const url = baseURL.replace(/\/?$/, "/") + "chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, mimo),
    body: JSON.stringify(buildPayload(model, messages, DEFAULT_MAX_TOKENS, mimo)),
    signal,
  });
  const data = await response.text();
  if (!response.ok) throw new Error(`vision API request failed with status ${response.status}`);
  return extractResponseContent(data);
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
