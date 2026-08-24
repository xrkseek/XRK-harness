# 工具结算 / Tool Settlement

> **读者 / Audience**：贡献者 / Contributors

## 悬挂 call（fail-before-retry） / Dangling calls (fail-before-retry)

底层不变量：**每个 `tool/call`（及未落 call 的 `assistant.toolCalls`）必须有配对 `tool/result`，才可进入下一轮模型请求。**

Invariant: **every `tool/call` (and every `assistant.toolCalls` entry without a logged call) must have a paired `tool/result` before the next model request.**

崩溃/中止后禁止默默重放副作用：先写失败 `tool/result` 再 assemble。

After crash or abort, do not silently replay side effects: write a failed `tool/result` before assemble.

### API（`@xrkseek/core-session`）

| 函数 / Function | 作用 / Role |
|------|------|
| `listDanglingToolCalls(events)` | 纯扫描未结 call / Scan unsettled calls |
| `settleDanglingTools(store, sessionId)` | 追加 `isError` 的 `tool/result`（带结构化 `error`） |
| `assertToolCallsSettled(events)` | 仍有悬挂则抛 `ToolSettlementError` |
| `danglingSettlement(d)` | 按来源返回文案与码 / Copy and code by source |

结算码（模型读 `content`；Face 可读 `result.error`） / Settlement codes：

| 来源 / 路径 / Source | `error.code` | 含义 / Meaning |
|-------------|--------------|------|
| 崩溃修复：已有 `tool/call`、无 `tool/result` | `TOOL_OUTCOME_UNKNOWN` | 已记开跑，结局未知；勿盲目重试 / Started; outcome unknown; do not blindly retry |
| 崩溃修复：仅 `assistant/message.toolCalls` | `TOOL_NOT_STARTED` | 未记到 `tool/call`；可按需重试 / Call not logged; retry if needed |
| 取消路径：body 已调用 | `ABORTED` | 取消发生在开跑之后 / Cancel after start |
| 取消路径：未开跑槽位 | `ABORTED_BEFORE_DISPATCH` | 取消阻止了 body；可按需重试 / Cancel blocked the body |

`runTurn` **入口**先 `settleDanglingTools`（崩溃码）；取消 finalize 用 `aborted-before-dispatch`，并把 `AgentCancelCause` 写入 `turn/end.reason`（`user` / `parent` / `hook` / `disposed` / `legacy`）。每步 LLM 前再 `assertToolCallsSettled`。

`runTurn` **entry** first calls `settleDanglingTools` (crash codes). Cancel finalize uses `aborted-before-dispatch` and writes `AgentCancelCause` into `turn/end.reason`. Before each LLM step, `assertToolCallsSettled` runs again.

---

## 并行 settle（`isConcurrencySafe`） / Parallel settle

默认 `toolSettle: "parallel"`：step 内多 call **先耐久写齐** `tool/call`，再按分类 settle，**result 日志序固定为 call 序**。Face `agent-loop.toolSettle` 可强制 `serial`。

Default `toolSettle: "parallel"`: within a step, all `tool/call` rows are durable-written first, then settled by class; **result log order matches call order**. Face `agent-loop.toolSettle` may force `serial`.

### 分类 / Classification

| 条件 / Condition | 调度 / Scheduling |
|------|------|
| 工具声明 `isConcurrencySafe(args)` 且返回**恰好** `true` | 可与同组其它 safe call 重叠 / May overlap other safe calls in the group |
| 未声明 / 抛错 / 其它返回值 / 未知工具名 | **独占屏障** / Exclusive barrier |
| `toolSettle: "serial"` | 全部独占 / All exclusive |

已标 concurrency-safe（只读）：`web_search` · `web_fetch` · `read_file` · `glob` · `grep` · `lsp` · `skill` · `terminal_list` · `terminal_read` · `bash_jobs` · `job_list` · `job_output`（`wait≠true`）。写副作用工具默认独占。MCP 工具仅当 `annotations.readOnlyHint === true` 时标 safe。

Read-only tools listed above are marked concurrency-safe. Side-effect tools are exclusive by default. MCP tools are safe only when `annotations.readOnlyHint === true`.

步内 LLM 重试：Face `agent-loop.llmRetryMaxRetries`（默认 5；`0` 关闭）→ Host → harness → `runTurn.llmRetry`。

### 双屏障 / Dual barriers

```text
1. Append all tool/call in order     ← barrier (durable first)
2. settleToolBatch                   ← exclusive barrier + bounded parallel pool
3. Append tool/result in call order  ← barrier (stable log order)
4. batch safety/notice + additionalContexts
```

- 池上限 / Pool cap：`maxParallelToolCalls`（Face `agent-loop.maxParallelToolCalls`）
- 组内后置 call 在启动前会**再分类**；若变成 exclusive，当前池排空后留给下一组

```ts
runTurn({ …, toolSettle: "parallel" }); // default — concurrency-aware
createAgent({ …, toolSettle: "serial" });
```

崩溃在 barrier 2：已有未结 `tool/call` → 下次入口 `settleDanglingTools` 写成 `TOOL_OUTCOME_UNKNOWN`。  
取消在 barrier 2：未开跑槽位当场 `ABORTED_BEFORE_DISPATCH`；已开跑的 call 结为 `ABORTED`（或正常结果若先于取消完成）。

---

## `concludesTurn`（步末结轮） / End turn at step end

工具成功结轮有两种等价写法：返回 `{ concludesTurn: true }`，或在 body 内调用 `extras.concludeTurn()`（可再 `extras.deferContext(text)`）。`runTurn` 在本步 settle 完后**结束本轮**，不再开下一步 LLM。失败 / `isError` / abort 合成结果**不会**结轮。

Two equivalent ways to conclude a successful tool turn: return `{ concludesTurn: true }`, or call `extras.concludeTurn()` inside the body. After settle completes, `runTurn` **ends the turn** and does not open another LLM step. Failed / `isError` / abort synthetic results do **not** conclude the turn.

```ts
async execute(_args, _signal, extras) {
  extras?.concludeTurn();
  return { content: "submitted" };
  // or: return { content: "submitted", concludesTurn: true };
}
```
