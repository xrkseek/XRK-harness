# 配置参考 / Configuration Reference

> **读者 / Audience**：终端用户 · 集成者 / End users · Integrators

本页汇总 **Host / CLI 常用环境变量与落盘路径**。实现真源在代码；契约细节仍以各专题文档为准。

This page summarizes **common Host / CLI environment variables and on-disk paths**. Implementation truth is in code; contract details remain in the topic documents.

## 密钥与凭据 / Secrets and credentials

**永不入库**：`.env`、`.xrk/.credentials.yaml`、`.xrk/settings.yaml`、`.xrk/workspaces.json` 均在 `.gitignore`。仓库只提供 `.env.example` 与 `.xrk/*.example` 模板。

**Never commit**: `.env`, `.xrk/.credentials.yaml`, `.xrk/settings.yaml`, and `.xrk/workspaces.json` are all gitignored. The repository ships only `.env.example` and `.xrk/*.example` templates.

| 来源 / Source | 用途 / Purpose | 优先级（高 → 低） / Precedence (high → low) |
|------|------|-------------------|
| 进程 **env** / Process **env** | Host 鉴权 `XRK_API_KEY`；LLM `DEEPSEEK_API_KEY` 等 brand `apiKeyEnv` | 覆盖同名文件键 / Overrides same-named file keys |
| `~/.xrk/.credentials.yaml` | Face `credentials.set` 落盘；Settings → Credentials | 用户主目录（`XRK_HOME` 可改） / User home (`XRK_HOME` may override) |
| `~/.xrk/settings.yaml` | 模型选择、preset、MCP desired 等 / Model selection, preset, MCP desired, etc. | 与 credentials 分离 / Separate from credentials |
| Settings UI | 同上，经 Face RPC 写文件 / Same; written via Face RPC | 推荐终端用户路径 / Recommended end-user path |

**开发 / Development**：`XRK_API_KEY` 留空 → HTTP/Face **免鉴权**（仅本机调试）。  
**生产 / Production**：必须非空 `XRK_API_KEY`，并收紧 `XRK_CORS_ORIGIN`（[security-checklist.md](./security-checklist.md)）。

Leave `XRK_API_KEY` empty for local unauthenticated HTTP/Face debugging. Production requires a non-empty `XRK_API_KEY` and a tightened `XRK_CORS_ORIGIN` ([security-checklist.md](./security-checklist.md)).

从零安装步骤 / From-scratch install：[getting-started.md](./getting-started.md)。

## 落盘路径（两套根） / On-disk paths (two roots)

| 根 / Root | 用途 / Purpose |
|----|------|
| **`~/.xrk`**（`XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME`） | 用户设置、凭据、会话、工作区列表、MCP desired — 对齐 DSH `~/.dsh` 布局 / User settings, credentials, sessions, workspace list, MCP desired — layout aligned with DSH `~/.dsh` |
| **`{workspace}/.xrk`** | 可选：项目 assistant / context / rules / recipes；**不强制创建** / Optional project assistant / context / rules / recipes; **not required** |
| **Skills** | 多根导入：`.agents/skills` · `.xrk/skills` · `.claude/skills` 等（见 [skills-layers.md](./skills-layers.md)） / Multi-root import: `.agents/skills` · `.xrk/skills` · `.claude/skills` and peers ([skills-layers.md](./skills-layers.md)) |

| 路径 / Path | 用途 / Purpose | 入库 / In git |
|------|------|------|
| `~/.xrk/sessions/` | CLI `serve`/`web` 默认 Session 仓（`sessions.db` · `--no-persist` 关） / Default Session store for CLI `serve`/`web` (`sessions.db`; disable with `--no-persist`) | 否 / No |
| `~/.xrk/settings.yaml` | Face 设置真源（模型 / 预设 / 插件 / 权限等） / Face settings source of truth (models / presets / plugins / permissions, etc.) | **否**（仓内有 `.example`） / **No** (`.example` in repo) |
| `~/.xrk/.credentials.yaml` | API 密钥（write-only；`credentials.set` 落盘） / API keys (write-only; persisted by `credentials.set`) | **否** / **No** |
| `~/.xrk/workspaces.json` | 侧栏工作区列表 / Sidebar workspace list | 否 / No |
| `~/.xrk/host-settings.json` | Face MCP desired；文件真源时可热挂载 / Face MCP desired; hot-mount when file-backed | 否 / No |
| `{workspace}/.xrk/skills/` · `recipes/` | 可选项目 inject；skills 也从 `.claude` / `.cursor` 等导入 / Optional project inject; skills also import from `.claude` / `.cursor` peers | 否 / No |
| `XRK_POLICY_FILE` | 显式 policy JSON；优先于默认路径 / Explicit policy JSON; wins over default paths | 否（勿提交含密钥的 policy） / No (do not commit policies that contain secrets) |

旁路文件（与 sessions 同目录时常有）：`subagents.json` · `goals.json`。

Sidecar files often beside sessions: `subagents.json` · `goals.json`.

### Agent 写哪里 / Where the Agent may write

| 目标 / Target | 行为 / Behavior |
|------|------|
| 当前会话 **workspace 根内** / Inside the session **workspace root** | fs / bash / PTY / LSP 可读写（受权限预设与 path jail） / Readable/writable via fs / bash / PTY / LSP (permission presets and path jail) |
| **`~/.xrk`**（设置、凭据、会话库、工作区列表） / Settings, credentials, session store, workspace list | Face / Host 进程写；**模型工具默认碰不到**（除非 workspace 就是该目录） / Written by Face / Host; **model tools cannot reach it by default** (unless the workspace is that directory) |
| 产品仓 `packages/*` · `extensions/*` | 仅当 `--workspace` / 侧栏工作区指向该树时，与改普通项目一样 / Same as editing a normal project only when `--workspace` / the sidebar workspace points at that tree |

Path jail：`exec-fs` `resolveWithinRoot`（[security-checklist.md](./security-checklist.md)）。

## 监听与鉴权 / Listen and auth

| 变量 / Variable | 含义 / Meaning | 默认 / 备注 / Default / Notes |
|------|------|-------------|
| `XRK_HOST` | 绑定地址 / Bind address | 常用 `127.0.0.1`；CLI 拒绝 `0.0.0.0` / typically `127.0.0.1`; CLI rejects `0.0.0.0` |
| `XRK_PORT` | 端口 / Port | 常用 `8787`；测例可用 `0` / typically `8787`; tests may use `0` |
| `XRK_API_KEY` | Face/HTTP 鉴权 / Face/HTTP auth | 空 = **开发免鉴权**；产品壳同源回环可无头 / empty = **dev unauthenticated**; same-origin product-shell loopback may omit the header |
| `XRK_CORS_ORIGIN` | CORS | 默认 `*` / default `*` |
| `XRK_RATE_LIMIT` | 每 IP 每分钟请求上限 / Per-IP requests per minute | 见 http 实现 / see HTTP implementation |
| `XRK_LOG` / `XRK_LOG_LEVEL` | CLI Host 日志级别：`silent` \| `error` \| `warn` \| `info` \| `debug` / CLI Host log level | 默认 `info`；CLI `--verbose` = debug，`--quiet` = warn / default `info`; CLI `--verbose` = debug, `--quiet` = warn |

## Preset · Workspace · 静态壳 / Preset · Workspace · static shell

| 变量 / Variable | 含义 / Meaning |
|------|------|
| `XRK_PRESET` | Host 入口：`minimal` \| `harness` \| `server`（`server` = harness 工具 + Host factory；会话徽章见 [profiles.md](./profiles.md)） / Host entry: `minimal` \| `harness` \| `server` (`server` = harness tools + Host factory; session badge: [profiles.md](./profiles.md)) |
| `XRK_WORKSPACE` | workspace 根 / Workspace root |
| `XRK_WEB_DIST` | 产品壳静态根。默认：CLI 包内 `product-web/`，或 monorepo `apps/web/dist`。设了则必须已存在 / Product-shell static root. Default: `product-web/` inside the CLI package, or monorepo `apps/web/dist`. If set, the path must already exist |
| `XRK_SESSIONS_DIR` | 会话持久化目录（`sessions.db` · WAL）；Host 省略 = 内存（CLI serve 另有默认） / Session persistence directory (`sessions.db` · WAL); Host omit = in-memory (CLI serve has its own default) |
| `XRK_PLUGINS_DIR` | 进程插件根；`web/` 子目录为客户端叠加。未设时：若 `{XRK_HOME}/plugins` 已存在（`xrkh plugin add` 会创建）则用该目录 / Process plugin root; `web/` subdirectory is client overlay. When unset: use `{XRK_HOME}/plugins` if it already exists (`xrkh plugin add` creates it) |
| `XRK_DUMP_SESSION` | 非空时 CLI run 向 stderr dump session（示例见 hello-agent） / When non-empty, CLI run dumps the session to stderr (see hello-agent) |

用户插件 CLI / User plugin CLI：`xrkh plugin add|remove|list|path|reconcile`（亦 `xrk-harness plugin …`；见 [plugin-loader.md](./plugin-loader.md)）。

Preset 选型 / Preset selection：[profiles.md](./profiles.md)。

## LLM

| 变量 / Variable | 含义 / Meaning |
|------|------|
| `XRK_LLM_PRESET` | Provider Registry brand id（`openrouter` · `deepseek` · `custom` …） |
| `XRK_LLM_MODEL` | 可选模型覆盖 / Optional model override |
| `XRK_LLM_BASE_URL` | 可选 baseUrl（`custom` 等常需） / Optional baseUrl (often required for `custom`) |
| brand `apiKeyEnv` | 如 `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY` · `OPENAI_API_KEY`（见 presets 表；**不是**统一的 `XRK_LLM_API_KEY`） / e.g. `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY` · `OPENAI_API_KEY` (see presets table; **not** a unified `XRK_LLM_API_KEY`) |

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md)。

## Policy · MCP

| 变量 / Variable | 含义 / Meaning |
|------|------|
| `XRK_POLICY_FILE` | policy JSON（tool / provider / mcp） |
| `XRK_MCP_SERVERS` | 可选；非空则赢过文件（CI）。产品路径用 Settings → Plugins → MCP / Optional; when non-empty wins over file (CI). Product path: Settings → Plugins → MCP |
| `XRK_MCP_ALLOW` | 可选；强制 allow（CI/无头）。产品路径用 MCP「允许连接」 / Optional; force allow (CI/headless). Product path: MCP “Allow connect” |

行为要点 / Behavior notes：

- `mcp.connect` 默认 deny；Web「允许连接」或 `XRK_MCP_ALLOW` 才挂载 / `mcp.connect` defaults to deny; mount only after Web “Allow connect” or `XRK_MCP_ALLOW`
- env/config **空**时读 `~/.xrk/host-settings.json`（`servers` + `allowConnect`），Face mutate 后 **热挂载** / When env/config is **empty**, read `~/.xrk/host-settings.json` (`servers` + `allowConnect`) and **hot-mount** after Face mutate

[policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md)。

## 工具相关 / Tool-related

| 变量 / Variable | 含义 / Meaning |
|------|------|
| `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY` | 可选 env；产品路径用 Credentials / Optional env; product path uses Credentials |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选 Parallel 免费 MCP URL（默认 `https://search.parallel.ai/mcp`） / Optional Parallel free MCP URL (default `https://search.parallel.ai/mcp`) |
| `XRK_WEB_SEARCH_PROVIDER` | 可选钉死提供方；产品路径用 Settings → Plugins → Web search / Optional pinned provider; product path: Settings → Plugins → Web search |
| `XRK_WEB_SEARCH_REGION` | 可选 DuckDuckGo `kl`；产品路径用 Web search → region / Optional DuckDuckGo `kl`; product path: Web search → region |
| `XRK_LSP_COMMAND` / `XRK_LSP_ARGS` | `lsp` stdio 语言服务器 / `lsp` stdio language server |
| `XRK_SHELL` 等 / and peers | PTY/shell 显式覆盖（见 [pty-tools.md](./pty-tools.md)；子进程会 scrub 凭据形环境变量） / Explicit PTY/shell overrides ([pty-tools.md](./pty-tools.md); child processes scrub credential-shaped env vars) |

无 Tavily/Brave 密钥时：`web_search` 默认 **parallel-free**，失败回退 DuckDuckGo。无 LSP 命令时：`lsp` 仍可能登记，**execute 诚实失败**。

Without Tavily/Brave keys: `web_search` defaults to **parallel-free**, then falls back to DuckDuckGo. Without an LSP command: `lsp` may still register and **execute fails honestly**.

## Plugins 设置（端到端） / Plugins settings (end-to-end)

Settings → Plugins 里会动到运行时的命名空间：

Settings → Plugins mutates these runtime namespaces:

| Face ns | 字段 / Fields | 生效 / Takes effect |
|---------|------|------|
| `mcp` | `servers` · `allowConnect` | 热挂载（文件源）；关 allow 则 park / Hot-mount (file-backed); park when allow is off |
| `web-search` | `provider` · `region`（密钥走 Credentials） / keys via Credentials | 下次 agent 重建后作用于 `web_search` / Applies to `web_search` after the next agent rebuild |
| `bash` | `timeoutMs` · `maxOutputBytes`（默认 **64_000**） | 下次 agent 重建后作用于 `bash` 捕获上限 / Applies to bash capture cap after the next agent rebuild (default **64_000**) |
| `agent-loop` | `maxParallelToolCalls` | 下次 agent 重建后限制同一步并行 settle 池上限 / Caps the parallel settle pool for one step after the next agent rebuild |
| `agent-loop` | `maxSteps` | 单次用户 turn 的 LLM 步数上限（默认 32） / Max LLM steps per user turn (default 32) |
| `agent-loop` | `toolSettle` | `parallel`（默认，按 `isConcurrencySafe`）或 `serial` / `parallel` (default, by `isConcurrencySafe`) or `serial` |
| `agent-loop` | `llmRetryMaxRetries` | 步内 provider 重试上限（默认 5；`0` 关闭） / In-step provider retry cap (default 5; `0` disables) |
| `agent-loop` | `toolOrder` | DSH 风格工具线序（settings.yaml；恰好一个 `' '` rest） / DSH-style tool line order (settings.yaml; exactly one `' '` rest) |
| `agent-loop` | `maxRequestTokens` · `keepTokens` · `bufferTokens` | 软上下文预算（默认 100k / 24k / 4k）；超限 prune → compact → fail-closed / Soft context budget (defaults 100k / 24k / 4k); over → prune → compact → fail-closed |
| `agent-loop` | `toolResultMaxInlineBytes` | 工具正文 spill 上限（默认 **64_000**；`0` 关闭） / Tool-result spill ceiling (default **64_000**; `0` disables) |

Tavily / Brave 密钥：Plugins → Web search 卡或 Settings → Credentials（同一槽 `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY`）。

Tavily / Brave keys: Plugins → Web search card or Settings → Credentials (same slots `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY`).

## CLI 常用标志 / Common CLI flags

```text
xrkh run|serve|web|doctor|dump-config   # 亦 xrk-harness …
  --preset · --workspace · --host · --port · --open
  serve/web: --no-persist
```

细节 / Details：`apps/cli` README · `node apps/cli/dist/bin.js --help`。

## 相关 / Related

- HTTP 端点与 SSE / HTTP endpoints and SSE：[http-api.md](./http-api.md)
- Host 接线文件地图 / Host wiring file map：[modules/server-host.md](./modules/server-host.md)
- 发包与 private / Publishing and private packages：[publishing.md](./publishing.md)
