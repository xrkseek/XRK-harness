# LLM OpenAI-compatible

`@xrkseek/llm-openai-compatible` — thin `LlmAdapter` over **Chat Completions** HTTP.

## Steal from bar / AGT（精华 · 不并源码）

| 吸取 | 本仓落地 |
|------|----------|
| `baseUrl` + `/chat/completions` 拼接 | `buildOpenAiCompatibleEndpoint` |
| `bearer` / `api-key` / 自定义 header 鉴权 | `authMode` |
| tools → `type: function` schema | 请求映射 |
| `tool_calls` 缺 id 时兜底 | `call_${i}_…` |
| 上下文溢出 → 可恢复错误 | `ContextOverflowError`（供 loop compaction） |

**不取（本切片）：** SSE 流式、vision、stripToolTraces、proxy、厂商专用 body 分叉（DeepSeek 薄预设见 [llm-deepseek.md](./llm-deepseek.md)；`thinking` 等后置）。

## API

```ts
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";

const llm = createOpenAiCompatibleAdapter({
  baseUrl: process.env.OPENAI_BASE_URL!, // e.g. https://api.openai.com/v1
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
  // authMode?: "bearer" | "api-key" | "header"
  // path?: "/chat/completions"
  // fetch?: custom // tests
});

// plug into preset:
createMinimalComposition({ workspaceRoot, llm });
```

密钥只从宿主 env / 调用方传入——**永不入库**。

## Tests

无真实密钥：注入 mock `fetch`（见包内测例）。行为锁：消息/工具映射、鉴权头、overflow。

## Related

- Interface: `@xrkseek/llm`  
- Replay（CI）: `@xrkseek/llm-replay`  
- DeepSeek 默认：[`@xrkseek/llm-deepseek`](./llm-deepseek.md)  
- [status.md](./status.md) · [profiles.md](./profiles.md) · [references.md](./references.md)
