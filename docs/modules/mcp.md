# Module: `@xrkseek/mcp`

> **读者**：贡献者 · 维护者（文件地图）；集成门禁见 [policy.md](../policy.md)。

MCP **client**（stdio + streamable-http）。规格门禁：[policy.md](../policy.md)。包 README：[packages/mcp/README.md](../../packages/mcp/README.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 连 MCP server · list/call tools | 不做 MCP server（本仓角色） |
| 命名 `mcp__<server>__<raw>` | 不静默覆盖 ToolRegistry 同名 |
| `connect` 前 `assertPolicyAllow(mcp.connect)` | 默认 deny；UI 在 Face/Host，不在本包 |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | SSE 走 SDK `reconnectionOptions`；进程级 supervisor 默认开（与 stdio 同策；可 `reconnect.enabled: false`） |
| `onToolsListChanged` / `registerMcpTools` 默认 watch | 拉表失败保留上一代；gave-up 才卸工具 |
| stdio / HTTP `Client.onclose` 有界退避重连（DSH `connection.ts`） | 首次 `connect()` 失败 fail-closed；disabled / 帽满 → `gave-up` |

`McpHttpOptions.reconnectionOptions` 原样传给 SDK（SSE 流恢复）。Host HTTP MCP 默认 `maxRetries: 2`。stdio/HTTP 默认 `reconnect.enabled: true`（`initialDelayMs` 500 · `maxDelayMs` 30s · `maxAttempts` 10）；稳定窗口 = `maxDelayMs`。Host `loadMcpToolPlugins` 在 list_changed / health 后就地更新 `plugin.tools` 并 `invalidateAll`；文件真源下 Face mutate → `reconcileMcpToolPlugins` 热挂载（`gave-up` 同 fingerprint 也会 replace）；health 变推 `settings/document-updated` 刷新 overlay 徽标。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 导出面 | |
| `types.ts` | `McpClient` · `McpStdioOptions` · `McpHttpOptions` · `McpConnectionState` · 结果形 | |
| `names.ts` | `publicToolName` · `parsePublicToolName` · `assertServerName` | serverName ∈ `[A-Za-z0-9_-]{1,32}`；raw 禁 `__` |
| `reconnect.ts` | `resolveReconnectPolicy` · `RECONNECT_DEFAULTS` | 有界退避；错配构造失败 |
| `client.ts` | `createMcpClient` | 先 policy；stdio 代际 supervisor；`onToolsListChanged` / `onConnectionState`；可选 `imageAdmission` |
| `project-content.ts` | 有序块投影；公开 barrel：`mapMcpCallContent` · `McpImageAdmission`；`projectMcpContent` 等为模块内实现 | image → AttachmentStore 或 diagnostic text；禁 JSON dump base64 |
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

Host 批量接线见 [server-host.md](./server-host.md)（`XRK_MCP_*`；条目可 `command` 或 `url`；空 env 时读 `~/.xrk/host-settings.json` 的 `mcp.servers`）。Face `settings.mutate` 写 desired `servers`（禁 `env`）；文件真源时 Host `reconcileMcpToolPlugins` 热挂载（`applies: live`）；`XRK_MCP_SERVERS` / config 非空则仍赢过文件且 mutate 为 `applies: restart`。

## 不变量（防 bug）

1. **永不跳过 policy**：即使测试注入 transport，也要走 `assertPolicyAllow`。  
2. **工具名稳定**：模型可见名只来自 `publicToolName`；改命名规则 = 破坏会话可重放。  
3. **dispose 成对**：Host `loader.unregister` / plugin `dispose` 必须关子进程 / HTTP session。  
4. **显式优先**：registry 已有同名 → skip（与 loader tools 纪律一致）。  
5. **代际不交错**：每次重连新 `Client`；`isCurrent` 让旧代 `onclose`  inert。失败帽耗尽才卸工具。  
6. **富结果**：非 text 块不 `JSON.stringify`；image 须 `imageAdmission` 才进模型可见 ContentBlock；否则固定 diagnostic 文案（raw bytes 不进 session log）。

## 测试

| 测 | 覆盖 |
|----|------|
| `packages/mcp/tests/mcp.test.ts` | 命名 · 默认 deny · InMemory ping · http 选项形 · register/dispose · list_changed 热同步 |
| `packages/mcp/tests/project-content.test.ts` | 有序投影 · image 准入 / 拒绝 · 禁 dump base64 |
| `packages/mcp/tests/reconnect.test.ts` | 代际重连 · 失败帽 · disabled→gave-up · HTTP 默认督 · dispose 竞态 · 稳定窗口 |
| `packages/server/host/tests/mcp-wire.test.ts` | env / host-settings · fingerprint · reconcile keep/remove/gave-up replace/fail |
| Face `settings-credentials` | mutate 落盘 · `applies: live` · `connectFailures` |

本模块本切片能力已接；更长尾缺口见 [status.md](../status.md)。
