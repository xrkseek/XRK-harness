> **读者**：集成者 · 终端用户（CLI 安装与日常命令）。

# @xrkseek/harness-cli

XRK Harness 命令行入口。日常以缩写 **`xrkh`** 为主；完整 bin 名 **`xrk-harness`** 等价可用。

## 安装

```bash
npm install -g @xrkseek/harness-cli
# 或一次性
npx @xrkseek/harness-cli@latest web
```

安装后 PATH 上会有 `xrkh` 与 `xrk-harness` 两个入口，指向同一程序。

## 命令

| 命令 | 作用 |
|------|------|
| `xrkh run` | 单次 agent 回合（参数、`-` / 管道 stdin；`--session-id` 续会话；`--json` 逐行事件） |
| `xrkh serve` | 启动 HTTP Host + Face API |
| `xrkh web` | 产品壳（静态 UI + API 代理） |
| `xrkh <preset>` | 同 `xrkh web --preset <preset>`（Host 徽章种子；id 与 `XRK_PRESET` / `--preset` 一致） |
| `xrkh plugin` | 工作区插件 install / list / remove / reconcile |
| `xrkh skill` | 工作区 skills install / list / remove / path（本地目录或 git） |
| `xrkh mcp` | HTTP MCP server 的 OAuth 设备码登录：login / logout / status / list / path |
| `xrkh acp` | stdio ACP server（编辑器把本进程当 ACP host） |
| `xrkh tui` | 薄产品 TUI：挂到本机 Host（Face HTTP + mux），流式输出 + 工具轨 + `/status` |
| `xrkh doctor` | 环境与产品目录检查 |
| `xrkh dump-config` | 输出解析后的 Host 配置（JSON） |

启动失败时：终端打印 **Failed plugins** / **Plugins waiting for services** 摘要，完整 `inspect` 报告写入 **`~/.xrk/logs/startup-*.log`**（写盘失败则整份打到 stderr）。

```bash
xrkh --help
xrkh plugin --help
```

## 示例

```bash
xrkh run "hello"
echo "summarize this" | xrkh run --preset minimal
xrkh run --json --session-id sess_… "continue"
xrkh serve --port 8787
xrkh web
xrkh frugal
xrkh plugin add ./extensions/example-tools
xrkh skill add ./skills/office-ping
xrkh skill add github:acme/skills#pdf-tools --force
xrkh skill list
xrkh mcp login linear --client-id xrk-cli --scope mcp:read
xrkh mcp status
xrkh mcp logout linear
xrkh doctor
xrkh tui --port 8787
```

### 无头 `run`

| 输入 | 行为 |
|------|------|
| 位置参数 / `--prompt` | 作为任务正文 |
| 管道 stdin（无显式任务）或单独的 `-` | 从 stdin 读任务（空管道失败） |
| `--session-id <id>` | 续写已持久化会话（默认 `~/.xrk/sessions`；未知 id 失败） |
| `--json` | stdout 为 NDJSON（`session` → `status`/`text`/`thinking`/`tool_*` → `final`）；用法错误也写 `error` 行 |
| `--no-persist` | 内存会话（进程内；跨调用无法 `--session-id`） |

### 薄 TUI（`xrkh tui`）

挂到已运行的 Host（默认 `http://127.0.0.1:8787`），复用 Face unary + `/api/events.mux`：助手流式文本、工具轨一行、本地 `/status`（与 Overview / Face slash 同源 `session.status`）。不是第二套 agent 运行时；先 `xrkh web` 再另开终端跑 `xrkh tui`。

| 输入 | 行为 |
|------|------|
| 普通行 | `session.prompt`（`mode=queue`） |
| `/status` | Face `session.status` → 同 slash 文本 |
| `/cancel` | `session.cancel` |
| `/quit` · Ctrl+D | 退出；回合中 Ctrl+C 先 cancel |

## 产品壳路径

`xrkh web` / `xrkh serve` 会按顺序解析产品静态资源：

1.  monorepo 开发：`apps/web/dist`（需先 `pnpm web:assemble`）
2.  全局安装：`product-web/`（随 npm 包发布）

## 相关文档

- [Getting started](../../docs/getting-started.md)
- [Plugin loader](../../docs/plugin-loader.md)
- [Skills and rules layers](../../docs/skills-layers.md)
- [Host / Face](../../docs/host-face.md)
