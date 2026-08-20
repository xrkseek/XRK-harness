# Tool pipeline

> **读者**：集成者 · 贡献者。

```text
tool/call (session, by loop)
  → pre-execute
  → guards (monotonic: deny sticky)
  → execute (around + timeout + retry)
  → post-execute
  → finalizeContent
  → output bound (optional persist)
  → freeze tool/result
  → (per call) toolEvents → e.g. `todo/write` · `plan/mode`（先于 tool/result 入账）
  → (batch) safetyNotices → safety/notice
  → (batch) additionalContexts → user/message
```

## 硬规则

1. **`tool/call` before pre** — `runTurn` 先 append call，再进 pipeline。  
2. **Guards monotonic** — deny 粘性；`abstain` 中性。  
3. **Pre** — `continue` | `deny` | `ask`（无 hook 默认 deny）。  
4. **Execute** — around + `timeoutMs` + `transientError` 重试；可选 `extras.emitToolEvent`。  
5. **Post** — `accept` | `block` | `replace`；safety / additionalContext 分批。  
6. **Finalize** — 只改 `content` 字符串。  
7. **Output bound** — 默认行/字节上限；可选 workspace persist。`result.meta` 透传（壳卡回放，不进 `deriveMessages`）。  
8. **Result freeze** — `Object.freeze`。  
9. **Side events** — `todo_write` / `exit_plan_mode` 等经 `emitToolEvent`；loop 校验后 append（不进 `deriveMessages`）。  
10. **Settle** — 默认 parallel + 屏障；见 [tool-settlement.md](./tool-settlement.md)。  
11. **Materialize** — settle 用冻结工具表。

Pipeline 是显式 `ToolPipeline` 对象（无全局 proxy）。审批 hook `ask` 由 Face `approval/*` 接线。
