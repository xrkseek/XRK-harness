# @xrkseek/core-session

Append-only session log, `deriveMessages()`, model-visible invariant, and execution latches.

## Invariant

**Model-visible ≡ Logged** — anything sent to the model must be reconstructible from session events.

## Latches

- `createTurnLatch` — exclusive turn; busy → `SessionBusyError`（wired into `createAgent`）
- `createSessionDrainLatch` / `createSessionDrainHub` — `run` / `wake` / `cancel`（host admit wake/resume）

See [docs/session-latch.md](../../../docs/session-latch.md), [docs/session-api.md](../../../docs/session-api.md), [docs/session-delivery.md](../../../docs/session-delivery.md), [docs/session-safety.md](../../../docs/session-safety.md), [docs/session-compaction.md](../../../docs/session-compaction.md), [docs/protocol-events.md](../../../docs/protocol-events.md), and [docs/tool-settlement.md](../../../docs/tool-settlement.md).

## Store

`createMemorySessionStore` — `append` runs `assertSessionEvent` then deep-freeze.
