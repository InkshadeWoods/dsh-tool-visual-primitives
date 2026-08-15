# dsh-tool-visual-primitives

DSH vision analysis plugin inspired by the visual primitives approach from DeepSeek's "Thinking with Visual Primitives" paper. Routes images to an external vision model and returns text analysis with spatial evidence (bounding boxes, points, refs). Works as both a standalone tool and a provider-level bridge — text-only models gain native image input without losing conversation continuity.

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

### Detail Levels

- **Brief**: Minimum visual primitives necessary
- **Standard**: Main evidence with relations and uncertainties
- **Verbose**: Comprehensive objects, relations, uncertainties

### Retry Mechanism

When output is missing required markers (`<ref>`, `<box>`, `<point>`):
- **Off**: Return raw result
- **On**: Re-analyze from image
- **Format-only**: Keep conclusions, fix formatting

### Dual Operation Mode

| Mode | How It Works | User Experience |
|:---|:---|:---|
| **Tool** (default) | Call `vision_analyze` with `image_path` or `url` | Works with any model |
| **Provider Bridge** (opt-in) | Wraps text-only models to accept image input natively | Paste images directly — same model handles text and converted evidence |

### Bridge Display Modes

When bridge mode is active, control how models appear in the selector:

| Mode | Effect |
|:---|:---|
| **append** (default) | Original models + `[vision]` variants both shown |
| **replace** | Only `[vision]` variants shown |

In both modes, bridged models keep the original name + `[vision]` suffix for clear identification.

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
5. Adjust analysis parameters and bridge mode
6. Save

### Credential Resolution Order

1. `ctx.credentials.resolve()` (DSH credential store / `~/.dsh/.credentials.yaml`)
2. Environment variables (`VISION_API_KEY`, `VISION_BASE_URL`, `VISION_MODEL`)

## Usage

### Tool Mode

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

### Provider Bridge Mode

1. Select a model with `[vision]` suffix in the model selector
2. Paste or drop images directly into the conversation
3. Images are automatically converted to evidence text and fed to the same model

## Development

```bash
npm install
npm run build
```

## License

MIT

## References

- DeepSeek paper: [Thinking with Visual Primitives](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives) (2026.05)
- Paper PDF: [Thinking_with_Visual_Primitives.pdf](https://github.com/deepseek-ai/Thinking-with-Visual-Primitives/blob/main/Thinking_with_Visual_Primitives.pdf)
