# dsh-tool-visual-primitives

参考 DeepSeek 论文《Thinking with Visual Primitives》中的视觉原语思路，为 DSH 打造的视觉分析插件。将图片路由到外部视觉模型并返回带视觉基元的文本分析。支持独立工具和 Provider 桥接双模式——纯文本模型无需原生视觉能力即可"看见"图片，桥接模式下保持对话连贯性。

## 背景

当前多模态大语言模型在通用视觉问答基准测试中表现出色，但在需要**精确空间推理**和**复杂视觉分析**的任务中仍存在系统性缺陷。DeepSeek 在 2026 年 5 月发布的论文 **《Thinking with Visual Primitives》** 将这一问题命名为 **"指代鸿沟"（Reference Gap）**：自然语言在精确指向密集空间实体时本质上是模糊的。

论文提出用**归一化坐标的视觉基元**作为可引用的视觉指针：

| 基元 | 格式 | 用途 |
|:---|:---|:---|
| **Ref** | `<ref>object_id_or_name</ref>` | 为视觉对象绑定稳定标识 |
| **Box** | `<box>[[x1,y1,x2,y2]]</box>` | 定位对象或区域的边界框 |
| **Point** | `<point>[[x,y],[x,y],...]</point>` | 标记路径、轨迹、关键位置 |

坐标统一归一化到 **0–999**：左上角为 `[0,0]`，右下角为 `[999,999]`。

## 功能

### 11 种分析模式

根据用户提问自动切换：

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

### 双运行模式

| 模式 | 工作方式 | 用户体验 |
|:---|:---|:---|
| **工具模式**（默认） | 调用 `vision_analyze` 工具，参数传 `image_path` 或 `url` | 任何模型都能用 |
| **Provider 桥接**（可选） | 包装纯文本模型，原生支持图片输入 | 直接粘贴图片，同一模型处理文本和转换后的证据 |

### 桥接显示模式

桥接模式下，可控制在模型选择器中的显示方式：

| 模式 | 效果 |
|:---|:---|
| **append**（默认） | 原模型 + `[vision]` 变体都显示 |
| **replace** | 只显示 `[vision]` 变体（不显示原模型） |

两种模式下桥接模型都保留原名 + `[vision]` 后缀，便于一眼识别哪些模型开启了桥接。

## 安装

### 方式一：npm（推荐）

```powershell
dsh plugin --profile web add dsh-tool-visual-primitives
```

### 方式二：本地克隆

```powershell
cd ~\.dsh\profiles\web\plugins
git clone https://github.com/<your-username>/dsh-tool-visual-primitives.git
# 重启 DSH，硬刷新浏览器（Ctrl+Shift+R）
```

## 配置

1. 打开 DSH **设置** 面板
2. 找到 **视觉分析** 页面
3. 填写凭证：
   - **API Key**：视觉模型 API 密钥
   - **Base URL**：OpenAI 兼容端点
   - **Model**：视觉模型名称
4. 点击 **测试连接** 验证配置
5. 调整分析参数和桥接模式
6. 保存

### 凭证解析顺序

1. `ctx.credentials.resolve()`（DSH 凭据存储 / `~/.dsh/.credentials.yaml`）
2. 环境变量（`VISION_API_KEY`、`VISION_BASE_URL`、`VISION_MODEL`）

## 使用

### 工具模式

```json
{
  "image_path": "/path/to/image.png",
  "prompt": "图中有多少个物体？"
}
```

```json
{
  "url": "https://example.com/image.png",
  "prompt": "找出图中的红色按钮位置"
}
```

### Provider 桥接模式

1. 在模型选择器中选择带 `[vision]` 后缀的模型
2. 直接在对话中粘贴或拖入图片
3. 图片自动转换为证据文本，送进同一模型继续推理

## 开发

```bash
npm install
npm run build
```

## License

MIT

## 参考

- DeepSeek 论文：[Thinking with Visual Primitives](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives) (2026.05)
- 论文 PDF：[Thinking_with_Visual_Primitives.pdf](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives/blob/main/Thinking_with_Visual_Primitives.pdf)
