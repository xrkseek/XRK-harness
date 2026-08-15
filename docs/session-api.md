# Session API（newSession · admit · continueTurn）

对齐 ADR-0003 / OpenCode admit≠execute（见 [learn/opencode-session-runner.md](./learn/opencode-session-runner.md)）。**无 Effect · 无 SQLite inbox**——pending 用事件 `prompt/admitted` / `prompt/promoted`。

插话 vs 排队两档（steer / queue）见 [session-delivery.md](./session-delivery.md)。默认 `admit` = **queue（FIFO）**；可带 `delivery: "steer"`。空 `continueTurn` 走 `promoteAdmitsForTurn`：**全部 pending steer 合并进一轮**（一份 maxSteps），否则 promote 一条 queue。`promoteNextAdmit` 仍可单条 promote（steer 优先）。HTTP `POST .../admit` 已透传 `delivery`。

## 产品语义

| API | 含义 |
|-----|------|
| **newSession** | 新日志（或复用已有 id） |
| **admit** | 只记账；**不**进 `deriveMessages`（现行 = queue） |
| **continueTurn(text)** | 同 session 跑一轮（`runTurn` 写 `user/message`） |
| **continueTurn()** | `promoteAdmitsForTurn`（steer 批合并或一条 queue）→ 再跑 |
| **run(text)** | 兼容别名；必须带 text |

`createAgent` 已暴露 `continueTurn` / `admit` / `pendingAdmits`。

## 事件

```text
prompt/admitted  →  pending（模型不可见）
prompt/promoted  →  已消费 admit（仍不是 chat message）
user/message     →  由 runTurn 写入（模型可见）
```

## HTTP

| Method | Path | 行为 |
|--------|------|------|
| `POST` | `/api/sessions` | newSession → `201 { sessionId }` |
| `POST` | `/api/sessions/:id/admit` | body `{ message, resume?, wake? }` — 默认 **202** admit-only；`wake` → 202+scheduled；`resume` → drain join **200** |
| `POST` | `/api/sessions/:id/turn` | continueTurn；`message` 可省略（promote） |
| `POST` | `/api/chat` | ensureSession + continueTurn(message)（便利入口） |

忙（TurnLatch 直调）→ `409`；drain `resume` 则 **join** 等待。无 pending 却空 turn → `400 no pending admit`。

## 包

- `@xrkseek/core-session`：`newSession` / `admitPrompt` / `promoteNextAdmit` / …
- `@xrkseek/core-agent`：`AgentHandle.continueTurn`
- `@xrkseek/harness` 再导出
