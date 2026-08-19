# @xrkseek/llm-openai-responses

OpenAI Responses API adapter (`openai-responses` protocol).

```ts
import { createOpenAiResponsesAdapter } from "@xrkseek/llm-openai-responses";

const llm = createOpenAiResponsesAdapter({
  baseUrl: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o",
});
```

Registry brand: `openai-responses`. Spec: [docs/llm-provider-registry.md](../../../docs/llm-provider-registry.md).
