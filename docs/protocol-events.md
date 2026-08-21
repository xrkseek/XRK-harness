# Protocol events

> **读者**：集成者 · 贡献者。

Append-only session facts（`@xrkseek/protocol`）。模型可见历史由 `deriveMessages` 从事件重建，没有并行的可变 messages 数组。

压缩换窗见 [session-compaction.md](./session-compaction.md)。

## Event set

| `type` | Required fields (beyond `ts`) | Notes |
|--------|-------------------------------|--------|
| `turn/start` · `turn/end` | `turnId` | Turn bracket；`turn/end.reason` 含 `completed` · `aborted` · `error` · `max-tokens` · `interrupted` · `blocked`。OpenAI `finish_reason: length` / Anthropic `stop_reason: max_tokens` → keep/drop 去截断 toolCalls → `{ kind: "max-tokens" }`（sticky）。`stop` 且无内容/推理/工具 → `EMPTY_RESPONSE`；未知 finish（如 `content_filter`）→ `ProviderFinishError`；非 max-tokens 的残缺 tool JSON → `IncompleteToolCallError`；三者均写 `turn/end` `{ kind: "error" }` 后抛出 |
| `step/start` · `step/end` | `turnId`, `stepId` | Provider step |
| `user/message` | `turnId`, `content` | `content`: `string` **或** `ContentBlock[]`（text / image+`ImageAttachmentRef`）；可选 `messageId`（Face 行 id；同 turn 多条 inject/人话必须唯一）；可选 `rpcId`；可选 `source`（DSH：`user` · `skill-catalog` · `agent-instructions` · `plugin`；非 `user` = 持久上下文注入，仍进 `deriveMessages`） |
| `assistant/chunk` | `turnId`, `stepId`, `text` | Stream delta；可选 `kind`：`text`\|`reasoning`\|`usage`\|`tool-call`；`usage` 时带 `usage`；`tool-call` 时带 `toolCallId` · 可选 `toolName` · `argumentsDelta`；可选 `index` |
| `assistant/message` | `turnId`, `stepId`, `content` | Optional `toolCalls`；可选 `reasoning`（`deriveMessages` 在有文本时回传，DSH rc.8 每轮 CoT）；可选 `interrupted`；可选 `usage`（`TokenUsage`；Face `sessionStats.decodeTokens` + `tokenUsage`） |
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
