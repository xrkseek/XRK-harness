# LLM DeepSeek

> **读者**：集成者 · 终端用户。

`@xrkseek/llm-deepseek` — DeepSeek Chat Completions 预设（基于 `@xrkseek/llm-openai-compatible`）。

## 默认

| 项 | 值 |
| --- | --- |
| Host | `https://api.deepseek.com`（Bearer） |
| 默认模型 | `deepseek-v4-flash` |
| Catalog | `deepseek-v4-flash` · `deepseek-v4-pro` · **`deepseek-v4-flash-vision-exp`**（1M 上下文 · 384K max output） |

SSE thinking 流走 openai-compatible 适配器（`reasoning_content` → `reasoning-delta`）。

## 视觉 modality

| 路由 | `inputModalities` |
| --- | --- |
| 官方 host + Flash / Pro | `["text"]`（serialize 拒图） |
| 官方 host + **`deepseek-v4-flash-vision-exp`** | `["text", "image"]`（对照 DSH `dsh-v0.1.1-rc.1` catalog） |
| 自定义 gateway（非官方 baseUrl） | 默认 `["text", "image"]` |

Face / Registry 创建 adapter 时按上表解析；Face intake（粘贴图片）不能盖过官方 text-only 模型。

## reasoningEffort

请求可带 `reasoningEffort`（`off` | `low` | `high` | `max`）：出站映射为 `thinking: { type }` + 可选 `reasoning_effort`（DSH `serializeRequest`；`off` 只关 thinking，不发 `reasoning_effort: off`）。Face / routing 选择的 effort 经 `LlmChatRequest` 注入。

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const vision = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: "deepseek-v4-flash-vision-exp",
});
```

密钥由宿主传入，**不入库**。

## 相关

[llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-provider-registry.md](./llm-provider-registry.md) · [status.md](./status.md)
