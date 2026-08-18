# @xrkseek/core-agent-loop

Turn 驱动：`runTurn`。写 append-only session 事件；LLM 前校验 model-visible ≡ logged。

| 能力 | 说明 |
|------|------|
| materialize | 每步工具表快照 + stale settle |
| maxSteps | 末步注入文案、tools=[]、拒执行 |
| settle | `settleToolBatch`：call 齐 → 并行/串行 → result 按序 |
| dangling | turn 开始 `settleDanglingTools` |
| compaction | 可选 overflow 一次重试 |
| stream | 适配器有 `stream()` 时先写 `assistant/chunk`（含 reasoning）再 `assistant/message` |
| vision | user 图块：适配器 `inputModalities` 含 `image` 才放行，并转发 `resolveImage` |

规格：[docs/tool-settlement.md](../../../docs/tool-settlement.md) · [docs/session-compaction.md](../../../docs/session-compaction.md)
