# @xrkseek/llm-deepseek

Thin `LlmAdapter` for DeepSeek’s **OpenAI-compatible** Chat Completions surface.

Defaults: `https://api.deepseek.com` + model `deepseek-v4-flash`. Implementation delegates to
`@xrkseek/llm-openai-compatible` — optional `reasoning` / SSE `reasoning-delta`. Does **not**
declare image modality (official serialize rejects images).

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
  // model?: "deepseek-v4-flash" | "deepseek-v4-pro" | platform ids
});
```

Specs: [docs/llm-deepseek.md](../../../docs/llm-deepseek.md).
