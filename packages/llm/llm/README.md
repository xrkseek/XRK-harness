# @xrkseek/llm

LLM 适配面：`LlmAdapter` · 简单 registry · `ContextOverflowError`。

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
- Vendor 包 `openai-compatible` / `deepseek`：**空壳**（自行实现 Adapter 或后填）
- Overflow 与 compaction：[docs/session-compaction.md](../../docs/session-compaction.md)
