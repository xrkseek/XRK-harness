# Tool settlement

> **读者**：贡献者。

## 悬挂 call（fail-before-retry）

底层不变量：**每个 `tool/call`（及未落 call 的 `assistant.toolCalls`）必须有配对 `tool/result`，才可进入下一轮模型请求。**

崩溃/中止后禁止默默重放副作用：先写失败 `tool/result` 再 assemble。

### API（`@xrkseek/core-session`）

| 函数 | 作用 |
|------|------|
| `listDanglingToolCalls(events)` | 纯扫描未结 call |
| `settleDanglingTools(store, sessionId)` | 追加 `isError` 的 `tool/result`（带结构化 `error`） |
| `assertToolCallsSettled(events)` | 仍有悬挂则抛 `ToolSettlementError` |
| `danglingSettlement(d)` | 按来源返回文案与码 |

结算码（模型读 `content`；Face 可读 `result.error`）：

| 来源 / 路径 | `error.code` | 含义 |
|-------------|--------------|------|
| 崩溃修复：已有 `tool/call`、无 `tool/result` | `TOOL_OUTCOME_UNKNOWN` | 已记开跑，结局未知；勿盲目重试 |
| 崩溃修复：仅 `assistant/message.toolCalls` | `TOOL_NOT_STARTED` | 未记到 `tool/call`；可按需重试 |
| 取消路径：body 已调用（抛 Abort / 晚成功被覆盖） | `ABORTED` | 取消发生在开跑之后；勿当未执行 |
| 取消路径：`settleDanglingTools(…, { kind: "aborted-before-dispatch" })` 或 settle 未开跑槽位 | `ABORTED_BEFORE_DISPATCH` | 取消阻止了 body；可按需重试 |

`runTurn` **入口**先 `settleDanglingTools`（崩溃码）；取消 finalize 用 `aborted-before-dispatch`。每步 LLM 前再 `assertToolCallsSettled`。

---

## 并行 settle（`isConcurrencySafe`）

默认 `toolSettle: "parallel"`：step 内多 call **先耐久写齐** `tool/call`，再按分类 settle，**result 日志序固定为 call 序**。Face `agent-loop.toolSettle` 可强制 `serial`。

### 分类（DSH `executionMode`）

| 条件 | 调度 |
|------|------|
| 工具声明 `isConcurrencySafe(args)` 且返回**恰好** `true` | 可与同组其它 safe call 重叠 |
| 未声明 / 抛错 / 其它返回值 / 未知工具名 | **独占屏障**（先排空池，单独跑） |
| `toolSettle: "serial"` | 全部独占 |

已标 concurrency-safe（只读）：`web_search` · `web_fetch` · `read_file` · `glob` · `grep` · `lsp` · `skill` · `terminal_list` · `terminal_read` · `bash_jobs` · `job_list` · `job_output`（`wait≠true`）。写副作用工具默认独占。MCP 工具仅当 `annotations.readOnlyHint === true` 时标 safe（否则独占）。

步内 LLM 重试：Face `agent-loop.llmRetryMaxRetries`（默认 5；`0` 关闭）→ Host → harness → `runTurn.llmRetry`。

### 双屏障

```text
1. 依次 append 全部 tool/call     ← barrier（先耐久、再副作用）
2. settleToolBatch                 ← exclusive 屏障 + 有界 parallel 池
3. 按 **call 序** append tool/result ← barrier（日志顺序稳定）
4. batch safety/notice + additionalContexts
```

- 池上限：`maxParallelToolCalls`（Face `agent-loop.maxParallelToolCalls`）
- 组内后置 call 在启动前会**再分类**；若变成 exclusive，当前池排空后留给下一组

```ts
runTurn({ …, toolSettle: "parallel" }); // default — concurrency-aware
createAgent({ …, toolSettle: "serial" });
```

崩溃在 barrier 2：已有未结 `tool/call` → 下次入口 `settleDanglingTools` 写成 `TOOL_OUTCOME_UNKNOWN`。
取消在 barrier 2：未开跑槽位当场 `ABORTED_BEFORE_DISPATCH`；已开跑的 call 结为 `ABORTED`（或正常结果若先于取消完成）；随后 `finalizeCancelledTurn` 再兜底结算悬挂。


---

## `concludesTurn`（DSH 步末结轮）

工具 `execute` 成功返回 `{ concludesTurn: true }` 时，`runTurn` 在本步 settle 完（call/result · contexts · `step/end`）后**结束本轮**，不再开下一步 LLM。失败 / `isError` / abort 合成结果**不会**结轮。

```ts
async execute() {
  return { content: "submitted", concludesTurn: true };
}
```
