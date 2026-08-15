# Session Delivery（steer · queue）

产品规格：用户输入如何进入 inbox，以及何时被 promote 进 turn。  
对照 OpenCode V2（见 [learn/opencode-session-runner.md](./learn/opencode-session-runner.md) §3）；**无 Effect · 无独立 inbox 表**——仍用 `prompt/admitted` / `prompt/promoted` 事件。

---

## 1. 两档意图

| 档 | 用户意图 | 相对正在跑的 drain |
|----|----------|-------------------|
| **queue** | 「下一题，等这轮做完再答」 | 不插话；continuation 未结束时 **不 promote** |
| **steer** | 「插话纠正 / 改方向」 | 可在 **安全的 turn 边界** promote；可打断「本来要 idle」的节奏 |

与 Cline 单通道 `continue` 不同：两档是一等公民产品语义，不是 UI 文案差异。

---

## 2. 与现有 API 的关系

| 已有能力 | Delivery 角色 |
|----------|---------------|
| `admit(message)` | 记账进 inbox（模型不可见） |
| `continueTurn()` / drain `wake`·`resume` | 执行面：`promoteAdmitsForTurn` + `runTurn` |
| `listPendingAdmits` / `promoteNextAdmit` | 单条：FIFO，steer 优先 |
| `promoteAdmitsForTurn` | **turn 入口**：全部 pending steer 合并，否则一条 queue |

未传 `delivery` 时默认 **queue**。

---

## 3. Promote 规则（规格）

### queue（已锁测）

1. Pending 按 `prompt/admitted` 出现序 FIFO。  
2. 一轮 drain 内：若本 turn 还需 continuation（模型还要再调工具 / 未结束），**先不** promote 下一条 queue。  
   — 由 `continueTurn` 只在入口 promote 一次 + `runTurn` 吃完本 turn 保证（见 `admit-turn` 测）。  
3. Drain 本将 idle 时：一次只 promote **一条** queue，再决定是否再开 turn。  
   — Host drain = `while pending: continueTurn()`（见 `server-host`）。  
4. `wake` 只保证「有 pending 时会来 drain」；不改变 FIFO。

### steer（已落地）

1. Promote 仅在 **provider-turn 边界**（今日 = `continueTurn` 入口）；不在 tool body 中途插入。  
2. **`promoteAdmitsForTurn`**：若有任意 pending steer，**一次 promote 全部 steer**（FIFO among steers），正文用 `\n\n` 合并进 **一条** `user/message` → **一次** `runTurn`（一份 `maxSteps` 配额）。中间夹杂的 queue **仍留 pending**。  
3. Abort / soft interrupt 语义另见 latch；steer ≠ `cancel`。

`promoteNextAdmit` 仍是「只 promote 一条」（优先最老 steer）——底层/测试用；产品热路径用 `promoteAdmitsForTurn`。

---

## 4. 明确不做（本阶段）

- SQLite / 集群 durable inbox  
- 立即 abort 正在执行的 tool body 来塞用户字（危险；与 dangling settle 冲突）  
- 把 steer 写成第二条 HTTP 路径却语义与 admit 相同（避免假双通道）  
- Continuation 中途插入 steer（仍仅 turn 入口）

---

## 5. 落地顺序

1. ~~产品文档（本页）~~  
2. ~~Protocol：`PromptAdmittedEvent.delivery?`~~  
3. ~~`promoteNextAdmit` 优先最老 steer~~  
4. ~~HTTP：`admit` body 透传 `delivery`~~  
5. ~~Drain：continuation 不 promote + idle 前一次一条 queue~~  
6. ~~同批 steer 合并 + 单次 step 配额（`promoteAdmitsForTurn`）~~  

---

## 6. 相关文档

- [session-api.md](./session-api.md) — admit / continueTurn  
- [session-latch.md](./session-latch.md) — run / wake / join  
- [http-api.md](./http-api.md) — HTTP 形状  
- ADR-0003 — session 长寿 · loop 短寿  
