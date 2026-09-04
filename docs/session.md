# Session（索引）

> **读者**：集成者 · 贡献者

长寿 session + 短寿 turn（[ADR-0003](./adr/0003-session-long-loop-short.md)）。真源是事件日志；模型可见输入由 `deriveMessages` 重建。身份与文档分层见 [audiences.md](./audiences.md)。

| 文档 | 内容 |
|------|------|
| [protocol-events.md](./protocol-events.md) | 事件集合 · `aborted` vs `interrupted` · TokenUsage · `parseSessionEvent` · JSON Schema |
| [session-log.md](./session-log.md) | 日志位置品牌 · 必选 `readEvents` · store accessors · 与 Face mux 序号分离 |
| [session-api.md](./session-api.md) | `newSession` · `admit` · `continueTurn` |
| [session-delivery.md](./session-delivery.md) | steer / queue；批合并 · 单次 maxSteps |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch · wake/resume |
| [session-safety.md](./session-safety.md) | mistake · loop tracker |
| [session-compaction.md](./session-compaction.md) | 换窗压缩 · overflow · Token 估算 · Context meter |
| [modules/session-projection.md](./modules/session-projection.md) | 投影状态/视图缝 · Face mux / history |
| [tool-settlement.md](./tool-settlement.md) | dangling · 取消码 · 并行 settle · concludesTurn |
| [http-api.md](./http-api.md) | HTTP 形状 |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` → durable `user/message` injects（`messageId` 唯一；skill-catalog · agent-instructions） |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` 展开 |
| [policy.md](./policy.md) | tool/provider/mcp 门禁 |

包：`@xrkseek/protocol` · `@xrkseek/core-session` · `@xrkseek/core-agent`。

JSONL 导出：`toJSONL` / `fromJSONL` / `parseJSONL`；ZIP 导出用 `toPackedJSONL`（`text-chunks` / `tool-call-chunks` 行压缩连续 `assistant/chunk`，≥3）+ 可选 `.jsonl.zst` sidecar；`fromPackedJSONL` / `parsePackedJSONL` / `fromPackedJSONLZstd` 可导入。

**默认持久化**：`createPersistentSessionStore` → `{XRK_SESSIONS_DIR}/sessions.db`（WAL · **schema v3** · `node:sqlite` · FTS5 trigram · lazy load · chunk 写批并物理打包 `text-chunks` / `tool-call-chunks` · `flush()` · open-turn 崩溃修复 · **驻留 LRU**：默认最多 8 个会话在内存，**未闭合 turn 不驱逐**，必要时可临时超上限）。内存 API 仍为扁平 `SessionEvent[]`。`SessionStore.readEvents` **必选**；生产读走 [session-log.md](./session-log.md)（`readSessionEvents` · `sessionEventCount` · …）。`SessionStore.has` 不抛。`session.search` 持久化走 FTS 候选。

发模型前硬闸：`assertToolCallsSettled`（按 id 结算）+ `assertAssistantToolCallAdjacency`（`assistant(toolCalls)` 后必须紧跟对应 `tool`，禁止双 assistant 夹断；结算通过仍可能邻接失败 → 本地抛错，不再打到供应商 400）。

**耐久屏障**：Host 在 drain idle（一轮工具/续写收敛后）与 `stop` 时调用 `store.flush()`，把已 append 的事件推到 SQLite，再对外暴露「可观察」状态。工具副作用在事件落库之后执行；未 `flush` 的读路径上磁盘可能落后于内存。

索引：[docs/README.md](./README.md)。

---

# Session (Index)

> **Audience**: Integrators · Contributors

A long-lived session plus short-lived turns ([ADR-0003](./adr/0003-session-long-loop-short.md)). The source of truth is the event log; model-visible input is rebuilt by `deriveMessages`. Audience layering: [audiences.md](./audiences.md).

| Doc | Content |
|-----|---------|
| [protocol-events.md](./protocol-events.md) | Event set · `aborted` vs `interrupted` · TokenUsage · `parseSessionEvent` · JSON Schema |
| [session-log.md](./session-log.md) | Log position brands · required `readEvents` · store accessors · distinct from Face mux seq |
| [session-api.md](./session-api.md) | `newSession` · `admit` · `continueTurn` |
| [session-delivery.md](./session-delivery.md) | steer / queue; batch merge · per-drain maxSteps |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch · wake/resume |
| [session-safety.md](./session-safety.md) | mistake · loop tracker |
| [session-compaction.md](./session-compaction.md) | Window compaction · overflow · token estimate · context meter |
| [modules/session-projection.md](./modules/session-projection.md) | Projection state/view seam · Face mux / history |
| [tool-settlement.md](./tool-settlement.md) | dangling · cancel codes · parallel settle · concludesTurn |
| [http-api.md](./http-api.md) | HTTP shapes |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` → durable `user/message` injects (`messageId` unique; skill-catalog · agent-instructions) |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` expansion |
| [policy.md](./policy.md) | tool/provider/mcp gates |

Packages: `@xrkseek/protocol` · `@xrkseek/core-session` · `@xrkseek/core-agent`.

JSONL export uses `toJSONL` / `fromJSONL` / `parseJSONL`. ZIP export uses `toPackedJSONL` (packs consecutive `assistant/chunk` rows of kind `text-chunks` / `tool-call-chunks`, length ≥ 3) plus an optional `.jsonl.zst` sidecar; import via `fromPackedJSONL` / `parsePackedJSONL` / `fromPackedJSONLZstd`.

**Default persistence**: `createPersistentSessionStore` → `{XRK_SESSIONS_DIR}/sessions.db` (WAL · **schema v3** · `node:sqlite` · FTS5 trigram · lazy load · batched chunk writes with physical packing · `flush()` · open-turn crash repair · **resident LRU**: default cap 8 in memory; **open turns are never evicted**, so the resident set may temporarily exceed the cap). The in-memory API remains a flat `SessionEvent[]`. `SessionStore.readEvents` is **required**; production reads go through [session-log.md](./session-log.md) (`readSessionEvents` · `sessionEventCount` · …). `SessionStore.has` does not throw. Persistent `session.search` uses FTS candidates.

Pre-LLM hard gates: `assertToolCallsSettled` (settle by id) + `assertAssistantToolCallAdjacency` (`assistant(toolCalls)` must be followed immediately by matching `tool` messages — a second assistant in between fails locally even if ids later settle, instead of an upstream HTTP 400).

**Durability barrier**: Host calls `store.flush()` on drain idle (after a tool/continue wave settles) and on `stop`, so appended events reach SQLite before observers treat the session as settled. Tool side effects run after the call is logged; without `flush`, disk may lag memory on a read path.

Index: [docs/README.md](./README.md).
