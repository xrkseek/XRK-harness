# ADR-0003: Session 长寿 · Loop 短寿

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** session, agent-loop

## Context

本仓已有 `SessionStore`（append-only 事件）与 `runTurn` / `AgentHandle`。若把 `AgentHandle` 当成会话真源（长期缓存可变 messages），会与「模型输入必须可从事件重建」、多端订阅（HTTP SSE / WS）冲突。

## Decision

**Session 长寿 · 单次 turn / loop 状态短寿。**

1. **真源**：仅 `SessionStore` 事件日志（及派生物）。禁止 runtime 可变 messages 覆盖日志。  
2. **寿命**：Session（及 tools/pipeline/llm 绑定）长寿；step 计数、abort、pending tool ids 随 `runTurn` 起止。  
3. **缓存**：Host 可按 sessionId 缓存 `AgentHandle` 作为**组合绑定**，不得当作 transcript 真源；preset 变更须 invalidate（见 compose agent-cache）。  
4. **并发**：同一 session 同时至多一个 turn（TurnLatch / DrainHub），不用第三套「会话内核」。  
5. **安全 tracker**：挂在 session 旁路，不写进 `runTurn` 内核分支。  

拒绝：以代数效应 Runner 作为会话内核；拒绝长寿 Agent 独占 messages。

## Consequences

- `continueTurn` / drain 语义清晰  
- Face / HTTP 多端读同一事件流  
- 与 [ADR-0004](./0004-no-effect-runtime.md) 一致  

## Related

[session-api.md](../session-api.md) · [session-safety.md](../session-safety.md) · [session-delivery.md](../session-delivery.md)
