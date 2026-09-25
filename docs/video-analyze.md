# 视频理解

> **读者**：集成者 · Agent 作者

整段视频理解缝：`@xrkseek/exec-video-analyze`。模型工具 `video_analyze`（对齐 Hermes）。

**不是**抽帧流水线：把完整视频（URL 或工作区路径）以 `video_url` 多模态部件送给视频能力模型（如 Gemini），返回 JSON 文本分析。

## 与邻近工具的分界

| 工具 | 输入 | 作用 |
|------|------|------|
| `video_analyze` | 视频文件 / URL + `question` | 整段视频 → 文本分析 |
| `browser_vision` | 当前浏览器页 | 页面截图进附件（非视频） |
| `read_image` | 静图路径 | 图片进附件（可 region 裁剪） |
| `video_generate` | 文生/图生视频 | **生成**视频，不理解 |

## 工具

| 参数 | 作用 |
|------|------|
| `video_url` | `http(s)` URL 或工作区相对路径（mp4 / webm / mov / avi / mkv / mpeg） |
| `question` | 关于视频的问题（工具会先要求完整描述画面/运动/音频/字幕/转场，再答问题） |
| `model` | 可选覆盖模型 id |

成功返回 JSON：`{ "success": true, "analysis": "…", "provider", "model", … }`。硬顶约 **50 MB**；>20 MB 可能较慢。

## 启用

优先序：**Settings（产品真源）** → **Credentials（密钥）** → **env（仅 CI / 无头旁路）**。

| 通道 | 内容 |
|------|------|
| **Settings** | Face ns `video-analyze`：`mode` = 关 / openai · 可选 `baseUrl` · `model`（Settings → Plugins → **视频理解**） |
| **Credentials** | `XRK_VIDEO_ANALYZE_OPENAI_KEY`（槽 `video-analyze.openai`）；运行时也可回落 `OPENAI_API_KEY` |
| **仅 env** | `XRK_VIDEO_ANALYZE=memory` · `=1` / `openai`（旁路 Settings）· 可选 `XRK_VIDEO_ANALYZE_BASE_URL` / `XRK_VIDEO_ANALYZE_MODEL` |

保存 Settings 后热切换。OpenAI 兼容路径发 `chat/completions` + `content[].type=video_url`；网关须支持视频部件（默认模型 `gemini-2.0-flash`）。

| Settings / env | 行为 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（确定性文本，CI / 演示） |
| `1` / openai | 需 API key；可选 Settings / env 的 base URL · model |

---

# Video analysis

> **Audience**: Integrators · Agent authors

Whole-clip video understanding seam: `@xrkseek/exec-video-analyze`. Model tool `video_analyze` (Hermes-aligned).

**Not** a frame-extraction pipeline: the full video (URL or workspace path) is sent as a multimodal `video_url` part to a video-capable model (e.g. Gemini) and returns a JSON text analysis.

## Boundaries vs neighboring tools

| Tool | Input | Role |
|------|-------|------|
| `video_analyze` | Video file / URL + `question` | Whole clip → text analysis |
| `browser_vision` | Current browser page | Page screenshot into attachments (not video) |
| `read_image` | Still image path | Image into attachments (optional region crop) |
| `video_generate` | Text/image → video | **Creates** video; does not understand |

## Tool

| Param | Role |
|-------|------|
| `video_url` | `http(s)` URL or workspace-relative path (mp4 / webm / mov / avi / mkv / mpeg) |
| `question` | Question about the video (the tool asks for a full description first, then answers) |
| `model` | Optional model id override |

Success JSON: `{ "success": true, "analysis": "…", "provider", "model", … }`. Hard cap ~**50 MB**; clips >20 MB may be slow.

## Enable

Precedence: **Settings (product SoT)** → **Credentials (secrets)** → **env (CI / headless bypass only)**.

| Channel | Content |
|---------|---------|
| **Settings** | Face ns `video-analyze`: `mode` = off / openai · optional `baseUrl` · `model` (Settings → Plugins → **Video analyze**) |
| **Credentials** | `XRK_VIDEO_ANALYZE_OPENAI_KEY` (slot `video-analyze.openai`); runtime may also fall back to `OPENAI_API_KEY` |
| **env only** | `XRK_VIDEO_ANALYZE=memory` · `=1` / `openai` (bypasses Settings) · optional `XRK_VIDEO_ANALYZE_BASE_URL` / `XRK_VIDEO_ANALYZE_MODEL` |

Applies after the next agent rebuild. The OpenAI-compatible path posts `chat/completions` with `content[].type=video_url`; the gateway must accept video parts (default model `gemini-2.0-flash`).

| Settings / env | Behavior |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| (unset / off) | Tool still registered; execute **fails honestly** |
| `memory` (env only) | In-memory Provider (deterministic text; CI / demo) |
| `1` / openai | Needs an API key; optional Settings / env base URL · model |
