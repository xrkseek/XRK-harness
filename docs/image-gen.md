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

**产品路径**：Settings → Plugins → **Image gen**（Face ns `image-gen`：`mode` = 关 / openai · 可选 `baseUrl` · `model`）。API 密钥经 Credentials `XRK_IMAGE_GEN_OPENAI_KEY`。保存后热切换。非空 `XRK_IMAGE_GEN` 为 CI 旁路。

| `XRK_IMAGE_GEN` / Settings | 行为 |
|-----------------|------|
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

**Product path**: Settings → Plugins → **Image gen**. Non-empty `XRK_IMAGE_GEN` is the CI bypass (`memory` / `1`+key). Custom Providers inject via `ImageGenService`.
