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

**同步 flush 代价（2026 实机压测）**：非 `assistant/chunk` 事件（`tool/call` · `tool/result` · `user/message` 等）走 `persistEvent` **逐条同步落库**——`BEGIN IMMEDIATE` + 插入 + `COMMIT` 全部同步发生在调用线程。本机基准（5000 次 `tool/call` append）：单次 **P50≈1.2ms · P99≈2.0ms · max≈9.2ms**；**连续 300 次不让出的事件循环冻结 ≈ 384ms**。`assistant/chunk` 例外：只进批，**不**逐条 flush（5000 次 append P50≈0.003ms），到 `flush()` 一次落库（5000 条 ≈ 24ms）。因此**热路径契约**：工具/消息类事件以每几十毫秒数条的节奏安全；若一次事件循环内同步 append 数百条，事件循环（Face mux 推送 · Ping · 流式让出）会被同量级冻结，这是设计内行为（drain 边界 flush），不是泄漏。

**目录级写锁（多实例防误用）**：`createPersistentSessionStore(dir)` 默认对 `dir` 取**独占写租约**（`sessions.write.lock` PID 锁文件，见 `store-lock.ts`）：同进程二次独占、或另一存活 Host/CLI 持锁时抛 `SessionsDirInUseError`（`code = "sessions-dir-in-use"`），**fail-closed 而非静默共享 `sessions.db`**。崩溃持有者的过期锁在 PID 校验失败后才会被接管（空/不可读锁前 4 次视为争用重试，不立即接管——避免 create 窗口双写）。**正确用法**：Host/CLI 等**写者必须省略 `shared`**；`{ shared: true }` 仅用于**多进程只读旁路**（如测试在 Host 持锁时读库断言）——跳过写租约、`node:sqlite` 只读打开、任何写 API 抛 `"read-only when opened with { shared: true }"`。`shared` 模式是只读旁路，写会话会抛错。

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

**Synchronous flush cost (measured, 2026)**: non-`assistant/chunk` events (`tool/call` · `tool/result` · `user/message` …) go through `persistEvent` **per-event synchronous persistence** — `BEGIN IMMEDIATE` + insert + `COMMIT` all happen synchronously on the calling thread. Local benchmark (5000 `tool/call` appends): per append **P50≈1.2ms · P99≈2.0ms · max≈9.2ms**; **300 back-to-back appends without yielding freeze the event loop ≈ 384ms**. `assistant/chunk` is the exception: it only joins the batch, never flushes per event (5000 appends P50≈0.003ms), and lands in one `flush()` (5000 rows ≈ 24ms). So the hot-path contract: tool/message events are safe at a few per tens of ms; hundreds of synchronous appends inside one event-loop turn freeze it by the same magnitude — that is by-design drain-boundary behavior, not a leak.

**Directory-level write lock (multi-instance misuse guard)**: `createPersistentSessionStore(dir)` by default takes an **exclusive write lease** on `dir` (`sessions.write.lock` PID lockfile, see `store-lock.ts`): a second exclusive open in this process, or a live Host/CLI holder elsewhere, throws `SessionsDirInUseError` (`code = "sessions-dir-in-use"`) — **fail-closed instead of silently sharing `sessions.db`**. A crashed holder's stale file is taken over only after the PID check fails (an empty/unreadable lock is treated as contended for the first 4 attempts — never taken over on first sight, to avoid dual writers during the create window). **Correct usage**: writers (Host/CLI) **must omit `shared`**; `{ shared: true }` is only for **multi-process read-only sidecars** (e.g. tests asserting on the DB while a Host holds the lease) — it skips the lease, opens `node:sqlite` read-only, and every write API throws `"read-only when opened with { shared: true }"`. Do not attempt to write sessions in `shared` mode.

Index: [docs/README.md](./README.md).
