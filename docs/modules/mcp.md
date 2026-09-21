# Module: `@xrkseek/mcp`

> **读者**：贡献者 · 维护者（文件地图）；集成门禁见 [policy.md](../policy.md)

MCP **client**（stdio + streamable-http）。规格门禁：[policy.md](../policy.md)。包 README：[packages/mcp/README.md](../../packages/mcp/README.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 连 MCP server · list/call tools · list/read resources · URI templates | 不做 MCP server（本仓角色） |
| 命名 `mcp__<server>__<raw>` | 不静默覆盖 ToolRegistry 同名 |
| `connect` 前 `assertPolicyAllow(mcp.connect)` | 默认 deny；UI 在 Face/Host，不在本包。Host reconcile：**deny 时 park**（保留 desired、不 spawn、不记 warn failure） |
| resources 前 `assertPolicyAllow(mcp.resource)` | 默认 allow；ruleset `deny` + server names |
| Host 共享工具 `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` | 无已连 server 时卸 `mcp-resources` 插件 |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | SSE 走 SDK `reconnectionOptions`；进程级 supervisor 默认开（与 stdio 同策；可 `reconnect.enabled: false`） |
| `onToolsListChanged` / `registerMcpTools` 默认 watch | 拉表失败保留上一代；gave-up 才卸工具 |
| initialize 协商协议版本 · 空 client capabilities | 无 `tools` 能力 → 空表（不调 `tools/list`）；MethodNotFound 同空表 |
| `listTools` 分页排空 | 重复 cursor / 超 `MAX_TOOLS_LIST_PAGES` 拒绝 |
| stdio / HTTP `Client.onclose` 有界退避重连 | 首次 `connect()` 失败 fail-closed；disabled / 帽满 → `gave-up` |
| HTTP 设备码 OAuth（RFC 8628）：登录 · 落盘 · 到期 refresh | 不在包内开 UI；CLI 入口在 `apps/cli`（`xrkh mcp`）。stdio 无 `auth`；未登录则匿名连接，不猜端点 |
| 端点缺失时按 RFC 9728 / RFC 8414 发现（`oauth-discovery.ts`） | 显式 flag / env 永远赢过发现；发现失败抛 `McpOAuthDiscoveryError`（不静默回退） |

`McpHttpOptions.reconnectionOptions` 原样传给 SDK（SSE 流恢复）。Host HTTP MCP 默认 `maxRetries: 2`。stdio/HTTP 默认 `reconnect.enabled: true`（`initialDelayMs` 500 · `maxDelayMs` 30s · `maxAttempts` 10）；稳定窗口 = `maxDelayMs`。Host `loadMcpToolPlugins` 在 list_changed / health 后就地更新 `plugin.tools` 并 `invalidateAll`；文件真源下 Face mutate → `reconcileMcpToolPlugins` 热挂载（`gave-up` 同 fingerprint 也会 replace）；health 变推 `settings/document-updated` 刷新 overlay 徽标。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 导出面 | |
| `client.ts` | `createMcpClient` · `parseMcpToolAnnotations` | 先 policy；stdio 代际 supervisor；initialize 协商协议 + 空 client capabilities；无 `tools` 能力 → 空表；`listResources` / `listResourceTemplates` / `readResource` + `mcp.resource`；`onToolsListChanged` / `onConnectionState`；可选 `imageAdmission`；listTools 透传 annotations |
| `types.ts` | `McpClient` · `McpToolInfo` · `McpResourceInfo` · `McpToolAnnotations` · `McpStdioOptions` · `McpHttpOptions` · `McpConnectionState` · 结果形 | |
| `list-tools.ts` | `drainToolsListPages` · `MAX_TOOLS_LIST_PAGES` · `isResourcesUnsupported` | 分页排空；重复 cursor / 超页硬顶拒绝 |
| `resources.ts` | `createMcpResourceTools` · `renderResourceResult` · `MCP_RESOURCES_PLUGIN_ID` | 三共享工具；blob 不进模型文案 |
| `project-content.ts` | 有序块投影；公开 barrel：`mapMcpCallContent` · `McpImageAdmission`；`projectMcpContent` 等为模块内实现 | image → AttachmentStore 或 diagnostic text；禁 JSON dump base64 |
| `oauth-device.ts` | `startDeviceAuthorization` · `pollDeviceToken` · `loginWithDeviceCode` · `refreshDeviceToken` · `McpDeviceTokenStore` · `mergeAuthHeaders` · `isTokenExpired` · `McpDeviceCodeError` | RFC 8628 表单请求；`authorization_pending` / `slow_down` 续等（interval 只增不减），`access_denied` / `expired_token` / 超 `expires_in` 立即失败；`fetch` · `now` · `sleep` · `signal` 全注入，测试不起真定时器；令牌写盘 tmp+rename 原子 + best-effort 0600；refresh 提前 60s |
| `oauth-discovery.ts` | `discoverDeviceCodeEndpoints` · `discoverProtectedResource` · `discoverAuthorizationServerMetadata` · `parseResourceMetadataChallenge` · `McpOAuthDiscoveryError` | RFC 9728 `/.well-known/oauth-protected-resource` → `authorization_servers` → RFC 8414 / OIDC metadata；只接受 https（localhost http 例外）；无 `device_authorization_endpoint` → `no-device-authorization-endpoint`（**不**冒充别的 grant） |
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
  auth, // 可选 McpHttpAuthProvider（设备码令牌）；stdio 忽略
});
```

Host 批量接线见 [server-host.md](./server-host.md)（`XRK_MCP_*`；条目可 `command` 或 `url`；空 env 时读 `~/.xrk/host-settings.json` 的 `mcp.servers`）。Face `settings.mutate` 写 desired `servers`（`env` 仅允许代理键 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`）；文件真源时 Host `reconcileMcpToolPlugins` 热挂载（`applies: live`）；`XRK_MCP_SERVERS` / config 非空则仍赢过文件且 mutate 为 `applies: restart`。stdio 未写 `cwd` 时默认 `~/.xrk/mcp-cwd/<serverName>`（避免 `@playwright/mcp` 等在工作区落 `.playwright-mcp`）。Settings 显式 `cwd` 优先生效；若解析后落在 Host 工作区内，须设 `cwdAllowWorkspace: true`（设置卡勾选「允许工作区 cwd」），否则连接失败并提示风险。

## 终端用户如何挂能力

产品壳 Agent 可调用 **`settings_get` / `settings_mutate`**（与设置 UI Save 同路径；`ns=mcp` 时本进程 remount/connect，工具结果含失败信息）。也可用 **设置 → 插件 → 插件配置**：粘贴 Trae / Cursor 风格 `{"mcpServers":{…}}`，打开 **允许连接**，Save。用斜杠 **`/mcp`** 查看 desired / 挂载状态。行状态反映 connected / park / 失败；policy deny 时保留 desired、不 spawn。密钥不进 `mcp.servers.env`，走 Credentials。分层与选型见 [skills-layers.md](../skills-layers.md)（能力挂载；全局种子 `apps/cli/seeds` → `~/.xrk`）；进程内自有函数仍走 `extensions/` 插件（需 restart）。

## 不变量（防 bug）

1. **永不跳过 policy**：即使测试注入 transport，也要走 `assertPolicyAllow`。  
2. **工具名稳定**：模型可见名只来自 `publicToolName`；改命名规则 = 破坏会话可重放。  
3. **dispose 成对**：Host `loader.unregister` / plugin `dispose` 必须关子进程 / HTTP session。回合进行中的 `settings_mutate` 热挂载走 **soft-detach**（`loader.detach` + 回合结束后再 dispose），避免 mid-drain 工具被掐断。  
4. **显式优先**：registry 已有同名 → skip（与 loader tools 纪律一致）。  
5. **代际不交错**：每次重连新 `Client`；`isCurrent` 让旧代 `onclose` inert。失败帽耗尽才卸工具。  
6. **富结果**：非 text 块不 `JSON.stringify`；image 须 `imageAdmission` 才进模型可见 ContentBlock；否则固定 diagnostic 文案（raw bytes 不进 session log）。  
7. **park / connectFailures**：policy deny 或 Allow connect 关闭 → `parked`；spawn/握手失败 → `connectFailures`。Face 缓存最近一次 Host sync overlay，避免 `settings.describe` 把失败行误标成 parked。  
8. **auth 只加头，不改门禁**：`auth.headers()` 在 `openTransport` 里 await，抛错即连接失败——**不**降级成匿名重试；`auth` 也不绕过 `mcp.connect` policy。合并头大小写不敏感，同名以 auth 为准，调用方原有 header 保留。

## 测试

| 测 | 覆盖 |
|----|------|
| `oauth-device.test.ts` · `oauth-discovery.test.ts` | 设备码全流程（注入 fetch / now / sleep）· 四种错误码 · deadline · refresh · 令牌原子落盘 · 合并头大小写 · RFC 9728 / 8414 发现与失败码 |
| `apps/cli/tests/mcp-command.test.ts` | `xrkh mcp` 端到端：显式端点 · 发现回退 · 配置 URL 解析 · 0600 落盘 · status/logout/list/path · `--json` · 失败时不写令牌 |
| `packages/mcp/tests/mcp.test.ts` | 命名 · 默认 deny · InMemory ping · http 选项形 · register/dispose · list_changed 热同步 |
| `packages/mcp/tests/resources.test.ts` | list/templates/read · 无 capability · policy deny · 共享工具 / blob 脱敏 |
| `packages/mcp/tests/project-content.test.ts` | 有序投影 · image 准入 / 拒绝 · 禁 dump base64 |
| `packages/mcp/tests/reconnect.test.ts` | 代际重连 · 失败帽 · disabled→gave-up · HTTP 默认督 · dispose 竞态 · 稳定窗口 |
| `packages/server/host/tests/mcp-wire.test.ts` | env / host-settings · fingerprint · reconcile keep/remove/gave-up replace/fail · mcp-resources 插件 |
| `packages/server/host/tests/mcp-deferred-dispose.test.ts` | mid-drain soft-detach · 空闲后再 dispose |
| Face `settings-credentials` | mutate 落盘 · `applies: live` · `connectFailures` · describe overlay |

本模块本切片能力已接；更长尾缺口见 [status.md](../status.md)。

---

# Module: `@xrkseek/mcp`

> **Audience**: Contributors · Maintainers (file map); integrator gates: [policy.md](../policy.md)

MCP **client** (stdio + streamable-http). Spec gates: [policy.md](../policy.md). Package README: [packages/mcp/README.md](../../packages/mcp/README.md).

## Responsibility boundary

| Does | Does not |
|----|------|
| Connect MCP servers · list/call tools · list/read resources · URI templates | Act as an MCP server (this repo’s role) |
| Name tools `mcp__<server>__<raw>` | Silently overwrite same-named ToolRegistry entries |
| `assertPolicyAllow(mcp.connect)` before `connect` | Default deny; UI lives in Face/Host, not this package. Host reconcile: **park on deny** (keep desired, no spawn, no warn failure) |
| `assertPolicyAllow(mcp.resource)` before resource ops | Default allow; ruleset may `deny` by server name |
| Host shared tools `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` | Unload `mcp-resources` plugin when no live servers |
| `transport: "http"` → SDK `StreamableHTTPClientTransport` | SSE uses SDK `reconnectionOptions`; process-level supervisor on by default (same policy as stdio; `reconnect.enabled: false` to disable) |
| `onToolsListChanged` / `registerMcpTools` watch by default | Keep previous generation on list failure; unload tools only on gave-up |
| Initialize negotiates protocol version · empty client capabilities | No `tools` capability → empty list (skip `tools/list`); MethodNotFound same |
| `listTools` drains pagination | Reject repeated cursor / over `MAX_TOOLS_LIST_PAGES` |
| Bounded backoff reconnect on stdio / HTTP `Client.onclose` | First `connect()` failure is fail-closed; disabled / cap exhausted → `gave-up` |
| Device-code OAuth for HTTP servers (RFC 8628): login · persisted token · refresh before expiry | No UI in this package; the CLI entry is `xrkh mcp` in `apps/cli`. stdio ignores `auth`; no token → anonymous connect, never endpoint guessing |
| Discover missing endpoints per RFC 9728 / RFC 8414 (`oauth-discovery.ts`) | Explicit flags / env always win over discovery; discovery failures throw `McpOAuthDiscoveryError` (no silent fallback) |

`McpHttpOptions.reconnectionOptions` pass through to the SDK (SSE stream recovery). Host HTTP MCP defaults `maxRetries: 2`. stdio/HTTP default `reconnect.enabled: true` (`initialDelayMs` 500 · `maxDelayMs` 30s · `maxAttempts` 10); stability window = `maxDelayMs`. Host `loadMcpToolPlugins` updates `plugin.tools` in place after list_changed / health and `invalidateAll`; under file source of truth, Face mutate → `reconcileMcpToolPlugins` hot-mounts (`gave-up` same fingerprint also replaces); health changes push `settings/document-updated` to refresh overlay badges.

## File map

| File | Role | Key contracts |
|------|------|----------|
| `index.ts` | Export surface | |
| `client.ts` | `createMcpClient` · `parseMcpToolAnnotations` | Policy first; stdio generational supervisor; initialize negotiates protocol + empty client capabilities; no `tools` capability → empty list; `listResources` / `listResourceTemplates` / `readResource` + `mcp.resource`; `onToolsListChanged` / `onConnectionState`; optional `imageAdmission`; listTools passes annotations through |
| `types.ts` | `McpClient` · `McpToolInfo` · `McpResourceInfo` · `McpToolAnnotations` · `McpStdioOptions` · `McpHttpOptions` · `McpConnectionState` · result shapes | |
| `list-tools.ts` | `drainToolsListPages` · `MAX_TOOLS_LIST_PAGES` · `isResourcesUnsupported` | Drain pagination; reject repeated cursor / page-cap overflow |
| `resources.ts` | `createMcpResourceTools` · `renderResourceResult` · `MCP_RESOURCES_PLUGIN_ID` | Three shared tools; blob redacted from model text |
| `project-content.ts` | Ordered block projection; public barrel: `mapMcpCallContent` · `McpImageAdmission`; `projectMcpContent` etc. are module-internal | image → AttachmentStore or diagnostic text; no JSON dump of base64 |
| `oauth-device.ts` | `startDeviceAuthorization` · `pollDeviceToken` · `loginWithDeviceCode` · `refreshDeviceToken` · `McpDeviceTokenStore` · `mergeAuthHeaders` · `isTokenExpired` · `McpDeviceCodeError` | RFC 8628 form requests; keeps waiting on `authorization_pending` / `slow_down` (interval never shrinks), fails fast on `access_denied` / `expired_token` / past `expires_in`; `fetch` · `now` · `sleep` · `signal` are injected so tests start no real timers; atomic tmp+rename token write + best-effort 0600; refresh 60s before expiry |
| `oauth-discovery.ts` | `discoverDeviceCodeEndpoints` · `discoverProtectedResource` · `discoverAuthorizationServerMetadata` · `parseResourceMetadataChallenge` · `McpOAuthDiscoveryError` | RFC 9728 `/.well-known/oauth-protected-resource` → `authorization_servers` → RFC 8414 / OIDC metadata; https only (localhost http excepted); no `device_authorization_endpoint` → `no-device-authorization-endpoint` (**does not** pretend another grant works) |
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
  auth, // optional McpHttpAuthProvider (device-code token); ignored by stdio
});
```

Host batch wiring: [server-host.md](./server-host.md) (`XRK_MCP_*`; entries may use `command` or `url`; empty env reads `mcp.servers` from `~/.xrk/host-settings.json`). Face `settings.mutate` writes desired `servers` (`env` allows proxy keys only: `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`); with file source of truth, Host `reconcileMcpToolPlugins` hot-mounts (`applies: live`); non-empty `XRK_MCP_SERVERS` / config still wins over file and mutate is `applies: restart`. When stdio omits `cwd`, Host defaults to `~/.xrk/mcp-cwd/<serverName>` (so `@playwright/mcp` does not drop `.playwright-mcp` into the workspace). An explicit Settings `cwd` wins; if it resolves under the Host workspace, set `cwdAllowWorkspace: true` (Settings checkbox **Allow workspace cwd**) or connect fails with a risk notice.

## How end users attach capabilities

The product Agent may call **`settings_get` / `settings_mutate`** (same path as Settings UI Save; for `ns=mcp`, remount/connect in-process and surface connect failures in the tool result). Or use **Settings → Plugins → Plugin config**: paste Trae / Cursor-style `{"mcpServers":{…}}`, enable **Allow connect**, then Save. Slash **`/mcp`** lists desired / mount status. Row status shows connected / park / failure; on policy deny the desired list is kept and nothing is spawned. Keep secrets out of `mcp.servers.env`; use Credentials. Layers and routing: [skills-layers.md](../skills-layers.md) (capability attach; global seeds `apps/cli/seeds` → `~/.xrk`). In-repo JS tools still use `extensions/` plugins (restart required).

## Invariants (bug prevention)

1. **Never skip policy**: even with test-injected transport, run `assertPolicyAllow`.  
2. **Stable tool names**: model-visible names come only from `publicToolName`; renaming breaks session replay.  
3. **Paired dispose**: Host `loader.unregister` / plugin `dispose` must close child processes / HTTP sessions. Mid-turn `settings_mutate` remounts **soft-detach** (`loader.detach`, dispose after the drain) so in-flight MCP tools are not killed.  
4. **Explicit wins**: existing registry name → skip (same discipline as loader tools).  
5. **No generation interleave**: each reconnect gets a new `Client`; `isCurrent` makes prior-generation `onclose` inert. Unload tools only after the failure cap.  
6. **Rich results**: do not `JSON.stringify` non-text blocks; images need `imageAdmission` to enter model-visible ContentBlocks; otherwise fixed diagnostic copy (raw bytes stay out of the session log).  
7. **park / connectFailures**: policy deny or Allow connect off → `parked`; spawn/handshake failure → `connectFailures`. Face keeps the last Host sync overlay so `settings.describe` does not relabel failures as parked.  
8. **Auth only adds headers; it never relaxes gates**: `auth.headers()` is awaited inside `openTransport` and a throw fails the connection — it does **not** fall back to an anonymous retry, and `auth` never bypasses the `mcp.connect` policy. Header merge is case-insensitive: auth wins on collision, caller headers are preserved.

## Tests

| Test | Coverage |
|----|------|
| `oauth-device.test.ts` · `oauth-discovery.test.ts` | Full device flow with injected fetch / now / sleep · the four error codes · deadline · refresh · atomic token persist · case-insensitive header merge · RFC 9728 / 8414 discovery and its failure codes |
| `packages/mcp/tests/mcp.test.ts` | Naming · default deny · InMemory ping · http option shape · register/dispose · list_changed hot sync |
| `packages/mcp/tests/resources.test.ts` | list/templates/read · no capability · policy deny · shared tools / blob redact |
| `packages/mcp/tests/project-content.test.ts` | Ordered projection · image admit/reject · no base64 dump |
| `packages/mcp/tests/reconnect.test.ts` | Generational reconnect · failure cap · disabled→gave-up · HTTP default supervisor · dispose races · stability window |
| `packages/server/host/tests/mcp-wire.test.ts` | env / host-settings · fingerprint · reconcile keep/remove/gave-up replace/fail · mcp-resources plugin |
| `packages/server/host/tests/mcp-deferred-dispose.test.ts` | mid-drain soft-detach · flush after idle |
| `apps/cli/tests/mcp-command.test.ts` | `xrkh mcp` end to end: explicit endpoints · discovery fallback · config URL resolution · 0600 persist · status/logout/list/path · `--json` · safe failure with no token written |
| Face `settings-credentials` | mutate persistence · `applies: live` · `connectFailures` · describe overlay |

This slice is wired; longer-tail gaps: [status.md](../status.md).
