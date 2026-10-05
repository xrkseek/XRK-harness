# Session 投递（steer · queue）

> **读者**：集成者 · 贡献者

产品规格：用户输入如何进入 inbox，以及何时被 promote 进 turn。  
真源为 `prompt/admitted` / `prompt/promoted` 事件（无独立 inbox 表）。

## 1. 两档意图

| 档 | 用户意图 | 相对正在跑的 drain |
|----|----------|-------------------|
| **queue** | 「下一题，等这轮做完再答」 | 不插话；continuation 未结束时 **不 promote** |
| **steer** | 「插队：等当前工具步结束再答」（壳文案「插队」） | 不打断正在跑的 tool；当前步 settle 后 `promotePendingSteers` 进同一 Host turn 的下一次模型请求 |

两档是一等公民产品语义，不是 UI 文案差异，也不是单通道 continue 的别名。

## 2. 与现有 API 的关系

| 已有能力 | Delivery 角色 |
|----------|---------------|
| `admit(message)` | 记账进 inbox（模型不可见） |
| `continueTurn()` / drain `wake`·`resume` | 执行面：`promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | 单条：FIFO，steer 优先 |
| `promotePendingSteers` | **`runTurn` 工具步边界**：只 promote pending steer |
| `promoteAdmitsForTurn` | **turn 入口**：全部 pending steer 合并，否则一条 queue |

未传 `delivery` 时默认 **queue**。

## 3. Promote 规则（规格）

### queue

1. Pending 按 `prompt/admitted` 出现序 FIFO。  
2. 一轮 drain 内：若本 turn 还需 continuation，**先不** promote 下一条 queue。  
3. Drain 本将 idle 时：一次只 promote **一条** queue，再决定是否再开 turn。  
4. `wake` 只保证「有 pending 时会来 drain」；不改变 FIFO。

### steer

1. **`runTurn` 工具步边界**：上一步 tool settle 之后、下一次 `chat()` 之前，`promotePendingSteers` 认领全部 pending steer（不碰 queue）。壳标「发送中」仅 inbox 未认领期间可撤回。  
2. **`promoteAdmitsForTurn`**（`continueTurn` / drain 入口）：若本 turn 没有工具步可插入（例如纯文本回合已结束），仍在下一 turn 入口一次 promote 全部 pending steer（FIFO among steers），正文用 `\n\n` 合并进 **一条** `user/message` → **一次** `runTurn`。中间夹杂的 queue **仍留 pending**（排队等的是整轮 轮次 / drain idle）。Face 在该行写入首条 echo 的 `rpcId` 与其余 `rpcIds`；壳队列与本地回显按这组 id 一次卸掉。已有插队未落地时，composer Enter 继续 `steer`。跨 turn 的 queue 仍 FIFO 一条对人。  
3. 认领后的 `user/message` 进入同一 Host turn 的下一次模型请求；排队不走这条路径。  
4. Abort / soft interrupt 语义见 [session-latch.md](./session-latch.md)；steer ≠ `cancel`。

`promoteNextAdmit` 仍是「只 promote 一条」（优先最老 steer）——底层/测试用；产品热路径用 `promoteAdmitsForTurn`。

## 4. 边界（现行为）

- **inbox 真源是 session log**：不建独立 inbox 表，也无集群多写 durable inbox。
- **不打断在跑的 tool**：用户新输入须等当前 tool settle 完才到 next-step，不 abort 正在执行的 tool body 来插入文本。
- **steer 不是第二条 HTTP 路径**：Face/HTTP 字段名仍是 `steer`/`queue`，走同一 admit 通道。
- **`session.cancel` 与 inbox 关系**：`session.cancel` 保留 pending admits；cancel 期间到达的消息（wake）在 teardown settle 后用全新 entry 续跑（见 [session-latch.md](./session-latch.md)），不会滞留在队列里。壳立刻按 `host/session-status running:false` 把列表、Composer Stop、`session.status.delivery.turnActive` 收成空闲；drain 最多再 join 数秒，期间 `/compact` 仍 `compactBlockedByTurn`，工具卡可等到 `tool/result` 才落定。
- **无「不 wake 的 next-step inject」旗标**；Host 不暴露 `cancel keepInbox`。

**Host 重启恢复**：pending queue/steer 随 `createPersistentSessionStore` 落盘；mux 重连补发 `session/queue`；Face 启动对有 pending 的 session `publishQueue` + `drain.wake`（刚被 `goals.bind` disarm 的 active goal 不 wake，须用户 resume）。冷 session 的 `session.updateQueue` 不依赖进程内 Agent。

**产品壳文案**：**排队** = `delivery: "queue"`（等本轮 轮次 / drain idle）；**插队** = `delivery: "steer"`（等当前工具步结束再作为同一回合的下一次模型请求，≠ 停止）。任务「暂停」走 `session.cancel` / 子代理 `interrupt_agent`（`takeover: true` 时任务板标 paused + 人工接管，`send_message` 恢复），不是 inbox soft-pause。

**壳气泡**：inbox 里尚未 promote 的 steer 标「发送中」，可撤回。认领进日志后是普通发送。排队行在 QueueDock，同样是未请求 LLM 的中间态。inbox claim 同时按 Host `admitId` 与 promote 后 `user/message` 上的 prompt `rpcId` / `rpcIds` 索引。

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
| **steer** | “Steer: answer after the current tool step settles” (shell: 插队) | Do not abort an in-flight tool; after that step settles, `promotePendingSteers` enters the same Host turn’s next model request |

These are first-class product semantics, not a UI copy difference or an alias of a single continue channel.

## 2. Relation to existing APIs

| Capability | Delivery role |
|----------|---------------|
| `admit(message)` | Bookkeeping into inbox (not model-visible) |
| `continueTurn()` / drain `wake`·`resume` | Execution: `promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | Single item: FIFO, steers first |
| `promotePendingSteers` | **`runTurn` tool-step boundary**: pending steers only |
| `promoteAdmitsForTurn` | **Turn entry**: merge all pending steers, else one queue item |

Default `delivery` is **queue**.

## 3. Promote rules

### queue

1. Pending is FIFO by `prompt/admitted` order.  
2. Within a drain: if this turn still needs continuation, **do not** promote the next queue item yet.  
3. When drain would go idle: promote **one** queue item, then decide whether to open another turn.  
4. `wake` only guarantees “drain will come when pending exists”; it does not change FIFO.

### steer

1. **`runTurn` tool-step boundary**: after the previous tool step settles and before the next `chat()`, `promotePendingSteers` claims every pending steer (queues stay). The shell “Sending…” badge is withdrawable only while the admit is still in the inbox.  
2. **`promoteAdmitsForTurn`** (`continueTurn` / drain entry): if this turn had no later tool step (a text-only turn already ended), still promote all pending steers at the next turn entry (FIFO among steers), merge bodies with `\n\n` into **one** `user/message` → **one** `runTurn`. Interleaved queue items **stay pending** (queue waits for the user 轮次 / drain idle). Face stamps the first echo as `rpcId` and the rest as `rpcIds`. While a steer is already pending, composer Enter stays `steer`.  
3. After claim, the `user/message` is the same Host turn’s next model request; queue does not take this path.  
4. Abort / soft-interrupt semantics: see [session-latch.md](./session-latch.md); steer ≠ `cancel`.

`promoteNextAdmit` remains “promote one” (oldest steer first) — for internals/tests; the product hot path uses `promoteAdmitsForTurn`.

## 4. Boundaries (current behavior)

- **Inbox source of truth is the session log**: no separate inbox table, no clustered multi-writer durable inbox.
- **In-flight tools are not interrupted**: new user input must wait for the current tool to settle before next-step; an executing tool body is not aborted to inject text.
- **Steer is not a second HTTP path**: Face/HTTP field names remain `steer`/`queue`, through the same admit channel.
- **`session.cancel` vs inbox**: `session.cancel` keeps pending admits; a message (wake) arriving during the cancel re-drains on a fresh entry once teardown settles (see [session-latch.md](./session-latch.md)) rather than sitting in the queue. The shell goes idle immediately on `host/session-status running:false` (session list, composer Stop, `session.status.delivery.turnActive`). Drain may still join for a few seconds: `/compact` stays `compactBlockedByTurn`, and tool cards can wait for `tool/result`.
- **No “next-step inject without wake” flag**; Host does not expose `cancel keepInbox`.

**Host restart recovery**: pending queue/steer survive via `createPersistentSessionStore`; mux reconnect replays `session/queue`; Face boot does `publishQueue` + `drain.wake` for sessions with pending work (skips active goals that `goals.bind` just disarmed — user must resume). Cold `session.updateQueue` does not require a live Agent.

**Product shell copy**: **Queue** = `delivery: "queue"` (after this user 轮次 / drain idle); **Steer** = `delivery: "steer"` (after the current tool step, as the same turn’s next model request — not Stop). Task “pause” goes through `session.cancel` / subagent `interrupt_agent` (`takeover: true` marks the task board paused + human-owned; `send_message` resumes) — not inbox soft-pause.

**Shell bubbles**: a steer still waiting in the inbox shows “Sending…” and can be withdrawn. After claim into the log it is an ordinary send. Queued rows stay in QueueDock, also pre-LLM. Inbox claims index both the Host `admitId` and the prompt `rpcId` / `rpcIds` stamped on the promoted `user/message`.

## 5. Related docs

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP shapes  
- ADR-0003 — session long-lived · loop short-lived
