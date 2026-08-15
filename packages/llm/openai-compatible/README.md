# @xrkseek/llm-openai-compatible

OpenAI-compatible Chat Completions → `LlmAdapter`（非流式）。

```ts
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";

const llm = createOpenAiCompatibleAdapter({
  baseUrl: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
});
```

见 `docs/llm-openai-compatible.md`。测例用 mock `fetch`，勿提交真实 key。
