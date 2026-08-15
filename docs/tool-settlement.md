# Tool settlement

## 悬挂 call（fail-before-retry）

底层不变量：**每个 `tool/call`（及未落 call 的 `assistant.toolCalls`）必须有配对 `tool/result`，才可进入下一轮模型请求。**

对照 OpenCode `failInterruptedTools` — 崩溃/中止后禁止默默重放副作用；先写失败结果再 assemble。

### API（`@xrkseek/core-session`）

| 函数 | 作用 |
|------|------|
| `listDanglingToolCalls(events)` | 纯扫描未结 call |
| `settleDanglingTools(store, sessionId)` | 追加 `isError` 的 `tool/result` |
| `assertToolCallsSettled(events)` | 仍有悬挂则抛 `ToolSettlementError` |

`runTurn` **入口**先 `settleDanglingTools`；每步 LLM 前再 `assertToolCallsSettled`。

---

## 并行 settle（step 内多 call）

对照 OpenCode Runner：`FiberSet` eager settle → await 全部再 continuation。  
本仓 **无 Effect**；默认 `toolSettle: "parallel"`。

### 双屏障（相对 Fiber 完成序发布的升级）

```text
1. 依次 append 全部 tool/call     ← barrier（先耐久、再副作用）
2. settleToolBatch(parallel|serial)  ← 体并行或串行
3. 按 **call 序** append tool/result ← barrier（日志顺序稳定）
4. batch safety/notice + additionalContexts
```

| | OpenCode | XRK |
|--|----------|-----|
| 启动 | Fiber eager | `Promise.all`（parallel） |
| result 日志序 | 随完成发布，可能乱序 | **固定为 call 序** |
| 可关 | — | `toolSettle: "serial"` |

```ts
runTurn({ …, toolSettle: "parallel" }); // default
createAgent({ …, toolSettle: "serial" });
```

崩溃在 barrier 2：已有未结 `tool/call` → 下次入口 `settleDanglingTools` 写成 interrupted。
