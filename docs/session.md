# Session（索引）

> **读者**：集成者 · 贡献者。

长寿 session + 短寿 turn（[ADR-0003](./adr/0003-session-long-loop-short.md)）。真源是事件日志；模型可见输入由 `deriveMessages` 重建。身份与文档分层见 [audiences.md](./audiences.md)。

| 文档 | 内容 |
|------|------|
| [protocol-events.md](./protocol-events.md) | 事件集合 · TokenUsage helpers · `parseSessionEvent` · JSON Schema |
| [session-api.md](./session-api.md) | `newSession` · `admit` · `continueTurn` |
| [session-delivery.md](./session-delivery.md) | steer / queue；批合并 · 单次 maxSteps |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch · wake/resume |
| [session-safety.md](./session-safety.md) | mistake · loop tracker |
| [session-compaction.md](./session-compaction.md) | 换窗压缩 · overflow · Token 估算 · Context meter |
| [modules/session-projection.md](./modules/session-projection.md) | 投影状态/视图缝 · Face mux / history |
| [tool-settlement.md](./tool-settlement.md) | dangling · 取消码 · 并行 settle · concludesTurn |
| [http-api.md](./http-api.md) | HTTP 形状 |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` → durable `user/message` injects（skill-catalog · agent-instructions） |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` 展开 |
| [policy.md](./policy.md) | tool/provider/mcp 门禁 |

包：`@xrkseek/protocol` · `@xrkseek/core-session` · `@xrkseek/core-agent`。

JSONL 导出：`toJSONL` / `fromJSONL` / `parseJSONL`；ZIP 导出用 `toPackedJSONL`（`text-chunks` / `tool-call-chunks` 行压缩连续 `assistant/chunk`，≥3）+ 可选 `.jsonl.zst` sidecar；`fromPackedJSONL` / `parsePackedJSONL` / `fromPackedJSONLZstd` 可导入。**默认持久化** `createPersistentSessionStore` → `{XRK_SESSIONS_DIR}/sessions.db`（WAL · **schema v3** · `node:sqlite` · FTS5 trigram · lazy load · chunk 写批并物理打包 `text-chunks` / `tool-call-chunks` · `flush()` · open-turn 崩溃修复）。内存 API 仍为扁平 `SessionEvent[]`。`SessionStore.has` 不抛。`session.search` 持久化走 FTS 候选。
