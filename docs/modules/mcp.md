# Module: `@xrkseek/mcp`

MCP **client** M0（stdio）。规格门禁：[policy.md](../policy.md)。包 README：[packages/mcp/README.md](../../packages/mcp/README.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 连 MCP server · list/call tools | 不做 MCP server（本仓角色） |
| 命名 `mcp__<server>__<raw>` | 不静默覆盖 ToolRegistry 同名 |
| `connect` 前 `assertPolicyAllow(mcp.connect)` | 默认 deny；不假装已产品化 Host UI |

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 导出面 | |
| `types.ts` | `McpClient` · `McpStdioOptions` · 结果形 | |
| `names.ts` | `publicToolName` · `parsePublicToolName` · `assertServerName` | serverName ∈ `[A-Za-z0-9_-]{1,32}`；raw 禁 `__` |
| `client.ts` | `createMcpClient` | 先 policy，再 stdio / `createTransport`（测试） |
| `register.ts` | `registerMcpTools` | 显式同名 → skip；返回 `dispose` 只卸本批 |

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

Host 批量接线见 [server-host.md](./server-host.md)（`XRK_MCP_*`）。

## 不变量（防 bug）

1. **永不跳过 policy**：即使测试注入 transport，也要走 `assertPolicyAllow`。  
2. **工具名稳定**：模型可见名只来自 `publicToolName`；改命名规则 = 破坏会话可重放。  
3. **dispose 成对**：Host `loader.unregister` / plugin `dispose` 必须关子进程。  
4. **显式优先**：registry 已有同名 → skip（与 loader tools 纪律一致）。

## 测试

| 测 | 覆盖 |
|----|------|
| `packages/mcp/tests/mcp.test.ts` | 命名 · 默认 deny · InMemory ping · register/dispose |

## 未做

streamable-http · 自动重连 · Face MCP 设置 UI。
