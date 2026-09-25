# Session 投递（steer · queue）

> **读者**：集成者 · 贡献者

产品规格：用户输入如何进入 inbox，以及何时被 promote 进 turn。  
真源为 `prompt/admitted` / `prompt/promoted` 事件（无独立 inbox 表）。

## 1. 两档意图

| 档 | 用户意图 | 相对正在跑的 drain |
|----|----------|-------------------|
| **queue** | 「下一题，等这轮做完再答」 | 不插话；continuation 未结束时 **不 promote** |
| **steer** | 「插队纠正 / 改方向」（壳文案「插队」） | 可在 **安全的 turn 边界** promote |

两档是一等公民产品语义，不是 UI 文案差异，也不是单通道 continue 的别名。

## 2. 与现有 API 的关系

| 已有能力 | Delivery 角色 |
|----------|---------------|
| `admit(message)` | 记账进 inbox（模型不可见） |
| `continueTurn()` / drain `wake`·`resume` | 执行面：`promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | 单条：FIFO，steer 优先 |
| `promoteAdmitsForTurn` | **turn 入口**：全部 pending steer 合并，否则一条 queue |

未传 `delivery` 时默认 **queue**。

## 3. Promote 规则（规格）

### queue

1. Pending 按 `prompt/admitted` 出现序 FIFO。  
2. 一轮 drain 内：若本 turn 还需 continuation，**先不** promote 下一条 queue。  
3. Drain 本将 idle 时：一次只 promote **一条** queue，再决定是否再开 turn。  
4. `wake` 只保证「有 pending 时会来 drain」；不改变 FIFO。

### steer

1. Promote 在两类 **安全边界**：  
   - **turn 入口**（`continueTurn` / drain）：`promoteAdmitsForTurn`  
   - **tool-step 边界**（`runTurn` 第 2+ 步开始前）：`promotePendingSteers`（只 claim steer，不碰 queue）  
2. **`promoteAdmitsForTurn`**：若有任意 pending steer，**一次 promote 全部 steer**（FIFO among steers），正文用 `\n\n` 合并进 **一条** `user/message` → **一次** `runTurn`。中间夹杂的 queue **仍留 pending**。  
3. Step 边界 claim 把合并正文追加到 **当前 turn** 的 `user/message`，下一轮模型请求即可看见。  
4. Abort / soft interrupt 语义见 [session-latch.md](./session-latch.md)；steer ≠ `cancel`。

`promoteNextAdmit` 仍是「只 promote 一条」（优先最老 steer）——底层/测试用；产品热路径用 `promoteAdmitsForTurn` / `promotePendingSteers`。

## 4. 边界（现行为）

- **inbox 真源是 session log**：不建独立 inbox 表，也无集群多写 durable inbox。
- **不打断在跑的 tool**：用户新输入须等当前 tool settle 完才到 next-step，不 abort 正在执行的 tool body 来插入文本。
- **steer 不是第二条 HTTP 路径**：Face/HTTP 字段名仍是 `steer`/`queue`，走同一 admit 通道。
- **`session.cancel` 与 inbox 关系**：`session.cancel` 保留 pending admits；cancel 期间到达的消息（wake）在 teardown settle 后用全新 entry 续跑（见 [session-latch.md](./session-latch.md)），不会滞留在队列里。
- **无「不 wake 的 next-step inject」旗标**；Host 不暴露 `cancel keepInbox`。

**Host 重启恢复**：pending queue/steer 随 `createPersistentSessionStore` 落盘；mux 重连补发 `session/queue`；Face 启动对有 pending 的 session `publishQueue` + `drain.wake`（刚被 `goals.bind` disarm 的 active goal 不 wake，须用户 resume）。冷 session 的 `session.updateQueue` 不依赖进程内 Agent。

**产品壳文案**：**排队** = `delivery: "queue"`（默认，本轮后再答）；**插队** = `delivery: "steer"`（工具/步边界切入当前轮，≠ 停止）。任务「暂停」走 `session.cancel` / 子代理 `interrupt_agent`（`takeover: true` 时任务板标 paused + 人工接管，`send_message` 恢复），不是 inbox soft-pause。

## 5. 相关文档

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP 形状  
- ADR-0003 — session 长寿 · loop 短寿  

---

# Session Delivery (steer · queue)

> **Audience**: Integrators · Contributors

Product spec: how user input enters the inbox and when it is promoted into a turn.  
Source of truth is the `prompt/admitted` / `prompt/promoted` events (no separate inbox table).

## 1. Two delivery intents

| Mode | User intent | Vs running drain |
|----|----------|-------------------|
| **queue** | “Next question — answer after this turn finishes” | No interrupt; **do not promote** while continuation is still needed |
| **steer** | “Steer / redirect” (shell copy: Steer into this turn) | May promote at a **safe turn boundary** |

These are first-class product semantics, not a UI copy difference or an alias of a single continue channel.

## 2. Relation to existing APIs

| Capability | Delivery role |
|----------|---------------|
| `admit(message)` | Bookkeeping into inbox (not model-visible) |
| `continueTurn()` / drain `wake`·`resume` | Execution: `promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | Single item: FIFO, steers first |
| `promoteAdmitsForTurn` | **Turn entry**: merge all pending steers, else one queue item |

Default `delivery` is **queue**.

## 3. Promote rules

### queue

1. Pending is FIFO by `prompt/admitted` order.  
2. Within a drain: if this turn still needs continuation, **do not** promote the next queue item yet.  
3. When drain would go idle: promote **one** queue item, then decide whether to open another turn.  
4. `wake` only guarantees “drain will come when pending exists”; it does not change FIFO.

### steer

1. Promote at two **safe boundaries**:  
   - **Turn entry** (`continueTurn` / drain): `promoteAdmitsForTurn`  
   - **Tool-step boundary** (before `runTurn` step 2+): `promotePendingSteers` (claims steers only; does not touch queue)  
2. **`promoteAdmitsForTurn`**: if any pending steer exists, **promote all steers at once** (FIFO among steers), merge bodies with `\n\n` into **one** `user/message` → **one** `runTurn`. Interleaved queue items **stay pending**.  
3. Step-boundary claim appends the merged body to the **current turn** `user/message` so the next model request sees it.  
4. Abort / soft-interrupt semantics: see [session-latch.md](./session-latch.md); steer ≠ `cancel`.

`promoteNextAdmit` remains “promote one” (oldest steer first) — for internals/tests; the product hot path uses `promoteAdmitsForTurn` / `promotePendingSteers`.

## 4. Boundaries (current behavior)

- **Inbox source of truth is the session log**: no separate inbox table, no clustered multi-writer durable inbox.
- **In-flight tools are not interrupted**: new user input must wait for the current tool to settle before next-step; an executing tool body is not aborted to inject text.
- **Steer is not a second HTTP path**: Face/HTTP field names remain `steer`/`queue`, through the same admit channel.
- **`session.cancel` vs inbox**: `session.cancel` keeps pending admits; a message (wake) arriving during the cancel re-drains on a fresh entry once teardown settles (see [session-latch.md](./session-latch.md)) rather than sitting in the queue.
- **No “next-step inject without wake” flag**; Host does not expose `cancel keepInbox`.

**Host restart recovery**: pending queue/steer survive via `createPersistentSessionStore`; mux reconnect replays `session/queue`; Face boot does `publishQueue` + `drain.wake` for sessions with pending work (skips active goals that `goals.bind` just disarmed — user must resume). Cold `session.updateQueue` does not require a live Agent.

**Product shell copy**: **Queue** = `delivery: "queue"` (default; after this turn); **Steer** = `delivery: "steer"` (inject at the tool/step boundary into the running turn — not Stop). Task “pause” goes through `session.cancel` / subagent `interrupt_agent` (`takeover: true` marks the task board paused + human-owned; `send_message` resumes) — not inbox soft-pause.

## 5. Related docs

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP shapes  
- ADR-0003 — session long-lived · loop short-lived
