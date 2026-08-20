# LLM DeepSeek

> **读者**：集成者 · 终端用户。

`@xrkseek/llm-deepseek` — DeepSeek Chat Completions 预设（基于 `@xrkseek/llm-openai-compatible`）。

默认：`https://api.deepseek.com` · Bearer · 模型 `deepseek-v4-flash` / `deepseek-v4-pro`（catalog 默认 1M 上下文 · 384K max output）。SSE thinking 流走 openai-compatible 适配器（`reasoning_content` → `reasoning-delta`）。**不**声明视觉 modality（官方 Chat Completions serialize 拒图）。

```ts
import { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";

const llm = createDeepSeekAdapter({
  apiKey: process.env.DEEPSEEK_API_KEY,
});
```

密钥由宿主传入，**不入库**。

## 相关

[llm-openai-compatible.md](./llm-openai-compatible.md) · [status.md](./status.md)
