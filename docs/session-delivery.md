# Session 投递（steer · queue）

> **读者**：集成者 · 贡献者

产品规格：用户输入如何进入 inbox，以及何时被 promote 进 turn。  
真源仍为 `prompt/admitted` / `prompt/promoted` 事件（无独立 inbox 表）。

## 1. 两档意图

| 档 | 用户意图 | 相对正在跑的 drain |
|----|----------|-------------------|
| **queue** | 「下一题，等这轮做完再答」 | 不插话；continuation 未结束时 **不 promote** |
| **steer** | 「插话纠正 / 改方向」 | 可在 **安全的 turn 边界** promote |

与「单通道 continue」不同：两档是一等公民产品语义，不是 UI 文案差异。

## 2. 与现有 API 的关系

| 已有能力 | Delivery 角色 |
|----------|---------------|
| `admit(message)` | 记账进 inbox（模型不可见） |
| `continueTurn()` / drain `wake`·`resume` | 执行面：`promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | 单条：FIFO，steer 优先 |
| `promoteAdmitsForTurn` | **turn 入口**：全部 pending steer 合并，否则一条 queue |

未传 `delivery` 时默认 **queue**。

## 3. Promote 规则（规格）

### queue（已锁测）

1. Pending 按 `prompt/admitted` 出现序 FIFO。  
2. 一轮 drain 内：若本 turn 还需 continuation，**先不** promote 下一条 queue。  
3. Drain 本将 idle 时：一次只 promote **一条** queue，再决定是否再开 turn。  
4. `wake` 只保证「有 pending 时会来 drain」；不改变 FIFO。

### steer（已落地）

1. Promote 在两类 **安全边界**：  
   - **turn 入口**（`continueTurn` / drain）：`promoteAdmitsForTurn`  
   - **tool-step 边界**（`runTurn` 第 2+ 步开始前）：`promotePendingSteers`（只 claim steer，不碰 queue）  
2. **`promoteAdmitsForTurn`**：若有任意 pending steer，**一次 promote 全部 steer**（FIFO among steers），正文用 `\n\n` 合并进 **一条** `user/message` → **一次** `runTurn`。中间夹杂的 queue **仍留 pending**。  
3. Step 边界 claim 把合并正文追加到 **当前 turn** 的 `user/message`，下一轮模型请求即可看见。  
4. Abort / soft interrupt 语义另见 latch；steer ≠ `cancel`。

`promoteNextAdmit` 仍是「只 promote 一条」（优先最老 steer）——底层/测试用；产品热路径用 `promoteAdmitsForTurn` / `promotePendingSteers`。

## 4. 明确不做（本阶段）

- SQLite / 集群 durable inbox  
- 立即 abort 正在执行的 tool body 来塞用户字（须等当前 tool settle 完才到 next-step）  
- 把 steer 写成第二条 HTTP 路径却语义与 admit 相同  
- 产品「不 wake 的 next-step inject」与显式 `cancel keepInbox` 旗标 — Host 尚未暴露；XRK `session.cancel` 本身已保留 pending admits  

产品「插话」= Face/HTTP `delivery: "steer"`（turn / next-step 边界优先于 queue）。「排队」= `delivery: "queue"`（默认）。任务「暂停」今日走 `session.cancel` / 子代理 `interrupt_agent`，不是 inbox soft-pause。

## 5. 落地顺序

1. ~~产品文档（本页）~~  
2. ~~Protocol：`PromptAdmittedEvent.delivery?`~~  
3. ~~`promoteNextAdmit` 优先最老 steer~~  
4. ~~HTTP：`admit` body 透传 `delivery`~~  
5. ~~Drain：continuation 不 promote + idle 前一次一条 queue~~  
6. ~~同批 steer 合并 + 单次 step 配额（`promoteAdmitsForTurn`）~~  
7. ~~tool-step 边界 claim（`promotePendingSteers`）~~  

## 6. 相关文档

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP 形状  
- ADR-0003 — session 长寿 · loop 短寿  

---

# Session Delivery (steer · queue)

> **Audience**: Integrators · Contributors

Product spec: how user input enters the inbox and when it is promoted into a turn.  
Source of truth remains `prompt/admitted` / `prompt/promoted` events (no separate inbox table).

## 1. Two delivery intents

| Mode | User intent | Vs running drain |
|----|----------|-------------------|
| **queue** | “Next question — answer after this turn finishes” | No interrupt; **do not promote** while continuation is still needed |
| **steer** | “Interrupt to correct / redirect” | May promote at a **safe turn boundary** |

These are first-class product semantics, not a UI copy difference from a single continue channel.

## 2. Relation to existing APIs

| Capability | Delivery role |
|----------|---------------|
| `admit(message)` | Bookkeeping into inbox (not model-visible) |
| `continueTurn()` / drain `wake`·`resume` | Execution: `promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | Single item: FIFO, steers first |
| `promoteAdmitsForTurn` | **Turn entry**: merge all pending steers, else one queue item |

Default `delivery` is **queue**.

## 3. Promote rules

### queue (locked by tests)

1. Pending is FIFO by `prompt/admitted` order.  
2. Within a drain: if this turn still needs continuation, **do not** promote the next queue item yet.  
3. When drain would go idle: promote **one** queue item, then decide whether to open another turn.  
4. `wake` only guarantees “drain will come when pending exists”; it does not change FIFO.

### steer (shipped)

1. Promote at two **safe boundaries**:  
   - **Turn entry** (`continueTurn` / drain): `promoteAdmitsForTurn`  
   - **Tool-step boundary** (before `runTurn` step 2+): `promotePendingSteers` (claims steers only; does not touch queue)  
2. **`promoteAdmitsForTurn`**: if any pending steer exists, **promote all steers at once** (FIFO among steers), merge bodies with `\n\n` into **one** `user/message` → **one** `runTurn`. Interleaved queue items **stay pending**.  
3. Step-boundary claim appends the merged body to the **current turn** `user/message` so the next model request sees it.  
4. Abort / soft interrupt semantics: see latch; steer ≠ `cancel`.

`promoteNextAdmit` remains “promote one” (oldest steer first) — for internals/tests; product hot path uses `promoteAdmitsForTurn` / `promotePendingSteers`.

## 4. Explicitly out of scope (this phase)

- SQLite / clustered durable inbox  
- Immediately aborting an in-flight tool body to inject user text (must wait for current tool settle before next-step)  
- A second HTTP path named steer with the same semantics as admit  
- Product “next-step inject without wake” and explicit `cancel keepInbox` flags — Host does not expose them yet; XRK `session.cancel` already keeps pending admits  

Product “interrupt” = Face/HTTP `delivery: "steer"` (turn / next-step boundary wins over queue). “Queue” = `delivery: "queue"` (default). Task “pause” today is `session.cancel` / subagent `interrupt_agent`, not inbox soft-pause.

## 5. Landing order

1. ~~Product doc (this page)~~  
2. ~~Protocol: `PromptAdmittedEvent.delivery?`~~  
3. ~~`promoteNextAdmit` prefers oldest steer~~  
4. ~~HTTP: `admit` body passes `delivery`~~  
5. ~~Drain: no promote during continuation + one queue item before idle~~  
6. ~~Same-batch steer merge + single-step quota (`promoteAdmitsForTurn`)~~  
7. ~~Tool-step boundary claim (`promotePendingSteers`)~~  

## 6. Related docs

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP shapes  
- ADR-0003 — session long-lived · loop short-lived  
