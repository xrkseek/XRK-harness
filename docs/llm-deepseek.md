# LLM DeepSeek

`@xrkseek/llm-deepseek` — DeepSeek Chat Completions 预设（基于 `@xrkseek/llm-openai-compatible`）。

默认：`https://api.deepseek.com` · Bearer · 模型 `deepseek-chat`。无独立 thinking / SSE 分叉（后续加深另开切片）。

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
});
```

密钥由宿主传入，**不入库**。

## 相关

[llm-openai-compatible.md](./llm-openai-compatible.md) · [status.md](./status.md)
