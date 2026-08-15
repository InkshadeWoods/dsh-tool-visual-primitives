// dsh-tool-visual-primitives — model-facing `vision_analyze` tool.
//
// Routes an image (local path or URL) to an external vision model and returns
// its TEXT analysis. Pure-text loop: the conversation model never receives an
// image block, so a text-only conversation model can still "see" images.
//
// Registered as a raw JSON-Schema tool definition (no dsh package imports),
// so this plugin owns its own argument validation inside execute and stays
// free of any @deepseek-ai runtime dependency.
//
// References:
//   DeepSeek "Thinking with Visual Primitives" (2026.05)
//   https://github.com/deepseek-ai/Thinking-with-Visual-Primitives

export const name = "tool-visual-primitives";
export const inject = ["tools"];

const DEFAULT_MAX_TOKENS = 65536;
const VALID_PRIMITIVE_MODES = new Set(["auto", "on", "off"]);
const VALID_DETAIL_LEVELS = new Set(["brief", "standard", "verbose"]);
const VALID_RETRY_MODES = new Set(["off", "on", "format-only"]);

// ── Config (plain object with defaults, no schemastery) ────────────────────

export const DEFAULT_CONFIG = {
  apiKeyEnv: "VISION_API_KEY",
  baseUrlEnv: "VISION_BASE_URL",
  modelEnv: "VISION_MODEL",
  primitives: "auto",
  detail: "standard",
  retry: "off",
  maxImageBytes: 10 * 1024 * 1024,
  timeoutMs: 60000,
  upstream: "",
  visionProvider: true,
  bridgeMode: "append",
};

function normalizeConfig(config) {
  return { ...DEFAULT_CONFIG, ...(config || {}) };
}

// ── helpers ────────────────────────────────────────────────────────────────

function normalizeOption(value, fallback, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : fallback;
}

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`tool-visual-primitives: ${field} must be a positive integer`);
}

// ── mode detection (ported from vision.js) ────────────────────────────────

function detectVisionMode(prompt) {
  const text = prompt.toLowerCase();
  if (/(maze|reachable|solvable|迷宫|可达|走到|通路)/i.test(text)) return "topology";
  if (/(path|line|trace|route|connect|路径|路线|线条|连到|轨迹)/i.test(text)) return "path_tracing";
  if (/(count|number|how many|几个|多少|数量|计数)/i.test(text)) return "counting";
  if (/(button|click|menu|ui|screen|screenshot|按钮|点击|菜单|界面|截图|报错)/i.test(text)) return "ui_analysis";
  if (/(table|chart|diagram|poster|document|receipt|invoice|ocr|text|表格|图表|图示|海报|文档|票据|发票|文字|二维码)/i.test(text)) return "document_visual";
  if (/(compare|comparison|versus|vs\.?|比较|对比|区别|差异)/i.test(text)) return "comparison";
  if (/(larger|smaller|closer|farther|beside|overlap|relation|更大|更小|更近|更远|旁边|相邻|关系|重叠|遮挡|包含)/i.test(text)) return "spatial_relation";
  if (/(where|locate|location|position|位置|在哪|哪个|左边|右边|上方|下方|中间|附近)/i.test(text)) return "grounding";
  if (/(people|persons|characters|subjects|figures|group|人物|角色|主体|他们|这些人|这些对象|组合|从左到右|第.*位)/i.test(text)) return "multi_subject";
  if (/(list|objects|items|inventory|列出|有哪些|主要对象|物体|元素)/i.test(text)) return "object_inventory";
  return "caption";
}

function shouldUsePrimitives(mode, primitives, detail) {
  if (primitives === "off") return false;
  if (primitives === "on") return true;
  return mode !== "caption" || detail !== "brief";
}

function buildModeInstruction(mode) {
  const instructions = {
    caption: `
任务重点：普通图像理解。
- 给出整体图像摘要。
- 标注最关键的对象或区域。
- 不需要列出所有细枝末节。`,
    object_inventory: `
任务重点：对象清单。
- 尽量列出图中主要对象。
- 每个对象给稳定 id 和位置框。
- 避免重复列出同一个对象。`,
    multi_subject: `
任务重点：多主体分析。
- 按从左到右、从上到下的稳定顺序编号 subject_1、subject_2 等。
- 每个主体输出位置框、显著视觉特征、可确认身份和置信度。
- 若身份无法高置信确认，请明确写"不确定"，不要强行猜测。`,
    counting: `
任务重点：数量统计。
- 明确统计目标。
- 框出所有候选目标。
- 如有排除项，说明排除原因。
- 最终数量必须与候选列表一致。`,
    grounding: `
任务重点：对象定位。
- 定位用户提到的对象、区域或候选对象。
- 如果存在多个候选，全部列出并说明最可能者。
- 使用位置证据支持答案。`,
    spatial_relation: `
任务重点：空间关系。
- 定位参与关系判断的对象。
- 根据 box 或 point 说明上下、左右、远近、大小、遮挡、包含等关系。
- 只基于可见证据判断。`,
    comparison: `
任务重点：视觉比较。
- 先明确比较维度。
- 定位被比较对象。
- 分别列出可见证据，再给出比较结论。`,
    path_tracing: `
任务重点：路径/线条追踪。
- 定位起点。
- 使用 point 序列表示观察到的路径或轨迹。
- 定位终点。
- 在交叉、遮挡、不确定处明确说明。`,
    topology: `
任务重点：拓扑/可达性推理。
- 定位起点和终点。
- 使用 point 序列描述可见探索路径。
- 说明阻断、死路或连通依据。
- 最后给出 True/False 或可达/不可达结论。`,
    ui_analysis: `
任务重点：界面截图分析。
- 标注关键 UI 元素，如按钮、输入框、菜单、错误提示、选中状态。
- 给出元素位置和下一步建议。
- 不要建议点击不可见或不确定的元素。`,
    document_visual: `
任务重点：文档、图表、海报或截图文字结构分析。
- 标注标题、表格、图表、关键文本块、图例、二维码等区域。
- 说明阅读顺序和视觉层级。
- 无法看清的文字请说明不确定。`,
  };
  return instructions[mode] || instructions.caption;
}

function buildDetailInstruction(detail) {
  if (detail === "brief") {
    return `
详细程度：brief。
- 只列出回答问题所需的最少视觉基元。
- 观察和关系说明保持简短。`;
  }
  if (detail === "verbose") {
    return `
详细程度：verbose。
- 尽量完整列出关键对象、关系和不确定性。
- 对复杂任务给出更充分的可见证据。
- 仍然避免冗长不可验证的思维链。`;
  }
  return `
详细程度：standard。
- 列出主要视觉证据。
- 给出必要的关系和不确定性。
- 最终答案保持清晰直接。`;
}

function buildPrimitiveInstruction(mode, detail) {
  return `你是一个视觉证据提取与图像分析助手。请将论文式"Thinking with Visual Primitives"的思想用于当前图片分析：先建立可引用的视觉证据，再回答问题。

通用规则：
1. 先提取图像中的关键视觉证据，再回答用户问题。
2. 对可定位的对象、人物、区域使用 bounding box。
3. 对路径、轨迹、关键位置使用 point。
4. 坐标统一归一化到 0-999：左上角为 [0,0]，右下角为 [999,999]。
5. box 格式必须使用：<ref>object_id_or_name</ref><box>[[x1,y1,x2,y2]]</box>
6. point 格式必须使用：<point>[[x,y],[x,y],...]</point>
7. 请区分：视觉上可确认的事实、基于上下文推断的结论、不确定的信息。
8. 不要强行猜测不可确认的信息；低置信时明确说明不确定。
9. 不要输出冗长不可验证的思维链；输出可验证的视觉证据、简短依据和最终答案。

输出结构必须包含以下标题：
[Mode]
[Visual Primitives]
[Observations]
[Relations]
[Uncertainty]
[Answer]

当前模式：${mode}
${buildDetailInstruction(detail)}
${buildModeInstruction(mode)}`;
}

function buildVisionPrompt(userPrompt, mode, primitives, detail) {
  if (!shouldUsePrimitives(mode, primitives, detail)) return userPrompt;
  return `${buildPrimitiveInstruction(mode, detail)}

用户问题：
${userPrompt}`;
}

function hasPrimitiveMarkers(text) {
  return /<\s*(ref|box|point)\b/i.test(text) || /<｜\s*(ref|box|point)\s*｜>/i.test(text);
}

function buildRetryPrompt(userPrompt, mode, previousResult, primitives, detail, retryMode) {
  const formatDirective = retryMode === "format-only"
    ? "请尽量保持上一轮结论不变，只补齐和整理视觉基元格式。"
    : "请重新基于图片进行分析，并严格按视觉基元格式输出。";
  return `${buildPrimitiveInstruction(mode, detail)}

上一轮输出没有包含必要的 <ref>、<box> 或 <point> 视觉基元标记。
${formatDirective}

用户问题：
${userPrompt}

上一轮输出：
${previousResult}`;
}

// ── HTTP transport (Node global fetch; MiMo adapted) ─────────────────────

function isMimo(baseURL) {
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

async function request(baseURL, payload, headers, signal) {
  const url = baseURL.replace(/\/?$/, "/") + "chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.text();
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${data.slice(0, 300)}`);
  }
  return extractResponseContent(data);
}

function extractResponseContent(data) {
  try {
    const parsed = JSON.parse(data);
    const message = parsed?.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => item?.text || item?.content || "")
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return text;
    }
    if (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) {
      return message.reasoning_content;
    }
    if (typeof parsed?.output_text === "string" && parsed.output_text.trim()) {
      return parsed.output_text;
    }
    return data;
  } catch {
    return data;
  }
}

// ── image acquisition ────────────────────────────────────────────────────

const MIME_MAP = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
};

function extToMediaType(path) {
  const ext = path.split(/[\\/]/).pop().split(".").pop().toLowerCase();
  return MIME_MAP[ext] || "jpeg";
}

/** Read a local file into a base64 data URL through ctx.fs (sandbox-aware). */
async function imageFromLocal(ctx, imagePath, maxBytes, signal) {
  const fs = ctx.get("fs");
  if (fs === void 0) throw new Error("cannot analyze image: no fs service is mounted");
  const target = await fs.resolve(imagePath, {});
  const bytes = await fs.readBytes(target, signal, maxBytes);
  const mediaType = extToMediaType(imagePath);
  return { mediaType, dataUrl: `data:image/${mediaType};base64,${Buffer.from(bytes).toString("base64")}` };
}

/** Fetch a remote image into a base64 data URL. */
async function imageFromUrl(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`fetch image ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  const m = /^image\/([a-z0-9.+-]+)/i.exec(contentType);
  const mediaType = m ? m[1].replace("svg", "jpeg") : "jpeg";
  return { mediaType, dataUrl: `data:image/${mediaType};base64,${Buffer.from(bytes).toString("base64")}` };
}

// ── credential resolution (inline, no dsh-credentials) ───────────────────

async function resolveCredential(ctx, envName) {
  // Try ctx.credentials first (if available)
  const credentials = ctx.get?.("credentials");
  if (credentials?.resolve) {
    try {
      const hit = await credentials.resolve({ type: "env", name: envName });
      if (hit?.value) return hit.value;
    } catch {
      // fall through to env
    }
  }
  // Fall back to process.env
  return process.env[envName];
}

// ── core analysis ────────────────────────────────────────────────────────

async function analyzeImage(ctx, args, exec, cfg) {
  const apiKey = await resolveCredential(ctx, cfg.apiKeyEnv);
  const baseURL = await resolveCredential(ctx, cfg.baseUrlEnv);
  const model = await resolveCredential(ctx, cfg.modelEnv);
  if (!apiKey) throw new Error(`vision credential "${cfg.apiKeyEnv}" is not configured`);
  if (!baseURL) throw new Error(`vision credential "${cfg.baseUrlEnv}" is not configured`);
  if (!model) throw new Error(`vision credential "${cfg.modelEnv}" is not configured`);

  const prompt = (args.prompt || "请详细描述这张图片的内容。").trim();
  const mode = detectVisionMode(prompt);
  const primitives = normalizeOption(cfg.primitives, "auto", VALID_PRIMITIVE_MODES);
  const detail = normalizeOption(cfg.detail, "standard", VALID_DETAIL_LEVELS);
  const retry = normalizeOption(cfg.retry, "off", VALID_RETRY_MODES);
  const usePrimitives = shouldUsePrimitives(mode, primitives, detail);
  const mimo = isMimo(baseURL);
  const headers = buildHeaders(apiKey, mimo);

  const image = args.image_path !== void 0
    ? await imageFromLocal(ctx, args.image_path, cfg.maxImageBytes, exec.signal)
    : await imageFromUrl(args.url, exec.signal);

  const enhancedPrompt = usePrimitives
    ? `${buildPrimitiveInstruction(mode, detail)}\n\n用户问题：\n${prompt}`
    : prompt;

  const messages = [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: image.dataUrl } },
      { type: "text", text: enhancedPrompt },
    ],
  }];

  const firstResult = await request(baseURL, buildPayload(model, messages, DEFAULT_MAX_TOKENS, mimo), headers, exec.signal);

  if (!usePrimitives || retry === "off" || hasPrimitiveMarkers(firstResult)) return firstResult;

  const retryMessages = [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: image.dataUrl } },
      { type: "text", text: buildRetryPrompt(prompt, mode, firstResult, primitives, detail, retry) },
    ],
  }];
  const retryResult = await request(baseURL, buildPayload(model, retryMessages, DEFAULT_MAX_TOKENS, mimo), headers, exec.signal);
  if (hasPrimitiveMarkers(retryResult)) return retryResult;
  return `${retryResult}\n\n[Vision Primitive Notice]\n模型未返回完整视觉基元标记，以上结果按普通视觉分析返回。`;
}

function parseArgs(args) {
  const hasPath = typeof args.image_path === "string" && args.image_path.trim().length > 0;
  const hasUrl = typeof args.url === "string" && args.url.trim().length > 0;
  if (hasPath === hasUrl) throw new Error("provide exactly one of image_path or url");
  return { image_path: hasPath ? args.image_path.trim() : void 0, url: hasUrl ? args.url.trim() : void 0, prompt: args.prompt };
}

// ── Provider wrapper (DSH native image support) ──────────────────────────

function contentHasImage(blocks) {
  return (
    Array.isArray(blocks) &&
    blocks.some((b) => b?.type === 'image' || (b?.type === 'tool-result' && contentHasImage(b.content)))
  );
}

async function convertBlocks(blocks, convertOne) {
  const out = [];
  for (const block of blocks) {
    if (block?.type === 'image') {
      out.push(await convertOne(block));
    } else if (block?.type === 'tool-result' && contentHasImage(block.content)) {
      out.push({ ...block, content: await convertBlocks(block.content, convertOne) });
    } else {
      out.push(block);
    }
  }
  return out;
}

async function convertImagesToEvidence(ctx, messages, signal, cfg, cache) {
  const out = [];
  for (const message of messages) {
    if (!contentHasImage(message.content)) {
      out.push(message);
      continue;
    }
    const content = await convertBlocks(message.content, (block) =>
      readImageBlock(ctx, block, signal, cfg, cache)
    );
    out.push({ ...message, content });
  }
  return out;
}

async function readImageBlock(ctx, block, signal, cfg, cache) {
  try {
    if (!block?.attachment) {
      return { type: "text", text: "[Image analysis failed: no attachment reference]" };
    }

    // Read image bytes from DSH attachment storage
    const stored = await ctx.attachments.readImage(block.attachment, signal);
    if (!stored?.data) {
      throw new Error("attachments.readImage returned no data");
    }

    const mediaType = stored.ref?.mediaType ?? block.attachment?.mediaType;
    const ext = MEDIA_EXT[mediaType] || "png";
    const dataUrl = `data:image/${ext};base64,${Buffer.from(stored.data).toString("base64")}`;

    // Check cache for this attachment
    const cacheKey = block.attachment.ref || JSON.stringify(block.attachment);
    if (cache?.has(cacheKey)) {
      return { type: "text", text: cache.get(cacheKey) };
    }

    const prompt = "Describe this image in detail.";
    const mode = detectVisionMode(prompt);
    const primitives = normalizeOption(cfg.primitives, "auto", VALID_PRIMITIVE_MODES);
    const detail = normalizeOption(cfg.detail, "standard", VALID_DETAIL_LEVELS);
    const usePrimitives = shouldUsePrimitives(mode, primitives, detail);

    const apiKey = await resolveCredential(ctx, cfg.apiKeyEnv);
    const baseURL = await resolveCredential(ctx, cfg.baseUrlEnv);
    const model = await resolveCredential(ctx, cfg.modelEnv);
    const mimo = isMimo(baseURL);
    const headers = buildHeaders(apiKey, mimo);

    const enhancedPrompt = usePrimitives
      ? `${buildPrimitiveInstruction(mode, detail)}\n\nUser question:\n${prompt}`
      : prompt;

    const messages = [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: enhancedPrompt },
      ],
    }];

    const result = await request(
      baseURL,
      buildPayload(model, messages, DEFAULT_MAX_TOKENS, mimo),
      headers,
      signal,
    );

    const evidence = `[Image analyzed by visual primitives]\n${result}`;
    // Cache the evidence for this attachment (LRU-style cap)
    if (cache) {
      cache.set(cacheKey, evidence);
      if (cache.size > 64) {
        cache.delete(cache.keys().next().value);
      }
    }

    return { type: "text", text: evidence };
  } catch (error) {
    return {
      type: "text",
      text: `[Image analysis failed: ${error instanceof Error ? error.message : String(error)}]`,
    };
  }
}

function registerVisionProvider(ctx, cfg) {
  const upstream = cfg.upstream || 'deepseek-official';
  const providerId = 'visual-primitives';

  // bridgeMode:
  //   "append"  = show original models + [vision] variants (default)
  //   "replace" = show only [vision] variants (no originals)
  // Bridged models keep the original name + [vision] suffix in both modes.
  const bridgeDisplay = cfg.bridgeMode === 'replace' ? 'replace' : 'append';

  // Evidence cache for this provider (persists across requests)
  const evidenceCache = new Map();

  try {
    const disposer = ctx.llm.registerAdapter([providerId], {
      providerInfo: () => ({ id: providerId, name: 'Visual Primitives' }),
      providerRetryPolicy: () => undefined,

      async listModels(_provider, signal) {
        try {
          const models = await ctx.llm.listModels(upstream, signal);
          return models
            .filter(m => !m.inputModalities?.includes('image'))
            .map(m => ({ ...m, name: `${m.name ?? m.id} [vision]`, inputModalities: ['text', 'image'] }));
        } catch {
          return [];
        }
      },

      async resolveModel(_provider, model, signal) {
        const info = await ctx.llm.resolveModelInfo(upstream, signal);
        return { ...info, inputModalities: ['text', 'image'] };
      },

      stream(options) {
        return (async function* () {
          const messages = await convertImagesToEvidence(ctx, options.messages, options.signal, cfg, evidenceCache);
          yield* ctx.llm.stream({ ...options, provider: upstream, messages });
        })();
      },
    });

    // Return disposer for plugin cleanup
    return disposer;
  } catch (error) {
    console.error(`[tool-visual-primitives] vision provider registration skipped: ${error}`);
    return null;
  }
}

// ── Registration (raw tool schema, no dsh package imports) ─────────────────

export function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  assertPositiveInteger("maxImageBytes", cfg.maxImageBytes);
  assertPositiveInteger("timeoutMs", cfg.timeoutMs);
  const primitives = normalizeOption(cfg.primitives, "auto", VALID_PRIMITIVE_MODES);
  const detail = normalizeOption(cfg.detail, "standard", VALID_DETAIL_LEVELS);
  const retry = normalizeOption(cfg.retry, "off", VALID_RETRY_MODES);

  // Tool registration (preserved, available as standalone tool)
  ctx.tools.register({
    name: "vision_analyze",
    description: "Analyze an image by routing it to an external vision model and returning its text analysis. Works even when the conversation model has no image input: the image goes only to the vision model, and only its text answer comes back. Provide exactly one of image_path (local file) or url. Use when the task needs to inspect a screenshot, diagram, photo, chart, or image, including questions about positions, counts, relationships, text in images, or UI layouts.",
    parameters: {
      image_path: { type: "string", description: "Local image file path (absolute). Omit when using url." },
      url: { type: "string", description: "Image URL (http/https). Omit when using image_path." },
      prompt: { type: "string", description: "Question or instruction about the image. Defaults to a general description request." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string", required: true } },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    timeoutMs: cfg.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = parseArgs(args);
      const text = await analyzeImage(ctx, input, exec, { ...cfg, primitives, detail, retry });
      return { text };
    },
  });

  // Provider wrapper (DSH native image support)
  if (cfg.visionProvider !== false && typeof ctx.llm?.registerAdapter === 'function') {
    registerVisionProvider(ctx, cfg);
  }
}
