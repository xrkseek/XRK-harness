# Module: `@xrkseek/server-host`

进程内 Host：config · store · drain · HTTP · Face · 插件 / MCP 装载。

规格：[host-preset.md](../host-preset.md) · [http-api.md](../http-api.md)。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | `createHostManager` · spawn/stop | AgentHandle 可缓存绑定，**不可**当 transcript |
| `agent-cache.ts` | 按 session 缓存 agent · `host.plugins` Scope | 根会话 `agent:{id}`；子会话 `openSubagentRealm`（`subagent:{id}`）；invalidate 父卸嵌套子 |
| `standing-tools.ts` | preset standing 工具表（Face `viewFor`） | 冷 history 不 resume agent；minimal = fs+std+skill，harness/server 加 bash + web + lsp + pty |
| `mcp-wire.ts` | `XRK_MCP_SERVERS` 或 `{workspace}/.xrk/host-settings.json` → 合成 `kind: tools` 插件 | 须 allow；id = `mcp:<serverName>`；list_changed 刷新 tools + invalidateAll；env/config 非空赢过文件 |

配置在 `@xrkseek/server-config`（`loadHostConfig`）。

## Spawn 顺序（排障）

```text
1. createMemorySessionStore 或 createJsonlSessionStore(XRK_SESSIONS_DIR) + PluginLoader
2. loadAll(pluginsDir) 若配置
3. loadMcpToolPlugins(mcpServers) 若有 spec（env/config 或 host-settings.json）且 policy/XRK_MCP_ALLOW 允许
4. createHostAgentCache(loader.list())
5. createFaceRuntime（policy · drain · seeds · plugins · webPlugins · standing tools · questions · `subagents.json` · `goals.json`）
6. AgentFactory 内 `bindAskUserTool`（Face broker）；createHttpServer + attachFace
```

停机：`agentCache.dispose` → `shellJobs.dispose`（若有）→ PTY `dispose` → 关 HTTP → `loader.unregister` 逐个（含 MCP `dispose`）。

## Env 契约（标准化）

| Env | 含义 |
|-----|------|
| `XRK_HOST` / `XRK_PORT` | 监听 |
| `XRK_WORKSPACE` | workspaceRoot |
| `XRK_PRESET` | minimal \| harness \| server |
| `XRK_API_KEY` | Face/HTTP 鉴权（空=开发免鉴权） |
| `XRK_SESSIONS_DIR` | JSONL 会话目录；省略 = 内存 store（CLI `serve` 另有默认 `{workspace}/.xrk/sessions`） |
| `XRK_PLUGINS_DIR` | 进程插件根；`web/` 子目录为客户端叠加（boot + `/plugins/…`） |
| `XRK_WEB_DIST` | 静态壳（CLI 按包定位 `apps/web-static`） |
| `XRK_POLICY_FILE` | policy JSON |
| `XRK_MCP_SERVERS` | JSON 数组：`[{serverName,command,args?,env?,cwd?}]` 或 `[{serverName,url}]`；空则回退 `.xrk/host-settings.json` |
| `XRK_MCP_ALLOW` | `1`/`true` → 本进程 mcp.connect 默认 allow |
| `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY` | web_search；见 [web-tools.md](../web-tools.md) |
| `XRK_LSP_COMMAND` / `XRK_LSP_ARGS` | `lsp` stdio 语言服务器；见 [lsp-tools.md](../lsp-tools.md) |

## AgentFactory 输入

```ts
{
  sessionId, store, workspaceRoot,
  plugins: loader.list(), // 含目录插件 + mcp:*
  resolveImage,            // Host 附件仓 → 视觉适配器
  ptyService?,             // harness/server 共享 PTY（跨 agent invalidate）
  shellJobs?,              // harness/server 共享 jobs；composition 按 sessionId 隔离
}
```

Preset 须 `wireCompositionTools({ plugins })`（见 minimal/harness）。Host stop：`shellJobs.dispose()` → PTY `dispose` → unregister 插件。

## 测试

| 测 | 覆盖 |
|----|------|
| `tests/mcp-wire.test.ts` | JSON 解析 · 默认 deny · host-settings.json |
| `tests/http-chat.test.ts` | spawn · pluginsDir 接线 |
| `tests/product-shell.test.ts` | 捕获壳 GET `/` · boot 无 cordis UI / HMR · plugin 200 · 首屏 RPC · manifest 名 · 欢迎文案 |
| `tests/agent-cache.test.ts` | 卸序 |
| `tests/standing-tools.test.ts` | minimal 无 bash；harness/server 有 bash presenter |

## 常见坑

1. 配了 `XRK_MCP_SERVERS` 但未 `XRK_MCP_ALLOW` 且无 policy allow → spawn 抛 policy deny。  
2. MCP 插件 id 冲突：已存在同 id 则 skip register。  
3. Face 与 REST 共用 store；改 session 别绕过 Face 投影假设。
