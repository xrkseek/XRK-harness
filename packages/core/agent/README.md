# @xrkseek/core-agent

Thin `AgentHandle` over `@xrkseek/core-agent-loop`:

- **`continueTurn`** — same-session turn（text 或 promote pending admit）
- **`admit`** — admit-only
- **`run(text)`** — 兼容别名
- TurnLatch：busy → `SessionBusyError`

See [docs/session-api.md](../../../docs/session-api.md).
