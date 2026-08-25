# Session 门闩

> **读者**：贡献者 · 维护者

Promise 门闩（无代数效应运行时）。决策见 [ADR-0003](./adr/0003-session-long-loop-short.md)、[ADR-0004](./adr/0004-no-effect-runtime.md)。

## `createTurnLatch`（已接 `createAgent`）

同一 `AgentHandle` **同时至多一个** `continueTurn`：

- 再入 → `SessionBusyError`
- `abort()` → 中止 in-flight `AbortSignal`
- HTTP 直调 turn/chat：`409` + `{ error: "session busy" }`

## `createSessionDrainLatch` + `createSessionDrainHub`

| API | 行为 |
|-----|------|
| `run(sessionId)` | idle → `drain(force=true)`；busy → **join** |
| `wake(sessionId)` | idle → `drain(force=false)`；busy → **至多一个** follow-up |
| `cancel(sessionId)` | abort、清 wake、等待清理 |

**Host**（`createHostManager`）持有 hub；drain body = 循环 `continueTurn()` 直到无 pending admit。实现为纯 Promise Map。

## HTTP 产品切分

| admit 字段 | 行为 |
|------------|------|
| （默认） | 只记账 → **202** |
| `wake: true` | 记账 + `hub.wake` → **202** `{ scheduled: true }`（不阻塞） |
| `resume: true` | 记账 + `hub.run`（join）→ **200** 回合结果 |

`POST /turn` / `/chat` 仍可直调 agent（忙则 409）；inbox 路径优先走 drain。

## 包

`@xrkseek/core-session`：`createTurnLatch` · `createSessionDrainLatch` · `createSessionDrainHub`  
`@xrkseek/server-host`：接线 + `HostInstance.drain`

---

# Session Latch

> **Audience**: Contributors · Maintainers

Promise latches (no algebraic-effect runtime). Decisions: [ADR-0003](./adr/0003-session-long-loop-short.md), [ADR-0004](./adr/0004-no-effect-runtime.md).

## `createTurnLatch` (wired into `createAgent`)

One `AgentHandle` allows **at most one** concurrent `continueTurn`:

- Re-entry → `SessionBusyError`
- `abort()` → aborts the in-flight `AbortSignal`
- Direct HTTP turn/chat: `409` + `{ error: "session busy" }`

## `createSessionDrainLatch` + `createSessionDrainHub`

| API | Behavior |
|-----|----------|
| `run(sessionId)` | idle → `drain(force=true)`; busy → **join** |
| `wake(sessionId)` | idle → `drain(force=false)`; busy → **at most one** follow-up |
| `cancel(sessionId)` | abort, clear wake, wait for cleanup |

**Host** (`createHostManager`) owns the hub; drain body = loop `continueTurn()` until no pending admit. Implementation is a pure Promise Map.

## HTTP product split

| admit field | Behavior |
|------------|----------|
| (default) | Bookkeeping only → **202** |
| `wake: true` | Bookkeeping + `hub.wake` → **202** `{ scheduled: true }` (non-blocking) |
| `resume: true` | Bookkeeping + `hub.run` (join) → **200** turn result |

`POST /turn` / `/chat` may still call the agent directly (409 when busy); inbox paths prefer drain.

## Packages

`@xrkseek/core-session`: `createTurnLatch` · `createSessionDrainLatch` · `createSessionDrainHub`  
`@xrkseek/server-host`: wiring + `HostInstance.drain`
