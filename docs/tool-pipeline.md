# 工具管道 / Tool Pipeline

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

```text
tool/call (session, by loop)
  → pre-execute
  → guards (monotonic: deny sticky)
  → execute (around + timeout + retry)
  → post-execute
  → finalizeContent
  → output bound (optional persist)
  → freeze tool/result
  → (per call) toolEvents → e.g. `todo/write` · `plan/mode`（before tool/result）
  → (batch) safetyNotices → safety/notice
  → (batch) additionalContexts → user/message
```

## 硬规则 / Hard rules

1. **`tool/call` before pre** — `runTurn` 先 append call，再进 pipeline。 / Append the call first, then enter the pipeline.  
2. **Guards monotonic** — deny 粘性；`abstain` 中性。 / Deny is sticky; `abstain` is neutral.  
3. **Pre** — `continue` | `deny` | `ask`（无 hook 默认 deny）。 / Without a hook, default is deny.  
4. **Execute** — around + `timeoutMs` + `transientError` 重试；可选 `extras.emitToolEvent`。  
5. **Post** — `accept` | `block` | `replace`；safety / additionalContext 分批。 / Safety and additionalContext are batched.  
6. **Finalize** — 只改 `content` 字符串。 / Only mutates the `content` string.  
7. **Output bound** — 默认行/字节上限；可选 workspace persist。`result.meta` 透传（壳卡回放，不进 `deriveMessages`）。 / Default line/byte caps; optional workspace persist. `result.meta` is passed through for shell cards and does not enter `deriveMessages`.  
8. **Result freeze** — `Object.freeze`。  
9. **Side events** — `todo_write` / `exit_plan_mode` 等经 `emitToolEvent`；loop 校验后 append（不进 `deriveMessages`）。  
10. **Settle** — 默认 parallel + 屏障；见 [tool-settlement.md](./tool-settlement.md)。 / Default parallel settle with a barrier.  
11. **Materialize** — settle 用冻结工具表。 / Settle uses a frozen tool table.

Pipeline 是显式 `ToolPipeline` 对象（无全局 proxy）。审批 hook `ask` 由 Face `approval/*` 接线。

The pipeline is an explicit `ToolPipeline` object (no global proxy). The approval hook `ask` is wired by Face `approval/*`.
