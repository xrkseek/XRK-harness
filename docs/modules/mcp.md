# Module: `@xrkseek/mcp`

MCP **client**（stdio + streamable-http）。规格门禁：[policy.md](../policy.md)。包 README：[packages/mcp/README.md](../../packages/mcp/README.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 连 MCP server · list/call tools | 不做 MCP server（本仓角色） |
| 命名 `mcp__<server>__<raw>` | 不静默覆盖 ToolRegistry 同名 |
| `connect` 前 `assertPolicyAllow(mcp.connect)` | 默认 deny；不假装已产品化 Host UI |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | 进程级自动重连 · 浏览器 MCP 设置壳硬刷 |
| `onToolsListChanged` / `registerMcpTools` 默认 watch | `notifications/tools/list_changed` 热同步；拉表失败保留上一代 |

`McpHttpOptions.reconnectionOptions` 原样传给 SDK（SSE 流恢复）。Host HTTP MCP 默认 `maxRetries: 2`。这不是进程 supervisor。Host `loadMcpToolPlugins` 在 list_changed 后就地更新 `plugin.tools` 并 `invalidateAll` agent 缓存。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 导出面 | |
| `types.ts` | `McpClient` · `McpStdioOptions` · `McpHttpOptions` · 结果形 | |
| `names.ts` | `publicToolName` · `parsePublicToolName` · `assertServerName` | serverName ∈ `[A-Za-z0-9_-]{1,32}`；raw 禁 `__` |
| `client.ts` | `createMcpClient` | 先 policy；connect 单飞 / 失败关 transport；`onToolsListChanged` 串行 |
| `register.ts` | `registerMcpTools` · `mcpToolDefinition` | 显式同名 → skip；默认 watch；dispose 后不落半代 |

## 标准用法

```ts
const client = createMcpClient({
  serverName: "fs",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  policy, // 须 allow mcp.connect
});
await client.connect();
const wired = await registerMcpTools(registry, client);
// …
wired.dispose();
await client.dispose();
```

HTTP：

```ts
createMcpClient({
  transport: "http",
  serverName: "remote",
  url: "https://example.com/mcp",
  policy,
});
```

Host 批量接线见 [server-host.md](./server-host.md)（`XRK_MCP_*`；条目可 `command` 或 `url`；空 env 时读 `{workspace}/.xrk/host-settings.json` 的 `mcp.servers`）。Face `settings.mutate` 写 desired `servers`（禁 `env`），下次 spawn 生效。

## 不变量（防 bug）

1. **永不跳过 policy**：即使测试注入 transport，也要走 `assertPolicyAllow`。  
2. **工具名稳定**：模型可见名只来自 `publicToolName`；改命名规则 = 破坏会话可重放。  
3. **dispose 成对**：Host `loader.unregister` / plugin `dispose` 必须关子进程 / HTTP session。  
4. **显式优先**：registry 已有同名 → skip（与 loader tools 纪律一致）。

## 测试

| 测 | 覆盖 |
|----|------|
| `packages/mcp/tests/mcp.test.ts` | 命名 · 默认 deny · InMemory ping · http 选项形 · register/dispose · list_changed 热同步 |

## 未做

进程级 supervisor（HTTP 仅 SDK SSE 恢复；`tools/list_changed` 热同步已接）。浏览器 MCP 设置壳硬刷未勾。Face desired `servers` 落盘已接。
