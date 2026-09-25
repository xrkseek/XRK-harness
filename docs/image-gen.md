# 图像生成

> **读者**：集成者 · Agent 作者

文生图 / 图生图缝：`@xrkseek/exec-image-gen`。模型工具 `image_generate`（Hermes 单工具风格：有参考图即 edit）；Provider 可换；工具 schema 按 `capabilities()` 动态重建。

## 工具

| 工具 | 作用 |
|------|------|
| `image_generate` | 文生图；若 Provider 支持 edit，可传 `image_url` / `reference_image_urls` / `reference_attachment_ids` 做图生图编辑。返回 PNG base64（工具文本截断）；有 `AttachmentStore` 时另给 `attachmentId` |

### 参数

| 参数 | 说明 |
|------|------|
| `prompt` | 必填；文生描述或编辑指令 |
| `size` / `n` / `model` | 可选 |
| `image_url` | 主参考图：`https` · `data:image/…;base64,…` · `attachment:<id>`（仅当 capabilities 含 image） |
| `reference_image_urls` | 额外参考 URL（同上） |
| `reference_attachment_ids` | Host 附件 id（优先） |

无参考图 → `POST /images/generations`；有参考图 → `POST /images/edits`（OpenAI；memory 记 `modality=image`）。

## 启用

优先序：**Settings（产品真源）** → **Credentials（密钥）** → **env（仅 CI / 无头旁路）**。

| 通道 | 内容 |
|------|------|
| **Settings** | Face ns `image-gen`：`mode` = 关 / openai · 可选 `baseUrl` · `model`（Settings → Plugins → **图像生成**） |
| **Credentials** | `XRK_IMAGE_GEN_OPENAI_KEY`（槽 `image.openai`）；运行时也可回落 `OPENAI_API_KEY` |
| **仅 env** | `XRK_IMAGE_GEN=memory`（演示 Provider）· `=1` / `openai`（旁路 Settings 开 openai）· 可选 `XRK_IMAGE_GEN_BASE_URL` / `XRK_IMAGE_GEN_MODEL` |

保存 Settings 后热切换（下次 agent 重建）。非空 `XRK_IMAGE_GEN` 为 CI 旁路。

| Settings / env | 行为 |
|----------------|------|
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（1×1 PNG；支持 edit 路径测例） |
| `1` / openai | 需 `OPENAI_API_KEY` 或 Credentials；默认 capabilities：text+image、最多 16 张参考图 |

其它后端（FAL / xAI）可注入自定义 `ImageGenService`（实现 `capabilities()` + `generate`）。

---

# Image generation

> **Audience**: Integrators · Agent authors

Text-to-image / image-to-image seam: `@xrkseek/exec-image-gen`. Model tool `image_generate` (Hermes one-tool style: refs select edit). Schema rebuilds from Provider `capabilities()`.

## Tools

| Tool | Role |
|------|------|
| `image_generate` | Text-to-image; with edit-capable Provider also accepts `image_url` / `reference_image_urls` / `reference_attachment_ids`. Returns PNG base64 (truncated) and optional `attachmentId`. |

No refs → OpenAI `images/generations`; with refs → `images/edits`.

## Enable

Precedence: **Settings (product SoT)** → **Credentials (secrets)** → **env (CI / headless bypass only)**.

| Channel | Fields |
|---------|--------|
| **Settings** | Face ns `image-gen`: `mode` off/openai · optional `baseUrl` · `model` (Settings → Plugins → **Image generation**) |
| **Credentials** | `XRK_IMAGE_GEN_OPENAI_KEY` (slot `image.openai`); runtime may also fall back to `OPENAI_API_KEY` |
| **Env-only** | `XRK_IMAGE_GEN=memory` · `=1` / `openai` (bypass Settings) · optional `XRK_IMAGE_GEN_BASE_URL` / `XRK_IMAGE_GEN_MODEL` |

Live after the next agent rebuild. Non-empty `XRK_IMAGE_GEN` is the CI bypass. Custom Providers inject via `ImageGenService`.
