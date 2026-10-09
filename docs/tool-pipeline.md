# 工具管道

> **读者**：集成者 · 贡献者

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
12. **Wire catalog** — `listForModel` 按 `ToolDefinition.exposure` 过滤进模型的工具表（`direct` / `deferred` / `hidden`）；有 `tool_search` 时 Deferred 默认不出 schema，经 search 展开（单次 ≤8）；无 search → 全量非 hidden（fail-open）。Registry 仍挂全表。MCP 工具默认 `exposure: deferred`。

Pipeline 是显式 `ToolPipeline` 对象（无全局 proxy）。审批 hook `ask` 由 Face `approval/*` 接线。路径越权（`workspace-write` 盘外）走 pre → `ask`（约 5s 确认），白名单是会话路径对象。

---

# Tool Pipeline

> **Audience**: Integrators · Contributors

```text
tool/call (session, by loop)
  → pre-execute
  → guards (monotonic: deny sticky)
  → execute (around + timeout + retry)
  → post-execute
  → finalizeContent
  → output bound (optional persist)
  → freeze tool/result
  → (per call) toolEvents → e.g. `todo/write` · `plan/mode` (before tool/result)
  → (batch) safetyNotices → safety/notice
  → (batch) additionalContexts → user/message
```

## Hard rules

1. **`tool/call` before pre** — Append the call first, then enter the pipeline.
2. **Guards monotonic** — Deny is sticky; `abstain` is neutral.
3. **Pre** — `continue` | `deny` | `ask` (without a hook, default is deny).
4. **Execute** — around + `timeoutMs` + `transientError` retries; optional `extras.emitToolEvent`.
5. **Post** — `accept` | `block` | `replace`; safety and additionalContext are batched.
6. **Finalize** — Only mutates the `content` string.
7. **Output bound** — Default line/byte caps; optional workspace persist. `result.meta` is passed through for shell cards and does not enter `deriveMessages`.
8. **Result freeze** — `Object.freeze`.
9. **Side events** — `todo_write` / `exit_plan_mode` and peers go through `emitToolEvent`; the loop validates then appends (not into `deriveMessages`).
10. **Settle** — Default parallel settle with a barrier; see [tool-settlement.md](./tool-settlement.md).
11. **Materialize** — Settle uses a frozen tool table.
12. **Wire catalog** — `listForModel` filters tools by `ToolDefinition.exposure` (`direct` / `deferred` / `hidden`); with `tool_search`, Deferred schemas stay off the wire until searched (≤8 per call); without search → all non-hidden (fail-open). The Registry stays full. MCP tools default to `exposure: deferred`.

The pipeline is an explicit `ToolPipeline` object (no global proxy). The approval hook `ask` is wired by Face `approval/*`. Path overreach (`workspace-write` off-root) uses pre → `ask` (≈5s); the allowlist is session path objects.
