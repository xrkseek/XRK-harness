# @xrkseek/mcp

MCP client：stdio 或 streamable-http（或测试注入 transport）→ `listTools` / `callTool` → 可选挂到 `ToolRegistry`。

## Status

**能跑**：stdio · streamable-http · 命名 `mcp__<server>__<tool>` · `registerMcpTools` · **默认 `mcp.connect` deny**。  
Host 接线：`XRK_MCP_SERVERS`（`command` 或 `url`）+ `XRK_MCP_ALLOW=1`（见 [server-host 模块笔记](../../docs/modules/server-host.md)）。  
HTTP 可传 SDK `reconnectionOptions`（SSE 恢复）。`registerMcpTools` 默认 watch `tools/list_changed`（拉表失败保留上一代）。未做：Face MCP 设置 UI · 进程 supervisor。

门禁见 [docs/policy.md](../../docs/policy.md)。状态：[docs/status.md](../../docs/status.md)。  
**文件地图**：[docs/modules/mcp.md](../../docs/modules/mcp.md)。

## API

```ts
import { createMcpClient, registerMcpTools } from "@xrkseek/mcp";
import { createPolicyEngine } from "@xrkseek/policy";
import { createToolRegistry } from "@xrkseek/core-tools";

const policy = createPolicyEngine({
  defaults: { "mcp.connect": "allow" }, // product default remains deny
});

const client = createMcpClient({
  serverName: "fs",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  policy,
});

await client.connect();
const registry = createToolRegistry();
const wired = await registerMcpTools(registry, client);
// … agent turn …
wired.dispose();
await client.dispose();
```

HTTP：`createMcpClient({ transport: "http", serverName, url, policy })`。

`connect()` 先 `assertPolicyAllow({ kind: "mcp.connect", serverId })`。显式同名工具优先，插件/MCP 不覆盖。

协议：https://modelcontextprotocol.io/specification/2025-11-25/
