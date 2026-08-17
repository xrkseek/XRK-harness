# Module maps（实现笔记）

给维护者 / Coding Agent 的**文件级地图**：找 bug、改契约、加能力时先读这里，再改代码。

| 包 | 笔记 | 规格入口 |
|----|------|----------|
| `@xrkseek/server-face` | [server-face.md](./server-face.md) | [host-face.md](../host-face.md) |
| `@xrkseek/server-host` | [server-host.md](./server-host.md) | [host-preset.md](../host-preset.md) · [http-api.md](../http-api.md) |
| `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) | [plugin-loader.md](../plugin-loader.md) |
| `@xrkseek/server-config` | （薄：见 host 笔记 env 表） | [http-api.md](../http-api.md) |
| `@xrkseek/mcp` | [mcp.md](./mcp.md) | [policy.md](../policy.md) |

## 标准化定义（排错速查）

| 术语 | 定义 |
|------|------|
| Session 真源 | `SessionStore` 事件日志；模型输入可从事件重建 |
| Face | Host 对外 Unary RPC + mux/host WS；不拥有 agent loop |
| Wire 投影 | Face 把内部事件/队列译成壳协议（如 inbox spliced） |
| Process 插件 | `server-loader` 登记的 `RegisteredPlugin`（tools/prompt/…） |
| 显式优先 | registry / assembler 已有同名或保留 id → 插件 skip |
| `mcp.connect` | policy 门禁；默认 deny；允许后才可 `createMcpClient.connect` |
| soft 降级 | 返回空/null 成功形（如 pickDirectory），不是 NI |
| NI | `ok:false` + `error.code: not-implemented`（或专用码） |

改术语语义 → 同步本表 + 对应模块页。

## 怎么用

1. **改 RPC / wire** → Face 地图 + `host-face.md`；补测再改 status。  
2. **改插件 kind** → loader 地图 + `plugin-loader.md`；禁止 Host 特例绕过。  
3. **改 MCP** → mcp 地图；门禁永远走 `mcp.connect`。  
4. **排障** → 先看对应「不变量 / 常见坑」，再开文件。

公开学习收获：[learn.md](../learn.md)。能力三态：[status.md](../status.md)。
