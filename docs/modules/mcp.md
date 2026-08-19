# Module: `@xrkseek/mcp`

MCP **client**（stdio + streamable-http）。规格门禁：[policy.md](../policy.md)。包 README：[packages/mcp/README.md](../../packages/mcp/README.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 连 MCP server · list/call tools | 不做 MCP server（本仓角色） |
| 命名 `mcp__<server>__<raw>` | 不静默覆盖 ToolRegistry 同名 |
| `connect` 前 `assertPolicyAllow(mcp.connect)` | 默认 deny；UI 在 Face/Host，不在本包 |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | HTTP 进程级 supervisor（默认关；SSE 走 SDK `reconnectionOptions`） |
| `onToolsListChanged` / `registerMcpTools` 默认 watch | 拉表失败保留上一代；gave-up 才卸工具 |
| stdio `Client.onclose` 有界退避重连（DSH `connection.ts`） | 首次 `connect()` 失败 fail-closed；HTTP 进程 supervisor 默认关 |

`McpHttpOptions.reconnectionOptions` 原样传给 SDK（SSE 流恢复）。Host HTTP MCP 默认 `maxRetries: 2`。stdio 默认 `reconnect.enabled: true`（`initialDelayMs` 500 · `maxDelayMs` 30s · `maxAttempts` 10）；稳定窗口 = `maxDelayMs`。Host `loadMcpToolPlugins` 在 list_changed / gave-up 后就地更新 `plugin.tools` 并 `invalidateAll` agent 缓存；文件真源下 Face mutate → `reconcileMcpToolPlugins` 热挂载；overlay `connected[].status` 供 Plugins 卡徽标。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 导出面 | |
| `types.ts` | `McpClient` · `McpStdioOptions` · `McpHttpOptions` · `McpConnectionState` · 结果形 | |
| `names.ts` | `publicToolName` · `parsePublicToolName` · `assertServerName` | serverName ∈ `[A-Za-z0-9_-]{1,32}`；raw 禁 `__` |
| `reconnect.ts` | `resolveReconnectPolicy` · `RECONNECT_DEFAULTS` | 有界退避；错配构造失败 |
| `client.ts` | `createMcpClient` | 先 policy；stdio 代际 supervisor；`onToolsListChanged` / `onConnectionState` |
| `register.ts` | `registerMcpTools` · `mcpToolDefinition` | 显式同名 → skip；默认 watch；gave-up 卸工具 |

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

Host 批量接线见 [server-host.md](./server-host.md)（`XRK_MCP_*`；条目可 `command` 或 `url`；空 env 时读 `{workspace}/.xrk/host-settings.json` 的 `mcp.servers`）。Face `settings.mutate` 写 desired `servers`（禁 `env`）；文件真源时 Host `reconcileMcpToolPlugins` 热挂载（`applies: live`）；`XRK_MCP_SERVERS` / config 非空则仍赢过文件且 mutate 为 `applies: restart`。

## 不变量（防 bug）

1. **永不跳过 policy**：即使测试注入 transport，也要走 `assertPolicyAllow`。  
2. **工具名稳定**：模型可见名只来自 `publicToolName`；改命名规则 = 破坏会话可重放。  
3. **dispose 成对**：Host `loader.unregister` / plugin `dispose` 必须关子进程 / HTTP session。  
4. **显式优先**：registry 已有同名 → skip（与 loader tools 纪律一致）。  
5. **代际不交错**：每次重连新 `Client`；`isCurrent` 让旧代 `onclose`  inert。失败帽耗尽才卸工具。

## 测试

| 测 | 覆盖 |
|----|------|
| `packages/mcp/tests/mcp.test.ts` | 命名 · 默认 deny · InMemory ping · http 选项形 · register/dispose · list_changed 热同步 |
| `packages/mcp/tests/reconnect.test.ts` | 代际重连 · 失败帽 · disabled · HTTP 默认不督 · dispose 取消退避 · 稳定窗口 |
| `packages/server/host/tests/mcp-wire.test.ts` | env / host-settings · fingerprint · reconcile keep/remove/fail |
| Face `settings-credentials` | mutate 落盘 · `applies: live`（有 `syncMcpServers`）/ `restart` |

## 未做

HTTP 进程级 supervisor（stdio 已接；HTTP 仅 SDK SSE）。浏览器 **Plugins → MCP** 卡编辑 desired `servers` 已硬刷；文件真源下 mutate 后热挂载已接。
