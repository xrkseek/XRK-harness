# 配置参考

> **读者**：终端用户 · 集成者。

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

### Agent 写哪里

| 目标 | 行为 |
|------|------|
| 当前会话 **workspace 根内** | fs / bash / PTY / LSP 可读写（受权限预设与 path jail） |
| **`~/.xrk`**（设置、凭据、会话库、工作区列表） | Face / Host 进程写；**模型工具默认碰不到**（除非 workspace 就是该目录） |
| 产品仓 `packages/*` · `extensions/*` | 仅当 `--workspace` / 侧栏工作区指向该树时，与改普通项目一样 |

Path jail：`exec-fs` `resolveWithinRoot`（[security-checklist.md](./security-checklist.md)）。

## 监听与鉴权

| 变量 | 含义 | 默认 / 备注 |
|------|------|-------------|
| `XRK_HOST` | 绑定地址 | 常用 `127.0.0.1`；CLI 拒绝 `0.0.0.0` |
| `XRK_PORT` | 端口 | 常用 `8787`；测例可用 `0` |
| `XRK_API_KEY` | Face/HTTP 鉴权 | 空 = **开发免鉴权**；产品壳同源回环可无头 |
| `XRK_CORS_ORIGIN` | CORS | 默认 `*` |
| `XRK_RATE_LIMIT` | 每 IP 每分钟请求上限 | 见 http 实现 |
| `XRK_LOG` / `XRK_LOG_LEVEL` | CLI Host 日志级别：`silent` \| `error` \| `warn` \| `info` \| `debug` | 默认 `info`；CLI `--verbose` = debug，`--quiet` = warn |

## Preset · Workspace · 静态壳

| 变量 | 含义 |
|------|------|
| `XRK_PRESET` | Host 入口：`minimal` \| `harness` \| `server`（`server` = harness 工具 + Host factory；会话徽章见 [profiles.md](./profiles.md)） |
| `XRK_WORKSPACE` | workspace 根 |
| `XRK_WEB_DIST` | 产品壳静态根。默认：CLI 包内 `product-web/`，或 monorepo `apps/web/dist`。设了则必须已存在 |
| `XRK_SESSIONS_DIR` | 会话持久化目录（`sessions.db` · WAL）；Host 省略 = 内存（CLI serve 另有默认） |
| `XRK_PLUGINS_DIR` | 进程插件根；`web/` 子目录为客户端叠加。未设时：若 `{XRK_HOME}/plugins` 已存在（`xrk-harness plugin add` 会创建）则用该目录 |
| `XRK_DUMP_SESSION` | 非空时 CLI run 向 stderr dump session（示例见 hello-agent） |

用户插件 CLI：`xrk-harness plugin add|remove|list|path`（见 [plugin-loader.md](./plugin-loader.md)）。

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
| `XRK_MCP_SERVERS` | 可选；非空则赢过文件（CI）。产品路径用 Settings → Plugins → MCP |
| `XRK_MCP_ALLOW` | 可选；强制 allow（CI/无头）。产品路径用 MCP「允许连接」 |

行为要点：

- `mcp.connect` 默认 deny；Web「允许连接」或 `XRK_MCP_ALLOW` 才挂载
- env/config **空**时读 `~/.xrk/host-settings.json`（`servers` + `allowConnect`），Face mutate 后 **热挂载**

[policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md)。

## 工具相关

| 变量 | 含义 |
|------|------|
| `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY` | 可选 env；产品路径用 Credentials |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选 Parallel 免费 MCP URL（默认 `https://search.parallel.ai/mcp`） |
| `XRK_WEB_SEARCH_PROVIDER` | 可选钉死提供方；产品路径用 Settings → Plugins → Web search |
| `XRK_WEB_SEARCH_REGION` | 可选 DuckDuckGo `kl`；产品路径用 Web search → region |
| `XRK_LSP_COMMAND` / `XRK_LSP_ARGS` | `lsp` stdio 语言服务器 |
| `XRK_SHELL` 等 | PTY/shell 显式覆盖（见 [pty-tools.md](./pty-tools.md)；子进程会 scrub 凭据形环境变量） |

无 Tavily/Brave 密钥时：`web_search` 默认 **parallel-free**，失败回退 DuckDuckGo。无 LSP 命令时：`lsp` 仍可能登记，**execute 诚实失败**。

## Plugins 设置（端到端）

Settings → Plugins 里会动到运行时的命名空间：

| Face ns | 字段 | 生效 |
|---------|------|------|
| `mcp` | `servers` · `allowConnect` | 热挂载（文件源）；关 allow 则 park |
| `web-search` | `provider` · `region`（密钥走 Credentials） | 下次 agent 重建后作用于 `web_search` |
| `bash` | `timeoutMs` · `maxOutputBytes` | 下次 agent 重建后作用于 `bash` 工具 |
| `agent-loop` | `maxParallelToolCalls` | 下次 agent 重建后限制同一步并行 settle |

Tavily / Brave 密钥：Plugins → Web search 卡或 Settings → Credentials（同一槽 `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY`）。

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
