export const VALID_PRIMITIVE_MODES = new Set(["auto", "on", "off"]);
export const VALID_DETAIL_LEVELS = new Set(["brief", "standard", "verbose"]);
export const VALID_RETRY_MODES = new Set(["off", "on", "format-only"]);

export function normalizeOption(value, fallback, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : fallback;
}

export function detectVisionMode(prompt) {
  const text = String(prompt || "").toLowerCase();
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

export function shouldUsePrimitives(mode, primitives, detail) {
  if (primitives === "off") return false;
  if (primitives === "on") return true;
  return mode !== "caption" || detail !== "brief";
}
