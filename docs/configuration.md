# 配置参考

本页汇总 **Host / CLI 常用环境变量与落盘路径**。实现真源在代码；契约细节仍以各专题文档为准。

## 密钥与凭据

**永不入库**：`.env`、`.xrk/.credentials.yaml`、`.xrk/settings.yaml`、`.xrk/workspaces.json` 均在 `.gitignore`。仓库只提供 `.env.example` 与 `.xrk/*.example` 模板。

| 来源 | 用途 | 优先级（高 → 低） |
|------|------|-------------------|
| 进程 **env** | Host 鉴权 `XRK_API_KEY`；LLM `DEEPSEEK_API_KEY` 等 brand `apiKeyEnv` | 覆盖同名文件键 |
| `~/.xrk/.credentials.yaml` | Face `credentials.set` 落盘；Settings → Credentials | 用户主目录（`XRK_HOME` 可改） |
| `~/.xrk/settings.yaml` | 模型选择、preset、MCP desired 等 | 与 credentials 分离 |
| Settings UI | 同上，经 Face RPC 写文件 | 推荐终端用户路径 |

**开发**：`XRK_API_KEY` 留空 → HTTP/Face **免鉴权**（仅本机调试）。  
**生产**：必须非空 `XRK_API_KEY`，并收紧 `XRK_CORS_ORIGIN`（[security-checklist.md](./security-checklist.md)）。

从零安装步骤：[getting-started.md](./getting-started.md)。

## 落盘路径（两套根）

| 根 | 用途 |
|----|------|
| **`~/.xrk`**（`XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME`） | 用户设置、凭据、会话、工作区列表、MCP desired — 对齐 DSH `~/.dsh` |
| **`{workspace}/.xrk`** | 可选：项目 assistant / context / rules / recipes；**不强制创建** |
| **Skills** | 自动导入已存在的 `.claude/skills` · `.cursor/skills` · `.agents/skills` · `.codex/skills` · `.xrk/skills`（及 `~/` 同名路径）；缺则跳过 |

| 路径 | 用途 | 入库 |
|------|------|------|
| `~/.xrk/sessions/` | CLI `serve`/`web` 默认 Session 仓（`sessions.db` · `--no-persist` 关） | 否 |
| `~/.xrk/settings.yaml` | Face 设置真源（模型 / 预设 / 插件 / 权限等） | **否**（仓内有 `.example`） |
| `~/.xrk/.credentials.yaml` | API 密钥（write-only；`credentials.set` 落盘） | **否** |
| `~/.xrk/workspaces.json` | 侧栏工作区列表 | 否 |
| `~/.xrk/host-settings.json` | Face MCP desired；文件真源时可热挂载 | 否 |
| `{workspace}/.xrk/skills/` · `recipes/` | 可选项目 inject；skills 也从 `.claude` / `.cursor` 等导入 | 否 |
| `XRK_POLICY_FILE` | 显式 policy JSON；优先于默认路径 | 否（勿提交含密钥的 policy） |

旁路文件（与 sessions 同目录时常有）：`subagents.json` · `goals.json`。

## 监听与鉴权

| 变量 | 含义 | 默认 / 备注 |
|------|------|-------------|
| `XRK_HOST` | 绑定地址 | 常用 `127.0.0.1`；CLI 拒绝 `0.0.0.0` |
| `XRK_PORT` | 端口 | 常用 `8787`；测例可用 `0` |
| `XRK_API_KEY` | Face/HTTP 鉴权 | 空 = **开发免鉴权**；产品壳同源回环可无头 |
| `XRK_CORS_ORIGIN` | CORS | 默认 `*` |
| `XRK_RATE_LIMIT` | 每 IP 每分钟请求上限 | 见 http 实现 |

## Preset · Workspace · 静态壳

| 变量 | 含义 |
|------|------|
| `XRK_PRESET` | `minimal` \| `harness` \| `server` |
| `XRK_WORKSPACE` | workspace 根 |
| `XRK_WEB_DIST` | 产品壳静态根。默认：CLI 包内 `product-web/`，或 monorepo `apps/web/dist`。设了则必须已存在 |
| `XRK_SESSIONS_DIR` | 会话持久化目录（`sessions.db` · WAL）；Host 省略 = 内存（CLI serve 另有默认） |
| `XRK_PLUGINS_DIR` | 进程插件根；`web/` 子目录为客户端叠加 |
| `XRK_DUMP_SESSION` | 非空时 CLI run 向 stderr dump session（示例见 hello-agent） |

Preset 选型：[profiles.md](./profiles.md)。

## LLM

| 变量 | 含义 |
|------|------|
| `XRK_LLM_PRESET` | Provider Registry brand id（`openrouter` · `deepseek` · `custom` …） |
| `XRK_LLM_MODEL` | 可选模型覆盖 |
| `XRK_LLM_BASE_URL` | 可选 baseUrl（`custom` 等常需） |
| brand `apiKeyEnv` | 如 `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY` · `OPENAI_API_KEY`（见 presets 表；**不是**统一的 `XRK_LLM_API_KEY`） |

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md)。

## Policy · MCP

| 变量 | 含义 |
|------|------|
| `XRK_POLICY_FILE` | policy JSON（tool / provider / mcp） |
| `XRK_MCP_SERVERS` | JSON 数组 `[{serverName,command|url,...}]` 或 Cursor/Claude `{ "mcpServers": { "name": { "command", "args" } } }` |
| `XRK_MCP_ALLOW` | `1`/`true` → 本进程 `mcp.connect` 默认 allow |

行为要点：

- `mcp.connect` **默认 deny**
- `XRK_MCP_SERVERS` / config **非空**时赢过文件，mutate 为 `applies: restart`
- env/config **空**时读 `~/.xrk/host-settings.json` 的 `mcp.servers`（也接受根级 `mcpServers` 对象），Face mutate 后 **热挂载**（`applies: live`）

[policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md)。

## 工具相关

| 变量 | 含义 |
|------|------|
| `XRK_TAVILY_API_KEY` | Tavily `web_search` |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave Search |
| `XRK_WEB_SEARCH_PROVIDER` | 可选 `tavily` \| `brave` |
| `XRK_LSP_COMMAND` / `XRK_LSP_ARGS` | `lsp` stdio 语言服务器 |
| `XRK_SHELL` 等 | PTY/shell 显式覆盖（见 [pty-tools.md](./pty-tools.md)；子进程会 scrub 凭据形环境变量） |

无搜索密钥 / 无 LSP 命令时：工具仍可能登记，**execute 诚实失败**。

## CLI 常用标志

```text
xrk-harness run|serve|web|doctor|dump-config
  --preset · --workspace · --host · --port · --open
  serve/web: --no-persist
```

细节：`apps/cli` README · `node apps/cli/dist/bin.js --help`。

## 相关

- HTTP 端点与 SSE：[http-api.md](./http-api.md)
- Host 接线文件地图：[modules/server-host.md](./modules/server-host.md)
- 发包与 private：[publishing.md](./publishing.md)
