# @xrkseek/mcp

MCP client：stdio 或 streamable-http（或测试注入 transport）→ `listTools` / `callTool` → 可选挂到 `ToolRegistry`。

## Status

**能跑**：stdio · streamable-http · 命名 `mcp__<server>__<tool>` · `registerMcpTools` · **默认 `mcp.connect` deny** · **resources list/templates/read + `mcp.resource` policy（默认 allow）** · 共享工具 `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` · **stdio/HTTP 有界进程重连**（`Client.onclose`；HTTP 另有 SDK SSE `reconnectionOptions`）· **HTTP 设备码 OAuth**（RFC 8628 登录 + 到期 refresh；端点缺失时按 RFC 9728 / RFC 8414 发现）。  
Host 接线：`XRK_MCP_SERVERS`（`command` 或 `url`）+ `XRK_MCP_ALLOW=1`（见 [server-host 模块笔记](../../docs/modules/server-host.md)）。  
`registerMcpTools` 默认 watch `tools/list_changed`（拉表失败含重复分页游标 / 超页硬顶时保留上一代；gave-up 卸工具）。`connect` 经 SDK initialize 协商协议并声明空 client capabilities；无 `tools` 能力的 server 不调 `tools/list`（空表兼容）。`listTools` 排空分页并拒绝重复 `nextCursor` 或超过 100 页。Face `mcp.servers` 可落盘；空 `XRK_MCP_SERVERS` 时 Host 在 mutate 后热挂载。Plugins → MCP 卡硬刷见 `product-shell-mcp.e2e.ts`。

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

设备码 OAuth（RFC 8628）：登录一次，之后每次连接自动带 Bearer 并在到期前 refresh。

```ts
import {
  McpDeviceTokenStore,
  createMcpClient,
  discoverDeviceCodeEndpoints,
  loginWithDeviceCode,
} from "@xrkseek/mcp";

const store = new McpDeviceTokenStore({ file: "~/.xrk/mcp-tokens/linear.json" });

if (!store.isLoggedIn()) {
  // 端点未知时先发现（RFC 9728 protected-resource → RFC 8414 authorization-server）
  const endpoints = await discoverDeviceCodeEndpoints({ url: "https://mcp.example.com/mcp" });
  await loginWithDeviceCode({
    client: { id: "xrk-cli" },
    ...endpoints,
    store,
    onPrompt: (start) => console.log(start.verificationUri, start.userCode),
  });
}

const client = createMcpClient({
  transport: "http",
  serverName: "linear",
  url: "https://mcp.example.com/mcp",
  policy,
  auth: store, // McpHttpAuthProvider：headers() → { authorization: "Bearer …" }
});
```

`auth` 只影响 HTTP transport；stdio 不读令牌。`headers()` 与调用方 `requestInit.headers` 合并（大小写不敏感，同名以 auth 为准），`openTransport` 失败即抛出，不降级成匿名连接。产品路径请直接用 `xrkh mcp login|status|logout|list|path`（见 [apps/cli](../../apps/cli/README.md)）。

`connect()` 先 `assertPolicyAllow({ kind: "mcp.connect", serverId })`。显式同名工具优先，插件/MCP 不覆盖。

协议：https://modelcontextprotocol.io/specification/2025-11-25/
