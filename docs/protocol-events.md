# Protocol events

Append-only session facts (`@xrkseek/protocol`). Model-visible history is reconstructed by `deriveMessages` — never a parallel mutable messages array.

## Event set

| `type` | Required fields (beyond `ts`) | Notes |
|--------|-------------------------------|--------|
| `turn/start` · `turn/end` | `turnId` | Turn bracket |
| `step/start` · `step/end` | `turnId`, `stepId` | Provider step |
| `user/message` | `turnId`, `content` | `content`: `string` **或** `ContentBlock[]`（text / image+`ImageAttachmentRef`）；可选 `rpcId` |
| `prompt/admitted` | `admitId`, `content` | 同上 MessageContent；可选 `delivery` |
| `assistant/chunk` | `turnId`, `stepId`, `text` | Stream delta |
| `assistant/message` | `turnId`, `stepId`, `content` | Optional `toolCalls` |
| `tool/call` | `turnId`, `stepId`, `call` | Before pipeline body |
| `tool/result` | `turnId`, `stepId`, `result` | Settled result |
| `prompt/admitted` | `admitId`, `content` | Optional `delivery`: steer\|queue |
| `prompt/promoted` | `admitId` | Consumed into a turn (not yet chat) |
| `prompt/withdrawn` | `admitId` | Inbox withdraw (edit/remove/steer rewrite) |
| `safety/notice` | `turnId`, `kind`, `content` | loop_soft/hard · mistake_limit · api_error |
| `context/compaction` | `reason`, `summary`, `recent` | Optional `turnId` |
| `session/title` | `title`, `source` (`fallback`\|`user`) | **Log-only** — not in `deriveMessages`; Face projections |
| `approval/asked` | `approvalId`, `toolCallId`, `toolName`, `reason` | **Log-only** — tool policy `ask`；可选 `argsSummary` |
| `approval/decided` | `approvalId`, `decision` (`allow`\|`deny`), `source` | `user` · `cancel` · `timeout` |
| `approval/asked` | `approvalId`, `toolCallId`, `toolName`, `reason` | **Log-only** — policy/pipeline ask; optional `argsSummary` |
| `approval/decided` | `approvalId`, `decision` (`allow`\|`deny`), `source` | **Log-only** — `user` · `cancel` · `timeout` |

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
