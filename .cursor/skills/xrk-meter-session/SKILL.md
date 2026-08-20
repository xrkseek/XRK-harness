---
name: xrk-meter-session
description: >-
  Working notes for XRK session meter, compaction shadow-price, TokenUsage, and
  Face context projections. Use when editing those packages or syncing related
  textbook docs (session-compaction, protocol-events).
---

# 笔记 · meter / session compaction

教科书先读：`docs/session-compaction.md` · `docs/protocol-events.md`（TokenUsage 节）。  
常驻红线：`.cursor/rules/xrk-meter-compaction.mdc`。

## 触发

改下列任一，或用户问「压缩 / Context meter / shadowedTokenCount / TokenUsage」：

- `packages/protocol/src/token-usage.ts`
- `packages/core/session/src/surface-*.ts` · `compaction.ts`
- `packages/core/agent-loop/src/compaction.ts` · `request-header-log.ts`
- Face `projections/units/token-usage|context-pressure|context-breakdown|session-stats.ts`

## 改码清单

1. 样本只走 protocol；计价只走 core-session；Face 只做投影。
2. 预算 `estimateTokens` 与 meter `foldSurfaceTokens` 分路。
3. 写压缩：`runCompaction` → `priceCurrentSurfaceWindow` → `shadowedTokenCount`。
4. 测：`protocol/tests/token-usage` · `session/tests/surface-fold` · `face/tests/token-usage` · loop compaction · agent compact-now。
5. 契约变了 → **改教科书**（事实与 API），红线只留在本 skill / mdc。

## 勿做

- 把预算强行换成 surface 计价  
- Face estimate/fold shim  
- 搬 Cordis `xrk-token-meter` 进内核  
- 在 `docs/` 写「不要合并 / 本刀 / shim」  
- 假扮 DSH 多事件 `summary|prune` + surfaceOp（本仓单事件 shadow 字段）

## 教科书 vs 笔记

| | 教科书 | 本笔记 |
|--|--------|--------|
| 读者 | 集成者 | 改码 Agent |
| 内容 | 行为 · API · 怎么开 | 分层 · 红线 · 测哪些 |
| 位置 | `docs/` | `.cursor/skills` · `.cursor/rules` |
