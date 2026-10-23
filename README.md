<div align="center">

<img src="docs/assets/banner-dsh-tool-visual-primitives.png" alt="dsh-tool-visual-primitives — 为 DSH 纯文本模型补充视觉能力" width="900">

[**中文**](README.md) · [English](README_EN.md)

<!-- badges -->
[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square&labelColor=0b1220)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-tool-visual-primitives?style=flat-square&labelColor=0b1220&color=cb3837)](https://www.npmjs.com/package/dsh-tool-visual-primitives)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-4f46e5?style=flat-square&labelColor=0b1220)](https://github.com/deepseek-ai/DeepSeek-Harness)
[![DSH](https://img.shields.io/badge/dsh-%E2%89%A50.1.2--rc.1%20%C2%B7%20tested%20to%200.2.1--rc.2-06b6d4?style=flat-square&labelColor=0b1220)](#前置条件)
[![Modes](https://img.shields.io/badge/modes-11%20auto--detected-f59e0b?style=flat-square&labelColor=0b1220)](#11-种自动分析模式)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&labelColor=0b1220&logo=node.js&logoColor=white)](#前置条件)
[![Visual Primitives](https://img.shields.io/badge/visual%20primitives-text%20evidence-8b5cf6?style=flat-square&labelColor=0b1220)](#工作方式)

**把图片交给外部视觉模型分析，再把带空间定位的纯文本视觉证据交回原对话模型——被增强的模型不需要原生图片输入能力。**

</div>

---

## 这是什么

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 的纯文本模型本身看不见图片。本插件为它们补上视觉能力。

核心思路参考 DeepSeek 的 [Thinking with Visual Primitives](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives)：不把图片转成一段模糊的描述，而是以**归一化坐标和可引用对象**输出结构化证据，让后续推理可以引用、可检查。

> 已发布至 npm。推荐使用下方的 DSH 官方一键安装命令；GitHub 源码挂载方式保留给开发与本地调试。

## 1.5.4 更新

- **`vision_analyze` 工具收紧为 `[vision]` 模型专用**：非 `[vision]` 模型调用会被明确拒绝并给出可操作原因，自带图片能力的模型不再有两条竞争通路。
- **图片 URL 支持 302 跳转**：改为逐跳手动跟随、每一跳重新校验安全，此前短链图床（如 `picsum.photos`）必然读取失败。
- **抓图失败附带底层原因**：错误信息现在包含 `cause`（如 `UND_ERR_CONNECT_TIMEOUT`），可直接区分 DNS 失败、连接超时与 TLS 错误。
- 连接超时收紧至 5 秒，并增加一次有限重试（仅覆盖连接类瞬时错误）。

> 完整更新历史见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

| 能力 | 说明 |
|---|---|
| 🖼 **两个入口，一条核心** | 显式工具调用 `vision_analyze` 与对话中的 `[vision]` 模型，共用同一套分析管线与证据格式 |
| 🧠 **11 类自动识别** | 描述 · 对象清单 · 多主体 · 计数 · 定位 · 空间关系 · 比较 · 路径 · 拓扑 · UI · 文档视觉，按问题自动选择模式 |
| 📐 **视觉原语** | 以 `<ref>`、`<box>`、`<point>` 输出归一化坐标（`0–999`），证据可被后续推理引用与核对；三档策略 `auto` / `on` / `off` |
| 🎚 **三档细节** | `brief` · `standard`（默认） · `verbose`，按任务复杂度控制证据粒度与 token 开销 |
| 🔒 **只增强你选的模型** | 仅对指定纯文本模型追加 `[vision]` 变体，原模型保留不受影响；自带图片输入能力的模型在选择器中自动置灰 |
| 💾 **会话级证据缓存** | 追问仅在已有证据覆盖新任务、细节与关注对象时复用，覆盖不足则重新读图，不把旧答案当事实 |
| 🎛 **原生设置页** | 安全密钥存储 · 连接测试 · `/models` 搜索选择 · 手动模型 ID · 按供应商折叠选择待增强模型 |
| 🛡 **读取安全** | 远程 URL 拒绝 localhost、私有网段与带凭据地址；重定向逐跳重校验，最多 5 跳 |

## 工作方式

```text
图片 + 用户问题
      │
      ▼
detectVisionMode() → shouldUsePrimitives() → buildVisionPrompt()
      │
      ▼
外部视觉模型（OpenAI 兼容 Chat Completions）
      │
      ▼
纯文本视觉证据（可含坐标化 primitives）
      │
      ▼
原始文本模型继续回答
```

`Mode` 与 `Detail` 是正交控制：Mode 决定任务，Detail 决定信息密度。`Primitives` 决定是否强制结构化的空间证据。

## 前置条件

- 已可运行的 DSH **Web Profile**（要求 DSH `0.1.2-rc.1` 或更高版本，已实测至 `0.2.1-rc.2`）。
- Node.js `>= 20` 与 pnpm。
- 一个可访问的视觉模型服务。默认使用 OpenAI 兼容端点：
  - `POST <Base URL>/chat/completions`
  - 可选模型目录：`GET <Base URL>/models`

视觉服务与被增强的文本模型可以来自不同供应商。

## 安装

### npm 一键安装

在 PowerShell 或终端执行（以下 `dsh` 命令以已全局安装 DSH 为前提，即 `npm install -g @deepseek-ai/dsh`；未全局安装时，可将 `dsh` 替换为 `npx @deepseek-ai/dsh`）：

```powershell
dsh plugin --profile web add dsh-tool-visual-primitives@latest
```

该命令调用 DSH 官方插件管理器，在 `web` Profile 中执行包安装。安装成功后，DSH 会识别本插件包内的 `dsh.bundle.patch` 声明，自动将插件加入 `dsh.profile.bundles`，并在启动时应用包内的 `cordis.patch.yml`。

该过程可重复执行，不会重复添加 bundle；它不会直接修改 Profile 自身的 `cordis.patch.yml` 或其他插件配置，因此可与 `dsh-better-sidebar` 等插件共存。

如使用的不是 `web` Profile，请将 `--profile` 改为对应的 Profile 名称：

```powershell
dsh plugin --profile <你的 Profile 名称> add dsh-tool-visual-primitives@latest
```

安装后完整重启 DSH，并在“设置 → 视觉分析”中填写 API Key、Base URL 和视觉模型。

### 从 GitHub 源码本地挂载

这是当前已验证的安装方式。如使用其他目录，请同步调整 `$source`。

```powershell
$source = 'D:\DSH\dsh-tool-visual-primitives'
git clone https://github.com/InkshadeWoods/dsh-tool-visual-primitives.git $source

Set-Location $source
pnpm install
pnpm run build

dsh plugin --profile web add $source
```

DSH 官方 CLI 会自动将本地包加入 Profile 依赖，并基于包内的 `dsh.bundle.patch` 声明维护 `dsh.profile.bundles`；无需手动编辑 Profile 的 `package.json` 或 `cordis.patch.yml`。

完整重启 DSH：

```powershell
dsh web
```

首次更新客户端界面时，请在浏览器按 `Ctrl+Shift+R` 强制刷新。

### 卸载

如需清除已保存的 API Key，请先在插件设置页点击“清除 API Key”。然后执行 DSH 官方卸载命令：

```powershell
dsh plugin --profile web remove dsh-tool-visual-primitives
```

DSH 会移除包依赖，并自动从 `dsh.profile.bundles` 清除对应 bundle。完成后重启 DSH。

## 首次配置

打开 DSH **设置 → 视觉分析**，按顺序完成：

1. 填写 **API Key**、**Base URL** 与视觉模型。
2. 点击 **加载模型**：插件从 `<Base URL>/models` 获取可搜索列表。
3. 若服务不提供模型目录，直接填写 **自定义模型 ID**。
4. 点击 **测试连接**。
5. 配置分析参数，并在“对话视觉模型”中勾选希望追加 `[vision]` 的纯文本模型。

已保存的 API Key 不会在重新打开页面时回显；填写新值会覆盖旧值，点击“清除 API Key”才会删除它。

### API 与模型目录

| 项目 | 行为 |
| --- | --- |
| 视觉请求 | `POST <Base URL>/chat/completions`，使用 `Authorization: Bearer <API Key>` |
| 模型列表 | `GET <Base URL>/models`，使用 `Accept: application/json` 与同一 API Key |
| 模型列表失败 | 仍可直接填写自定义模型 ID，不影响视觉分析 |
| 小米 Mimo URL | 自动改用 `api-key` 请求头 |

## 分析参数

| 设置 | 选项 / 默认值 | 作用 |
| --- | --- | --- |
| 视觉原语 | `auto` / `on` / `off`（默认 `auto`） | `auto` 根据 Mode 与 Detail 判断；`on` 强制坐标化证据；`off` 只要求纯文本证据。 |
| 分析细节 | `brief` / `standard` / `verbose`（默认 `standard`） | 控制输出密度，不改变任务类型。 |
| 重试模式 | `off` / `on` / `format-only`（默认 `off`） | 原语缺失时，`on` 重新读图；`format-only` 尽量保留结论，仅补齐格式。 |
| 最大图片大小 | `10 MB` | 本地、远程与对话附件均受上限约束。 |
| 超时 | `180000 ms` | 单次视觉模型请求的最长等待时间。 |
| 输出 Token 预算 | `auto` 或手动值（默认 `auto`） | `auto` 跟随 Detail：brief `1024`、standard `2048`、verbose `4096`。 |
| 诊断日志 | `off` / `on`（默认 `off`） | 开启后向 DSH 控制台输出插件运行日志，便于排查问题。 |

## 11 种自动分析模式

| Mode | 适合的问题 | 证据重点 |
| --- | --- | --- |
| `caption` | “这张图是什么？” | 整体摘要与关键对象 |
| `object_inventory` | “图里有哪些物体？” | 主要对象清单与位置 |
| `multi_subject` | “从左到右有哪些人？” | 主体编号、特征与位置 |
| `counting` | “有几个按钮？” | 候选对象、排除项与数量 |
| `grounding` | “红色按钮在哪里？” | 目标及候选位置 |
| `spatial_relation` | “A 在 B 的哪边？” | 上下左右、遮挡、包含等关系 |
| `comparison` | “比较这两个区域” | 比较维度与分别可见证据 |
| `path_tracing` | “路线怎么走？” | 起点、关键点、终点与不确定处 |
| `topology` | “迷宫是否可达？” | 连通性、阻断与结论 |
| `ui_analysis` | “这个界面怎么操作？” | UI 元素、状态、位置与下一步建议 |
| `document_visual` | “解读这张图表/海报” | 标题、文本块、表格、阅读顺序 |

优先级最高的关键词决定 Mode；没有匹配时使用 `caption`。例如“这个界面有几个按钮？”会识别为 `ui_analysis`，再叠加所选 Detail。

## 使用方式

### 方式一：在对话中使用 `[vision]`

1. 在插件设置的“对话视觉模型”中勾选一个纯文本模型。
2. 重新打开对话模型列表，选择新增的 `模型名 [vision]`。
3. 上传、粘贴或拖入图片，并直接提出问题。

插件仅将图像块替换为视觉证据文本；最终回答仍由所选的原文本模型生成。

对于明确指向当前会话最近图片的追问，插件会检查缓存证据是否覆盖新的任务、细节与关注对象/位置。覆盖不足时会重新分析图片，而不是把不充分的旧答案当作事实。

### 方式二：显式调用 `vision_analyze`

工具接收**且只接收一个**图片来源：本地绝对路径或 HTTP(S) URL。

```json
{
  "image_path": "D:/images/dashboard.png",
  "prompt": "统计界面上可点击的主要按钮，并标出它们的位置"
}
```

```json
{
  "url": "https://example.com/chart.png",
  "prompt": "解读图表的趋势，并说明读不清的标签"
}
```

远程 URL 不允许指向 localhost、私有网络地址或携带用户名/密码。允许跟随重定向（最多 5 跳）以支持短链图床，但每一跳都会重新执行上述校验——若使用自动跟随，跳转就能到达首跳已放行的检查之外，因此这里逐跳手动跟随，服务器端请求伪造的风险面不因支持跳转而扩大。

**该工具仅对 `[vision]` 模型开放。** 在非 `[vision]` 模型下调用会被明确拒绝，并说明当前 provider、建议改用模型自身的图片能力、以及如何切换到 `[vision]` 模型。这样，自带图片能力的模型不会同时存在“自己看”和“外部管线”两条通路。拒绝发生在工具执行之前，不会产生任何上游调用。

未配置对话视觉模型（即桥接器未启用）时不存在 `[vision]` 模型可选，此时不安装该限制，工具保持对所有模型开放。

### 视觉证据格式

启用视觉原语时，外部视觉模型会被要求按如下标题返回：

```text
[Mode]
[Visual Primitives]
[Observations]
[Relations]
[Uncertainty]
[Answer]
```

定位信息示例：

```text
<ref>submit_button</ref><box>[[742, 861, 900, 930]]</box>
<point>[[125, 430], [210, 430], [300, 510]]</point>
```

所有坐标均为相对 `0–999`，不是原图像素。

## 已验证的端到端场景

测试素材和结果均保存在 [`test/`](test/)。

| 场景 | 已验证结果 |
| --- | --- |
| 对话图片理解 | `[vision]` 模型成功读取 DSH 使用模式对比图，并向文本模型提供结构化图像说明。 |
| 截图驱动的 UI 复刻 | `[vision]` 模型理解 Bilibili 首页截图后，文本模型据此生成了一个独立的 Bilibili 风格 HTML 页面。 |

**图片理解结果**

![对话视觉入口成功读取图片](test/test-1-Read_Image_Information.png)

**UI 复刻过程与结果**

![对截图进行 UI 复刻的对话](test/test-2-Replicate_Image_UI.png)

![根据视觉证据生成的 HTML 页面](test/test-2-Replicate_UI_Display.png)

这些结果证明的是当前版本的端到端链路；生成效果仍取决于外部视觉模型、文本模型、提示词和图片质量。

## 开发

```powershell
pnpm install
pnpm run build
```

`pnpm run build` 会生成客户端包 `lib/client.js`。

- 服务端入口为 `index.mjs`；修改后需要重启 DSH。
- 修改客户端界面后，需要重新执行构建，并在浏览器中强制刷新页面。

## 许可证

[MIT](LICENSE)

## 致谢与参考

- [Thinking with Visual Primitives](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives)
- [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)
- Provider 桥接设计参考 [modlens](https://github.com/liustack/modlens)
