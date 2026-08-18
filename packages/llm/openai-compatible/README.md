# @xrkseek/llm-openai-compatible

OpenAI-compatible Chat Completions → `LlmAdapter`（`chat()` 非流 JSON；默认另暴露 `stream()` SSE）。

```ts
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";

const llm = createOpenAiCompatibleAdapter({
  baseUrl: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
  inputModalities: ["text", "image"],
});
```

见 `docs/llm-openai-compatible.md`。测例用 mock `fetch`，勿提交真实 key。
