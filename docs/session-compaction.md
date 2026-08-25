# Session 压缩 / Session Compaction

> **读者 / Audience**：集成者 · 贡献者（配置压缩 / 理解 meter；终端用户可用壳内 `/compact`） / Integrators · Contributors (configure compaction / understand meter; end users may use in-shell `/compact`)

长会话里，模型可见上下文需要**换窗**，而不是改写或删除历史日志。

In long sessions, model-visible context must **window**, not rewrite or delete the historical log.

本仓做法：在 append-only 事件流上追加一条 `context/compaction`，之后 `deriveMessages` 只从**最新**压缩点往后重建；旧事件仍留在 store，可供审计与摘要器全量读取。

This repository appends a `context/compaction` event on the append-only stream; afterward `deriveMessages` rebuilds only from the **latest** compaction point. Older events remain in the store for audit and full-history summarizers.

相关事件全集见 [protocol-events.md](./protocol-events.md)；Session 总览见 [session.md](./session.md)。

## 事件字段 / Event fields

`context/compaction`：

| 字段 / Field | 含义 / Meaning |
|------|------|
| `reason` | `auto`（预算触发）· `overflow`（上下文溢出恢复）· `manual`（`/compact`） |
| `summary` | 锚定摘要（固定 Markdown 骨架） / Anchored summary |
| `recent` | 未并入摘要的尾部原文 / Tail text not folded into the summary |
| `shadowedTokenCount` | 可选。压缩前当前窗口的 surface 估算量；有则 Context meter 按「摘要价 − 该值」缩小显示；缺省则不缩小 |

## 模型可见历史 / Model-visible history

`deriveMessages`：

1. 找到最新 `context/compaction` / Find the latest `context/compaction`
2. 投影为一条 `user` 消息（`summary` + `recent`） / Project as one `user` message
3. 再 fold 该事件**之后**的对话事件 / Then fold dialogue events **after** that event

全量读取用 `deriveMessagesUnwindowed`（摘要器、调试）。 / Full-history reads use `deriveMessagesUnwindowed`.

## 怎么开 / How to enable

```ts
// Pure helpers (@xrkseek/core-session)
prepareCompactionPayload(events, keepTokens)
selectHeadRecent(messages, keepTokens)

// Write the log (@xrkseek/core-agent-loop)
runCompaction({ store, sessionId, llm, reason })

runTurn({
  compaction: {
    maxRequestTokens: 32_000, // optional: proactive compact over budget
    keepTokens: 8_000,
    bufferTokens: 2_000,
  },
})

createAgent({ compaction: {} }).compactNow() // Face `/compact`: idle · reason manual
```

| 项 / Item | 本仓 / This repo |
|----|------|
| 运行时 / Runtime | plain async |
| 窗口 / Window | `deriveMessages` 读时 fold / fold at read time |
| 默认 / Default | loop **opt-in**；session preset 常用 `compaction: {}` |

未传 `compaction`（或 `false`）时，loop **不做** overflow 恢复。preset `{}`：开一次 overflow 重试；无 `maxRequestTokens` 则不主动按预算 compact。`/compact` 走 `compactNow`，不依赖 overflow 开关。

Without `compaction` (or with `false`), the loop does **not** recover from overflow. Preset `{}` enables one overflow retry; without `maxRequestTokens` there is no proactive budget compact. `/compact` uses `compactNow` and does not depend on the overflow switch.

### Harness 默认软压缩与 tool-result prune / Soft compact & prune

`presets/harness`（及 server）默认：

```ts
compaction: {
  maxRequestTokens: 100_000,
  keepTokens: 24_000,
  bufferTokens: 4_000,
}
```

`minimal` 仍 `{}`（仅 overflow，无主动软压）。软压触发时：先 **model-free prune**，重测后仍超预算才摘要。Provider overflow：先 prune 再重试一次，仍溢出才 `runCompaction`。阈值用 Unicode **码点**（`thresholdChars=8192` · `head=4096` · `tail=1024`）；日志保留原文，`deriveMessages` 按 callId 取最新表面。

`minimal` stays `{}` (overflow only). On soft pressure: **model-free prune** first, then summarize if still over budget. On provider overflow: prune, retry once, then `runCompaction`. Thresholds use Unicode **code points**; the log keeps originals; `deriveMessages` takes the latest surface per callId.

### Face `/compact`

无参数。busy / 摘要失败 → error；无可压缩历史 → success「No compactable history yet.」。成功文案含 shadowed 条数与估算 token；`command/done.sourceEventSeq` 指向写入的 `context/compaction`。

No arguments. Busy / summarize failure → error; nothing compactable → success message above. Success copy includes shadowed count and estimated tokens; `command/done.sourceEventSeq` points at the written `context/compaction`.

## Overflow 一次恢复 / One-shot overflow recovery

对齐 DSH compaction-basic（prune-first，一轮恢复）：

Aligned with DSH compaction-basic (prune-first, one recovery):

1. Provider 抛 `ContextOverflowError`
2. **Model-free prune** 超大 `tool/result`（若有）→ 重建请求再 chat
3. 仍溢出 → `runCompaction({ reason: "overflow" })` 摘要换窗 → 再 chat **恰好一次**
4. 摘要失败或空结果 → **保留原始** `ContextOverflowError`（不掩盖成摘要错误）
5. 再次溢出 → 原样抛出（不再二次恢复）

Prune alone may clear overflow with **no** `context/compaction` event.

Standing plan（`todos` 投影）与换窗正交：`/compact` / `context/compaction` **不清** todo 列表；仅下一轮 `turn/start` 清空。

Standing plan (`todos` projection) is orthogonal to windowing: `/compact` / `context/compaction` do **not** clear the todo list; only the next `turn/start` does.

## Soft budget（`maxRequestTokens`）

Harness 默认（`presets/harness`）：`maxRequestTokens: 100_000` · `keepTokens: 24_000` · `bufferTokens: 4_000`。  
超 `maxRequestTokens − buffer` 时：先 prune，仍超则 `runCompaction({ reason: "auto" })`。`minimal` 预设默认仅 overflow（无主动软压）。

Harness defaults (`presets/harness`): soft ceiling at `maxRequestTokens − buffer`, prune-first, then `runCompaction({ reason: "auto" })`. The `minimal` preset stays overflow-only (no proactive soft budget).

## Token 估算 / Token estimates

| 用途 / Use | API（`@xrkseek/core-session`） | 说明 / Notes |
|------|-------------------------------|------|
| 压缩预算、挑选 `recent` | `estimateTokens` · `estimateMessagesTokens` | 纯文本约按 chars/4 |
| Context meter、`shadowedTokenCount` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` | 计入消息块与 toolCalls 开销 |

Provider 上报的 usage 样本见 `@xrkseek/protocol` 与 [protocol-events.md](./protocol-events.md) 的 TokenUsage 节。
