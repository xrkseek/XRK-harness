# Tool settlement

> **读者**：贡献者。

## 悬挂 call（fail-before-retry）

底层不变量：**每个 `tool/call`（及未落 call 的 `assistant.toolCalls`）必须有配对 `tool/result`，才可进入下一轮模型请求。**

崩溃/中止后禁止默默重放副作用：先写失败 `tool/result` 再 assemble。

### API（`@xrkseek/core-session`）

| 函数 | 作用 |
|------|------|
| `listDanglingToolCalls(events)` | 纯扫描未结 call |
| `settleDanglingTools(store, sessionId)` | 追加 `isError` 的 `tool/result` |
| `assertToolCallsSettled(events)` | 仍有悬挂则抛 `ToolSettlementError` |

`runTurn` **入口**先 `settleDanglingTools`；每步 LLM 前再 `assertToolCallsSettled`。

---

## 并行 settle（step 内多 call）

默认 `toolSettle: "parallel"`：step 内多 call 先耐久写齐，再并行/串行 settle，全部完成后再 continuation。

### 双屏障

```text
1. 依次 append 全部 tool/call     ← barrier（先耐久、再副作用）
2. settleToolBatch(parallel|serial)  ← 体并行或串行
3. 按 **call 序** append tool/result ← barrier（日志顺序稳定）
4. batch safety/notice + additionalContexts
```

- parallel：`Promise.all` 执行；**result 日志序固定为 call 序**
- 可关：`toolSettle: "serial"`

```ts
runTurn({ …, toolSettle: "parallel" }); // default
createAgent({ …, toolSettle: "serial" });
```

崩溃在 barrier 2：已有未结 `tool/call` → 下次入口 `settleDanglingTools` 写成 interrupted。
