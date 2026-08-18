# @xrkseek/llm

LLM 适配面：`LlmAdapter` · 简单 registry · `ContextOverflowError` · 可选 `stream()`。

```ts
import type { LlmAdapter } from "@xrkseek/llm";

const adapter: LlmAdapter = {
  id: "mine",
  async chat({ messages, tools, signal }) {
    /* call vendor */
    return { content: "…" };
  },
};
```

## 相关

- 无密钥测例：`@xrkseek/llm-replay`
- Vendor 包 `openai-compatible`：Chat Completions + 默认 SSE；`inputModalities` 含 `image` 才走视觉
- `deepseek`：兼容面 thinking 流；**不**标视觉
- Overflow 与 compaction：[docs/session-compaction.md](../../docs/session-compaction.md)
