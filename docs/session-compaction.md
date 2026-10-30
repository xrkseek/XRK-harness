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
// Soft / overflow from runTurn also pass turnId · stepId · retry
// (same llmRetry as the step provider call → llm/retry on SERVER etc.)

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

未传 `compaction`（或 `false`）时，loop **不做** overflow 恢复。preset `{}`：开一次 overflow 重试；无显式软预算时若路由有 `contextWindow`（≥8k）仍按 `floor(窗 × 90%)` 主动压（Codex）；无窗且无 SDK `maxRequestTokens` 才不主动按预算 compact。`/compact` 走 `compactNow`，不依赖 overflow 开关。

### Harness 默认软压缩与 tool-result prune

`presets/harness`（及 server）默认 `compaction: {}`（开 overflow + `/compact`）。**主动软压天花板**在 Settings → **Models** 每模型的 `softBudgetMaxTokens`（与 `contextWindow` 正交：窗可以更大；若软压/`maxRequestTokens` **高于** 路由 `contextWindow`，loop 会在步前把软压封顶到窗口，避免压到提供方拒识）。官方 DeepSeek 目录默认 300k。策略仍在 Face `agent-loop.compactionStrategy`：

```ts
// SDK / 测例仍可显式传预算；产品路径读当前路由的 softBudget*
compaction: {
  strategy: "prune-summary", // Face agent-loop.compactionStrategy
  // maxRequestTokens / keepTokens / bufferTokens — 可选覆盖
}
```

| `strategy` | 软压超预算（Provider overflow **另见下**） |
|------------|------------------------------------------|
| `prune-summary`（默认） | 先 model-free prune，再 LLM 摘要（可重试） |
| `prune-only` | 只 prune；仍超 / 仍溢出则 fail-closed（不调摘要） |
| `summary-only` | 跳过 prune，直接 LLM 摘要 |
| `off` | 关闭软压自动路径；**上游上下文溢出仍会**按 prune→summary 恢复一次（`/compact` 仍可用） |

`minimal` 仍 `{}`（仅 overflow，无主动软压；默认 `prune-summary`）。软压触发时按上表选阶段。Provider overflow：软压选 `off` 时仍强制一轮 prune→summary；其它策略与软压同族。剪枝用 Unicode **码点**（`thresholdChars=8192` · `head=4096` · `tail=1024`）；日志保留原文，`deriveMessages` 按 callId 取最新表面。


### Face `/compact`

无参数。busy / 摘要失败 → error；无可压缩历史 → success「No compactable history yet.」。成功文案含 shadowed 条数与估算 token；`command/done.sourceEventSeq` 指向写入的 `context/compaction`。

## Overflow 一次恢复

溢出恢复 **一轮**。软压策略为 `off` 时此处仍走 prune→summary；其它策略保留各自的 prune/summary 阶段：

1. Provider 抛 `ContextOverflowError`
2. 软压 `off` → 仍按 prune→summary 恢复一次（**不**立刻原样抛出）
3. 允许 prune 时：对超大 `tool/result` 做 model-free prune → 重建请求再 chat（仅当确有剪枝）
4. 仍溢出且允许 summary → `runCompaction({ reason: "overflow" })` 摘要换窗（摘要 LLM 与步内主调用共用 `llmRetry`；可重试失败写 `llm/retry`）→ 再 chat **恰好一次**
5. `prune-only` 且仍溢出 / 无可剪 → **保留原始** `ContextOverflowError`
6. 摘要重试耗尽 / 空结果 → **保留原始** `ContextOverflowError`（不掩盖成摘要错误）
7. 再次溢出 → 原样抛出（不再二次恢复）

仅 prune 就可能清除溢出，**不必**写入 `context/compaction`。

### Status 可观测（概况 · `/status`）

`session.status` / 斜杠 `/status` / Overview Status 栏同源暴露：

| 字段 | 含义 |
|------|------|
| `compaction.pipeline` | 最近一回合内的分阶：`none` · `prune` · `summary` · `prune→summary`（由已有 prune / compaction 时间线条目折算，**不**另写协议事件） |
| `compaction.stages` | 同上有序阶段列表 |
| `compaction.phase` | `idle` / `busy`（跟 `delivery.turnActive`；`/compact` 互斥看 `compactBlockedByTurn`） |
| `delivery.*` | `turnActive`（跟 Stop / 列表，cancel 立刻 false）· 队列/steer 计数 · `compactBlockedByTurn`（drain join 期间仍可 true）；忙时队列仍可 FIFO 入队，steer 需活跃 turn |

Standing plan（`todos` 投影）与换窗正交：`/compact` / `context/compaction` **不清** todo 列表；列表跨回合保留，直到下一次 `todo/write`。

## Soft budget（模型 `softBudgetMaxTokens`）

产品路径：Settings → **Models** → 模型行 `softBudgetMaxTokens`（可选 `softBudgetKeepTokens` / `softBudgetBufferTokens`）。与 `contextWindow`（meter 分母 / 路由容量）配合（Codex）：**留空软预算 = `floor(contextWindow × 90%)` 仍主动压**，不是「留空不压」。用户软预算更严（例如窗 256k、软 100k）时听用户；有提供方圆环时再把有效软上限 `min` 到窗的 90%，避免窗填错/软填过大撑到溢出才压。从「获取模型」新采纳且披露了窗：同样按 90% 填空白软预算；手填值不动。keep/buffer 未填时由 `resolveSoftBudgetTokens` 按软上限比例推导（贴近旧 24k/4k@100k）。策略 `off` 仍关软压路径（溢出恢复与 `/compact` 照旧）。

SDK 仍可在 `compaction.maxRequestTokens` 等字段显式覆盖。**Settings → Plugins → Agent 循环**另有：`compactionStrategy` · `softBudgetTriggerPercent`（默认 **90**，相对 softMax 预触发）· `compactRecentMaxTokens`（默认 **20000**，换窗 `recent` 上限）· `softBudgetPeelAttempts`（默认 **3**，标准 2 次摘要后 keep 减半再压）。

估价（进压缩前）= **max(本地 `estimateRequestTokens({ density: "soft-budget" })`，提供方 `projectedInputPressureTokens`)**。有 usage 时投影即上游占用；无 usage 时靠 CJK 更密的本地估价（ASCII 仍 chars/4）。**同一步内换窗成功后**软压改信本地估价，直到下一次 usage（提供方样本仍是换窗前的 prompt，shadow 缩不掉 tokenizer 差额时否则会误杀）。圆环投影仍**保留**压力样本 + `shadowedTokenCount` 缩 surface（对齐 DSH 展示）。

**圆环 vs 分项 vs 时间线**：圆环分子优先提供方 usage（**与上游一致的唯一路径**）。无 usage：有 `contextWindow` 时圆环回退本地分项（面板注明近似）。有提供方分子时**对话消息**补成 `圆环 − 系统 − 工具`；软上限再与窗的 90% 取更紧（Codex）。时间线本地重算**不驱动**软压。`/compact` = `manual`；软预算 / 窗推导 = `auto`；溢出 = `overflow`（`off` 仍强制一轮）。压完若窗/软明显不合理，请到 Settings → Models 核对上下文窗口与软预算。

天花板 = `resolveSoftBudgetCeiling(softMax, buffer)`（buffer ≥ max 时忽略 buffer，避免非正 ceiling 误杀）。达到 `softBudgetTriggerPercent`（相对 softMax）时开始 prune/摘要；若 softMax 已是窗的 90%（留空推导或圆环强制线），不再二次乘该百分比，以免压到约 81% 窗。超天花板时按策略压到不超过天花板（`prune-summary` 先 prune，再最多 **2 + peel** 次 `runCompaction({ reason: "auto" })`，peel 阶段 keep 减半）；**仍超则 fail-closed**（抛 `ContextOverflowError`，不再出站）。  
工具正文在进日志前按 spill 策略截断：超 **64KiB**（Face `agent-loop.toolResultMaxInlineBytes` 可调；`0` 关闭）全文只写一份到 `~/.xrk/spill/tool-outputs/`，模型只见 head/tail + 路径；`bash.maxOutputBytes` 默认同为 64KiB。spill / 策略在 **Settings → Plugins**；软上限在 **Models**。`minimal` 预设默认仅 overflow（无主动软压）。

## Token 估算

| 用途 | API（`@xrkseek/core-session`） | 说明 |
|------|-------------------------------|------|
| 压缩预算、挑选 `recent`、软预算 | `estimateTokens` · `estimateMessagesTokens` · `estimateRequestTokens` · `projectedInputPressureTokens` · `resolveSoftBudgetTokens` · `resolveSoftBudgetCeiling` | 软预算取本地估价与提供方投影压力的较大值；纯文本约 chars/4；含 reasoning / 非文本块 |
| Context meter、`shadowedTokenCount` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` · `projectedInputPressureTokens` | meter 分子与软预算共用提供方投影；压缩事件用 `shadowedTokenCount` 做有符号缩小（缺省不缩小） |

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
// Soft / overflow from runTurn also pass turnId · stepId · retry
// (same llmRetry as the step provider call → llm/retry on SERVER etc.)

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

Without `compaction` (or with `false`), the loop does **not** recover from overflow. Preset `{}` enables one overflow retry; with no explicit soft budget, a route `contextWindow` (≥8k) still seeds proactive compact at `floor(window × 90%)` (Codex); only missing both a window and SDK `maxRequestTokens` skips budget compact. `/compact` uses `compactNow` and does not depend on the overflow switch.

### Soft compact & tool-result prune (Harness defaults)

`presets/harness` (and server) default `compaction: {}` (overflow + `/compact`). The **proactive soft ceiling** is per-model `softBudgetMaxTokens` under Settings → **Models** (orthogonal to `contextWindow`: the window may be larger; if soft/`maxRequestTokens` **exceeds** the route `contextWindow`, the loop caps soft to the window before the step so pressure cannot climb past the provider limit). Official DeepSeek catalog defaults to 300k. Strategy stays on Face `agent-loop.compactionStrategy`:

```ts
// SDK / tests may still pass an explicit budget; product path reads route softBudget*
compaction: {
  strategy: "prune-summary", // Face agent-loop.compactionStrategy
  // maxRequestTokens / keepTokens / bufferTokens — optional overrides
}
```

| `strategy` | Soft budget (provider overflow **below**) |
|------------|------------------------------------------------|
| `prune-summary` (default) | Model-free prune, then LLM summary (retryable) |
| `prune-only` | Prune only; still over / still overflowing → fail-closed (no summary) |
| `summary-only` | Skip prune; LLM summary only |
| `off` | Disable soft-budget auto path; **provider context overflow still** recovers once via prune→summary (`/compact` still works) |

`minimal` stays `{}` (overflow only; no proactive soft pressure; default `prune-summary`). Soft pressure uses the table above; provider overflow always gets one prune→summary pass even when soft strategy is `off`. Thresholds use Unicode **code points** (`thresholdChars=8192` · `head=4096` · `tail=1024`); the log keeps originals; `deriveMessages` takes the latest surface per callId.

### Face `/compact`

No arguments. Busy / summarize failure → error; nothing compactable → success “No compactable history yet.”. Success copy includes shadowed count and estimated tokens; `command/done.sourceEventSeq` points at the written `context/compaction`.

## One-shot overflow recovery

Overflow recovery is **one** recovery pass. Soft strategy `off` still uses prune→summary here; other soft strategies keep their prune/summary stages:

1. Provider throws `ContextOverflowError`
2. Soft `off` → recover with prune→summary once (does **not** rethrow immediately)
3. When prune is allowed: model-free prune oversized `tool/result` → rebuild request and chat again (only when something was pruned)
4. Still overflowing and summary allowed → `runCompaction({ reason: "overflow" })` to summarize/window (summarizer LLM shares step `llmRetry`; retriable failures append `llm/retry`) → chat **exactly once** more
5. `prune-only` still overflowing / nothing to prune → **keep the original** `ContextOverflowError`
6. Summarizer retries exhausted / empty result → **keep the original** `ContextOverflowError` (do not mask it as a summarize error)
7. Overflow again → rethrow as-is (no second recovery)

Prune alone may clear overflow with **no** `context/compaction` event.

### Status observability (Overview · `/status`)

`session.status`, slash `/status`, and the Overview Status column share:

| Field | Meaning |
|------|------|
| `compaction.pipeline` | Last-turn stage chain: `none` · `prune` · `summary` · `prune→summary` (folded from existing prune / compaction timeline rows — **no** extra protocol events) |
| `compaction.stages` | Ordered stages for that pipeline |
| `compaction.phase` | `idle` / `busy` (follows `delivery.turnActive`; `/compact` exclusion is `compactBlockedByTurn`) |
| `delivery.*` | `turnActive` (follows Stop / the session list; false immediately on cancel) · queue/steer counts · `compactBlockedByTurn` (may stay true during drain join); queue still FIFO-accepts while busy; steer needs an active turn |

Standing plan (`todos` projection) is orthogonal to windowing: `/compact` / `context/compaction` do **not** clear the todo list; the list persists across turns until the next `todo/write`.

## Soft budget (model `softBudgetMaxTokens`)

Product path: Settings → **Models** → per-model `softBudgetMaxTokens` (optional `softBudgetKeepTokens` / `softBudgetBufferTokens`). Codex posture with `contextWindow`: **blank soft budget = `floor(contextWindow × 90%)` and still proactive** — blank does not disable compact. A stricter user soft (e.g. 100k soft vs 256k window) wins; with a provider ring the effective soft is also `min`’d to 90% of the window so a wrong/huge soft cannot delay compact until overflow. **Fetch models** fills blank soft the same 90% way; hand-tuned values stay. Omitted keep/buffer still derive from soft max (~24k/4k @ 100k). Strategy `off` still disables the soft path (overflow + `/compact` unchanged).

SDK callers may still override via `compaction.maxRequestTokens` etc. **Settings → Plugins → Agent loop** also exposes: `compactionStrategy` · `softBudgetTriggerPercent` (default **90**, pre-trigger vs softMax) · `compactRecentMaxTokens` (default **20000**, post-compact `recent` cap) · `softBudgetPeelAttempts` (default **3**, keep-halving after the standard two summaries).

Price (before compact) = **max(local `estimateRequestTokens({ density: "soft-budget" })`, provider `projectedInputPressureTokens`)**. With usage, projection *is* upstream occupancy; without usage, denser CJK local pricing (ASCII still chars/4). **After a successful swap in the same step**, soft-budget trusts local estimate until the next usage (the provider sample is still the pre-window prompt; otherwise an unshrinkable tokenizer gap fail-closes). The ring projection still **keeps** the pressure sample and shrinks via `shadowedTokenCount` (DSH display).

**Ring vs rows vs timeline**: ring numerator prefers provider usage (**only path that matches upstream**). No usage: with `contextWindow`, ring falls back to heuristic rows (panel marks approximate). With a provider numerator, **messages** fill `ring − system − tools`; effective soft is also `min`’d to 90% of the window (Codex). Timeline does **not** drive soft-budget. `/compact` → `manual`; soft / window-derive → `auto`; overflow → `overflow` (`off` still one forced pass). After compact, check Settings → Models if the window or soft budget looks wrong.

Ceiling = `resolveSoftBudgetCeiling(softMax, buffer)` (buffer ≥ max is ignored so a non-positive ceiling cannot fail-closed every turn). Auto-compact starts at `softBudgetTriggerPercent` of softMax; when softMax is already 90% of the window (blank-derived or ring force), that percent is **not** applied again (avoids ~81% of window). Over ceiling, stages follow strategy (`prune-summary` prunes then up to **2 + peel** `runCompaction({ reason: "auto" })`, peeling halves keep); **still over → fail-closed** (`ContextOverflowError`, no outbound call).  
Tool bodies are bounded **before** they enter the log (one spill policy): over **64KiB** (Face `agent-loop.toolResultMaxInlineBytes`; `0` disables) writes the full body once under `~/.xrk/spill/tool-outputs/` with a head/tail preview + path; `bash.maxOutputBytes` defaults to 64KiB too. Spill / strategy under **Settings → Plugins**; soft ceiling under **Models**. The `minimal` preset stays overflow-only.

## Token estimates

| Use | API (`@xrkseek/core-session`) | Notes |
|------|-------------------------------|------|
| Compaction budget, picking `recent`, soft budget | `estimateTokens` · `estimateMessagesTokens` · `estimateRequestTokens` · `projectedInputPressureTokens` · `resolveSoftBudgetTokens` · `resolveSoftBudgetCeiling` | Soft budget takes the larger of local estimate and provider projected pressure; plain text ≈ chars/4; includes reasoning / non-text blocks |
| Context meter, `shadowedTokenCount` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` · `projectedInputPressureTokens` | Meter numerator shares provider projection with soft budget; compaction uses `shadowedTokenCount` for a signed shrink (absent → no shrink) |

Log positions / read surface: [session-log.md](./session-log.md).

Provider-reported usage samples: `@xrkseek/protocol` and the TokenUsage section of [protocol-events.md](./protocol-events.md).
