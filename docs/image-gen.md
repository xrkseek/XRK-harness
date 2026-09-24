# 图像生成

> **读者**：集成者 · Agent 作者

文生图缝：`@xrkseek/exec-image-gen`。模型工具 `image_generate`；Provider 可换。

## 工具

| 工具 | 作用 |
|------|------|
| `image_generate` | 文生图；返回 PNG base64（工具文本截断）；若 Host 有 `AttachmentStore` 则另给 `attachmentId` |

## 启用

**产品路径**：Settings → Plugins → **Image gen**（Face ns `image-gen`：`mode` = 关 / openai · 可选 `baseUrl` · `model`）。API 密钥经 Credentials `XRK_IMAGE_GEN_OPENAI_KEY`。保存后热切换。非空 `XRK_IMAGE_GEN` 为 CI 旁路。

| `XRK_IMAGE_GEN` / Settings | 行为 |
|-----------------|------|
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（1×1 PNG，CI / 演示） |
| `1` / openai | 需 `OPENAI_API_KEY` 或 Credentials `XRK_IMAGE_GEN_OPENAI_KEY`；可选 Settings / `XRK_IMAGE_GEN_BASE_URL` · `XRK_IMAGE_GEN_MODEL`（默认 `dall-e-3`） |

FAL / xAI 等其它后端可后续作 Provider 注入；本 MVP 对齐 OpenAI Images API + memory。

---

# Image generation

> **Audience**: Integrators · Agent authors

Text-to-image seam: `@xrkseek/exec-image-gen`. Model tool `image_generate`; Providers are swappable.

## Tools

| Tool | Role |
|------|------|
| `image_generate` | Text-to-image; returns PNG base64 (truncated in tool text); also `attachmentId` when Host has an `AttachmentStore` |

## Enable

**Product path**: Settings → Plugins → **Image gen** (Face ns `image-gen`: `mode` = off / openai · optional `baseUrl` · `model`). API key via Credentials `XRK_IMAGE_GEN_OPENAI_KEY`. Live after save. Non-empty `XRK_IMAGE_GEN` is the CI bypass.

| `XRK_IMAGE_GEN` / Settings | Behavior |
|-----------------|----------|
| (unset / off) | Tool still registers; execute **fails honestly** |
| `memory` (env only) | In-memory Provider (1×1 PNG, CI / demos) |
| `1` / openai | Needs `OPENAI_API_KEY` or Credentials `XRK_IMAGE_GEN_OPENAI_KEY`; optional Settings / `XRK_IMAGE_GEN_BASE_URL` · `XRK_IMAGE_GEN_MODEL` (default `dall-e-3`) |

FAL / xAI and other backends can be injected later as Providers; this MVP covers OpenAI Images API + memory.
