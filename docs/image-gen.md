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
| **Settings** | Face ns `image-gen`：`mode` = 关 / openai / fal / xai / openrouter / deepinfra / krea / meta-ai · 可选 `baseUrl` · `model`（Settings → Plugins → **图像生成**） |
| **Credentials** | openai：`XRK_IMAGE_GEN_OPENAI_KEY` · fal：`XRK_IMAGE_GEN_FAL_KEY` · xai：`XRK_IMAGE_GEN_XAI_KEY` · openrouter：`XRK_IMAGE_GEN_OPENROUTER_KEY` · deepinfra：`XRK_IMAGE_GEN_DEEPINFRA_KEY` · krea：`XRK_IMAGE_GEN_KREA_KEY` · meta-ai：`XRK_IMAGE_GEN_META_KEY`（各有公开 env 回落） |
| **仅 env** | `XRK_IMAGE_GEN=memory` · `=1` / `openai` / `fal` / `xai` / `openrouter` / `deepinfra` / `krea` / `meta-ai`（旁路 Settings）· 可选 `XRK_IMAGE_GEN_BASE_URL` / `XRK_IMAGE_GEN_MODEL` |

保存 Settings 后热切换（下次 agent 重建）。非空 `XRK_IMAGE_GEN` 为 CI 旁路。

| Settings / env | 行为 |
|----------------|------|
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（1×1 PNG；支持 edit 路径测例） |
| `1` / openai | OpenAI Images；需钥；默认最多 16 张参考图 |
| `fal` | FAL queue（Hermes 满编 catalog；默认 `fal-ai/flux-2/klein/9b`） |
| `xai` | xAI Grok Imagine |
| `openrouter` | OpenRouter Dedicated Image API（默认 Gemini Flash Image） |
| `deepinfra` | DeepInfra OpenAI 兼容（**仅文生图**；诚实拒参考图） |
| `krea` | Krea 2 异步作业（medium / large / turbo） |
| `meta-ai` | Meta Muse（**仅文生图**） |

也可注入自定义 `ImageGenService`（实现 `capabilities()` + `generate`）。

---

# Image generation

> **Audience**: Integrators · Agent authors

Text-to-image / image-to-image seam: `@xrkseek/exec-image-gen`. Model tool `image_generate` (Hermes one-tool style: refs select edit). Schema rebuilds from Provider `capabilities()`.

## Tools

| Tool | Role |
|------|------|
| `image_generate` | Text-to-image; with edit-capable Provider also accepts `image_url` / `reference_image_urls` / `reference_attachment_ids`. Returns PNG base64 (truncated) and optional `attachmentId`. |

No refs → OpenAI `images/generations`; with refs → `images/edits`. FAL/xAI follow the same tool surface via their Providers.

## Enable

Precedence: **Settings (product SoT)** → **Credentials (secrets)** → **env (CI / headless bypass only)**.

| Channel | Fields |
|---------|--------|
| **Settings** | Face ns `image-gen`: `mode` off/openai/fal/xai/openrouter/deepinfra/krea/meta-ai · optional `baseUrl` · `model` |
| **Credentials** | openai · fal · xai · openrouter · deepinfra · krea · meta-ai slots (with public env fallbacks) |
| **Env-only** | `XRK_IMAGE_GEN=memory` · `=1` / `openai` / `fal` / `xai` / `openrouter` / `deepinfra` / `krea` / `meta-ai` |

Live after the next agent rebuild. Non-empty `XRK_IMAGE_GEN` is the CI bypass. Custom Providers inject via `ImageGenService`. Hermes-scale matrix: OpenAI · FAL (full catalog) · xAI · OpenRouter · DeepInfra (t2i-only) · Krea · Meta Muse (t2i-only).
