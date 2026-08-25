# 协议事件

> **读者**：集成者 · 贡献者

Append-only session facts（`@xrkseek/protocol`）。模型可见历史由 `deriveMessages` 从事件重建，没有并行的可变 messages 数组。

压缩换窗见 [session-compaction.md](./session-compaction.md)。

## 事件集合

| `type` | 必填字段（除 `ts`） | 说明 |
|--------|-------------------------------|--------|
| `turn/start` · `turn/end` | `turnId` | Turn bracket；`turn/end.reason` 见下节「结束原因」。OpenAI `finish_reason: length` / Anthropic `stop_reason: max_tokens` → keep/drop 去截断 toolCalls → `{ kind: "max-tokens" }`（sticky）。`stop` 且无内容/推理/工具 → `EMPTY_RESPONSE`；未知 finish（如 `content_filter`）→ `ProviderFinishError`；非 max-tokens 的残缺 tool JSON → `IncompleteToolCallError`；三者均写 `turn/end` `{ kind: "error" }` 后抛出 |
| `step/start` · `step/end` | `turnId`, `stepId` | Provider step |
| `user/message` | `turnId`, `content` | `content`: `string` **或** `ContentBlock[]`（text / image+`ImageAttachmentRef`）；可选 `messageId`（Face 行 id；同 turn 多条 inject/人话必须唯一）；可选 `rpcId`；可选 `source`（`user` · `skill-catalog` · `agent-instructions` · `plugin`；非 `user` = 持久上下文注入，仍进 `deriveMessages`） |
| `assistant/chunk` | `turnId`, `stepId`, `text` | Stream delta；可选 `kind`：`text`\|`reasoning`\|`usage`\|`tool-call`；`usage` 时带 `usage`；`tool-call` 时带 `toolCallId` · 可选 `toolName` · `argumentsDelta`；可选 `index` |
| `assistant/message` | `turnId`, `stepId`, `content` | Optional `toolCalls`；可选 `reasoning`（`deriveMessages` 在有文本时回传）；可选 **`interrupted: true`**（流式取消固化前缀，**不是** `turn/end.reason`）；可选 `usage`（`TokenUsage`；Face `sessionStats.decodeTokens` + `tokenUsage`） |
| `request/header` | `turnId`, `reason`, `header.config` | 非模型可见；`provider`/`model`；可选 `reasoningEffort` · `contextWindow`；可选 `system` · `tools[]`（Face `contextBreakdown` / envelope 重价） |
| `llm/retry` · `llm/retry-started` | `turnId`, `stepId`, `retryId`, `retry`, … | 非模型可见；步内可重试失败后写 `llm/retry`（delay / failure.code），backoff 结束写 `llm/retry-started`；失败尝试的 stream chunk **不**落库 |
| `tool/call` | `turnId`, `stepId`, `call` | Before pipeline body |
| `tool/result` | `turnId`, `stepId`, `result` | Settled result；`result.content` = MessageContent（string \| ContentBlock[]，MCP 可准入 image ref）；`result.meta` 可选（壳卡回放，不进 `deriveMessages`） |
| `prompt/admitted` | `admitId`, `content` | MessageContent（string \| blocks）；可选 `delivery`: steer\|queue |
| `prompt/promoted` | `admitId` | Consumed into a turn (not yet chat) |
| `prompt/withdrawn` | `admitId` | Inbox withdraw (edit/remove/steer rewrite) |
| `safety/notice` | `turnId`, `kind`, `content` | loop_soft/hard · mistake_limit · api_error |
| `context/compaction` | `reason`, `summary`, `recent` | Optional `turnId` · `shadowedTokenCount`（Face meter 有符号缩小；缺省 delta 0） |
| `session/title` | `title`, `source` (`fallback`\|`user`) | **Log-only** — not in `deriveMessages`; Face projections |
| `approval/asked` | `approvalId`, `toolCallId`, `toolName`, `reason` | **Log-only** — tool policy `ask`；可选 `argsSummary` |
| `approval/decided` | `approvalId`, `decision` (`allow`\|`deny`), `source` | `user` · `cancel` · `timeout` |
| `command/run` | `commandId`, `name`, `source` (`user`) | **Log-only** — Face `commands/execute`；可选 `args` |
| `command/done` | `commandId`, `kind` (`success`\|`error`) | **Log-only** — 可选 `text` · `sourceEventSeq` |
| `todo/write` | `todos`（`content` + `status`） | **Log-only** — `todo_write` 工具；Face `todos` 投影；`turn/start` 清站立计划 |
| `permission/preset` | `preset` | **Log-only** — Face `permissions` 投影 · `/permission` |
| `sandbox/mode` | `mode`（read-only\|workspace-write\|danger-full-access） | **Log-only** — 与 preset 同捆 |
| `approval/policy` | `policy`（ask\|never） | **Log-only** — `never` 时审批自动放行 |
| `plan/mode` | `active` | **Log-only** — Face `plan` 投影 · `/plan`；last-wins，缺省 inactive |
| `feedback/record` | `text` | **Log-only** — `/feedback`；不进 `deriveMessages`；捕获壳无专用卡（wire `ignorable`） |

## 结束原因：`aborted` vs `interrupted`

两处「中断」含义不同，勿混用。

| 位置 | 形状 | 何时 | 谁写 |
|------|------|------|------|
| `assistant/message.interrupted` | `true` | 用户/宿主 **取消** 时，已流式到达的文本/推理/工具前缀固化进日志，使 `deriveMessages` 与用户所见一致 | `finalizeCancelledTurn`（`@xrkseek/core-agent-loop`） |
| `turn/end.reason` · `aborted` | `{ kind: "aborted", reason: AgentCancelCause }` | **实时取消**（Stop / 父会话 / hook / dispose / legacy） | 同上；`reason` 为 `user` · `parent` · `hook` · `disposed` · `legacy` |
| `turn/end.reason` · `interrupted` | `{ kind: "interrupted" }` | **仅崩溃恢复**：进程挂了留下未闭合 turn/step；加载时合成闭合 | `repairOpenTurnEvents`（`@xrkseek/core-session`） |

对照：活会话点 Stop → 消息可带 `interrupted: true`，turn 仍是 **`aborted`**；壳英文 UI 显示 `Stopped`（`message.stopped`）。冷启动修开洞 turn → turn 是 **`interrupted`**，没有 `AgentCancelCause`。产品壳验收：`product-shell-cancel.e2e.ts`。

其它 `turn/end.reason`：`completed` · `error` · `max-tokens` · `blocked`。`error` 的壳展示见 `displayFailureMessage`（AUTH 脱敏）与 `product-shell-error.e2e.ts`。工具悬挂结算见 [tool-settlement.md](./tool-settlement.md)。

## Runtime validation

| API | Behavior |
|-----|----------|
| `parseSessionEvent(unknown)` | Strict parse; throws `SessionEventParseError` |
| `assertSessionEvent` | Alias of parse |
| `isValidSessionEvent` | Soft boolean |
| `isSessionEvent` | **Loose** gate (known `type` + numeric `ts` only) |

`createMemorySessionStore().append` runs `assertSessionEvent` before freeze — bad shapes fail at the write boundary.

## TokenUsage

| Export | Behavior |
|--------|----------|
| `parseTokenUsage` · `tryParseOpenAiUsage` | Strict / soft provider sample decode |
| `providerUsageSample(event)` | From mid-stream `assistant/chunk` kind=`usage` or final `assistant/message.usage` → `{ usage, turnId, stepId }` |
| `usageFromSessionEvent(event)` | Same sample, usage only |
| `inputPressureTokens(usage)` | `input + cacheRead + cacheWrite`（for context pressure） |

Surface / compaction window pricing lives in `@xrkseek/core-session` — see [session-compaction.md](./session-compaction.md).

## JSON Schema

`sessionEventJsonSchema` — hand-maintained `oneOf` by `type` (`$id`: `https://xrkseek.dev/schemas/session-event.json`).  
For OpenAPI / external validators. Runtime truth is `parseSessionEvent` (no Ajv dependency in-protocol).

`sessionEventJsonSchemaStub` → deprecated alias of the same object.

## Related

- [session.md](./session.md) · [session-delivery.md](./session-delivery.md) · [session-compaction.md](./session-compaction.md) · [session-safety.md](./session-safety.md)
- Package README: `packages/protocol/README.md`

---

# Protocol Events

> **Audience**: Integrators · Contributors

Append-only session facts (`@xrkseek/protocol`). Model-visible history is rebuilt by `deriveMessages` from events; there is no parallel mutable messages array.

Window compaction: [session-compaction.md](./session-compaction.md).

## Event set

| `type` | Required fields (beyond `ts`) | Notes |
|--------|-------------------------------|--------|
| `turn/start` · `turn/end` | `turnId` | Turn bracket; `turn/end.reason` in “End reasons” below. OpenAI `finish_reason: length` / Anthropic `stop_reason: max_tokens` → keep/drop truncated toolCalls → `{ kind: "max-tokens" }` (sticky). `stop` with no content/reasoning/tools → `EMPTY_RESPONSE`; unknown finish (e.g. `content_filter`) → `ProviderFinishError`; incomplete tool JSON that is not max-tokens → `IncompleteToolCallError`; all three write `turn/end` `{ kind: "error" }` then throw |
| `step/start` · `step/end` | `turnId`, `stepId` | Provider step |
| `user/message` | `turnId`, `content` | `content`: `string` **or** `ContentBlock[]` (text / image+`ImageAttachmentRef`); optional `messageId` (Face row id; must be unique across inject/human lines in the same turn); optional `rpcId`; optional `source` (`user` · `skill-catalog` · `agent-instructions` · `plugin`; non-`user` = durable context inject, still in `deriveMessages`) |
| `assistant/chunk` | `turnId`, `stepId`, `text` | Stream delta; optional `kind`: `text`\|`reasoning`\|`usage`\|`tool-call`; `usage` carries `usage`; `tool-call` carries `toolCallId` · optional `toolName` · `argumentsDelta`; optional `index` |
| `assistant/message` | `turnId`, `stepId`, `content` | Optional `toolCalls`; optional `reasoning` (returned by `deriveMessages` when text is present); optional **`interrupted: true`** (stream cancel freezes the prefix — **not** `turn/end.reason`); optional `usage` (`TokenUsage`; Face `sessionStats.decodeTokens` + `tokenUsage`) |
| `request/header` | `turnId`, `reason`, `header.config` | Not model-visible; `provider`/`model`; optional `reasoningEffort` · `contextWindow`; optional `system` · `tools[]` (Face `contextBreakdown` / envelope reprice) |
| `llm/retry` · `llm/retry-started` | `turnId`, `stepId`, `retryId`, `retry`, … | Not model-visible; after a retriable in-step failure write `llm/retry` (delay / failure.code), then `llm/retry-started` when backoff ends; failed-attempt stream chunks are **not** persisted |
| `tool/call` | `turnId`, `stepId`, `call` | Before pipeline body |
| `tool/result` | `turnId`, `stepId`, `result` | Settled result; `result.content` = MessageContent (string \| ContentBlock[]; MCP may admit image refs); optional `result.meta` (shell card replay; not in `deriveMessages`) |
| `prompt/admitted` | `admitId`, `content` | MessageContent (string \| blocks); optional `delivery`: steer\|queue |
| `prompt/promoted` | `admitId` | Consumed into a turn (not yet chat) |
| `prompt/withdrawn` | `admitId` | Inbox withdraw (edit/remove/steer rewrite) |
| `safety/notice` | `turnId`, `kind`, `content` | loop_soft/hard · mistake_limit · api_error |
| `context/compaction` | `reason`, `summary`, `recent` | Optional `turnId` · `shadowedTokenCount` (Face meter signed shrink; default delta 0) |
| `session/title` | `title`, `source` (`fallback`\|`user`) | **Log-only** — not in `deriveMessages`; Face projections |
| `approval/asked` | `approvalId`, `toolCallId`, `toolName`, `reason` | **Log-only** — tool policy `ask`; optional `argsSummary` |
| `approval/decided` | `approvalId`, `decision` (`allow`\|`deny`), `source` | `user` · `cancel` · `timeout` |
| `command/run` | `commandId`, `name`, `source` (`user`) | **Log-only** — Face `commands/execute`; optional `args` |
| `command/done` | `commandId`, `kind` (`success`\|`error`) | **Log-only** — optional `text` · `sourceEventSeq` |
| `todo/write` | `todos` (`content` + `status`) | **Log-only** — `todo_write` tool; Face `todos` projection; `turn/start` clears standing plan |
| `permission/preset` | `preset` | **Log-only** — Face `permissions` projection · `/permission` |
| `sandbox/mode` | `mode` (read-only\|workspace-write\|danger-full-access) | **Log-only** — bundled with preset |
| `approval/policy` | `policy` (ask\|never) | **Log-only** — `never` auto-allows approvals |
| `plan/mode` | `active` | **Log-only** — Face `plan` projection · `/plan`; last-wins, default inactive |
| `feedback/record` | `text` | **Log-only** — `/feedback`; not in `deriveMessages`; capture shell has no dedicated card (wire `ignorable`) |

## End reasons: aborted vs interrupted

Two different “interrupt” surfaces — do not conflate them.

| Where | Shape | When | Writer |
|------|------|------|------|
| `assistant/message.interrupted` | `true` | On user/host **cancel**, freeze streamed text/reasoning/tool prefix into the log so `deriveMessages` matches what the user saw | `finalizeCancelledTurn` (`@xrkseek/core-agent-loop`) |
| `turn/end.reason` · `aborted` | `{ kind: "aborted", reason: AgentCancelCause }` | **Live cancel** (Stop / parent session / hook / dispose / legacy) | Same; `reason` is `user` · `parent` · `hook` · `disposed` · `legacy` |
| `turn/end.reason` · `interrupted` | `{ kind: "interrupted" }` | **Crash recovery only**: process died with an open turn/step; synthesize closure on load | `repairOpenTurnEvents` (`@xrkseek/core-session`) |

Live Stop: message may set `interrupted: true`; turn ends as **`aborted`**; English shell shows `Stopped` (`message.stopped`, after cancel flushes the llm-retry chunk buffer). Cold-start repair of an open turn: turn ends as **`interrupted`** with no `AgentCancelCause`. Product-shell gate: `product-shell-cancel.e2e.ts`.

Other `turn/end.reason` values: `completed` · `error` · `max-tokens` · `blocked`. Shell display for `error`: `displayFailureMessage` (AUTH redaction) and `product-shell-error.e2e.ts`. Dangling tool settlement: [tool-settlement.md](./tool-settlement.md).

## Runtime validation

| API | Behavior |
|-----|----------|
| `parseSessionEvent(unknown)` | Strict parse; throws `SessionEventParseError` |
| `assertSessionEvent` | Alias of parse |
| `isValidSessionEvent` | Soft boolean |
| `isSessionEvent` | **Loose** gate (known `type` + numeric `ts` only) |

`createMemorySessionStore().append` runs `assertSessionEvent` before freeze — bad shapes fail at the write boundary.

## TokenUsage

| Export | Behavior |
|--------|----------|
| `parseTokenUsage` · `tryParseOpenAiUsage` | Strict / soft provider sample decode |
| `providerUsageSample(event)` | From mid-stream `assistant/chunk` kind=`usage` or final `assistant/message.usage` → `{ usage, turnId, stepId }` |
| `usageFromSessionEvent(event)` | Same sample, usage only |
| `inputPressureTokens(usage)` | `input + cacheRead + cacheWrite` (for context pressure) |

Surface / compaction window pricing lives in `@xrkseek/core-session` — see [session-compaction.md](./session-compaction.md).

## JSON Schema

`sessionEventJsonSchema` — hand-maintained `oneOf` by `type` (`$id`: `https://xrkseek.dev/schemas/session-event.json`).  
For OpenAPI / external validators. Runtime truth is `parseSessionEvent` (no Ajv dependency in-protocol).

`sessionEventJsonSchemaStub` → deprecated alias of the same object.

## Related

- [session.md](./session.md) · [session-delivery.md](./session-delivery.md) · [session-compaction.md](./session-compaction.md) · [session-safety.md](./session-safety.md)
- Package README: `packages/protocol/README.md`
