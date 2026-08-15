# Session compaction

对照 OpenCode `SessionCompaction`：换 **active 窗口**，**不删** append-only 日志。  
决策见 [learn/opencode-projector-derive.md](./learn/opencode-projector-derive.md)、absorb #9。

## 事件

`context/compaction`：

| 字段 | 含义 |
|------|------|
| `reason` | `auto` · `overflow` · `manual` |
| `summary` | 锚定摘要（固定 Markdown 骨架） |
| `recent` | 未进摘要的尾部原文 |

## `deriveMessages`

取 **最新** compaction：投影为一条 `user`（summary + recent），再 fold 其后事件。  
旧事件仍在 store；`deriveMessagesUnwindowed` 可读全量（供 summarizer）。

## API

```ts
// 纯函数（core-session）
prepareCompactionPayload(events, keepTokens)
selectHeadRecent(messages, keepTokens)

// 写日志（agent-loop）
runCompaction({ store, sessionId, llm, reason })

runTurn({
  compaction: {
    maxRequestTokens: 32_000, // 可选：超预算主动 compact
    keepTokens: 8_000,
    bufferTokens: 2_000,
  },
})
```

## Overflow 一次恢复

1. `llm.chat` 抛 `ContextOverflowError`
2. `runCompaction({ reason: "overflow" })`
3. 重建请求再 chat **恰好一次**
4. 再溢出则原样抛出

未配置 `compaction` 时不做恢复。

## 相对 OpenCode

| | OpenCode | XRK |
|--|----------|-----|
| 运行时 | Effect Fiber | plain async |
| 窗口 | message 表 seq | `deriveMessages` 读时 fold |
| 模板 | 固定 SUMMARY_TEMPLATE | 自研短骨架（同「固定结构」精华） |
| 默认 | 模型 context 限制驱动 | **opt-in** `compaction: {…}` |
