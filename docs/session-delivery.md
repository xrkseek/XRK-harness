# Session 投递（steer · queue） / Session Delivery

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

产品规格：用户输入如何进入 inbox，以及何时被 promote 进 turn。  
真源仍为 `prompt/admitted` / `prompt/promoted` 事件（无独立 inbox 表）。

Product spec: how user input enters the inbox and when it is promoted into a turn.  
Source of truth remains `prompt/admitted` / `prompt/promoted` events (no separate inbox table).

---

## 1. 两档意图 / Two delivery intents

| 档 / Mode | 用户意图 / User intent | 相对正在跑的 drain / Vs running drain |
|----|----------|-------------------|
| **queue** | 「下一题，等这轮做完再答」 / Wait until this turn finishes | 不插话；continuation 未结束时 **不 promote** |
| **steer** | 「插话纠正 / 改方向」 / Interrupt to correct or redirect | 可在 **安全的 turn 边界** promote |

与「单通道 continue」不同：两档是一等公民产品语义，不是 UI 文案差异。

These are first-class product semantics, not a UI copy difference from a single continue channel.

---

## 2. 与现有 API 的关系 / Relation to existing APIs

| 已有能力 / Capability | Delivery 角色 / Role |
|----------|---------------|
| `admit(message)` | 记账进 inbox（模型不可见） |
| `continueTurn()` / drain `wake`·`resume` | 执行面：`promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | 单条：FIFO，steer 优先 |
| `promoteAdmitsForTurn` | **turn 入口**：全部 pending steer 合并，否则一条 queue |

未传 `delivery` 时默认 **queue**。 / Default `delivery` is **queue**.

---

## 3. Promote 规则（规格） / Promote rules

### queue（已锁测） / queue (locked by tests)

1. Pending 按 `prompt/admitted` 出现序 FIFO。  
2. 一轮 drain 内：若本 turn 还需 continuation，**先不** promote 下一条 queue。  
3. Drain 本将 idle 时：一次只 promote **一条** queue，再决定是否再开 turn。  
4. `wake` 只保证「有 pending 时会来 drain」；不改变 FIFO。

### steer（已落地） / steer (shipped)

1. Promote 仅在 **provider-turn 边界**（今日 = `continueTurn` 入口）。  
2. **`promoteAdmitsForTurn`**：若有任意 pending steer，**一次 promote 全部 steer**（FIFO among steers），正文用 `\n\n` 合并进 **一条** `user/message` → **一次** `runTurn`。中间夹杂的 queue **仍留 pending**。  
3. Abort / soft interrupt 语义另见 latch；steer ≠ `cancel`。

`promoteNextAdmit` 仍是「只 promote 一条」（优先最老 steer）——底层/测试用；产品热路径用 `promoteAdmitsForTurn`。

---

## 4. 明确不做（本阶段） / Explicitly out of scope (this phase)

- SQLite / 集群 durable inbox  
- 立即 abort 正在执行的 tool body 来塞用户字  
- 把 steer 写成第二条 HTTP 路径却语义与 admit 相同  
- Continuation 中途插入 steer（仍仅 turn 入口）

---

## 5. 落地顺序 / Landing order

1. ~~产品文档（本页）~~  
2. ~~Protocol：`PromptAdmittedEvent.delivery?`~~  
3. ~~`promoteNextAdmit` 优先最老 steer~~  
4. ~~HTTP：`admit` body 透传 `delivery`~~  
5. ~~Drain：continuation 不 promote + idle 前一次一条 queue~~  
6. ~~同批 steer 合并 + 单次 step 配额（`promoteAdmitsForTurn`）~~  

---

## 6. 相关文档 / Related docs

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP 形状  
- ADR-0003 — session 长寿 · loop 短寿  
