# @xrkseek/protocol

Stable DTOs for chat messages, tool calls, and append-only session events.

## Event set

`turn/*` · `step/*` · `user/message` · `assistant/chunk|message` · `tool/call|result` · `prompt/admitted|promoted|withdrawn`（`delivery?`: steer|queue）· `safety/notice` · `context/compaction` · `session/title` · `approval/*` · `command/run|done` · `todo/write` · `permission/preset` · `sandbox/mode` · `approval/policy` · `plan/mode` · `feedback/record`

See `docs/protocol-events.md`.

## Validation

| Export | Use |
|--------|-----|
| `parseSessionEvent` / `assertSessionEvent` | Strict I/O / JSONL import |
| `isValidSessionEvent` | Soft check |
| `isSessionEvent` | Loose (type + ts) |
| `sessionEventJsonSchema` | Export / OpenAPI (`oneOf`) |

`sessionEventJsonSchemaStub` is a deprecated alias of `sessionEventJsonSchema`.

## TokenUsage

| Export | Use |
|--------|-----|
| `parseTokenUsage` / `tryParseOpenAiUsage` | Strict / soft decode of provider samples |
| `providerUsageSample` | Mid-stream usage chunk or final message usage (+ turn/step) |
| `usageFromSessionEvent` | Same sample without ids |
| `inputPressureTokens` | Input + cache buckets for context pressure |

See [docs/protocol-events.md](../../docs/protocol-events.md). Compaction / surface pricing: [docs/session-compaction.md](../../docs/session-compaction.md).

## Non-goals

Runtime logic, persistence, LLM adapters.
