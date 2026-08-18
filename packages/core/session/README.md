# @xrkseek/core-session

Append-only session log, `deriveMessages()`, model-visible invariant, and execution latches.

## Invariant

**Model-visible ≡ Logged** — anything sent to the model must be reconstructible from session events.

## Latches

- `createTurnLatch` — exclusive turn; busy → `SessionBusyError`（wired into `createAgent`）
- `createSessionDrainLatch` / `createSessionDrainHub` — `run` / `wake` / `cancel`（host admit wake/resume）

See [docs/session-latch.md](../../../docs/session-latch.md), [docs/session-api.md](../../../docs/session-api.md), [docs/session-delivery.md](../../../docs/session-delivery.md), [docs/session-safety.md](../../../docs/session-safety.md), [docs/session-compaction.md](../../../docs/session-compaction.md), [docs/protocol-events.md](../../../docs/protocol-events.md), and [docs/tool-settlement.md](../../../docs/tool-settlement.md).

## Store

`createMemorySessionStore` — `append` runs `assertSessionEvent` then deep-freeze. `has(id)` 不抛。  
`createJsonlSessionStore(dir)` — 每会话一个 `{id}.jsonl`；Host 经 `XRK_SESSIONS_DIR` 选用。hydrate 丢掉末行不完整 JSON 并回写该文件；中段损坏的文件跳过（不挡其它会话）。不是 FTS。
