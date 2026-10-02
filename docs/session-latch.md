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

## 委派活动信号（唯一权威判定）

```ts
isChildSessionActive(runtime, sessionId) // @xrkseek/server-face
// = drain latch 处于 active || 外部代理（acp / app-server）忙
```

`session.status` 的 `subagents.live[].activity`、graph 节点 `activity`、Sidebar 的
`subagents.live` 与 preview `activity` **共用这一个谓词**。判定只看运行态，**不看注册关系**。

| 不变量 | 含义 |
|--------|------|
| 判定与 link 存在性无关 | activity 只来自 drain latch / 外部代理忙闲。内存 `subagents` links 与持久 `agent-team-graph.json` 的 `delegates` 边是**两个真相源**，任一方缺失时遍历取**并集**，节点仍须拿到判定 |
| 缺失判定 ≠ 完成 | 客户端把 `activity` 缺失渲染成「已完成」（`SubagentGraphBoard`：`activityDot(undefined) → done`）。服务端**每个 graph 节点都必须带 activity**，不得条件省略该字段 |
| 根节点读自己的 turn | `subagents.live` 只列子代理，根节点（本会话）永不在其中。根节点 activity = `drain.isActive(self)`，否则正在跑的会话必然显示「已完成」 |
| 整棵树后序传播 | board 可能停在一次性子会话上，此时父与兄弟同在一棵树里。节点 running ⟺ 自身 running 或**任一后代** running；自身 idle 时引**最深活跃后代**的行（父自己的尾行已过期） |
| live 仍限本会话后代 | `subagents.live` = 本会话的委派后代（且 store 中有会话）；quota 仍按**直系**子代理计 —— 孙代理不占父的并发槽 |

判定只依赖运行态这一点是关键：link 丢失（多实例覆盖 sidecar、启动时的陈旧快照）不能降级成「无信号 → 已完成」。
回归见 `packages/server/face/tests/session-status.test.ts`。

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

## Delegation activity (the single authoritative verdict)

```ts
isChildSessionActive(runtime, sessionId) // @xrkseek/server-face
// = drain latch is active || external agent (acp / app-server) is busy
```

`subagents.live[].activity` in `session.status`, graph node `activity`, and the Sidebar's
`subagents.live` / preview `activity` **all share this one predicate**. The verdict reads runtime
state only — **never registration bookkeeping**.

| Invariant | Meaning |
|-----------|---------|
| The verdict is independent of link presence | activity comes only from the drain latch / external-agent busyness. In-memory `subagents` links and the durable `agent-team-graph.json` `delegates` edges are **two sources of truth**; when either is missing the walk takes their **union**, so a node still receives a verdict |
| A missing verdict is not "done" | Clients render a missing `activity` as completed (`SubagentGraphBoard`: `activityDot(undefined) → done`). The server **must attach activity to every graph node** — the field may never be conditionally omitted |
| The root node reads its own turn | `subagents.live` lists subagents only, so the root (this session) is never in it. The root's activity is `drain.isActive(self)`, otherwise a session mid-turn always reads as completed |
| Whole-tree, post-order propagation | The board is also opened on a one-shot child, where the parent and siblings sit in the same tree. A node is running ⟺ it is running itself **or any descendant** is; when idle it quotes the **deepest live descendant** (its own last line is stale) |
| `live` still means this session's descendants | `subagents.live` = this session's delegated descendants (that exist in the store); quota stays scoped to **direct** children — grandchildren never consume the parent's concurrency slots |

That the verdict depends on runtime state alone is the load-bearing part: a lost link (a sidecar overwritten by another instance, a stale snapshot at startup) must never degrade into "no signal → done".
Regression: `packages/server/face/tests/session-status.test.ts`.

## Packages

`@xrkseek/core-session`: `createTurnLatch` · `createSessionDrainLatch` · `createSessionDrainHub`  
`@xrkseek/server-host`: wiring + `HostInstance.drain`
