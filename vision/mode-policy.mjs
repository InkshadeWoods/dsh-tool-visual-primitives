export const VALID_PRIMITIVE_MODES = new Set(["auto", "on", "off"]);
export const VALID_DETAIL_LEVELS = new Set(["brief", "standard", "verbose"]);
export const VALID_RETRY_MODES = new Set(["off", "on", "format-only"]);

export function normalizeOption(value, fallback, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : fallback;
}

export function detectVisionMode(prompt) {
  const text = String(prompt || "").toLowerCase();
  const rules = [
    ["ui_analysis", /(button|click|menu|ui|screen|screenshot|html|网页|按钮|点击|菜单|界面|截图|报错|输入框|导航)/i, 8],
    ["document_visual", /(table|chart|diagram|poster|document|receipt|invoice|ocr|text|表格|图表|图示|海报|文档|票据|发票|文字|二维码)/i, 7],
    ["topology", /(maze|reachable|solvable|迷宫|可达|走到|通路)/i, 7],
    ["path_tracing", /(path|line|trace|route|connect|路径|路线|线条|连到|轨迹)/i, 6],
    ["comparison", /(compare|comparison|versus|vs\.?|比较|对比|区别|差异)/i, 5],
    ["counting", /(count|number|how many|几个|多少|数量|计数)/i, 4],
    ["spatial_relation", /(larger|smaller|closer|farther|beside|overlap|relation|更大|更小|更近|更远|旁边|相邻|关系|重叠|遮挡|包含)/i, 4],
    ["grounding", /(where|locate|location|position|位置|在哪|哪个|左边|右边|上方|下方|中间|附近)/i, 3],
    ["multi_subject", /(people|persons|characters|subjects|figures|group|人物|角色|主体|他们|这些人|这些对象|组合|从左到右|第.*位)/i, 3],
    ["object_inventory", /(list|objects|items|inventory|列出|有哪些|主要对象|物体|元素)/i, 2],
  ];
  const matched = rules.filter(([, pattern]) => pattern.test(text));
  if (matched.length === 0) return "caption";
  return matched.reduce((best, current) => current[2] > best[2] ? current : best)[0];
}

export function shouldUsePrimitives(mode, primitives, detail) {
  if (primitives === "off") return false;
  if (primitives === "on") return true;
  return mode !== "caption" || detail !== "brief";
}
