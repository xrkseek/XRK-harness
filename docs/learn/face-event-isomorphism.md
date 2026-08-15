# Face event isomorphism（U1 夹具 · 自研）

> Host Face 把本仓 `@xrkseek/protocol` 事件投影到 mux/history。  
> **Durable log 永远是本仓事件**；`view` 由 Host 现算、可不重放。

| XRK `SessionEvent.type` | Wire 角色 | 备注 |
|-------------------------|-----------|------|
| `user/message` | user | 可选 `rpcId`（乐观对齐；不进 deriveMessages） |
| `assistant/chunk` | assistant.delta | |
| `assistant/message` | assistant.message | |
| `tool/call` | tool.call | 可选 `view: tool-call` |
| `tool/result` | tool.result | 可选 `view: tool-result` |
| `turn/*` · `step/*` | turn/step | |
| `prompt/admitted` | inbox.admitted | |
| `prompt/promoted` | inbox.promoted | |
| `prompt/withdrawn` | inbox.withdrawn | updateQueue remove/rewrite |
| `safety/notice` | safety | |
| `context/compaction` | compaction | |
| `session/title` | title | log-only 投影源 |
| `approval/asked` | approval.asked | log-only；mux + AppShell |
| `approval/decided` | approval.decided | log-only |

代码真源：`EVENT_ISOMORPHISM` · `presentToolView` · `toMuxSessionEvent`（`@xrkseek/server-face`）。
