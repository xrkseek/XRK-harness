# 视频生成

> **读者**：集成者 · Agent 作者

文生视频缝：`@xrkseek/exec-video-gen`。模型工具 `video_generate`；Provider 可换。

视频渲染是**异步**的（真实后端都要排队数分钟），所以缝直接暴露作业生命周期，而不是把一次渲染藏在单个阻塞调用里：`create` 返回 `jobId`，`get` 轮询状态，`content` 在 `completed` 后下载 MP4。对齐 OpenAI Videos API（`POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`）。

## 工具

| 工具             | 作用                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `video_generate` | `action=start`（默认，需 `prompt`）返回 `jobId`；`action=status` 轮询；`action=wait` 阻塞直到终态；`action=content` 下载 MP4 |

MP4 **不内联进工具文本**；Host 配了 `AttachmentStore` 时经 `saveFile` 落盘并返回 `attachmentId`。
`content` 在作业未完成时返回 `not_ready=true`（不报错）；`status=failed` 才是 `isError`。

## 启用

**产品路径**：Settings → Plugins → **Video gen**（Face ns `video-gen`：`mode` = 关 / openai · 可选 `baseUrl` · `model`）。API 密钥经 Credentials `XRK_VIDEO_GEN_OPENAI_KEY`。保存后热切换。非空 `XRK_VIDEO_GEN` 为 CI 旁路。

| `XRK_VIDEO_GEN` / Settings | 行为 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（确定性作业生命周期 + 24 字节 `ftyp` MP4，CI / 演示） |
| `1` / openai | 需 `OPENAI_API_KEY` 或 Credentials `XRK_VIDEO_GEN_OPENAI_KEY`；可选 Settings / `XRK_VIDEO_GEN_BASE_URL` · `XRK_VIDEO_GEN_MODEL`（默认 `sora-2`） |

其它后端（Runway / Kling / FAL 等）可后续作 Provider 注入；本 MVP 对齐 OpenAI Videos API + memory。

---

# Video generation

> **Audience**: Integrators · Agent authors

Text-to-video seam: `@xrkseek/exec-video-gen`. Model tool `video_generate`; Providers are swappable.

Video renders are **asynchronous** — every real backend queues for minutes — so the seam exposes the job
lifecycle directly instead of hiding a render behind one blocking call: `create` returns a `jobId`, `get`
polls status, and `content` downloads the MP4 once `completed`. This mirrors the OpenAI Videos API
(`POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`).

## Tools

| Tool             | Role                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video_generate` | `action=start` (default, needs `prompt`) returns a `jobId`; `action=status` polls; `action=wait` blocks to a terminal state; `action=content` downloads the MP4 |

The MP4 is **never inlined into tool text**; with an `AttachmentStore` the Host persists it via `saveFile`
and returns an `attachmentId`. `content` returns `not_ready=true` (not an error) while the job is unfinished;
only `status=failed` is an `isError`.

## Enable

**Product path**: Settings → Plugins → **Video gen** (Face ns `video-gen`: `mode` = off / openai · optional `baseUrl` · `model`). API key via Credentials `XRK_VIDEO_GEN_OPENAI_KEY`. Live after save. Non-empty `XRK_VIDEO_GEN` is the CI bypass.

| `XRK_VIDEO_GEN` / Settings | Behavior |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| (unset / off) | Tool still registers; execute **fails honestly** |
| `memory` (env only) | In-memory Provider (deterministic job lifecycle + a 24-byte `ftyp` MP4, CI / demos) |
| `1` / openai | Needs `OPENAI_API_KEY` or Credentials `XRK_VIDEO_GEN_OPENAI_KEY`; optional Settings / `XRK_VIDEO_GEN_BASE_URL` · `XRK_VIDEO_GEN_MODEL` (default `sora-2`) |

Runway / Kling / FAL and other backends can be injected later as Providers; this MVP covers OpenAI Videos API + memory.
