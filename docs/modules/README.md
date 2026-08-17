# Module maps

| 包 | 笔记 | 规格 |
|----|------|------|
| `@xrkseek/server-face` | [server-face.md](./server-face.md) | [host-face.md](../host-face.md) |
| `@xrkseek/server-host` | [server-host.md](./server-host.md) | [host-preset.md](../host-preset.md) · [http-api.md](../http-api.md) |
| `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) | [plugin-loader.md](../plugin-loader.md) |
| `@xrkseek/server-config` | （env 见 host 笔记） | [http-api.md](../http-api.md) |
| `@xrkseek/mcp` | [mcp.md](./mcp.md) | [policy.md](../policy.md) |
| `@xrkseek/attachment` | [attachment.md](./attachment.md) | [protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) |

| 术语 | 含义（本仓） |
|------|----------------|
| Session 真源 | `SessionStore` 事件日志 |
| Face | Unary RPC + mux/host WS |
| Wire 投影 | 内部事件 → 壳协议 |
| Process 插件 | `server-loader` 的 `RegisteredPlugin` |
| soft 降级 | 空/null 成功形，不是 NI |
| NI | `ok:false` + `error.code: not-implemented`（或专用码） |
