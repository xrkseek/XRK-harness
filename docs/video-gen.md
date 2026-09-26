# 视频生成

> **读者**：集成者 · Agent 作者

文生视频 / 图生视频缝：`@xrkseek/exec-video-gen`。模型工具 `video_generate`；Provider 可换。

视频渲染是**异步**的（真实后端都要排队数分钟），所以缝直接暴露作业生命周期，而不是把一次渲染放在单个阻塞调用里：`create` 返回 `jobId`，`get` 轮询状态，`content` 在 `completed` 后下载 MP4。形状同 OpenAI Videos API（`POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`）。

对齐 Hermes `video_gen`：`capabilities()` → 动态工具 schema；`first_frame` / `image_url` → 图生视频（OpenAI `input_reference`）；`action=catalog` 列出 family；`action=edit` / `action=extend` 走 `/videos/edits` · `/videos/extensions`。

## 工具

| 工具             | 作用                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `video_generate` | `action=start`（默认，需 `prompt`；可选首帧）返回 `jobId`；`status` / `wait` / `content`；`catalog`；可选 `edit` / `extend` |

### 图生视频（首帧）

当 Provider `capabilities()` 含 `image` 模态时，schema 暴露：

| 参数 | 作用 |
| ---- | ---- |
| `first_frame` | 首帧静图：`https` · `data:image/…;base64,…` · `attachment:<id>` |
| `image_url` | Hermes 兼容别名（与 `first_frame` 同方案） |
| `reference_image_urls` / `reference_attachment_ids` | 额外参考（OpenAI 首帧上限 1） |

OpenAI 路径把首帧作为 multipart `input_reference` 上传。

### edit / extend / catalog

| action | 需要 | 后端 |
| ------ | ---- | ---- |
| `catalog` | — | 列出 `capabilities().families`（sora-2 · sora-2-pro） |
| `edit` | `job_id`（源视频）+ `prompt` | `POST /videos/edits` |
| `extend` | `job_id` + `prompt`；可选 `seconds` | `POST /videos/extensions` |

MP4 **不内联进工具文本**；Host 配了 `AttachmentStore` 时经 `saveFile` 落盘并返回 `attachmentId`。
`content` 在作业未完成时返回 `not_ready=true`（不报错）；`status=failed` 才是 `isError`。

## 启用

优先序：**Settings（产品真源）** → **Credentials（密钥）** → **env（仅 CI / 无头旁路）**。

| 通道 | 内容 |
|------|------|
| **Settings** | Face ns `video-gen`：`mode` = 关 / openai / fal / xai / openrouter / deepinfra · 可选 `baseUrl` · `model` |
| **Credentials** | openai · fal · xai · openrouter · deepinfra 槽（各有公开 env 回落） |
| **仅 env** | `XRK_VIDEO_GEN=memory` · `=1` / `openai` / `fal` / `xai` / `openrouter` / `deepinfra` |

保存 Settings 后热切换。非空 `XRK_VIDEO_GEN` 为 CI 旁路。

| Settings / env | 行为 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（确定性作业生命周期 + 24 字节 `ftyp` MP4） |
| `1` / openai | OpenAI Videos；默认 `sora-2` |
| `fal` | FAL queue（Hermes 满编 family：pixverse · veo · kling · wan · seedance · minimax · …） |
| `xai` | xAI Grok Imagine video |
| `openrouter` | OpenRouter Videos API（默认 `minimax/hailuo-3-max`） |
| `deepinfra` | DeepInfra OpenAI 兼容 Videos |

也可注入自定义 `VideoGenService`。

---

# Video generation

> **Audience**: Integrators · Agent authors

Text-to-video / image-to-video seam: `@xrkseek/exec-video-gen`. Model tool `video_generate`; Providers are swappable.

Video renders are **asynchronous** — every real backend queues for minutes — so the seam exposes the job
lifecycle directly instead of hiding a render behind one blocking call: `create` returns a `jobId`, `get`
polls status, and `content` downloads the MP4 once `completed`. The shape follows the OpenAI Videos API
(`POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`).

Aligned with Hermes `video_gen`: `capabilities()` → dynamic tool schema; `first_frame` / `image_url` →
image-to-video (OpenAI `input_reference`); `action=catalog` lists families; `action=edit` / `action=extend`
hit `/videos/edits` · `/videos/extensions`.

## Tools

| Tool             | Role                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video_generate` | `action=start` (default, needs `prompt`; optional first frame) returns a `jobId`; `status` / `wait` / `content`; `catalog`; optional `edit` / `extend` |

### Image-to-video (first frame)

When Provider `capabilities()` includes the `image` modality, the schema exposes:

| Arg | Role |
| ---- | ---- |
| `first_frame` | Opening still: `https` · `data:image/…;base64,…` · `attachment:<id>` |
| `image_url` | Hermes-compatible alias (same schemes as `first_frame`) |
| `reference_image_urls` / `reference_attachment_ids` | Extra refs (OpenAI first-frame max = 1) |

The OpenAI path uploads the still as multipart `input_reference`.

### edit / extend / catalog

| action | Needs | Backend |
| ------ | ---- | ---- |
| `catalog` | — | Lists `capabilities().families` (sora-2 · sora-2-pro) |
| `edit` | `job_id` (source) + `prompt` | `POST /videos/edits` |
| `extend` | `job_id` + `prompt`; optional `seconds` | `POST /videos/extensions` |

The MP4 is **never inlined into tool text**; with an `AttachmentStore` the Host persists it via `saveFile`
and returns an `attachmentId`. `content` returns `not_ready=true` (not an error) while the job is unfinished;
only `status=failed` is an `isError`.

## Enable

Precedence: **Settings (product SoT)** → **Credentials (secrets)** → **env (CI / headless bypass only)**.

| Channel | Fields |
|---------|--------|
| **Settings** | Face ns `video-gen`: `mode` off/openai/fal/xai/openrouter/deepinfra · optional `baseUrl` · `model` |
| **Credentials** | openai · fal · xai · openrouter · deepinfra slots (with public env fallbacks) |
| **Env-only** | `XRK_VIDEO_GEN=memory` · `=1` / `openai` / `fal` / `xai` / `openrouter` / `deepinfra` |

Live after the next agent rebuild. Non-empty `XRK_VIDEO_GEN` is the CI bypass.

| `XRK_VIDEO_GEN` / Settings | Behavior |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| (unset / off) | Tool still registers; execute **fails honestly** |
| `memory` (env only) | In-memory Provider |
| `1` / openai | OpenAI Videos; default `sora-2` |
| `fal` | FAL queue (Hermes-scale families: pixverse · veo · kling · wan · seedance · minimax · …) |
| `xai` | xAI Grok Imagine video |
| `openrouter` | OpenRouter Videos API (default `minimax/hailuo-3-max`) |
| `deepinfra` | DeepInfra OpenAI-compatible Videos |

Custom `VideoGenService` injection remains supported.
