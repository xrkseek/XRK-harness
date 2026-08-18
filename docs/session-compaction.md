# Session compaction

换 **active 窗口**，**不删** append-only 日志。

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

createAgent({ compaction: {} }).compactNow() // `/compact`：idle · reason manual
```

`/compact`（Face 内建）：无参数；busy / 摘要失败 → error；无可压缩历史 → success「No compactable history yet.」；成功文案带 shadowed 条数与估算 token，`command/done.sourceEventSeq` 指向 `context/compaction`。

## Overflow 一次恢复

1. `llm.chat` 抛 `ContextOverflowError`
2. `runCompaction({ reason: "overflow" })`
3. 重建请求再 chat **恰好一次**
4. 再溢出则原样抛出

未传 `compaction`（或 `false`）时 loop 不做 overflow 恢复。session preset 默认 `{}`：开一次 overflow 重试；无 `maxRequestTokens` 则不主动 compact。`/compact` 走 `compactNow`，不依赖 overflow 开关。

| 项 | 本仓 |
|----|------|
| 运行时 | plain async |
| 窗口 | `deriveMessages` 读时 fold |
| 默认 | loop **opt-in**；preset `compaction: {}` |
