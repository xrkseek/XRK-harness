# 快速开始 / Getting Started

> **读者 / Audience**：终端用户（路径 A）· 从本仓开发的贡献者（路径 B） / End users (Path A) · Contributors developing from this repository (Path B)

能力边界见 [status.md](./status.md)。环境变量与落盘路径见 [configuration.md](./configuration.md)。

Capability boundaries: [status.md](./status.md). Environment variables and on-disk paths: [configuration.md](./configuration.md).

## 前置 / Prerequisites

| 项 / Item | 要求 / Requirement |
|----|------|
| Node.js | **≥ 26**（`node -v`；勿被 IDE 自带 Node 抢 PATH / do not let an IDE-bundled Node preempt PATH） |
| pnpm | **仅路径 B / Path B only**：`npm install -g pnpm@11.22.0`（与根 `packageManager` 同版 / match root `packageManager`） |

| 用法 / Usage | **CLI**（`xrkh run`）或 **Web**（`xrkh web` / `serve`）。全局安装后主命令为 **`xrkh`**；完整 bin 名 **`xrk-harness`** 等价 / After a global install the primary command is **`xrkh`**; the full bin name **`xrk-harness`** is equivalent |

确认 Node 版本 / Verify the Node version：

```bash
node -v    # 应 ≥ v26
```

---

## 路径 A：零安装试用（终端用户） / Path A: Zero-install trial (end users)

不需要 clone 本仓。工作目录即 **workspace**（任意空文件夹）。

You do not need to clone this repository. The working directory is the **workspace** (any empty folder).

```bash
mkdir my-agent && cd my-agent
npx @xrkseek/harness-cli web
# 或全局安装后：xrkh web
```

不要在用户主目录直接跑 `web`（cwd 会变成 workspace，Agent 可写范围过大）。`~/.xrk` 是设置/会话仓，不是项目根。浏览器打开提示地址（默认 `http://127.0.0.1:8787`）。

Do not run `web` directly in the user home directory (cwd becomes the workspace and the Agent writable scope becomes too large). `~/.xrk` holds settings and sessions; it is not the project root. Open the URL printed in the terminal (default `http://127.0.0.1:8787`).

长任务可用模型工具 `todo_write` 维护站立计划（下一轮用户发言清空条带），必要时壳内 `/compact` 换窗。

For long tasks, the model can keep a standing plan with `todo_write` (cleared on the next user turn); use in-shell `/compact` when the context window needs a swap.

| 步骤 / Step | 说明 / Notes |
|------|------|
| 1 | 首次启动会在 **`~/.xrk/`**（可用 `XRK_HOME` 改）创建 `settings.yaml`、会话库等；`--workspace` 只钉项目根 / First launch creates `settings.yaml`, the session store, and related files under **`~/.xrk/`** (override with `XRK_HOME`); `--workspace` only pins the project root |
| 2 | **无 LLM 密钥**也可打开壳；发话需接模型或 `--preset minimal` + replay / The shell opens **without an LLM key**; sending messages requires a model or `--preset minimal` plus replay |
| 3 | 接真模型：Settings → Models / Credentials，或见下文「接真模型」 / Connect a live model via Settings → Models / Credentials, or see **Connect a live model** below |
| 4 | 可选装用户插件：`xrkh plugin add <包名>`（落到 `~/.xrk/plugins`；装完 **`xrkh restart`** 重载 Host） / Optionally install user plugins with `xrkh plugin add <package>` (into `~/.xrk/plugins`; then **`xrkh restart`** to reload Host) |

**社区 client 包**（如 `dsh-wallet` · `@liustack/modsearch`）同样用 `plugin add` 安装；经自研 Host 兼容器接入。能用什么、待补什么见 [community-plugins.md](./community-plugins.md)；安装与 discover 见 [plugin-loader.md](./plugin-loader.md)。

**Community client packages** (for example `dsh-wallet` · `@liustack/modsearch`) also install via `plugin add` and connect through the first-party Host adapter. Implemented vs planned surfaces: [community-plugins.md](./community-plugins.md); install and discover: [plugin-loader.md](./plugin-loader.md).

Registry / 安装见根 [README](../README.md)。版本说明：[releases/](./releases/)。

Registry and install notes: root [README](../README.md). Release notes: [releases/](./releases/).

---

## 路径 B：从源码（贡献者 / 本仓开发） / Path B: From source (contributors / in-repo development)

从源码克隆、安装依赖并组装产品壳 / Clone from source, install dependencies, and assemble the product shell：

```bash
git clone https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
npm install -g pnpm@11.22.0   # 与 packageManager 对齐
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

常用命令 / Common commands：

| 命令 / Command | 作用 / Effect |
|------|------|
| `xrkh web` / `serve` | 起 Host + 产品壳（默认徽章 **XRK Harness**） / Start Host + product shell (default badge **XRK Harness**) |
| `xrkh restart` | 停先前的 XRK Host（pid 锁）再起；不杀陌生进程 / Stop the previous XRK Host (pid lock) and restart; does not kill unrelated processes |
| `xrkh web --force` | 只停已识别为 XRK Host 的监听；非 XRK 占用则报错 / Stops only listeners identified as XRK Host; errors if the port is held by a non-XRK process |

`serve`/`web` 缺 `apps/web/dist` 时会自动跑上述三步组装；打发行版：`pnpm release:stage` / `pnpm release`。

When `serve`/`web` lack `apps/web/dist`, the three assemble steps above run automatically. Release staging: `pnpm release:stage` / `pnpm release`.

**本仓开发注意**：仓库根下的 `.xrk/` 是**你的本地 workspace 数据**，已在 `.gitignore` 中忽略。示例模板见 `.xrk/*.example` 与根 `.env.example` — **勿把真实密钥提交进 git**（见 [security-checklist.md](./security-checklist.md)）。

**In-repo development note**: `.xrk/` under the repository root is **your local workspace data** and is gitignored. Templates live in `.xrk/*.example` and root `.env.example` — **do not commit real secrets** ([security-checklist.md](./security-checklist.md)).

无密钥 smoke / Keyless smoke：

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

插件样例 / Plugin sample：[extensions/example-tools](../extensions/example-tools)；工作区 Agent 入口 / workspace agent entry：[.agents/AGENTS.md](../.agents/AGENTS.md)。

---

## 开发环境 vs 生产环境 / Development vs production

| 维度 / Dimension | 开发（本地） / Development (local) | 生产（对外 Host） / Production (public Host) |
|------|----------------|-------------------|
| Host 鉴权 / Host auth | `XRK_API_KEY` **留空** → `/api/*` 免鉴权 / leave empty → `/api/*` unauthenticated | **必须**设非空 `XRK_API_KEY` / **must** set a non-empty `XRK_API_KEY` |
| CORS | 默认 `*` 可接受 / default `*` is acceptable | 设 `XRK_CORS_ORIGIN` 为实际前端源 / set `XRK_CORS_ORIGIN` to the real frontend origin |
| 绑定 / Bind | `127.0.0.1:8787` | 反向代理 + TLS；CLI 拒绝 `0.0.0.0` / reverse proxy + TLS; CLI rejects `0.0.0.0` |
| LLM 密钥 / LLM keys | Settings / `.xrk/.credentials.yaml` / env | 同上，密钥**仅运行时**；不入库 / same; keys are **runtime-only**; never commit |
| Session | `~/.xrk/sessions/sessions.db` | 备份用户主目录；`XRK_HOME` 可改 / back up the user home; `XRK_HOME` may override |
| 源码仓 / Source tree | `.xrk/` gitignored | 部署机单独 workspace，不带开发机 `.xrk` / separate deploy workspace; do not ship a developer `.xrk` |

密钥落盘与 env 优先级 / Credential disk layout and env precedence：[configuration.md](./configuration.md#密钥与凭据--secrets-and-credentials)。

---

## 接真模型 / Connect a live model

三种等价方式（任选其一）：

Three equivalent approaches (pick one):

**1 — 产品壳（推荐） / Product shell (recommended)**

启动 `web` 后：Settings → Models 选 provider/model → Credentials 填入 API key（写入 `~/.xrk/.credentials.yaml`）。

After starting `web`: Settings → Models to choose provider/model → Credentials to enter the API key (written to `~/.xrk/.credentials.yaml`).

**2 — 工作区文件 / Workspace files**

```bash
cp .xrk/.credentials.yaml.example .xrk/.credentials.yaml
cp .xrk/settings.yaml.example .xrk/settings.yaml   # 可选
# 编辑 .credentials.yaml，填入 DEEPSEEK_API_KEY 等
npx @xrkseek/harness-cli web --workspace .
```

**3 — 环境变量 / Environment variables**

```bash
export DEEPSEEK_API_KEY=sk-...
export XRK_LLM_PRESET=deepseek   # CLI run 快捷路径；serve/web 仍读 settings
npx @xrkseek/harness-cli serve --preset harness --workspace .
```

Brand 与 `apiKeyEnv` 对照 / Brand and `apiKeyEnv` mapping：[llm-provider-presets.md](./llm-provider-presets.md)。  
Preset 选型（minimal / harness / server） / Preset selection：[profiles.md](./profiles.md)。

---

## MCP（可选） / MCP (optional)

默认 **deny**。启用：`XRK_MCP_ALLOW=1`，或 Settings → Plugins → MCP。见 [modules/mcp.md](./modules/mcp.md)。

Default is **deny**. Enable with `XRK_MCP_ALLOW=1`, or Settings → Plugins → MCP. See [modules/mcp.md](./modules/mcp.md).

---

## 社区 client 插件（可选） / Community Client Plugins (Optional)

npm 上带 `client.js`（及可选 `host.mjs`）的社区包可装到本机插件目录，与进程 `tools` 插件共用 CLI。

Community packages that ship `client.js` (and optional `host.mjs`) install into the local plugins directory and share the CLI with process `tools` plugins.

```bash
xrkh plugin add dsh-wallet
xrkh plugin add @liustack/modsearch
xrkh restart
```

| 项 / Item | 说明 / Notes |
|----|------|
| 落盘 / Disk | `~/.xrk/plugins`（`XRK_HOME` · `XRK_PLUGINS_DIR`） |
| Host | `serve` / `web` 加载内置兼容器（`extensions/dsh-compat`） / `serve` / `web` load the built-in adapter (`extensions/dsh-compat`) |
| 边界 / Boundary | Host / 持久化 / 门禁为 XRK 自研；见 [community-plugins](./community-plugins.md) / Host, persistence, and gating are first-party XRK; see [community-plugins](./community-plugins.md) |

| 文档 / Doc | 内容 / Content |
|------|------|
| [community-plugins.md](./community-plugins.md) | Host 契约 · 已实现 / 待补 / Host contracts · Implemented / Planned |
| [plugin-loader.md](./plugin-loader.md) | `plugin add` · discover · `host.mjs` |
| [plugin-development.md](./plugin-development.md) | 自写 `tools` / client 叠加 / Author `tools` / client overlays |

本机已装包可审计 / Audit installed packages：`node scripts/dsh-community-audit.mjs`（Node ≥26）。

---

## 下一步 / Next steps

| 目标 / Goal | 文档 / Doc |
|------|------|
| 能力边界 / Capability boundaries | [status.md](./status.md) |
| 社区插件 / Community plugins | [community-plugins.md](./community-plugins.md) |
| 配置全集 / Full configuration | [configuration.md](./configuration.md) |
| HTTP / Face | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| 发布 / Publishing | [publishing.md](./publishing.md) |
| 排障 / Troubleshooting | [troubleshooting.md](./troubleshooting.md) |
