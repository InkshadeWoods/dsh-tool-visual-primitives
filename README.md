# dsh-tool-visual-primitives

> 参考 DeepSeek 论文《Thinking with Visual Primitives》中的视觉原语思路，为 DSH 打造的视觉分析工具

将图片路由到外部视觉模型并返回**带视觉基元的文本分析**。纯文本循环——对话模型无需原生视觉能力即可"看见"图片。

## 背景：为何需要视觉基元？

多模态大语言模型（MLLMs）在通用视觉问答（VQA）基准测试中表现出色，但在需要**精确空间推理**和**复杂视觉分析**的任务中仍存在系统性缺陷。一个典型的例子：给一张密集的人群照片，问模型"图里有多少人"，它很可能数错；给一张复杂电路图问空间关系，它的回答往往前后矛盾。

这不是模型看不清图片的问题，而是模型在"思考"时**抓不住它想谈的视觉对象**。

DeepSeek 在 2026 年 5 月发布的论文 **《Thinking with Visual Primitives》** 将这一问题命名为 **"指代鸿沟"（Reference Gap）**，并给出了一套基于视觉原语的解法。本插件的设计思路受到这篇论文的启发。

### 解法：视觉原语（Visual Primitives）

论文提出用**归一化坐标的视觉基元**作为可引用的视觉指针：

| 基元 | 格式 | 用途 |
|:---|:---|:---|
| **Ref** | `<ref>object_id_or_name</ref>` | 为视觉对象绑定稳定标识 |
| **Box** | `<box>[[x1,y1,x2,y2]]</box>` | 定位对象或区域的边界框 |
| **Point** | `<point>[[x,y],[x,y],...]</point>` | 标记路径、轨迹、关键位置 |

坐标统一归一化到 **0-999**：左上角为 `[0,0]`，右下角为 `[999,999]`。

## 本插件的实现

### 11 种分析模式

插件内置了 11 种检测模式，根据用户提问自动切换：

| 模式 | 触发关键词 | 任务重点 |
|:---|:---|:---|
| **Caption** | 默认 | 整体图像摘要，标注最关键对象 |
| **Object Inventory** | "列出" "有哪些" | 主要对象清单，带稳定 id 和位置框 |
| **Multi-Subject** | "人物" "角色" "从左到右" | 多主体编号分析，带位置和置信度 |
| **Counting** | "多少个" "数量" "计数" | 统计目标，框出候选，排除项说明 |
| **Grounding** | "在哪" "哪个位置" | 定位用户提到的对象或区域 |
| **Spatial Relation** | "左边" "右边" "遮挡" | 空间关系判断，基于 box/point |
| **Comparison** | "比较" "对比" "vs" | 明确维度，分别列出证据，给出结论 |
| **Path Tracing** | "路径" "路线" "线条" | 起点 → point 序列 → 终点 |
| **Topology** | "迷宫" "可达" "通路" | 可达性推理，True/False 结论 |
| **UI Analysis** | "截图" "界面" "按钮" | UI 元素标注，位置和下一步建议 |
| **Document Visual** | "表格" "图表" "海报" | 文字结构分析，阅读顺序和视觉层级 |

### 三级 Detail 控制

- **Brief**：只列出回答问题所需的最少视觉基元
- **Standard**：列出主要视觉证据，给出必要的关系和不确定性
- **Verbose**：尽量完整列出关键对象、关系和不确定性

### Retry 机制

当模型输出缺少必要的 `<ref>`、`<box>` 或 `<point>` 标记时：
- **Off**：不重试，返回原始结果
- **On**：重新基于图片分析，严格按格式输出
- **Format-only**：保持上一轮结论，只补齐和整理视觉基元格式

## 功能特性

- 🔑 **API 配置**：API Key / Base URL / Model（不预填，用户自定义）
- ⚙️ **分析参数**：Primitives Mode / Detail Level / Retry Mode / 最大图片大小 / 超时时间
- ✅ **测试连接**：发送简短真实对话 `"Say OK"`，验证 API Key → Base URL → Model → 模型生成整条链路
- 🎛️ **原生设置面板**：在 DSH 设置中注册"视觉分析"页面，独立插件，不依赖其他插件
- 🔄 **纯文本循环**：对话模型无需原生视觉能力，通过工具调用"看见"图片

## 安装

```powershell
# 进入 DSH profile 的 plugins 目录
cd ~\.dsh\profiles\web\plugins

# 克隆此仓库
git clone https://github.com/<your-username>/dsh-tool-visual-primitives.git

# 重启 DSH，硬刷新浏览器（Ctrl+Shift+R）
```

## 配置

1. 打开 DSH 设置面板（`settings`）
2. 找到 **视觉分析** 页面
3. 填写 API Key、Base URL、Model
4. 点击 **测试连接** 验证配置
5. 调整分析参数后保存

## 使用

在对话中直接使用 `vision_analyze` 工具：

```json
{
  "image_path": "/path/to/image.png",
  "prompt": "图中有多少个物体？"
}
```

或

```json
{
  "url": "https://example.com/image.png",
  "prompt": "找出图中的红色按钮位置"
}
```

## 开发

```bash
# 安装依赖
npm install

# 构建前端
npm run build
```

## License

MIT

## 参考与启发

- 论文：[Thinking with Visual Primitives](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives) — DeepSeek, 2026.05
- 论文 PDF：[Thinking_with_Visual_Primitives.pdf](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives/blob/main/Thinking_with_Visual_Primitives.pdf)
