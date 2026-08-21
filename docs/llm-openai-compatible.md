# LLM OpenAI-compatible

> **读者**：集成者 · 贡献者。

`@xrkseek/llm-openai-compatible` — Chat Completions HTTP 适配（`LlmAdapter`）。

## 行为

- `baseUrl` + `/chat/completions`
- `bearer` / `api-key` / 自定义 header
- tools → `function` schema；缺 id 时兜底
- 上下文溢出 → `ContextOverflowError`（供 compaction）
- 默认 `stream()`：SSE `delta.reasoning_content` → `reasoning-delta`（index 0），`delta.content` → `text-delta`（index 1）；`chat()` 仍非流 JSON
- `inputModalities` 含 `"image"` 时 user 块走 `image_url` data URL（须 `resolveImage`）。默认 text-only

厂商专用 body 分叉见 [llm-deepseek.md](./llm-deepseek.md)（官方 DeepSeek 默认 text-only；`deepseek-v4-flash-vision-exp` 标视觉）。

```ts
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";

const llm = createOpenAiCompatibleAdapter({
  baseUrl: process.env.OPENAI_BASE_URL!,
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
});
```

密钥由宿主传入，**不入库**。测例用 mock `fetch`。

## 相关

`@xrkseek/llm` · `@xrkseek/llm-replay` · [llm-deepseek.md](./llm-deepseek.md) · [status.md](./status.md)
