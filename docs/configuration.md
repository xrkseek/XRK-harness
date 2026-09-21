# 配置参考

> **读者**：终端用户 · 集成者

日常调参走 **Web 设置**（写入 `~/.xrk/settings.yaml` / `.credentials.yaml`）。本页后半列出 Host / CLI **环境变量与落盘路径**——给启动、CI、无头用，不是终端用户主路径。实现真源在代码；契约细节仍以各专题文档为准。

## 产品设置优先（推荐）

启动 `xrkh web` 后：

| 目标 | 壳内路径 |
|------|----------|
| 模型 | **设置 → 模型** |
| API 密钥 | **设置 → 凭据**（不要为日常使用先 export env） |
| 默认权限档 | **设置 → 权限**；会话 Access 芯片 / `/permission` |
| MCP · 网页搜索 · 终端 · Agent 循环 · 工作区注入 | **设置 → 插件 → 插件配置** |
| 打开 yaml | 设置页「打开配置文件」→ `{XRK_HOME}/settings.yaml`（常用 `~/.xrk/settings.yaml`） |

Agent 循环卡：软请求预算 · keep/buffer · 工具结果 spill。终端卡：超时 · 单流输出上限。工作区注入卡：rules/skills 字符预算。

## 密钥与凭据

**永不入库**：`.env`、`.xrk/.credentials.yaml`、`.xrk/settings.yaml`、`.xrk/workspaces.json` 均在 `.gitignore`。仓库只提供 `.env.example` 与 `.xrk/*.example` 模板。

| 来源 | 用途 | 优先级（高 → 低） |
|------|------|-------------------|
| 进程 **env** | Host 鉴权 `XRK_API_KEY`；LLM brand `apiKeyEnv`（CI/无头旁路） | 覆盖同名文件键 |
| `~/.xrk/.credentials.yaml` | Face `credentials.set` 落盘；**设置 → 凭据** | 用户主目录（`XRK_HOME` 可改） |
| `~/.xrk/settings.yaml` | 模型选择、preset、MCP desired、agent-loop 等 | 与 credentials 分离 |
| **Settings UI** | 同上，经 Face RPC 写文件 | **推荐终端用户路径** |

**开发**：`XRK_API_KEY` 留空 → HTTP/Face **免鉴权**（仅本机调试）。  
**生产**：必须非空 `XRK_API_KEY`，并收紧 `XRK_CORS_ORIGIN`（[security-checklist.md](./security-checklist.md)）。

从零安装步骤：[getting-started.md](./getting-started.md)。

## 落盘路径（两套根）

| 根 | 用途 |
|----|------|
| **`~/.xrk`**（`XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME`） | 用户设置、凭据、会话、工作区列表、MCP desired — 布局与 `~/.xrk` 约定 |
| **`{workspace}/.xrk`** | 可选：项目 assistant / context / rules / recipes；**不强制创建** |
| **Skills** | 多根导入：`.agents/skills` · `.xrk/skills` · `.claude/skills` 等（见 [skills-layers.md](./skills-layers.md)） |

| 路径 | 用途 | 入库 |
|------|------|------|
| `~/.xrk/sessions/` | CLI `serve`/`web` 默认 Session 仓（`sessions.db` · `--no-persist` 关） | 否 |
| `~/.xrk/logs/startup-*.log` | Host 启动失败完整诊断（终端只打摘要；含 Failed / Waiting 分类） | 否 |
| `~/.xrk/settings.yaml` | Face 设置真源（模型 / 预设 / 插件 / 权限等） | **否**（仓内有 `.example`） |
| `~/.xrk/.credentials.yaml` | API 密钥（write-only；`credentials.set` 落盘） | **否** |
| `~/.xrk/workspaces.json` | 侧栏工作区列表 | 否 |
| `~/.xrk/host-settings.json` | Face MCP desired；文件真源时可热挂载 | 否 |
| `~/.xrk/mcp-tokens/<server>.json` | `xrkh mcp login` 的设备码令牌（access/refresh/到期）；尽量 0600 | 否（明文，仅本机权限保护） |
| `{workspace}/.xrk/skills/` · `recipes/` | 可选项目 inject；skills 也从 `.claude` / `.cursor` 等导入 | 否 |
| `XRK_POLICY_FILE` | 显式 policy（`.json` / `.yaml` / `.yml` / `.toml` 同构 v1）；优先于默认路径 | 否（勿提交含密钥的 policy） |

旁路文件（与 sessions 同目录时常有）：`subagents.json` · `goals.json`。

热更新契约（DSH settings-file）：`settings.yaml` / `host-settings.json` **解析失败时保留上一份有效配置**（warn，不静默清空）；落盘合并若磁盘已损坏则 **拒绝覆盖** 并回滚内存 mutate（`settings-persist-failed`），禁止半生效后静默继续。

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
| `XRK_PRESET` | Host 入口默认徽章：`minimal` \| `shell` \| `frugal` \| `plan` \| `shallow` \| `harness` \| `server`（`server` = harness 工具 + Host factory；会话徽章见 [profiles.md](./profiles.md)） |
| `XRK_WORKSPACE` | workspace 根 |
| `XRK_WEB_DIST` | 产品壳静态根。默认：CLI 包内 `product-web/`，或 monorepo `apps/web/dist`。设了则必须已存在 |
| `XRK_SESSIONS_DIR` | 会话持久化目录（`sessions.db` · WAL · 独占 `sessions.write.lock`）；第二 Host 拒绝抢写 | Host 省略 = 内存（CLI serve 另有默认） |
| `XRK_PLUGINS_DIR` | 进程插件根；`web/` 子目录为客户端叠加。未设时：若 `{XRK_HOME}/plugins` 已存在（`xrkh plugin add` 会创建）则用该目录 |
| `XRK_SKILLS_DIR` | 工作区 skills 根（`xrkh skill` add/list/remove/path 落点）。未设 = `{workspace}/.agents/skills`；相对路径按工作区解析 — 见 [skills-layers.md](./skills-layers.md) |
| `XRK_DUMP_SESSION` | 非空时 CLI `run` 向 stderr dump session JSONL（与 `--json` 互斥：已开 `--json` 时不再二次 dump） |

### SSH 远端工作区（Host / CI）

本地 Host、远端 cwd：文件 / bash / `run_code` 走 OpenSSH，无模型侧 `ssh_*` 工具。设齐 `XRK_SSH_HOST` 与 `XRK_SSH_WORKSPACE` 后，`workspaceRoot` 取远端绝对路径；Web 目录浏览经 SSH；交互式 PTY 与本机 `openPath` / OS 选目录关闭（见 `host.describe.remoteExecution`）。

| 变量 | 含义 |
|------|------|
| `XRK_SSH_HOST` | OpenSSH 主机或 `user@host` 别名 |
| `XRK_SSH_WORKSPACE` | 远端绝对 cwd（须 `/` 开头） |
| `XRK_SSH_USER` | 可选用户（host 已含 `user@` 时可省略） |
| `XRK_SSH_PORT` | 可选端口 |
| `XRK_SSH_KEY` | 可选私钥路径 |
| `XRK_SSH_NODE` | 远端 `run_code` 用的 Node（默认 `node`） |

用户插件 CLI：`xrkh plugin add|remove|list|path|reconcile`（亦 `xrk-harness plugin …`；见 [plugin-loader.md](./plugin-loader.md)）。

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
| `XRK_POLICY_FILE` | policy ruleset（JSON / YAML / TOML；tool / provider / mcp …） |
| `XRK_MCP_SERVERS` | 可选；非空则赢过文件（CI）。产品路径用 Settings → Plugins → MCP |
| `XRK_MCP_ALLOW` | 可选；强制 allow（CI/无头）。产品路径用 MCP「允许连接」 |
| `XRK_MCP_OAUTH_URL` · `XRK_MCP_OAUTH_CLIENT_ID` | `xrkh mcp login` 的目标 URL 与 OAuth client id（`--url` / `--client-id` 优先） |
| `XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL` · `XRK_MCP_OAUTH_TOKEN_URL` | 显式设备码端点；**两者齐备**才跳过发现 |
| `XRK_MCP_OAUTH_SCOPES` · `XRK_MCP_OAUTH_AUDIENCE` | 请求 scope（空格或逗号分隔）· `audience` |
| `XRK_MCP_OAUTH_TOKEN_DIR` | 令牌目录；默认 `~/.xrk/mcp-tokens`（`--token-dir` 优先） |
| `XRK_MCP_OAUTH_SERVERS_FILE` | 读 `mcp.servers` 的文件；默认 `~/.xrk/host-settings.json`（`--servers-file` 优先） |

行为要点：

- `mcp.connect` 默认 deny；Web「允许连接」或 `XRK_MCP_ALLOW` 才挂载
- env/config **空**时读 `~/.xrk/host-settings.json`（`servers` + `allowConnect`），Face mutate 后 **热挂载**
- HTTP MCP 的 `Authorization` 只来自 `xrkh mcp login` 写入 `<token-dir>/<server>.json` 的令牌（tmp+rename 原子写 · 尽量 0600 · 到期前 60s 自动 refresh）；未登录则匿名连接，包内不猜端点
- 端点未知时按 RFC 9728（`/.well-known/oauth-protected-resource`）→ RFC 8414 / OIDC authorization-server metadata 发现；显式 flag / env **永远**赢过发现，`--no-discovery` 可关闭
- 令牌是明文本机密钥：不进 `mcp.servers.env`、不进 session log、不入库

[policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md)。

## 工具相关

| 变量 | 含义 |
|------|------|
| `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY` | 可选 env；产品路径用 Credentials |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选 Parallel 免费 MCP URL（默认 `https://search.parallel.ai/mcp`） |
| `XRK_WEB_SEARCH_PROVIDER` | 可选钉死提供方；产品路径用 Settings → Plugins → Web search |
| `XRK_BROWSER_CDP_URL` | 可选 Chrome DevTools 地址（`http://host:9222` 或 `ws://…/devtools/browser/…`）。未设时 `browser_*` 仍走 HTTP 快照 |
| `XRK_WEB_SEARCH_REGION` | 可选 DuckDuckGo `kl`；产品路径用 Web search → region |
| `XRK_LSP_COMMAND` / `XRK_LSP_ARGS` | `lsp` stdio 语言服务器 |
| `XRK_SANDBOX_BACKEND` | `workspace`（默认）· `docker` · `bwrap` · `windows` — 见 [sandbox.md](./sandbox.md) |
| `XRK_SANDBOX_DOCKER_IMAGE` | Docker 后端镜像（`backend=docker` 时必填） |
| `XRK_SANDBOX_DOCKER_NETWORK` | `none`（默认）或 `bridge` |
| `XRK_SANDBOX_WINDOWS_HELPER` | Windows 后端 helper 二进制（`backend=windows` 时必填，缺则失败关闭） |
| `XRK_SANDBOX_WINDOWS_MODE` | `workspace-write`（默认）· `read-only` · `danger-full-access` |
| `XRK_SANDBOX_WINDOWS_NETWORK` | `none`（默认）或 `bridge` / `on` |
| `XRK_COMPUTER_USE` | `1`（Windows UIA）、`memory` 或 `background` — 见 [computer-use.md](./computer-use.md) |
| （无单独开关） | 策展记忆默认开：`{XRK_HOME}/memories/MEMORY.md` · `USER.md` — 见 [curated-memory.md](./curated-memory.md) |
| `XRK_CRON` | `0` 关闭 Host cron ticker；默认开 — 见 [cron.md](./cron.md) |
| `XRK_ACP_AGENT` | `subagent.runtime=acp` 时必填的 spawn 命令（如 `xrkh acp`）— 见 [external-agent.md](./external-agent.md) |
| `XRK_CODEX_APP_SERVER` | `runtime=app-server` 命令；默认 `codex app-server` |
| `XRK_CLAUDE_CODE` | `runtime=claude-code` 命令；默认 `claude`（加 `-p`） |
| `XRK_VOICE` | `memory` 或 `1`（+ OpenAI key）启用语音 Host — 见 [voice.md](./voice.md) |
| `XRK_VOICE_OPENAI_KEY` / `OPENAI_API_KEY` | `XRK_VOICE=1` 时 TTS/STT/realtime |
| `XRK_VOICE_BASE_URL` | 可选兼容端点（默认 `https://api.openai.com/v1`） |
| `XRK_IMAGE_GEN` | `memory` 或 `1`（+ OpenAI key）启用文生图 — 见 [image-gen.md](./image-gen.md) |
| `XRK_IMAGE_GEN_OPENAI_KEY` / `OPENAI_API_KEY` | `XRK_IMAGE_GEN=1` 时 Images API |
| `XRK_IMAGE_GEN_BASE_URL` | 可选兼容端点 |
| `XRK_IMAGE_GEN_MODEL` | 可选模型（默认 `dall-e-3`） |
| `XRK_VIDEO_GEN` | `memory` 或 `1`（+ OpenAI key）启用文生视频 — 见 [video-gen.md](./video-gen.md) |
| `XRK_VIDEO_GEN_OPENAI_KEY` / `OPENAI_API_KEY` | `XRK_VIDEO_GEN=1` 时 Videos API |
| `XRK_VIDEO_GEN_BASE_URL` | 可选兼容端点 |
| `XRK_VIDEO_GEN_MODEL` | 可选模型（默认 `sora-2`） |
| `XRK_TELEMETRY` | `0` 关闭 · `memory` · `1`/`otlp`（需 endpoint）— 见 [session-telemetry.md](./session-telemetry.md) |
| `XRK_TELEMETRY_OTLP_ENDPOINT` | OTLP logs URL（优先于标准 OTEL_*） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | 标准 OTel 端点；可单独作 opt-in |
| `OTEL_EXPORTER_OTLP_HEADERS` | 可选 `k=v,k2=v2` |
| `XRK_SHELL` 等 | PTY/shell 显式覆盖（见 [pty-tools.md](./pty-tools.md)；子进程会 scrub 凭据形环境变量） |

无 Tavily/Brave 密钥时：`web_search` 默认 **parallel-free**，失败回退 DuckDuckGo。无 LSP 命令时：`lsp` 仍可能登记，**execute 诚实失败**。

## Plugins 设置（端到端）

壳内路径：**设置 → 插件 → 插件配置**（不要停在「会话导入」）。展开 **MCP 服务器** · **网页搜索** · **终端**（`bash`）· **Agent 循环**（`agent-loop`）· **工作区注入**（`workspace-inject`）。亦可点「打开配置文件」编辑 `~/.xrk/settings.yaml`。

Settings → Plugins 里会动到运行时的命名空间：

| Face ns | 字段 | 生效 |
|---------|------|------|
| `mcp` | `servers` · `allowConnect` | 热挂载（文件源）；关 allow 则 park |
| `web-search` | `provider` · `region`（密钥走 Credentials） | 下次 agent 重建后作用于 `web_search` |
| `bash` | `timeoutMs` · `maxOutputBytes`（默认 **64_000**） | 下次 agent 重建后作用于 `bash` 捕获上限 |
| `agent-loop` | `maxParallelToolCalls` | 下次 agent 重建后限制同一步并行 settle 池上限 |
| `agent-loop` | `maxSteps` | 单次用户 turn 的 LLM 步数上限（默认 32） |
| `agent-loop` | `toolSettle` | `parallel`（默认，按 `isConcurrencySafe`）或 `serial` |
| `agent-loop` | `llmRetryMaxRetries` | 步内 provider 重试上限（默认 5；`0` 关闭） |
| `agent-loop` | `toolOrder` | 工具线序（settings.yaml；恰好一个 `' '` rest） |
| `agent-loop` | `maxRequestTokens` · `keepTokens` · `bufferTokens` | 软上下文预算（默认 100k / 24k / 4k）；超限 prune → compact → fail-closed |
| `agent-loop` | `toolResultMaxInlineBytes` | 工具正文 spill 上限（默认 **64_000**；`0` 同时关闭 pipeline bound 与 loop spill；全文只写 `~/.xrk/spill/tool-outputs/`） |
| `workspace-inject` | `injectMaxChars` | 下次 agent 重建后作用于 rules/skills 注入预算（默认 **32_000**） |

Tavily / Brave 密钥：Plugins → Web search 卡或 Settings → Credentials（同一槽 `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY`）。

## 社区插件 Host（可选 env）

联调 [community-plugins.md](./community-plugins.md) 社区 client 时；Host 核心不嵌入 sidecar / 厂商 SDK。日常仍优先 **Settings → Plugins**；下列供 CI / 无头。

| 变量 | 含义 |
|------|------|
| `XRK_IM_GATEWAY_URL` | 外接 IM relay 基址（HTTP health；WS `/ws` 可推导） |
| `XRK_IM_GATEWAY_WS_URL` | 显式 IM WebSocket 网关（优先于 URL 推导） |
| `XRK_IM_GATEWAY_TOKEN` | relay / WS Bearer |
| `XRK_MEMORY_EMBED_URL` | 外接向量库 HTTP（如 Qdrant）；未设则用 embedded host |
| `XRK_MEMORY_EMBED_TOKEN` | 向量库 API key（可选） |
| `XRK_MEMORY_EMBED_COLLECTION` | 集合名（可选） |
| `XRK_AUTO_REVIEW_CLASSIFIER_URL` | 外接 auto-review classifier（POST JSON，回 `verdict` 或 `decision`）；未设则用启发式 |
| `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN` | classifier Bearer（可选） |
| `XRK_GENUI_NPM_ALLOWLIST` | 逗号分隔 npm 包，合并进 GenUI component registry |
| `XRK_TONGFLOW_PYTHON` | 用户 Python 解释器（`/tongflow/scan` · `kind:python` 节点） |
| `XRK_TONGFLOW_PYTHON_SCAN` | 自定义 scan 脚本路径 |
| `XRK_TONGFLOW_PYTHON_RUNNER` | 自定义 Python 节点 runner 脚本 |

落盘：`~/.xrk/tongflow/python.json`（`command` · `scanScript` · `nodeRunner`）· `~/.xrk/genui/npm-components.json`。Host boot（`prewarmDshCompatAdapters`）会重建 embedded 向量索引并按 env 启动 IM WS。

## CLI 常用标志

```text
xrkh run|serve|web|doctor|dump-config   # 亦 xrk-harness …
  --preset · --workspace · --host · --port · --open
  serve/web: --no-persist
```

细节：`apps/cli` README · `node apps/cli/dist/bin.js --help`。

## 相关

- HTTP 端点与 SSE：[http-api.md](./http-api.md)
- Host 接线文件地图：[modules/server-host.md](./modules/server-host.md)
- 发包与 private：[publishing.md](./publishing.md)

---

# Configuration Reference

> **Audience**: End users · Integrators

Day-to-day knobs live in **Web Settings** (written to `~/.xrk/settings.yaml` / `.credentials.yaml`). Later sections list Host / CLI **environment variables and on-disk paths** for boot, CI, and headless use — not the primary end-user path. Implementation truth is in code; contract details remain in the topic documents.

## Product Settings first (recommended)

After `xrkh web`:

| Goal | In-shell path |
|------|---------------|
| Model | **Settings → Models** |
| API keys | **Settings → Credentials** (do not `export` env for routine use) |
| Default permission preset | **Settings → Permissions**; session Access chip / `/permission` |
| MCP · web search · shell · agent loop · workspace inject | **Settings → Plugins → Plugin configuration** |
| Open yaml | Settings “Open configuration file” → `{XRK_HOME}/settings.yaml` (usually `~/.xrk/settings.yaml`) |

Agent loop card: soft request budget · keep/buffer · tool-result spill. Shell card: timeout · per-stream output cap. Workspace inject card: rules/skills character budget.

## Secrets and credentials

**Never commit**: `.env`, `.xrk/.credentials.yaml`, `.xrk/settings.yaml`, and `.xrk/workspaces.json` are all gitignored. The repository ships only `.env.example` and `.xrk/*.example` templates.

| Source | Purpose | Precedence (high → low) |
|------|------|-------------------|
| Process **env** | Host auth `XRK_API_KEY`; LLM brand `apiKeyEnv` (CI/headless bypass) | Overrides same-named file keys |
| `~/.xrk/.credentials.yaml` | Face `credentials.set` persistence; **Settings → Credentials** | User home (`XRK_HOME` may override) |
| `~/.xrk/settings.yaml` | Model selection, preset, MCP desired, agent-loop, etc. | Separate from credentials |
| **Settings UI** | Same; written via Face RPC | **Recommended end-user path** |

**Development**: Leave `XRK_API_KEY` empty for local unauthenticated HTTP/Face debugging.  
**Production**: Requires a non-empty `XRK_API_KEY` and a tightened `XRK_CORS_ORIGIN` ([security-checklist.md](./security-checklist.md)).

From-scratch install: [getting-started.md](./getting-started.md).

## On-disk paths (two roots)

| Root | Purpose |
|----|------|
| **`~/.xrk`** (`XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME`) | User settings, credentials, sessions, workspace list, MCP desired — layout per `~/.xrk` convention |
| **`{workspace}/.xrk`** | Optional project assistant / context / rules / recipes; **not required** |
| **Skills** | Multi-root import: `.agents/skills` · `.xrk/skills` · `.claude/skills` and peers ([skills-layers.md](./skills-layers.md)) |

| Path | Purpose | In git |
|------|------|------|
| `~/.xrk/sessions/` | Default Session store for CLI `serve`/`web` (`sessions.db`; disable with `--no-persist`) | No |
| `~/.xrk/logs/startup-*.log` | Full Host startup failure diagnostics (terminal shows summary; Failed / Waiting sections) | No |
| `~/.xrk/settings.yaml` | Face settings source of truth (models / presets / plugins / permissions, etc.) | **No** (`.example` in repo) |
| `~/.xrk/.credentials.yaml` | API keys (write-only; persisted by `credentials.set`) | **No** |
| `~/.xrk/workspaces.json` | Sidebar workspace list | No |
| `~/.xrk/host-settings.json` | Face MCP desired; hot-mount when file-backed | No |
| `~/.xrk/mcp-tokens/<server>.json` | Device-code token written by `xrkh mcp login` (access/refresh/expiry); best-effort 0600 | No (plaintext; protected by file permissions only) |
| `{workspace}/.xrk/skills/` · `recipes/` | Optional project inject; skills also import from `.claude` / `.cursor` peers | No |
| `XRK_POLICY_FILE` | Explicit policy (`.json` / `.yaml` / `.yml` / `.toml` isomorphic v1); wins over default paths | No (do not commit policies that contain secrets) |

Sidecar files often beside sessions: `subagents.json` · `goals.json`.

Hot-reload contract (DSH settings-file): on `settings.yaml` / `host-settings.json` **parse failure, keep the last good document** (warn; never silently empty). Persist merge **refuses to overwrite** a corrupt on-disk file and rolls back in-memory mutate (`settings-persist-failed` → `settings-rejected`); no half-apply then silent continue.

### Where the Agent may write

| Target | Behavior |
|------|------|
| Inside the session **workspace root** | Readable/writable via fs / bash / PTY / LSP (permission presets and path jail) |
| **`~/.xrk`** (settings, credentials, session store, workspace list) | Written by Face / Host; **model tools cannot reach it by default** (unless the workspace is that directory) |
| Product tree `packages/*` · `extensions/*` | Same as editing a normal project only when `--workspace` / the sidebar workspace points at that tree |

Path jail: `exec-fs` `resolveWithinRoot` ([security-checklist.md](./security-checklist.md)).

## Listen and auth

| Variable | Meaning | Default / Notes |
|------|------|-------------|
| `XRK_HOST` | Bind address | Typically `127.0.0.1`; CLI rejects `0.0.0.0` |
| `XRK_PORT` | Port | Typically `8787`; tests may use `0` |
| `XRK_API_KEY` | Face/HTTP auth | Empty = **dev unauthenticated**; same-origin product-shell loopback may omit the header |
| `XRK_CORS_ORIGIN` | CORS | Default `*` |
| `XRK_RATE_LIMIT` | Per-IP requests per minute | See HTTP implementation |
| `XRK_LOG` / `XRK_LOG_LEVEL` | CLI Host log level: `silent` \| `error` \| `warn` \| `info` \| `debug` | Default `info`; CLI `--verbose` = debug, `--quiet` = warn |

## Preset · Workspace · static shell

| Variable | Meaning |
|------|------|
| `XRK_PRESET` | Host entry default badge: `minimal` \| `shell` \| `frugal` \| `plan` \| `shallow` \| `harness` \| `server` (`server` = harness tools + Host factory; session badge: [profiles.md](./profiles.md)) |
| `XRK_WORKSPACE` | Workspace root |
| `XRK_WEB_DIST` | Product-shell static root. Default: `product-web/` inside the CLI package, or monorepo `apps/web/dist`. If set, the path must already exist |
| `XRK_SESSIONS_DIR` | Session persistence directory (`sessions.db` · WAL · exclusive `sessions.write.lock`); a second Host refuses to steal the write lease | Host omit = in-memory (CLI serve has its own default) |
| `XRK_PLUGINS_DIR` | Process plugin root; `web/` subdirectory is client overlay. When unset: use `{XRK_HOME}/plugins` if it already exists (`xrkh plugin add` creates it) |
| `XRK_SKILLS_DIR` | Workspace skills root for `xrkh skill` add/list/remove/path. Unset = `{workspace}/.agents/skills`; a relative value resolves against the workspace — see [skills-layers.md](./skills-layers.md) |
| `XRK_DUMP_SESSION` | When non-empty, CLI `run` dumps session JSONL to stderr (skipped when `--json` already streams the turn) |

### SSH remote workspace (Host / CI)

Local Host, remote cwd: file / bash / `run_code` ride OpenSSH; no model-facing `ssh_*` tools. When both `XRK_SSH_HOST` and `XRK_SSH_WORKSPACE` are set, `workspaceRoot` is the remote absolute path; Web directory browse rides SSH; interactive PTY and host-local `openPath` / OS folder picker are off (see `host.describe.remoteExecution`).

| Variable | Meaning |
|------|------|
| `XRK_SSH_HOST` | OpenSSH host or `user@host` alias |
| `XRK_SSH_WORKSPACE` | Absolute remote cwd (must start with `/`) |
| `XRK_SSH_USER` | Optional user (omit when host already has `user@`) |
| `XRK_SSH_PORT` | Optional port |
| `XRK_SSH_KEY` | Optional identity file |
| `XRK_SSH_NODE` | Remote Node for `run_code` (default `node`) |

User plugin CLI: `xrkh plugin add|remove|list|path|reconcile` (also `xrk-harness plugin …`; see [plugin-loader.md](./plugin-loader.md)).

Preset selection: [profiles.md](./profiles.md).

## LLM

| Variable | Meaning |
|------|------|
| `XRK_LLM_PRESET` | Provider Registry brand id (`openrouter` · `deepseek` · `custom` …) |
| `XRK_LLM_MODEL` | Optional model override |
| `XRK_LLM_BASE_URL` | Optional baseUrl (often required for `custom`) |
| brand `apiKeyEnv` | e.g. `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY` · `OPENAI_API_KEY` (see presets table; **not** a unified `XRK_LLM_API_KEY`) |

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md).

## Policy · MCP

| Variable | Meaning |
|------|------|
| `XRK_POLICY_FILE` | policy ruleset (JSON / YAML / TOML; tool / provider / mcp …) |
| `XRK_MCP_SERVERS` | Optional; when non-empty wins over file (CI). Product path: Settings → Plugins → MCP |
| `XRK_MCP_ALLOW` | Optional; force allow (CI/headless). Product path: MCP “Allow connect” |
| `XRK_MCP_OAUTH_URL` · `XRK_MCP_OAUTH_CLIENT_ID` | Target URL and OAuth client id for `xrkh mcp login` (`--url` / `--client-id` win) |
| `XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL` · `XRK_MCP_OAUTH_TOKEN_URL` | Explicit device-code endpoints; discovery is skipped only when **both** are set |
| `XRK_MCP_OAUTH_SCOPES` · `XRK_MCP_OAUTH_AUDIENCE` | Requested scopes (space- or comma-separated) · `audience` |
| `XRK_MCP_OAUTH_TOKEN_DIR` | Token directory; default `~/.xrk/mcp-tokens` (`--token-dir` wins) |
| `XRK_MCP_OAUTH_SERVERS_FILE` | File read for `mcp.servers`; default `~/.xrk/host-settings.json` (`--servers-file` wins) |

Behavior notes:

- `mcp.connect` defaults to deny; mount only after Web “Allow connect” or `XRK_MCP_ALLOW`
- When env/config is **empty**, read `~/.xrk/host-settings.json` (`servers` + `allowConnect`) and **hot-mount** after Face mutate
- HTTP MCP `Authorization` comes only from the token `xrkh mcp login` writes to `<token-dir>/<server>.json` (atomic tmp+rename · best-effort 0600 · refreshed 60s before expiry); with no token the client connects anonymously and the package never guesses endpoints
- When endpoints are unknown, discover via RFC 9728 (`/.well-known/oauth-protected-resource`) → RFC 8414 / OIDC authorization-server metadata; explicit flags / env **always** win over discovery, `--no-discovery` disables it
- Tokens are plaintext local secrets: never in `mcp.servers.env`, never in session logs, never committed

[policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md).

## Tool-related

| Variable | Meaning |
|------|------|
| `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY` | Optional env; product path uses Credentials |
| `XRK_PARALLEL_FREE_MCP_URL` | Optional Parallel free MCP URL (default `https://search.parallel.ai/mcp`) |
| `XRK_WEB_SEARCH_PROVIDER` | Optional pinned provider; product path: Settings → Plugins → Web search |
| `XRK_BROWSER_CDP_URL` | Optional Chrome DevTools URL (`http://host:9222` or `ws://…/devtools/browser/…`). Unset keeps `browser_*` on the HTTP snapshot |
| `XRK_WEB_SEARCH_REGION` | Optional DuckDuckGo `kl`; product path: Web search → region |
| `XRK_LSP_COMMAND` / `XRK_LSP_ARGS` | `lsp` stdio language server |
| `XRK_SANDBOX_BACKEND` | `workspace` (default) · `docker` · `bwrap` · `windows` — see [sandbox.md](./sandbox.md) |
| `XRK_SANDBOX_DOCKER_IMAGE` | Docker backend image (required when `backend=docker`) |
| `XRK_SANDBOX_DOCKER_NETWORK` | `none` (default) or `bridge` |
| `XRK_SANDBOX_WINDOWS_HELPER` | Windows backend helper binary (required when `backend=windows`; fail closed without it) |
| `XRK_SANDBOX_WINDOWS_MODE` | `workspace-write` (default) · `read-only` · `danger-full-access` |
| `XRK_SANDBOX_WINDOWS_NETWORK` | `none` (default) or `bridge` / `on` |
| `XRK_COMPUTER_USE` | `1` (Windows UIA), `memory`, or `background` — see [computer-use.md](./computer-use.md) |
| (no dedicated switch) | Curated memory is on by default: `{XRK_HOME}/memories/MEMORY.md` · `USER.md` — see [curated-memory.md](./curated-memory.md) |
| `XRK_CRON` | `0` disables Host cron ticker; on by default — see [cron.md](./cron.md) |
| `XRK_ACP_AGENT` | Required spawn command when `subagent.runtime=acp` (e.g. `xrkh acp`) — see [external-agent.md](./external-agent.md) |
| `XRK_CODEX_APP_SERVER` | Command for `runtime=app-server`; default `codex app-server` |
| `XRK_CLAUDE_CODE` | Command for `runtime=claude-code`; default `claude` (plus `-p`) |
| `XRK_VOICE` | `memory` or `1` (+ OpenAI key) enables voice Host — see [voice.md](./voice.md) |
| `XRK_VOICE_OPENAI_KEY` / `OPENAI_API_KEY` | TTS/STT/realtime when `XRK_VOICE=1` |
| `XRK_VOICE_BASE_URL` | Optional compatible endpoint (default `https://api.openai.com/v1`) |
| `XRK_IMAGE_GEN` | `memory` or `1` (+ OpenAI key) enables text-to-image — see [image-gen.md](./image-gen.md) |
| `XRK_IMAGE_GEN_OPENAI_KEY` / `OPENAI_API_KEY` | Images API when `XRK_IMAGE_GEN=1` |
| `XRK_IMAGE_GEN_BASE_URL` | Optional compatible endpoint |
| `XRK_IMAGE_GEN_MODEL` | Optional model (default `dall-e-3`) |
| `XRK_VIDEO_GEN` | `memory` or `1` (+ OpenAI key) enables text-to-video — see [video-gen.md](./video-gen.md) |
| `XRK_VIDEO_GEN_OPENAI_KEY` / `OPENAI_API_KEY` | Videos API when `XRK_VIDEO_GEN=1` |
| `XRK_VIDEO_GEN_BASE_URL` | Optional compatible endpoint |
| `XRK_VIDEO_GEN_MODEL` | Optional model (default `sora-2`) |
| `XRK_TELEMETRY` | `0` off · `memory` · `1`/`otlp` (needs endpoint) — see [session-telemetry.md](./session-telemetry.md) |
| `XRK_TELEMETRY_OTLP_ENDPOINT` | OTLP logs URL (preferred over standard OTEL_*) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Standard OTel endpoints; either alone is opt-in |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional `k=v,k2=v2` |
| `XRK_SHELL` and peers | Explicit PTY/shell overrides ([pty-tools.md](./pty-tools.md); child processes scrub credential-shaped env vars) |

Without Tavily/Brave keys: `web_search` defaults to **parallel-free**, then falls back to DuckDuckGo. Without an LSP command: `lsp` may still register and **execute fails honestly**.

## Plugins settings (end-to-end)

In the shell: **Settings → Plugins → Plugin configuration** (not the Session Import tab). Expand **MCP servers**, **Web search**, **Shell** (`bash`), **Agent loop** (`agent-loop`), and **Workspace inject** (`workspace-inject`). Or use **Open configuration file** for `~/.xrk/settings.yaml`.

Settings → Plugins mutates these runtime namespaces:

| Face ns | Fields | Takes effect |
|---------|------|------|
| `mcp` | `servers` · `allowConnect` | Hot-mount (file-backed); park when allow is off |
| `web-search` | `provider` · `region` (keys via Credentials) | Applies to `web_search` after the next agent rebuild |
| `bash` | `timeoutMs` · `maxOutputBytes` (default **64_000**) | Applies to bash capture cap after the next agent rebuild |
| `agent-loop` | `maxParallelToolCalls` | Caps the parallel settle pool for one step after the next agent rebuild |
| `agent-loop` | `maxSteps` | Max LLM steps per user turn (default 32) |
| `agent-loop` | `toolSettle` | `parallel` (default, by `isConcurrencySafe`) or `serial` |
| `agent-loop` | `llmRetryMaxRetries` | In-step provider retry cap (default 5; `0` disables) |
| `agent-loop` | `toolOrder` | Tool line order (settings.yaml; exactly one `' '` rest) |
| `agent-loop` | `maxRequestTokens` · `keepTokens` · `bufferTokens` | Soft context budget (defaults 100k / 24k / 4k); over → prune → compact → fail-closed |
| `agent-loop` | `toolResultMaxInlineBytes` | Tool-result spill ceiling (default **64_000**; `0` disables both pipeline bound and loop spill; one full body under `~/.xrk/spill/tool-outputs/`) |
| `workspace-inject` | `injectMaxChars` | Rules/skills inject budget after the next agent rebuild (default **32_000**) |

Tavily / Brave keys: Plugins → Web search card or Settings → Credentials (same slots `XRK_TAVILY_API_KEY` / `XRK_BRAVE_SEARCH_API_KEY`).

## Community plugin Host (optional env)

For [community-plugins.md](./community-plugins.md) clients; the Host core does not embed sidecars or vendor SDKs. Prefer **Settings → Plugins** for day-to-day use; these are for CI / headless.

| Variable | Meaning |
|------|------|
| `XRK_IM_GATEWAY_URL` | External IM relay base (HTTP health; WS `/ws` may be inferred) |
| `XRK_IM_GATEWAY_WS_URL` | Explicit IM WebSocket gateway (overrides URL inference) |
| `XRK_IM_GATEWAY_TOKEN` | relay / WS Bearer |
| `XRK_MEMORY_EMBED_URL` | External vector HTTP (e.g. Qdrant); embedded host when unset |
| `XRK_MEMORY_EMBED_TOKEN` | Vector API key (optional) |
| `XRK_MEMORY_EMBED_COLLECTION` | Collection name (optional) |
| `XRK_AUTO_REVIEW_CLASSIFIER_URL` | External auto-review classifier (POST JSON, `verdict` or `decision`); heuristic when unset |
| `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN` | Classifier Bearer (optional) |
| `XRK_GENUI_NPM_ALLOWLIST` | Comma-separated npm packages merged into GenUI registry |
| `XRK_TONGFLOW_PYTHON` | User Python interpreter (`/tongflow/scan` · `kind:python` nodes) |
| `XRK_TONGFLOW_PYTHON_SCAN` | Custom scan script path |
| `XRK_TONGFLOW_PYTHON_RUNNER` | Custom Python node runner script |

On disk: `~/.xrk/tongflow/python.json` (`command` · `scanScript` · `nodeRunner`) · `~/.xrk/genui/npm-components.json`. Host boot (`prewarmDshCompatAdapters`) rebuilds the embedded vector index and starts IM WS when env is set.

## Common CLI flags

```text
xrkh run|serve|web|doctor|dump-config   # also xrk-harness …
  --preset · --workspace · --host · --port · --open
  serve/web: --no-persist
```

Details: `apps/cli` README · `node apps/cli/dist/bin.js --help`.

## Related

- HTTP endpoints and SSE: [http-api.md](./http-api.md)
- Host wiring file map: [modules/server-host.md](./modules/server-host.md)
- Publishing and private packages: [publishing.md](./publishing.md)
