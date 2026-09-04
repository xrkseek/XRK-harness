# 工具结算

> **读者**：贡献者

## 悬挂 call（fail-before-retry）

底层不变量：**每个 `tool/call`（及未落 call 的 `assistant.toolCalls`）必须有配对 `tool/result`，才可进入下一轮模型请求。**

崩溃/中止后禁止默默重放副作用：先写失败 `tool/result` 再 assemble。

### API（`@xrkseek/core-session`）

| 函数 | 作用 |
|------|------|
| `listDanglingToolCalls(events)` | 纯扫描未结 call |
| `settleDanglingTools(store, sessionId)` | 追加 `isError` 的 `tool/result`（带结构化 `error`） |
| `assertToolCallsSettled(events)` | 仍有悬挂则抛 `ToolSettlementError` |
| `assertAssistantToolCallAdjacency(messages)` | 模型可见历史：`assistant(toolCalls)` 后须紧跟匹配 `tool`；拒 orphan / 错 id / 双 assistant 夹断 |
| `danglingSettlement(d)` | 按来源返回文案与码 |

结算码（模型读 `content`；Face 可读 `result.error`）：

| 来源 / 路径 | `error.code` | 含义 |
|-------------|--------------|------|
| 崩溃修复：已有 `tool/call`、无 `tool/result` | `TOOL_OUTCOME_UNKNOWN` | 已记开跑，结局未知；勿盲目重试 |
| 崩溃修复：仅 `assistant/message.toolCalls` | `TOOL_NOT_STARTED` | 未记到 `tool/call`；可按需重试 |
| 取消路径：body 已调用 | `ABORTED` | 取消发生在开跑之后 |
| 取消路径：未开跑槽位 | `ABORTED_BEFORE_DISPATCH` | 取消阻止了 body；可按需重试 |

`runTurn` **入口**先 `settleDanglingTools`（崩溃码）；取消 finalize 用 `aborted-before-dispatch`，并把 `AgentCancelCause` 写入 `turn/end.reason`（`user` / `parent` / `hook` / `disposed` / `legacy`）。每步 LLM 前再 `assertToolCallsSettled` + `assertAssistantToolCallAdjacency`。

持久化水合 `repairOpenTurnEvents`：先结算日志上已有悬挂 call，再折叠 stream 前缀；若折叠出 `toolCalls`，**同批再结算一轮**，再写 `step/end` / `turn/end`（interrupted），避免「有 toolCalls、无 result」的邻接洞。

## 并行 settle（`isConcurrencySafe`）

默认 `toolSettle: "parallel"`：step 内多 call **先耐久写齐** `tool/call`，再按分类 settle，**result 日志序固定为 call 序**。Face `agent-loop.toolSettle` 可强制 `serial`。

### 分类

| 条件 | 调度 |
|------|------|
| 工具声明 `isConcurrencySafe(args)` 且返回**恰好** `true` | 可与同组其它 safe call 重叠 |
| 未声明 / 抛错 / 其它返回值 / 未知工具名 | **独占屏障** |
| `toolSettle: "serial"` | 全部独占 |

已标 concurrency-safe（只读）：`web_search` · `web_fetch` · `read_file` · `glob` · `grep` · `lsp` · `skill` · `terminal_list` · `terminal_read` · `job_list` · `job_output`（`wait≠true`）。写副作用工具默认独占。MCP 工具仅当 `annotations.readOnlyHint === true` 时标 safe。

步内 LLM 重试：Face `agent-loop.llmRetryMaxRetries`（默认 5；`0` 关闭）→ Host → harness → `runTurn.llmRetry`。

### 双屏障

```text
1. Append all tool/call in order     ← barrier (durable first)
2. settleToolBatch                   ← exclusive barrier + bounded parallel pool
3. Append tool/result in call order  ← barrier (stable log order)
4. batch safety/notice + additionalContexts
```

- 池上限：`maxParallelToolCalls`（Face `agent-loop.maxParallelToolCalls`）
- 组内后置 call 在启动前会**再分类**；若变成 exclusive，当前池排空后留给下一组

```ts
runTurn({ …, toolSettle: "parallel" }); // default — concurrency-aware
createAgent({ …, toolSettle: "serial" });
```

崩溃在 barrier 2：已有未结 `tool/call` → 下次入口 `settleDanglingTools` 写成 `TOOL_OUTCOME_UNKNOWN`。  
取消在 barrier 2：未开跑槽位当场 `ABORTED_BEFORE_DISPATCH`；已开跑的 call 结为 `ABORTED`（或正常结果若先于取消完成）。

## `concludesTurn`（步末结轮）

工具成功结轮有两种等价写法：返回 `{ concludesTurn: true }`，或在 body 内调用 `extras.concludeTurn()`（可再 `extras.deferContext(text)`）。`runTurn` 在本步 settle 完后**结束本轮**，不再开下一步 LLM。失败 / `isError` / abort 合成结果**不会**结轮。

```ts
async execute(_args, _signal, extras) {
  extras?.concludeTurn();
  return { content: "submitted" };
  // or: return { content: "submitted", concludesTurn: true };
}
```

---

# Tool Settlement

> **Audience**: Contributors

## Dangling calls (fail-before-retry)

Invariant: **every `tool/call` (and every `assistant.toolCalls` entry without a logged call) must have a paired `tool/result` before the next model request.**

After crash or abort, do not silently replay side effects: write a failed `tool/result` before assemble.

### API (`@xrkseek/core-session`)

| Function | Role |
|------|------|
| `listDanglingToolCalls(events)` | Pure scan of unsettled calls |
| `settleDanglingTools(store, sessionId)` | Append `isError` `tool/result` (with structured `error`) |
| `assertToolCallsSettled(events)` | Throw `ToolSettlementError` if any remain dangling |
| `assertAssistantToolCallAdjacency(messages)` | Model-facing history: `assistant(toolCalls)` must be followed by matching `tool` messages; rejects orphans / wrong ids / adjacent assistants |
| `danglingSettlement(d)` | Copy and code by source |

Settlement codes (model reads `content`; Face may read `result.error`):

| Source / path | `error.code` | Meaning |
|-------------|--------------|------|
| Crash repair: `tool/call` present, no `tool/result` | `TOOL_OUTCOME_UNKNOWN` | Started; outcome unknown; do not blindly retry |
| Crash repair: only `assistant/message.toolCalls` | `TOOL_NOT_STARTED` | Call not logged; retry if needed |
| Cancel path: body already invoked | `ABORTED` | Cancel after start |
| Cancel path: slot never started | `ABORTED_BEFORE_DISPATCH` | Cancel blocked the body; retry if needed |

`runTurn` **entry** first calls `settleDanglingTools` (crash codes). Cancel finalize uses `aborted-before-dispatch` and writes `AgentCancelCause` into `turn/end.reason` (`user` / `parent` / `hook` / `disposed` / `legacy`). Before each LLM step, `assertToolCallsSettled` and `assertAssistantToolCallAdjacency` run again.

Persistent hydrate `repairOpenTurnEvents`: settle dangling calls already on the log, fold the stream prefix, then **settle again in the same batch** if folding introduced `toolCalls`, before writing `step/end` / `turn/end` (`interrupted`) — so rehydrate does not leave assistant toolCalls without adjacent results.

## Parallel settle (`isConcurrencySafe`)

Default `toolSettle: "parallel"`: within a step, all `tool/call` rows are durable-written first, then settled by class; **result log order matches call order**. Face `agent-loop.toolSettle` may force `serial`.

### Classification

| Condition | Scheduling |
|------|------|
| Tool declares `isConcurrencySafe(args)` and returns **exactly** `true` | May overlap other safe calls in the group |
| Undeclared / throws / other return / unknown tool name | **Exclusive barrier** |
| `toolSettle: "serial"` | All exclusive |

Marked concurrency-safe (read-only): `web_search` · `web_fetch` · `read_file` · `glob` · `grep` · `lsp` · `skill` · `terminal_list` · `terminal_read` · `job_list` · `job_output` (`wait≠true`). Side-effect tools are exclusive by default. MCP tools are safe only when `annotations.readOnlyHint === true`.

In-step LLM retry: Face `agent-loop.llmRetryMaxRetries` (default 5; `0` disables) → Host → harness → `runTurn.llmRetry`.

### Dual barriers

```text
1. Append all tool/call in order     ← barrier (durable first)
2. settleToolBatch                   ← exclusive barrier + bounded parallel pool
3. Append tool/result in call order  ← barrier (stable log order)
4. batch safety/notice + additionalContexts
```

- Pool cap: `maxParallelToolCalls` (Face `agent-loop.maxParallelToolCalls`)
- Later calls in a group are **reclassified** before start; if they become exclusive, the current pool drains first

```ts
runTurn({ …, toolSettle: "parallel" }); // default — concurrency-aware
createAgent({ …, toolSettle: "serial" });
```

Crash at barrier 2: unsettled `tool/call` → next entry `settleDanglingTools` writes `TOOL_OUTCOME_UNKNOWN`.  
Cancel at barrier 2: unstarted slots get `ABORTED_BEFORE_DISPATCH` immediately; started calls settle as `ABORTED` (or normal result if they finished before cancel).

## `concludesTurn` (end turn at step end)

Two equivalent ways to conclude a successful tool turn: return `{ concludesTurn: true }`, or call `extras.concludeTurn()` inside the body (optional `extras.deferContext(text)`). After settle completes, `runTurn` **ends the turn** and does not open another LLM step. Failed / `isError` / abort synthetic results do **not** conclude the turn.

```ts
async execute(_args, _signal, extras) {
  extras?.concludeTurn();
  return { content: "submitted" };
  // or: return { content: "submitted", concludesTurn: true };
}
```
