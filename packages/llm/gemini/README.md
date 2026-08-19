# @xrkseek/llm-gemini

Google Gemini `generateContent` adapter (`gemini-generate` protocol).

```ts
import { createGeminiAdapter } from "@xrkseek/llm-gemini";

const llm = createGeminiAdapter({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-2.0-flash",
});
```

Registry brand: `gemini`. Spec: [docs/llm-provider-registry.md](../../../docs/llm-provider-registry.md).
