# Protocol events

Append-only session facts (`@xrkseek/protocol`). Model-visible history is reconstructed by `deriveMessages` — never a parallel mutable messages array.

## Event set

| `type` | Required fields (beyond `ts`) | Notes |
|--------|-------------------------------|--------|
| `turn/start` · `turn/end` | `turnId` | Turn bracket |
| `step/start` · `step/end` | `turnId`, `stepId` | Provider step |
| `user/message` | `turnId`, `content` | `content`: `string` **或** `ContentBlock[]`（text / image+`ImageAttachmentRef`）；可选 `rpcId` |
| `assistant/chunk` | `turnId`, `stepId`, `text` | Stream delta；可选 `kind`：`text`\|`reasoning`；可选 `index`（reasoning=0、text=1 当两者都出现） |
| `assistant/message` | `turnId`, `stepId`, `content` | Optional `toolCalls`；可选 `reasoning`（非 deriveMessages 可见） |
| `tool/call` | `turnId`, `stepId`, `call` | Before pipeline body |
| `tool/result` | `turnId`, `stepId`, `result` | Settled result；`result.meta` 可选（壳卡回放，不进 `deriveMessages`） |
| `prompt/admitted` | `admitId`, `content` | MessageContent（string \| blocks）；可选 `delivery`: steer\|queue |
| `prompt/promoted` | `admitId` | Consumed into a turn (not yet chat) |
| `prompt/withdrawn` | `admitId` | Inbox withdraw (edit/remove/steer rewrite) |
| `safety/notice` | `turnId`, `kind`, `content` | loop_soft/hard · mistake_limit · api_error |
| `context/compaction` | `reason`, `summary`, `recent` | Optional `turnId` |
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

## JSON Schema

`sessionEventJsonSchema` — hand-maintained `oneOf` by `type` (`$id`: `https://xrkseek.dev/schemas/session-event.json`).  
For OpenAPI / external validators. Runtime truth is `parseSessionEvent` (no Ajv dependency in-protocol).

`sessionEventJsonSchemaStub` → deprecated alias of the same object.

## Related

- [session.md](./session.md) · [session-delivery.md](./session-delivery.md) · [session-compaction.md](./session-compaction.md) · [session-safety.md](./session-safety.md)
- Package README: `packages/protocol/README.md`
