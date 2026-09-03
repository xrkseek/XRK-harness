# Session 压缩

> **读者**：集成者 · 贡献者（配置压缩 / 理解 meter；终端用户可用壳内 `/compact`）

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
| `shadowedTokenCount` | 可选。压缩前当前窗口的 surface 估算量；有则 Context meter 按「摘要价 − 该值」缩小显示；缺省则不缩小 |

## 模型可见历史

`deriveMessages`：

1. 找到最新 `context/compaction`
2. 投影为一条 `user` 消息（`summary` + `recent`）
3. 再 fold 该事件**之后**的对话事件

全量读取用 `deriveMessagesUnwindowed`（摘要器、调试）。

## 怎么开

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

| 项 | 本仓 |
|----|------|
| 运行时 | plain async |
| 窗口 | `deriveMessages` 读时 fold |
| 默认 | loop **opt-in**；session preset 常用 `compaction: {}` |

未传 `compaction`（或 `false`）时，loop **不做** overflow 恢复。preset `{}`：开一次 overflow 重试；无 `maxRequestTokens` 则不主动按预算 compact。`/compact` 走 `compactNow`，不依赖 overflow 开关。

### Harness 默认软压缩与 tool-result prune

`presets/harness`（及 server）默认：

```ts
compaction: {
  maxRequestTokens: 100_000,
  keepTokens: 24_000,
  bufferTokens: 4_000,
}
```

`minimal` 仍 `{}`（仅 overflow，无主动软压）。软压触发时：先 **model-free prune**，重测后仍超预算才摘要。Provider overflow：先 prune 再重试一次，仍溢出才 `runCompaction`。阈值用 Unicode **码点**（`thresholdChars=8192` · `head=4096` · `tail=1024`）；日志保留原文，`deriveMessages` 按 callId 取最新表面。

### Face `/compact`

无参数。busy / 摘要失败 → error；无可压缩历史 → success「No compactable history yet.」。成功文案含 shadowed 条数与估算 token；`command/done.sourceEventSeq` 指向写入的 `context/compaction`。

## Overflow 一次恢复

溢出恢复采用 **prune-first、一轮恢复**：

1. Provider 抛 `ContextOverflowError`
2. **Model-free prune** 超大 `tool/result`（若有）→ 重建请求再 chat
3. 仍溢出 → `runCompaction({ reason: "overflow" })` 摘要换窗 → 再 chat **恰好一次**
4. 摘要失败或空结果 → **保留原始** `ContextOverflowError`（不掩盖成摘要错误）
5. 再次溢出 → 原样抛出（不再二次恢复）

仅 prune 就可能清除溢出，**不必**写入 `context/compaction`。

Standing plan（`todos` 投影）与换窗正交：`/compact` / `context/compaction` **不清** todo 列表；仅下一轮 `turn/start` 清空。

## Soft budget（`maxRequestTokens`）

Harness 默认（`presets/harness`）：`maxRequestTokens: 100_000` · `keepTokens: 24_000` · `bufferTokens: 4_000`。  
估价 = **消息面 + 站立 tool schemas**（`estimateRequestTokens`）。超 `maxRequestTokens − buffer` 时：先 prune，仍超则 `runCompaction({ reason: "auto" })`；**仍超则 fail-closed**（抛 `ContextOverflowError`，不再出站）。  
工具正文在进日志前按 spill 策略截断：超 **64KiB**（Face `agent-loop.toolResultMaxInlineBytes` 可调；`0` 关闭）落盘到 `~/.xrk/spill/`，模型只见 head/tail + 路径；`bash.maxOutputBytes` 默认同为 64KiB。上述预算与 spill 均可在 **Settings → Plugins** 调整。`minimal` 预设默认仅 overflow（无主动软压）。

## Token 估算

| 用途 | API（`@xrkseek/core-session`） | 说明 |
|------|-------------------------------|------|
| 压缩预算、挑选 `recent` | `estimateTokens` · `estimateMessagesTokens` | 纯文本约按 chars/4 |
| Context meter、`shadowedTokenCount` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` | 计入消息块与 toolCalls；压缩事件用 `shadowedTokenCount` 做有符号缩小（缺省不缩小） |

日志位置与读面见 [session-log.md](./session-log.md)。

Provider 上报的 usage 样本见 `@xrkseek/protocol` 与 [protocol-events.md](./protocol-events.md) 的 TokenUsage 节。

---

# Session Compaction

> **Audience**: Integrators · Contributors (configure compaction / understand meter; end users may use in-shell `/compact`)

In long sessions, model-visible context must **window**, not rewrite or delete the historical log.

This product appends a `context/compaction` event on the append-only stream; afterward `deriveMessages` rebuilds only from the **latest** compaction point. Older events remain in the store for audit and full-history summarizers.

Full event set: [protocol-events.md](./protocol-events.md). Session overview: [session.md](./session.md).

## Event fields

`context/compaction`:

| Field | Meaning |
|------|------|
| `reason` | `auto` (budget) · `overflow` (context-overflow recovery) · `manual` (`/compact`) |
| `summary` | Anchored summary (fixed Markdown skeleton) |
| `recent` | Tail text not folded into the summary |
| `shadowedTokenCount` | Optional. Surface estimate of the window before compaction; when present, Context meter shrinks by “summary price − this value”; absent → no shrink |

## Model-visible history

`deriveMessages`:

1. Find the latest `context/compaction`
2. Project as one `user` message (`summary` + `recent`)
3. Then fold dialogue events **after** that event

Full-history reads use `deriveMessagesUnwindowed` (summarizers, debugging).

## How to enable

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

| Item | This product |
|----|------|
| Runtime | plain async |
| Window | `deriveMessages` fold at read time |
| Default | loop **opt-in**; session presets often use `compaction: {}` |

Without `compaction` (or with `false`), the loop does **not** recover from overflow. Preset `{}` enables one overflow retry; without `maxRequestTokens` there is no proactive budget compact. `/compact` uses `compactNow` and does not depend on the overflow switch.

### Soft compact & tool-result prune (Harness defaults)

`presets/harness` (and server) default:

```ts
compaction: {
  maxRequestTokens: 100_000,
  keepTokens: 24_000,
  bufferTokens: 4_000,
}
```

`minimal` stays `{}` (overflow only; no proactive soft pressure). On soft pressure: **model-free prune** first, then summarize if still over budget. On provider overflow: prune, retry once, then `runCompaction`. Thresholds use Unicode **code points** (`thresholdChars=8192` · `head=4096` · `tail=1024`); the log keeps originals; `deriveMessages` takes the latest surface per callId.

### Face `/compact`

No arguments. Busy / summarize failure → error; nothing compactable → success “No compactable history yet.”. Success copy includes shadowed count and estimated tokens; `command/done.sourceEventSeq` points at the written `context/compaction`.

## One-shot overflow recovery

Overflow recovery is **prune-first, one recovery pass**:

1. Provider throws `ContextOverflowError`
2. **Model-free prune** oversized `tool/result` (if any) → rebuild the request and chat again
3. Still overflowing → `runCompaction({ reason: "overflow" })` to summarize/window → chat **exactly once** more
4. Summarize failure or empty result → **keep the original** `ContextOverflowError` (do not mask it as a summarize error)
5. Overflow again → rethrow as-is (no second recovery)

Prune alone may clear overflow with **no** `context/compaction` event.

Standing plan (`todos` projection) is orthogonal to windowing: `/compact` / `context/compaction` do **not** clear the todo list; only the next `turn/start` does.

## Soft budget (`maxRequestTokens`)

Harness defaults (`presets/harness`): `maxRequestTokens: 100_000` · `keepTokens: 24_000` · `bufferTokens: 4_000`.  
Price = **messages + standing tool schemas** (`estimateRequestTokens`). Over `maxRequestTokens − buffer`: prune first, then `runCompaction({ reason: "auto" })`; **still over → fail-closed** (`ContextOverflowError`, no outbound call).  
Tool bodies are bounded **before** they enter the log (spill policy): over **64KiB** (Face `agent-loop.toolResultMaxInlineBytes`; `0` disables) spills to `~/.xrk/spill/` with a head/tail preview + path; `bash.maxOutputBytes` defaults to 64KiB too. Soft budget and spill are adjustable under **Settings → Plugins**. The `minimal` preset stays overflow-only.

## Token estimates

| Use | API (`@xrkseek/core-session`) | Notes |
|------|-------------------------------|------|
| Compaction budget, picking `recent` | `estimateTokens` · `estimateMessagesTokens` | Plain text ≈ chars/4 |
| Context meter, `shadowedTokenCount` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` | Includes message blocks and toolCalls; compaction uses `shadowedTokenCount` for a signed shrink (absent → no shrink) |

Log positions / read surface: [session-log.md](./session-log.md).

Provider-reported usage samples: `@xrkseek/protocol` and the TokenUsage section of [protocol-events.md](./protocol-events.md).
