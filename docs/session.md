# Session（索引）

长寿 session + 短寿 turn（[ADR-0003](./adr/0003-session-long-loop-short.md)）。真源是事件日志；模型可见输入由 `deriveMessages` 重建。

| 文档 | 内容 |
|------|------|
| [protocol-events.md](./protocol-events.md) | 事件集合 · `parseSessionEvent` · JSON Schema |
| [session-api.md](./session-api.md) | `newSession` · `admit` · `continueTurn` |
| [session-delivery.md](./session-delivery.md) | steer / queue；批合并 · 单次 maxSteps |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch · wake/resume |
| [session-safety.md](./session-safety.md) | mistake · loop tracker |
| [session-compaction.md](./session-compaction.md) | compaction · overflow 一次重试 |
| [http-api.md](./http-api.md) | HTTP 形状 |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` → assemble.workspaceBlocks |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` 展开 |
| [policy.md](./policy.md) | tool/provider/mcp 门禁 |

包：`@xrkseek/protocol` · `@xrkseek/core-session` · `@xrkseek/core-agent`。

JSONL 仓：`createJsonlSessionStore` hydrate 丢掉末行不完整 JSON **或** 末行事件 schema 失败并原子回写；中段损坏跳过该文件；`SessionStore.has` 不抛。不是 FTS。
