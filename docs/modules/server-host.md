# Module: `@xrkseek/server-host`

进程内 Host：config · store · drain · HTTP · Face · 插件 / MCP 装载。

规格：[host-preset.md](../host-preset.md) · [http-api.md](../http-api.md)。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | `createHostManager` · spawn/stop | AgentHandle 可缓存绑定，**不可**当 transcript |
| `agent-cache.ts` | 按 session 缓存 agent · `host.plugins` Scope | invalidate 先 abort 再撤插件 |
| `mcp-wire.ts` | `XRK_MCP_SERVERS` → 合成 `kind: tools` 插件 | 须 allow；id = `mcp:<serverName>` |

配置在 `@xrkseek/server-config`（`loadHostConfig`）。

## Spawn 顺序（排障）

```text
1. createMemorySessionStore + PluginLoader
2. loadAll(pluginsDir) 若配置
3. loadMcpToolPlugins(mcpServers) 若配置且 policy/XRK_MCP_ALLOW 允许
4. createHostAgentCache(loader.list())
5. createFaceRuntime（policy · drain · seeds）
6. createHttpServer + attachFace
```

停机：`loader.unregister` 逐个（含 MCP `dispose`）→ 关 HTTP。

## Env 契约（标准化）

| Env | 含义 |
|-----|------|
| `XRK_HOST` / `XRK_PORT` | 监听 |
| `XRK_WORKSPACE` | workspaceRoot |
| `XRK_PRESET` | minimal \| harness \| server |
| `XRK_API_KEY` | Face/HTTP 鉴权（空=开发免鉴权） |
| `XRK_PLUGINS_DIR` | 进程插件根 |
| `XRK_WEB_DIST` | 静态壳 |
| `XRK_POLICY_FILE` | policy JSON |
| `XRK_MCP_SERVERS` | JSON 数组：`[{serverName,command,args?,env?,cwd?}]` |
| `XRK_MCP_ALLOW` | `1`/`true` → 本进程 mcp.connect 默认 allow |

## AgentFactory 输入

```ts
{
  sessionId, store, workspaceRoot,
  plugins: loader.list(), // 含目录插件 + mcp:* 
}
```

Preset 须 `wireCompositionTools({ plugins })`（见 minimal/harness）。

## 测试

| 测 | 覆盖 |
|----|------|
| `tests/mcp-wire.test.ts` | JSON 解析 · 默认 deny |
| `tests/http-chat.test.ts` | spawn · pluginsDir 接线 |
| `tests/agent-cache.test.ts` | 卸序 |

## 常见坑

1. 配了 `XRK_MCP_SERVERS` 但未 `XRK_MCP_ALLOW` 且无 policy allow → spawn 抛 policy deny。  
2. MCP 插件 id 冲突：已存在同 id 则 skip register。  
3. Face 与 REST 共用 store；改 session 别绕过 Face 投影假设。
