# @xrkseek/protocol

Stable DTOs for chat messages, tool calls, and append-only session events.

## Event set

`turn/*` · `step/*` · `user/message` · `assistant/chunk|message` · `tool/call|result` · `prompt/admitted|promoted`（`delivery?`: steer|queue）· `safety/notice` · `context/compaction`

See `docs/protocol-events.md`.

## Validation

| Export | Use |
|--------|-----|
| `parseSessionEvent` / `assertSessionEvent` | Strict I/O / JSONL import |
| `isValidSessionEvent` | Soft check |
| `isSessionEvent` | Loose (type + ts) |
| `sessionEventJsonSchema` | Export / OpenAPI (`oneOf`) |

`sessionEventJsonSchemaStub` is a deprecated alias of `sessionEventJsonSchema`.

## Non-goals

Runtime logic, persistence, LLM adapters.
