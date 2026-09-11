# @xrkseek/llm-deepseek

Thin `LlmAdapter` for DeepSeek’s **OpenAI-compatible** Chat Completions surface.

Defaults: `https://api.deepseek.com` + model `deepseek-flash` (DeepSeek-V41-Flash).
Implementation delegates to `@xrkseek/llm-openai-compatible` — optional `reasoning` /
SSE `reasoning-delta`. Default catalog: `deepseek-flash` (text+image) · `deepseek-v4-flash` ·
`deepseek-v4-pro` · `deepseek-v4-flash-vision-exp`. An explicit Settings `llm-deepseek.models`
list replaces that default set. On the **official** host, image-capable routes prefer the
**Files API** (`file_id` reuse, `~/.xrk/llm-deepseek/files-v3.json`) with inline base64 fallback.

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
  // model?: "deepseek-flash" | "deepseek-v4-flash" | "deepseek-v4-pro" | "deepseek-v4-flash-vision-exp"
});
```

Specs: [docs/llm-deepseek.md](../../../docs/llm-deepseek.md).
