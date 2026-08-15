# @xrkseek/llm-replay

Fixture 驱动的 `LlmAdapter`，用于无密钥单测与 `minimal`/`harness` 默认演示。

```ts
import { createReplayAdapter } from "@xrkseek/llm-replay";

const llm = createReplayAdapter([
  { content: "first" },
  { content: "", toolCalls: [{ id: "1", name: "glob", arguments: { pattern: "*.ts" } }] },
  { content: "done" },
]);
```

耗尽 fixture 会抛错。支持 `signal` abort。
