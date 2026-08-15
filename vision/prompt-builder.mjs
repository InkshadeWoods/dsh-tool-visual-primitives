export function buildModeInstruction(mode) {
  const instructions = {
    caption: `\n任务重点：普通图像理解。\n- 给出整体图像摘要。\n- 标注最关键的对象或区域。\n- 不需要列出所有细枝末节。`,
    object_inventory: `\n任务重点：对象清单。\n- 尽量列出图中主要对象。\n- 每个对象给稳定 id 和位置框。\n- 避免重复列出同一个对象。`,
    multi_subject: `\n任务重点：多主体分析。\n- 按从左到右、从上到下的稳定顺序编号 subject_1、subject_2 等。\n- 每个主体输出位置框、显著视觉特征、可确认身份和置信度。\n- 若身份无法高置信确认，请明确写“不确定”，不要强行猜测。`,
    counting: `\n任务重点：数量统计。\n- 明确统计目标。\n- 框出所有候选目标。\n- 如有排除项，说明排除原因。\n- 最终数量必须与候选列表一致。`,
    grounding: `\n任务重点：对象定位。\n- 定位用户提到的对象、区域或候选对象。\n- 如果存在多个候选，全部列出并说明最可能者。\n- 使用位置证据支持答案。`,
    spatial_relation: `\n任务重点：空间关系。\n- 定位参与关系判断的对象。\n- 根据 box 或 point 说明上下、左右、远近、大小、遮挡、包含等关系。\n- 只基于可见证据判断。`,
    comparison: `\n任务重点：视觉比较。\n- 先明确比较维度。\n- 定位被比较对象。\n- 分别列出可见证据，再给出比较结论。`,
    path_tracing: `\n任务重点：路径/线条追踪。\n- 定位起点。\n- 使用 point 序列表示观察到的路径或轨迹。\n- 定位终点。\n- 在交叉、遮挡、不确定处明确说明。`,
    topology: `\n任务重点：拓扑/可达性推理。\n- 定位起点和终点。\n- 使用 point 序列描述可见探索路径。\n- 说明阻断、死路或连通依据。\n- 最后给出 True/False 或可达/不可达结论。`,
    ui_analysis: `\n任务重点：界面截图分析。\n- 标注关键 UI 元素，如按钮、输入框、菜单、错误提示、选中状态。\n- 给出元素位置和下一步建议。\n- 不要建议点击不可见或不确定的元素。`,
    document_visual: `\n任务重点：文档、图表、海报或截图文字结构分析。\n- 标注标题、表格、图表、关键文本块、图例、二维码等区域。\n- 说明阅读顺序和视觉层级。\n- 无法看清的文字请说明不确定。`,
  };
  return instructions[mode] || instructions.caption;
}

export function buildDetailInstruction(detail) {
  if (detail === "brief") return `\n详细程度：brief。\n- 只列出回答问题所需的最少视觉证据。\n- 观察和关系说明保持简短。`;
  if (detail === "verbose") return `\n详细程度：verbose。\n- 尽量完整列出关键对象、关系和不确定性。\n- 对复杂任务给出更充分的可见证据。\n- 仍然避免冗长不可验证的思维链。`;
  return `\n详细程度：standard。\n- 列出主要视觉证据。\n- 给出必要的关系和不确定性。\n- 最终答案保持清晰直接。`;
}

function buildPrimitiveInstruction(mode, detail) {
  return `你是一个视觉证据提取与图像分析助手。请将论文式“Thinking with Visual Primitives”的思想用于当前图片分析：先建立可引用的视觉证据，再回答问题。

通用规则：
1. 对可定位的对象、人物、区域使用 bounding box；对路径、轨迹、关键位置使用 point。
2. 坐标统一归一化到 0-999：左上角为 [0,0]，右下角为 [999,999]。
3. box 格式：<ref>object_id_or_name</ref><box>[[x1,y1,x2,y2]]</box>。
4. point 格式：<point>[[x,y],[x,y],...]</point>。
5. 区分可确认事实、推断结论和不确定信息；不要强行猜测。
6. 不要输出冗长不可验证的思维链；输出可验证证据、简短依据和最终答案。

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

function buildPlainTextInstruction(mode, detail) {
  return `请分析图片并给出可供文本模型继续推理的纯文本视觉证据。不要输出 <ref>、<box> 或 <point> 标签。

输出结构必须包含以下标题：
[Mode]
[Observations]
[Relations]
[Uncertainty]
[Answer]

当前模式：${mode}
${buildDetailInstruction(detail)}
${buildModeInstruction(mode)}`;
}

export function buildVisionPrompt(userPrompt, { mode, detail, usesPrimitives }) {
  const instruction = usesPrimitives
    ? buildPrimitiveInstruction(mode, detail)
    : buildPlainTextInstruction(mode, detail);
  return `${instruction}\n\n用户问题：\n${userPrompt}`;
}

export function buildRetryPrompt(userPrompt, mode, previousResult, detail, retryMode) {
  const formatDirective = retryMode === "format-only"
    ? "请尽量保持上一轮结论不变，只补齐和整理视觉基元格式。"
    : "请重新基于图片进行分析，并严格按视觉基元格式输出。";
  return `${buildPrimitiveInstruction(mode, detail)}

上一轮输出没有包含当前任务所需的视觉基元标记。
${formatDirective}

用户问题：
${userPrompt}

上一轮输出：
${previousResult}`;
}
