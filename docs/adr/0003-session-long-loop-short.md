# ADR-0003: Session 长寿 · Loop 短寿

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** session, agent-loop, cline, opencode
- **Depends on learn notes:** [cline-agent-runtime](../learn/cline-agent-runtime.md) (lc1), [cline-session-runtime](../learn/cline-session-runtime.md) (lc2)
- **TODO:** `lc7`

## Context

Cline 把能力拆成两层：

1. **SessionRuntime**（`@cline/core`）：跨 turn 持有 transcript、扩展、mistake/loop tracker、abort 门闩。
2. **AgentRuntime**（`@cline/agents`）：**每次 run 新建**，只负责 model↔tool 迭代；结束后把 `messages` 写回 session。

本仓已有：

- `SessionStore`：append-only 事件日志（红线：模型可见输入必须可重建）
- `runTurn` / `AgentHandle`：执行一轮 user→…→assistant

HTTP host 目前 **按 sessionId 缓存 AgentHandle**，容易让人以为「Agent = 会话真源」。需要在选型上钉死，避免 drift。

OpenCode 侧有 Effect `Runner`（`ensureRunning` / Idle·Busy）：那是 **并发门闩**，不是第三种「会话真源」模型；且本仓 **不引入 Effect**（lc10）。对照时只吸收「同一 session 同时只能跑一个 turn」的门闩语义。

## Options

### A — Session 长寿 + Loop/Runtime 短寿（Cline 分层）

- Session：事件日志、工具注册表、pipeline、policy 挂钩点、**安全 tracker（已落地：`createSessionSafety`）**、订阅者。
- 每次 `continueTurn`：新建或重置 **run 级** 状态机（iteration、pending tools、abort controller、usage），调用 `runTurn`；**不**把可变 `messages[]` 当真源。
- `newSession` 显式建新日志；禁止静默 `resetForRun` 清历史。

### B — Drain / Effect Runner 作为会话内核（OpenCode Effect 路径）

- 用 Effect Runtime/Runner 编排 turn 队列与中断。
- 与「不引入 Effect / Hub」冲突；学习成本高，收益主要在 Effect 生态而非 harness 语义。

### C — 长寿 Agent 独占一切（把 SessionStore 当附属）

- `AgentHandle` 长期持有 messages 投影与 run 状态。
- 易回到 Cline ConversationStore 的 `replaceMessages` 思维，威胁 append-only 与多端订阅（HTTP SSE / 未来 WS）一致性。

## Decision

**采用 A。拒绝 B 与 C。**

具体约束：

1. **真源**：仅 `SessionStore` 事件日志（及派生物）。禁止 runtime 可变 messages 覆盖日志。
2. **寿命**：Session（及挂在其上的 tools/pipeline/llm 绑定）长寿；**单次 turn 的 run 状态**（step 计数、abort、pending tool ids）短寿，随 `runTurn` 开始/结束。
3. **API 命名（产品语义）**：
   - `newSession` → 新日志（对标 Cline `run()` 清历史，但必须显式）
   - `continueTurn(text)` → 在同一 session 上再跑 `runTurn`（对标 Cline `continue()`）
   - 不提供隐式「run 即清空」。
4. **并发门闩**：同一 session **同时至多一个** in-flight turn（吸收 OpenCode Runner / Cline `running` 标志的语义，**不**引入 Effect）。
5. **AgentHandle**：可作为「绑定了 sessionId + tools + pipeline 的薄柄」缓存；**不得**成为第二真源。缓存的是组合，不是对话数组。
6. **安全 tracker**（mistake/loop）：挂在 session 壳，消费事件或 turn 汇总，可请求 abort；不写进 `runTurn` 内核分支。详见 [learn/cline-mistake-loop-safety.md](../learn/cline-mistake-loop-safety.md)（lc3）。

## Consequences

### Positive

- 与 AGENTS.md「模型可见输入可从 session 重建」一致。
- 对齐 Cline 已验证的分层，同时避开其 ConversationStore 替换模型。
- HTTP/WS 订阅者只跟事件走，不跟 Agent 内存走。

### Negative / follow-ups

- 需在 host/SDK 暴露清晰的 `newSession` / `continueTurn` — **已落地**（[session-api.md](../session-api.md)）；HTTP `/api/chat` 为 continueTurn 便利入口。
- AgentHandle 缓存策略要在 server/host 注释里写明「可缓存绑定，不可当 transcript」— host 已注释。
- mistake/loop（lc3）— **已落地**（[session-safety.md](../session-safety.md)）；挂 session 旁路，不塞 loop 内核。
- MCP 统一门禁仍为契约目标，包为空壳（[status.md](../status.md)）。

## References

- Cline `SessionRuntime` / `AgentRuntime`（见 learn 笔记）
- OpenCode `effect/runner` / V2 `SessionRunCoordinator`：仅作 busy-gate / wake coalesce 对照，不采纳 Effect（详见 [learn/opencode-session-runner.md](../learn/opencode-session-runner.md) lc4）
- 本仓：`packages/core/session`, `packages/core/agent-loop`, `packages/server/host`
