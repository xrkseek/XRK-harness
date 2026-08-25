# ADR-0003: Session 长寿 · Loop 短寿

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** session, agent-loop

## 背景

本仓已有 `SessionStore`（append-only 事件）与 `runTurn` / `AgentHandle`。若把 `AgentHandle` 当成会话真源（长期缓存可变 messages），会与「模型输入必须可从事件重建」、多端订阅（HTTP SSE / WS）冲突。

## 决策

**Session 长寿 · 单次 turn / loop 状态短寿。**

1. **真源**：仅 `SessionStore` 事件日志（及派生物）。禁止 runtime 可变 messages 覆盖日志。  
2. **寿命**：Session（及 tools/pipeline/llm 绑定）长寿；step 计数、abort、pending tool ids 随 `runTurn` 起止。  
3. **缓存**：Host 可按 sessionId 缓存 `AgentHandle` 作为**组合绑定**，不得当作 transcript 真源；preset 变更须 invalidate（见 compose agent-cache）。  
4. **并发**：同一 session 同时至多一个 turn（TurnLatch / DrainHub），不用第三套「会话内核」。  
5. **安全 tracker**：挂在 session 旁路，不写进 `runTurn` 内核分支。  

拒绝：以代数效应 Runner 作为会话内核；拒绝长寿 Agent 独占 messages。

## 后果

- `continueTurn` / drain 语义清晰  
- Face / HTTP 多端读同一事件流  
- 与 [ADR-0004](./0004-no-effect-runtime.md) 一致  

## 相关

[session-api.md](../session-api.md) · [session-safety.md](../session-safety.md) · [session-delivery.md](../session-delivery.md)

---

# ADR-0003: Session long-lived · loop short-lived

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** session, agent-loop

## Context

This repo already has `SessionStore` (append-only events) and `runTurn` / `AgentHandle`. Treating `AgentHandle` as the session source of truth (long-lived mutable messages) conflicts with “model input must rebuild from events” and multi-client subscribers (HTTP SSE / WS).

## Decision

**Session is long-lived; per-turn / loop state is short-lived.**

1. **Source of truth**: only the `SessionStore` event log (and derivatives). Runtime mutable messages must not override the log.  
2. **Lifetime**: Session (and tools/pipeline/llm bindings) persist; step counts, abort, and pending tool ids live with `runTurn`.  
3. **Cache**: Host may cache `AgentHandle` by sessionId as a **composition binding**, never as transcript truth; preset changes must invalidate (see compose agent-cache).  
4. **Concurrency**: at most one turn per session (TurnLatch / DrainHub); no third “session kernel”.  
5. **Safety tracker**: hangs beside the session; not inside `runTurn` core branches.  

Rejected: algebraic-effect Runner as session kernel; long-lived Agent owning messages.

## Consequences

- Clear `continueTurn` / drain semantics  
- Face / HTTP clients read the same event stream  
- Consistent with [ADR-0004](./0004-no-effect-runtime.md)  

## Related

[session-api.md](../session-api.md) · [session-safety.md](../session-safety.md) · [session-delivery.md](../session-delivery.md)
