# Module: `@xrkseek/mcp`

> **读者**：贡献者 · 维护者（文件地图）；集成门禁见 [policy.md](../policy.md)

MCP **client**（stdio + streamable-http）。规格门禁：[policy.md](../policy.md)。包 README：[packages/mcp/README.md](../../packages/mcp/README.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 连 MCP server · list/call tools | 不做 MCP server（本仓角色） |
| 命名 `mcp__<server>__<raw>` | 不静默覆盖 ToolRegistry 同名 |
| `connect` 前 `assertPolicyAllow(mcp.connect)` | 默认 deny；UI 在 Face/Host，不在本包。Host reconcile：**deny 时 park**（保留 desired、不 spawn、不记 warn failure） |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | SSE 走 SDK `reconnectionOptions`；进程级 supervisor 默认开（与 stdio 同策；可 `reconnect.enabled: false`） |
| `onToolsListChanged` / `registerMcpTools` 默认 watch | 拉表失败保留上一代；gave-up 才卸工具 |
| stdio / HTTP `Client.onclose` 有界退避重连 | 首次 `connect()` 失败 fail-closed；disabled / 帽满 → `gave-up` |

`McpHttpOptions.reconnectionOptions` 原样传给 SDK（SSE 流恢复）。Host HTTP MCP 默认 `maxRetries: 2`。stdio/HTTP 默认 `reconnect.enabled: true`（`initialDelayMs` 500 · `maxDelayMs` 30s · `maxAttempts` 10）；稳定窗口 = `maxDelayMs`。Host `loadMcpToolPlugins` 在 list_changed / health 后就地更新 `plugin.tools` 并 `invalidateAll`；文件真源下 Face mutate → `reconcileMcpToolPlugins` 热挂载（`gave-up` 同 fingerprint 也会 replace）；health 变推 `settings/document-updated` 刷新 overlay 徽标。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 导出面 | |
| `client.ts` | `createMcpClient` · `parseMcpToolAnnotations` | 先 policy；stdio 代际 supervisor；`onToolsListChanged` / `onConnectionState`；可选 `imageAdmission`；listTools 透传 annotations |
| `types.ts` | `McpClient` · `McpToolInfo` · `McpToolAnnotations` · `McpStdioOptions` · `McpHttpOptions` · `McpConnectionState` · 结果形 | |
| `project-content.ts` | 有序块投影；公开 barrel：`mapMcpCallContent` · `McpImageAdmission`；`projectMcpContent` 等为模块内实现 | image → AttachmentStore 或 diagnostic text；禁 JSON dump base64 |
| `register.ts` | `registerMcpTools` · `mcpToolDefinition` | 显式同名 → skip；默认 watch；gave-up 卸工具；`annotations.readOnlyHint === true` → `isConcurrencySafe` |

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
5. **代际不交错**：每次重连新 `Client`；`isCurrent` 让旧代 `onclose` inert。失败帽耗尽才卸工具。  
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

---

# Module: `@xrkseek/mcp`

> **Audience**: Contributors · Maintainers (file map); integrator gates: [policy.md](../policy.md)

MCP **client** (stdio + streamable-http). Spec gates: [policy.md](../policy.md). Package README: [packages/mcp/README.md](../../packages/mcp/README.md).

## Responsibility boundary

| Does | Does not |
|----|------|
| Connect MCP servers · list/call tools | Act as an MCP server (this repo’s role) |
| Name tools `mcp__<server>__<raw>` | Silently overwrite same-named ToolRegistry entries |
| `assertPolicyAllow(mcp.connect)` before `connect` | Default deny; UI lives in Face/Host, not this package. Host reconcile: **park on deny** (keep desired, no spawn, no warn failure) |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | SSE uses SDK `reconnectionOptions`; process-level supervisor on by default (same policy as stdio; `reconnect.enabled: false` to disable) |
| `onToolsListChanged` / `registerMcpTools` watch by default | Keep previous generation on list failure; unload tools only on gave-up |
| Bounded backoff reconnect on stdio / HTTP `Client.onclose` | First `connect()` failure is fail-closed; disabled / cap exhausted → `gave-up` |

`McpHttpOptions.reconnectionOptions` pass through to the SDK (SSE stream recovery). Host HTTP MCP defaults `maxRetries: 2`. stdio/HTTP default `reconnect.enabled: true` (`initialDelayMs` 500 · `maxDelayMs` 30s · `maxAttempts` 10); stability window = `maxDelayMs`. Host `loadMcpToolPlugins` updates `plugin.tools` in place after list_changed / health and `invalidateAll`; under file source of truth, Face mutate → `reconcileMcpToolPlugins` hot-mounts (`gave-up` same fingerprint also replaces); health changes push `settings/document-updated` to refresh overlay badges.

## File map

| File | Role | Key contracts |
|------|------|----------|
| `index.ts` | Export surface | |
| `client.ts` | `createMcpClient` · `parseMcpToolAnnotations` | Policy first; stdio generational supervisor; `onToolsListChanged` / `onConnectionState`; optional `imageAdmission`; listTools passes annotations through |
| `types.ts` | `McpClient` · `McpToolInfo` · `McpToolAnnotations` · `McpStdioOptions` · `McpHttpOptions` · `McpConnectionState` · result shapes | |
| `project-content.ts` | Ordered block projection; public barrel: `mapMcpCallContent` · `McpImageAdmission`; `projectMcpContent` etc. are module-internal | image → AttachmentStore or diagnostic text; no JSON dump of base64 |
| `register.ts` | `registerMcpTools` · `mcpToolDefinition` | Explicit name clash → skip; watch by default; gave-up unloads tools; `annotations.readOnlyHint === true` → `isConcurrencySafe` |

## Standard usage

```ts
const client = createMcpClient({
  serverName: "fs",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  policy, // must allow mcp.connect
});
await client.connect();
const wired = await registerMcpTools(registry, client);
// …
wired.dispose();
await client.dispose();
```

HTTP:

```ts
createMcpClient({
  transport: "http",
  serverName: "remote",
  url: "https://example.com/mcp",
  policy,
});
```

Host batch wiring: [server-host.md](./server-host.md) (`XRK_MCP_*`; entries may use `command` or `url`; empty env reads `mcp.servers` from `~/.xrk/host-settings.json`). Face `settings.mutate` writes desired `servers` (no `env`); with file source of truth, Host `reconcileMcpToolPlugins` hot-mounts (`applies: live`); non-empty `XRK_MCP_SERVERS` / config still wins over file and mutate is `applies: restart`.

## Invariants (bug prevention)

1. **Never skip policy**: even with test-injected transport, run `assertPolicyAllow`.  
2. **Stable tool names**: model-visible names come only from `publicToolName`; renaming breaks session replay.  
3. **Paired dispose**: Host `loader.unregister` / plugin `dispose` must close child processes / HTTP sessions.  
4. **Explicit wins**: existing registry name → skip (same discipline as loader tools).  
5. **No generation interleave**: each reconnect gets a new `Client`; `isCurrent` makes prior-generation `onclose` inert. Unload tools only after the failure cap.  
6. **Rich results**: do not `JSON.stringify` non-text blocks; images need `imageAdmission` to enter model-visible ContentBlocks; otherwise fixed diagnostic copy (raw bytes stay out of the session log).

## Tests

| Test | Coverage |
|----|------|
| `packages/mcp/tests/mcp.test.ts` | Naming · default deny · InMemory ping · http option shape · register/dispose · list_changed hot sync |
| `packages/mcp/tests/project-content.test.ts` | Ordered projection · image admit/reject · no base64 dump |
| `packages/mcp/tests/reconnect.test.ts` | Generational reconnect · failure cap · disabled→gave-up · HTTP default supervisor · dispose races · stability window |
| `packages/server/host/tests/mcp-wire.test.ts` | env / host-settings · fingerprint · reconcile keep/remove/gave-up replace/fail |
| Face `settings-credentials` | mutate persistence · `applies: live` · `connectFailures` |

This slice is wired; longer-tail gaps: [status.md](../status.md).
