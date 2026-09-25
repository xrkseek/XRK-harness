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
| `cancel(sessionId[, opts])` | 中止 signal、清 cancel 前 wake、有界等待清理；**超时后 entry 保留**，`isActive()` 仍如实反映状态 |

**取消语义**（core-session `latch.ts`）：

- **cancel 期间的 wake 不丢**：teardown 尚在 flight 时到达的消息，会在 drain settle 后用**全新 entry 续跑**（`force=false`），不会滞留在队列里。
- `cancel(opts?)` 支持 `cause`（作为 drain `AbortSignal.reason`）、`timeoutMs`（有界 join；超时只让 RPC 先返回，不丢队列）、`onAbort`（abort 已发出回调）。
- **级联**：`session.cancel` 先乐观发布 `running:false`（即使工具卡死，UI 也不会停留在运行态），abort agent turn，再把 delegated 子代理逐个 fire-and-forget 取消，最后有界 join drain。

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
| `cancel(sessionId[, opts])` | aborts the signal, clears pre-cancel wake, bounded-join; **entry stays installed past the budget** so `isActive()` reports accurately |

**Cancellation semantics** (core-session `latch.ts`):

- **A `wake` during cancel is not swallowed**: a message arriving while teardown is still in flight re-drains **on a fresh entry** (`force=false`) once the drain settles — never stranded in the queue.
- `cancel(opts?)` accepts `cause` (surfaced as the drain `AbortSignal.reason`), `timeoutMs` (bounded join; a timeout only lets the RPC return early, it does not drop the queue), and `onAbort` (fired once the abort signal is raised).
- **Cascade**: `session.cancel` first publishes an optimistic `running:false` (even a stuck tool cannot hold the UI in the running state), aborts the agent turn, fire-and-forget cancels each delegated child, then does a bounded drain join.

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
