# dsh-tool-visual-primitives

DSH vision analysis plugin inspired by DeepSeek's "Thinking with Visual Primitives" paper. Images from either a chat attachment or `vision_analyze` enter the same visual-primitives core: it identifies the visual task from the question, calls an external vision model, and returns pure-text evidence to the text model.

## Background

Current Multimodal LLMs perform well on general VQA benchmarks but struggle with precise spatial reasoning and complex visual analysis. DeepSeek's paper **"Thinking with Visual Primitives" (2026.05)** identifies this as the **Reference Gap**: natural language is too ambiguous to precisely point to dense spatial entities during reasoning.

The paper proposes using **normalized visual primitives** as referenceable pointers:

| Primitive | Format | Use Case |
|:---|:---|:---|
| **Ref** | `<ref>object_id_or_name</ref>` | Bind stable identifiers to visual objects |
| **Box** | `<box>[[x1,y1,x2,y2]]</box>` | Localize objects or regions |
| **Point** | `<point>[[x,y],[x,y],...]</point>` | Mark paths, trajectories, key positions |

Coordinates are normalized to **0–999**: top-left is `[0,0]`, bottom-right is `[999,999]`.

## Features

### 11 Analysis Modes

Auto-detected from user prompt keywords:

| Mode | Trigger Keywords | Focus |
|:---|:---|:---|
| **Caption** | default | Overall summary, key objects |
| **Object Inventory** | "list", "what items" | Main objects with stable IDs and boxes |
| **Multi-Subject** | "people", "characters", "left to right" | Numbered subjects with positions |
| **Counting** | "how many", "count" | Enumeration with exclusions |
| **Grounding** | "where", "which location" | Object localization |
| **Spatial Relation** | "left", "right", "overlap" | Spatial reasoning with boxes |
| **Comparison** | "compare", "vs" | Evidence-based comparison |
| **Path Tracing** | "path", "route", "trace" | Start → point sequence → end |
| **Topology** | "maze", "reachable" | Reachability: True/False |
| **UI Analysis** | "screenshot", "UI", "button" | UI element annotation |
| **Document Visual** | "table", "chart", "poster" | Document structure and reading order |

### Detail and Primitives

- **Brief**: Minimum visual evidence necessary
- **Standard**: Main evidence with relations and uncertainties
- **Verbose**: Comprehensive objects, relations, uncertainties

Detail is user-configured and defaults to **Standard**. It controls information density only; it does not change the automatically detected visual task.

Primitives are user-configured:

- **Auto** (default): decides whether coordinate-based visual primitives are needed from Mode and Detail
- **On**: requires visual primitives such as `<ref>`, `<box>`, and `<point>`
- **Off**: returns usable pure-text visual evidence without requiring primitive tags

### Retry Mechanism

When Primitives are enabled and output is missing required markers (`<ref>`, `<box>`, `<point>`):
- **Off**: Return raw result
- **On**: Re-analyze from image
- **Format-only**: Keep conclusions, fix formatting

### Two Entrances, One Core

| Mode | How It Works | User Experience |
|:---|:---|:---|
| **Explicit analysis** | Call `vision_analyze` with `image_path` or `url` | External images and advanced analysis |
| **Chat vision** | Wrap a text-only model to receive chat attachments | Paste images directly; the current question enters the same core |

Execution order: `detectVisionMode()` → `shouldUsePrimitives()` → `buildVisionPrompt()`.

### Bridge Display

The bridge currently uses a fixed append display mode in the model selector:

| Mode | Effect |
|:---|:---|
| **append** (default) | Original models + `[vision]` variants both shown |

In both modes, bridged models keep the original name + `[vision]` suffix for clear identification (suffixed = bridge active, unsuffixed = no bridge).

> `replace` mode is reserved for a future DSH release that supports hiding other providers.

## Installation

### Option 1: npm (recommended)

```powershell
dsh plugin --profile web add dsh-tool-visual-primitives
```

### Option 2: Local clone

```powershell
cd ~\.dsh\profiles\web\plugins
git clone https://github.com/<your-username>/dsh-tool-visual-primitives.git
# Restart DSH, hard refresh browser (Ctrl+Shift+R)
```

## Configuration

1. Open DSH **Settings** panel
2. Find **Vision Analysis** page
3. Fill in credentials:
   - **API Key**: Vision model API key
   - **Base URL**: OpenAI-compatible endpoint
   - **Model**: Vision model name
4. Click **Test Connection** to verify
5. Adjust Detail, Visual Primitives, Retry, and other analysis parameters
6. Save

### Credential Resolution Order

1. `ctx.credentials.resolve()` (DSH credential store / `~/.dsh/.credentials.yaml`)
2. Environment variables (`VISION_API_KEY`, `VISION_BASE_URL`, `VISION_MODEL`)

## Usage

### Explicit Analysis

```json
{
  "image_path": "/path/to/image.png",
  "prompt": "How many objects are in this image?"
}
```

```json
{
  "url": "https://example.com/image.png",
  "prompt": "Locate the red button"
}
```

### Chat Vision

1. Select a model with `[vision]` suffix in the model selector
2. Paste or drop images directly into the conversation
3. Images are converted into visual-primitives text evidence for the current question and fed to the same model

## Development

```bash
npm install
npm run build
```

## License

MIT

## Acknowledgments

The provider bridge framework of this plugin draws inspiration from [modlens](https://github.com/liustack/modlens).

## References

- DeepSeek paper: [Thinking with Visual Primitives](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives) (2026.05)
- Paper PDF: [Thinking_with_Visual_Primitives.pdf](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives/blob/main/Thinking_with_Visual_Primitives.pdf)
