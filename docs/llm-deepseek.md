# LLM DeepSeek

> **读者**：集成者 · 终端用户

`@xrkseek/llm-deepseek` — DeepSeek Chat Completions 预设（基于 `@xrkseek/llm-openai-compatible`）。

## 默认

| 项 | 值 |
| --- | --- |
| Host | `https://api.deepseek.com`（Bearer） |
| 默认模型 | `deepseek-flash`（DeepSeek-V4.1-Flash） |
| Catalog | `deepseek-flash`（text+image）· `deepseek-v4-pro`（text）（1M 上下文 · 384K max output） |

已退役的 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` **不进** Settings 默认目录；若请求仍带这些 id，按官方兼容路由视为 Flash（含视觉）。

SSE thinking 流走 openai-compatible 适配器（`reasoning_content` → `reasoning-delta`）。

## 视觉 modality

| 路由 | `inputModalities` |
| --- | --- |
| 官方 host + **`deepseek-flash`**（及退役 Flash 别名） | `["text", "image"]`；官方 host 优先 **Files API** 上传并复用 `file_id` |
| 官方 host + **`deepseek-v4-pro`** | `["text"]`（serialize 拒图） |
| 自定义 gateway（非官方 baseUrl） | 默认 `["text", "image"]` |

Face / Registry 创建 adapter 时按上表解析；Face intake（粘贴图片）不能盖过官方 text-only 模型（Pro）。

## reasoningEffort

请求可带 `reasoningEffort`（`off` | `low` | `high` | `max`）：出站映射为 `thinking: { type }` + 可选 `reasoning_effort`（`off` 只关 thinking，不发 `reasoning_effort: off`）。Face / routing 选择的 effort 经 `LlmChatRequest` 注入。

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const flash = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: "deepseek-flash",
});
```

密钥由宿主传入，**不入库**。

## 相关

[llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-provider-registry.md](./llm-provider-registry.md) · [status.md](./status.md)

---

# LLM DeepSeek

> **Audience**: Integrators · End users

`@xrkseek/llm-deepseek` — DeepSeek Chat Completions preset (on `@xrkseek/llm-openai-compatible`).

## Defaults

| Item | Value |
| --- | --- |
| Host | `https://api.deepseek.com` (Bearer) |
| Default model | `deepseek-flash` (DeepSeek-V4.1-Flash) |
| Catalog | `deepseek-flash` (text+image) · `deepseek-v4-pro` (text) (1M context · 384K max output) |

Retired ids `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` are **out** of the Settings seed; requests that still send them follow vendor compat routing as Flash (including vision).

SSE thinking uses the openai-compatible adapter (`reasoning_content` → `reasoning-delta`).

## Vision modality

| Route | `inputModalities` |
| --- | --- |
| Official host + **`deepseek-flash`** (and retired Flash aliases) | `["text", "image"]`; official host prefers the **Files API** upload and reuses `file_id` |
| Official host + **`deepseek-v4-pro`** | `["text"]` (serialize rejects images) |
| Custom gateway (non-official baseUrl) | Defaults to `["text", "image"]` |

Face / Registry resolve modalities as above when creating adapters; Face intake (pasted images) must not override official text-only models (Pro).

## reasoningEffort

Requests may carry `reasoningEffort` (`off` | `low` | `high` | `max`): outbound maps to `thinking: { type }` plus optional `reasoning_effort` (`off` disables thinking only; never sends `reasoning_effort: off`). Face / routing effort is injected via `LlmChatRequest`.

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const flash = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: "deepseek-flash",
});
```

Keys are supplied by the host and **never** checked into the repo.

## Related

[llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-provider-registry.md](./llm-provider-registry.md) · [status.md](./status.md)
