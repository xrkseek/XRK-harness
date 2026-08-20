# Session compaction

> **读者**：集成者 · 贡献者（配置压缩 / 理解 meter）。终端用户可在壳内使用 `/compact`，细节见下文「Face `/compact`」。

长会话里，模型可见上下文需要**换窗**，而不是改写或删除历史日志。

本仓做法：在 append-only 事件流上追加一条 `context/compaction`，之后 `deriveMessages` 只从**最新**压缩点往后重建；旧事件仍留在 store，可供审计与摘要器全量读取。

相关事件全集见 [protocol-events.md](./protocol-events.md)；Session 总览见 [session.md](./session.md)。

## 事件字段

`context/compaction`：

| 字段 | 含义 |
|------|------|
| `reason` | `auto`（预算触发）· `overflow`（上下文溢出恢复）· `manual`（`/compact`） |
| `summary` | 锚定摘要（固定 Markdown 骨架） |
| `recent` | 未并入摘要的尾部原文 |
| `shadowedTokenCount` | 可选。压缩前当前窗口的 surface 估算量；有则 Context meter 按「摘要价 − 该值」缩小显示；缺省则不缩小（兼容旧日志） |

## 模型可见历史

`deriveMessages`：

1. 找到最新 `context/compaction`
2. 投影为一条 `user` 消息（`summary` + `recent`）
3. 再 fold 该事件**之后**的对话事件

全量读取用 `deriveMessagesUnwindowed`（摘要器、调试）。

## 怎么开

```ts
// 纯函数（@xrkseek/core-session）
prepareCompactionPayload(events, keepTokens)
selectHeadRecent(messages, keepTokens)

// 写日志（@xrkseek/core-agent-loop）
runCompaction({ store, sessionId, llm, reason })

runTurn({
  compaction: {
    maxRequestTokens: 32_000, // 可选：超预算主动 compact
    keepTokens: 8_000,
    bufferTokens: 2_000,
  },
})

createAgent({ compaction: {} }).compactNow() // Face `/compact`：idle · reason manual
```

| 项 | 本仓 |
|----|------|
| 运行时 | plain async |
| 窗口 | `deriveMessages` 读时 fold |
| 默认 | loop **opt-in**；session preset 常用 `compaction: {}` |

未传 `compaction`（或 `false`）时，loop **不做** overflow 恢复。preset `{}`：开一次 overflow 重试；无 `maxRequestTokens` 则不主动按预算 compact。`/compact` 走 `compactNow`，不依赖 overflow 开关。

### Face `/compact`

无参数。busy / 摘要失败 → error；无可压缩历史 → success「No compactable history yet.」。成功文案含 shadowed 条数与估算 token；`command/done.sourceEventSeq` 指向写入的 `context/compaction`。

## Overflow 一次恢复

1. Provider 调用抛 `ContextOverflowError`
2. `runCompaction({ reason: "overflow" })`
3. 用新窗口重建请求，再 chat **恰好一次**
4. 再次溢出则原样抛出

## Token 估算

压缩与 Context meter 用到两套启发式（用途不同）：

| 用途 | API（`@xrkseek/core-session`） | 说明 |
|------|-------------------------------|------|
| 压缩预算、挑选 `recent` | `estimateTokens` · `estimateMessagesTokens` | 纯文本约按 chars/4 |
| Context meter、`shadowedTokenCount` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` | 计入消息块与 toolCalls 开销 |

Provider 上报的 usage 样本（`assistant/chunk` kind=`usage` / `assistant/message.usage`）见 `@xrkseek/protocol` 与 [protocol-events.md](./protocol-events.md) 的 TokenUsage 节。
