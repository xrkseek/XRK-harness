# @xrkseek/llm-anthropic

Anthropic Messages API adapter (`anthropic-messages` protocol).

```ts
import { createAnthropicAdapter } from "@xrkseek/llm-anthropic";

const llm = createAnthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-sonnet-4-20250514",
});
```

Registry brand: `anthropic`. Spec: [docs/llm-provider-registry.md](../../../docs/llm-provider-registry.md).
