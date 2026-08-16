# LLM OpenAI-compatible

`@xrkseek/llm-openai-compatible` — Chat Completions HTTP 适配（`LlmAdapter`）。

## 行为

- `baseUrl` + `/chat/completions`
- `bearer` / `api-key` / 自定义 header
- tools → `function` schema；缺 id 时兜底
- 上下文溢出 → `ContextOverflowError`（供 compaction）

本切片不含：SSE 流式、vision、厂商专用 body 分叉（DeepSeek 预设见 [llm-deepseek.md](./llm-deepseek.md)）。

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
