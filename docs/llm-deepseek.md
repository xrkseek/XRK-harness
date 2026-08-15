# LLM DeepSeek

`@xrkseek/llm-deepseek` — thin preset over `@xrkseek/llm-openai-compatible`.

**诚实边界：** 这不是 DeepSeek Harness 级「官方适配」（无 SSE / thinking / 稳定错误码）。深读对照见 [learn/openai-compatible-llm.md](./learn/openai-compatible-llm.md)。

## Steal / stance

DeepSeek’s public Chat Completions host is OpenAI-shaped (`https://api.deepseek.com`, Bearer).
This package only locks **defaults + naming**; wire logic stays in openai-compatible（调研取精华 · 不并上游）。

**本切片不取：** `thinking` / `reasoning_effort` body、reasoner 专用字段、Anthropic 兼容面、SSE。

## API

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";
// or from SDK: createDeepSeekAdapter

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
  // baseUrl?: default https://api.deepseek.com
  // model?: default deepseek-chat
});
```

密钥只从宿主 env / 调用方传入——**永不入库**。

## Related

- [llm-openai-compatible.md](./llm-openai-compatible.md)
- [learn/openai-compatible-llm.md](./learn/openai-compatible-llm.md)
- [status.md](./status.md)
