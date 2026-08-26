# 快速开始

> **读者**：终端用户（路径 A）· 从本仓开发的贡献者（路径 B）

能力边界见 [status.md](./status.md)。日常调参走 **Web 设置**；环境变量与落盘路径全集见 [configuration.md](./configuration.md)。

## 前置

| 项 | 要求 |
|----|------|
| Node.js | **≥ 26**（`node -v`；勿被 IDE 自带 Node 抢 PATH） |
| pnpm | **仅路径 B**：`npm install -g pnpm@11.22.0`（与根 `packageManager` 同版） |

用法：**CLI**（`xrkh run`）或 **Web**（`xrkh web` / `serve`）。全局安装后主命令为 **`xrkh`**；完整 bin 名 **`xrk-harness`** 等价。

```bash
node -v    # 应 ≥ v26
```

## 路径 A：零安装试用（终端用户）

不需要 clone 本仓。工作目录即 **workspace**（任意空文件夹）。

```bash
mkdir my-agent && cd my-agent
npx @xrkseek/harness-cli web
# 或全局安装后：xrkh web
```

不要在用户主目录直接跑 `web`（cwd 会变成 workspace，Agent 可写范围过大）。`~/.xrk` 是设置/会话仓，不是项目根。浏览器打开提示地址（默认 `http://127.0.0.1:8787`）。

长任务可用模型工具 `todo_write` 维护站立计划（下一轮用户发言清空条带），必要时壳内 `/compact` 换窗。  
工作区请打开**具体项目目录**，不要指到 Desktop 根（递归列目录会制造海量工具输出；内核会 spill，但仍应避免）。

| 步骤 | 说明 |
|------|------|
| 1 | 首次启动会在 **`~/.xrk/`**（可用 `XRK_HOME` 改）创建 `settings.yaml`、会话库等；`--workspace` 只钉项目根 |
| 2 | **无 LLM 密钥**也可打开壳；发话需接模型或 `--preset minimal` + replay |
| 3 | 接真模型：**设置 → 模型 / 凭据**（推荐），见下文 |
| 4 | 可选装用户插件：`xrkh plugin add <包名>`（落到 `~/.xrk/plugins`；装完 **`xrkh restart`** 重载 Host）；`xrkh doctor` 可查看 xrk-home 与已装 community client |

**社区 client 包**（如 `dsh-wallet` · `@liustack/modsearch`）同样用 `plugin add` 安装；经自研 Host 兼容器接入。能用什么、待补什么见 [community-plugins.md](./community-plugins.md)；安装与 discover 见 [plugin-loader.md](./plugin-loader.md)。

Registry / 安装见根 [README](../README.md)。版本说明：[releases/](./releases/)。

## 路径 B：从源码（贡献者 / 本仓开发）

```bash
git clone https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
npm install -g pnpm@11.22.0   # 与 packageManager 对齐
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

| 命令 | 作用 |
|------|------|
| `xrkh web` / `serve` | 起 Host + 产品壳（默认徽章 **XRK Harness**） |
| `xrkh restart` | 停先前的 XRK Host（pid 锁）再起；不杀陌生进程 |
| `xrkh web --force` | 只停已识别为 XRK Host 的监听；非 XRK 占用则报错 |

`serve`/`web` 缺 `apps/web/dist` 时会自动跑上述三步组装；打发行版：`pnpm release:stage` / `pnpm release`。

**本仓开发注意**：仓库根下的 `.xrk/` 是**你的本地 workspace 数据**，已在 `.gitignore` 中忽略。示例模板见 `.xrk/*.example` 与根 `.env.example` — **勿把真实密钥提交进 git**（见 [security-checklist.md](./security-checklist.md)）。

无密钥 smoke：

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

插件样例：[extensions/example-tools](../extensions/example-tools)；工作区 Agent 入口：[.agents/AGENTS.md](../.agents/AGENTS.md)。

### 产品 boot 与客户端热开发（Cordis UI / HMR）

**产品 `serve` / `web` 故意省略** Cordis 历史 UI 面板与 `@xrkseek/client-hmr`（`applyXrkProductBootPolicy` · [ADR-0002](./adr/0002-no-embed-upstream.md)）。这是 UX 选择，不是缺 dist。

改 **`packages/client/*`** 客户端插件时：

| 步骤 | 命令 |
|------|------|
| 1 | 终端 A：`pnpm dev:web`（监视 `src/client` 并自动 `client:bundle`） |
| 2 | 终端 B：`node apps/cli/dist/bin.js web --workspace .`（或 `xrkh web`） |
| 3 | 浏览器 **硬刷新** 当前 Host URL（产品 boot 无 HMR 行；见 [testing.md](./testing.md)） |

改 **`apps/web` 壳** 或 `boot.json` 图：另跑 `pnpm web:build` · `pnpm web:assemble`。维护者 Face 验证台：`apps/console`（`?console=1`），**不是**产品入口。

遗留 DSH 全 Cordis scaffold + 浏览器 HMR 测例：`apps/web/tests/hmr-live.e2e.ts`（**不进** `pnpm test:web` / `pnpm check`）。

## 开发环境 vs 生产环境

| 维度 | 开发（本地） | 生产（对外 Host） |
|------|----------------|-------------------|
| Host 鉴权 | `XRK_API_KEY` **留空** → `/api/*` 免鉴权 | **必须**设非空 `XRK_API_KEY` |
| CORS | 默认 `*` 可接受 | 设 `XRK_CORS_ORIGIN` 为实际前端源 |
| 绑定 | `127.0.0.1:8787` | 反向代理 + TLS；CLI 拒绝 `0.0.0.0` |
| LLM 密钥 | **设置 → 凭据**（或 `.xrk/.credentials.yaml`）；env 仅旁路 | 同上，密钥**仅运行时**；不入库 |
| Session | `~/.xrk/sessions/sessions.db` | 备份用户主目录；`XRK_HOME` 可改 |
| 源码仓 | `.xrk/` gitignored | 部署机单独 workspace，不带开发机 `.xrk` |

密钥与优先级：[configuration.md](./configuration.md)。

## 接真模型

优先用产品壳，不必先配环境变量：

1. **设置 → 模型**：选 provider / model  
2. **设置 → 凭据**：填入 API key（写入 `~/.xrk/.credentials.yaml`）

可选：复制 `.xrk/.credentials.yaml.example` 后手写文件，或用 brand `apiKeyEnv`（如 `DEEPSEEK_API_KEY`）作无头/CI 旁路。Brand 对照：[llm-provider-presets.md](./llm-provider-presets.md)。Preset 选型：[profiles.md](./profiles.md)。

## 常用设置（不必碰 env）

启动 `web` 后：

| 目标 | 路径 |
|------|------|
| 模型与密钥 | **设置 → 模型** · **设置 → 凭据** |
| MCP / 搜索 / 终端 / Agent 循环 / 工作区注入 | **设置 → 插件 → 插件配置** |
| 默认权限档 | **设置 → 权限**；会话内 Access 芯片或 `/permission` |
| 软预算 · spill · bash 输出上限 | 插件配置 → **Agent 循环** / **终端** |

环境变量留给 Host 监听、鉴权、CI；日常调参不要靠 env。细节：[configuration.md](./configuration.md)。

## MCP（可选）

默认 **deny**。启用：壳内 **设置 → 插件 → MCP**（勾选允许连接并保存）。无头/CI 才用 `XRK_MCP_ALLOW=1`。见 [modules/mcp.md](./modules/mcp.md)。

## 社区 client 插件（可选）

```bash
xrkh plugin add dsh-wallet
xrkh plugin add @liustack/modsearch
xrkh restart
```

| 项 | 说明 |
|----|------|
| 落盘 | `~/.xrk/plugins`（`XRK_HOME` · `XRK_PLUGINS_DIR`） |
| Host | `serve` / `web` 加载内置兼容器（`extensions/dsh-compat`） |
| 边界 | Host / 持久化 / 门禁为 XRK 自研；见 [community-plugins](./community-plugins.md) |

| 文档 | 内容 |
|------|------|
| [community-plugins.md](./community-plugins.md) | Host 契约 · 已实现 / 待补 |
| [plugin-loader.md](./plugin-loader.md) | `plugin add` · discover · `host.mjs` |
| [plugin-development.md](./plugin-development.md) | 自写 `tools` / client 叠加 |

本机已装包可审计：`node scripts/dsh-community-audit.mjs`（Node ≥26）。

## 下一步

| 目标 | 文档 |
|------|------|
| 能力边界 | [status.md](./status.md) |
| 社区插件 | [community-plugins.md](./community-plugins.md) |
| 配置全集 | [configuration.md](./configuration.md) |
| HTTP / Face | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| 发布 | [publishing.md](./publishing.md) |
| 排障 | [troubleshooting.md](./troubleshooting.md) |

---

# Getting Started

> **Audience**: End users (Path A) · Contributors developing from this repository (Path B)

Capability boundaries: [status.md](./status.md). Day-to-day knobs live in **Web Settings**; full env and on-disk paths: [configuration.md](./configuration.md).

## Prerequisites

| Item | Requirement |
|------|-------------|
| Node.js | **≥ 26** (`node -v`; do not let an IDE-bundled Node preempt PATH) |
| pnpm | **Path B only**: `npm install -g pnpm@11.22.0` (match root `packageManager`) |

Usage: **CLI** (`xrkh run`) or **Web** (`xrkh web` / `serve`). After a global install the primary command is **`xrkh`**; the full bin name **`xrk-harness`** is equivalent.

```bash
node -v    # should be ≥ v26
```

## Path A: Zero-install trial (end users)

You do not need to clone this repository. The working directory is the **workspace** (any empty folder).

```bash
mkdir my-agent && cd my-agent
npx @xrkseek/harness-cli web
# or after global install: xrkh web
```

Do not run `web` directly in the user home directory (cwd becomes the workspace and the Agent writable scope becomes too large). `~/.xrk` holds settings and sessions; it is not the project root. Open the URL printed in the terminal (default `http://127.0.0.1:8787`).

For long tasks, the model can keep a standing plan with `todo_write` (cleared on the next user turn); use in-shell `/compact` when the context window needs a swap.  
Open a **concrete project folder** as the workspace — not the Desktop root (recursive listings create huge tool output; the kernel spills them, but you should still avoid that).

| Step | Notes |
|------|-------|
| 1 | First launch creates `settings.yaml`, the session store, and related files under **`~/.xrk/`** (override with `XRK_HOME`); `--workspace` only pins the project root |
| 2 | The shell opens **without an LLM key**; sending messages requires a model or `--preset minimal` plus replay |
| 3 | Connect a live model via **Settings → Models / Credentials** (recommended); see below |
| 4 | Optionally install user plugins with `xrkh plugin add <package>` (into `~/.xrk/plugins`; then **`xrkh restart`** to reload Host); `xrkh doctor` reports xrk-home and staged community clients |

**Community client packages** (for example `dsh-wallet` · `@liustack/modsearch`) also install via `plugin add` and connect through the first-party Host adapter. Implemented vs planned surfaces: [community-plugins.md](./community-plugins.md); install and discover: [plugin-loader.md](./plugin-loader.md).

Registry and install notes: root [README](../README.md). Release notes: [releases/](./releases/).

## Path B: From source (contributors / in-repo development)

```bash
git clone https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
npm install -g pnpm@11.22.0   # match packageManager
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

| Command | Effect |
|---------|--------|
| `xrkh web` / `serve` | Start Host + product shell (default badge **XRK Harness**) |
| `xrkh restart` | Stop the previous XRK Host (pid lock) and restart; does not kill unrelated processes |
| `xrkh web --force` | Stops only listeners identified as XRK Host; errors if the port is held by a non-XRK process |

When `serve`/`web` lack `apps/web/dist`, the three assemble steps above run automatically. Release staging: `pnpm release:stage` / `pnpm release`.

**In-repo development note**: `.xrk/` under the repository root is **your local workspace data** and is gitignored. Templates live in `.xrk/*.example` and root `.env.example` — **do not commit real secrets** ([security-checklist.md](./security-checklist.md)).

Keyless smoke:

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

Plugin sample: [extensions/example-tools](../extensions/example-tools); workspace agent entry: [.agents/AGENTS.md](../.agents/AGENTS.md).

### Product boot vs client dev loop (Cordis UI / HMR)

**Product `serve` / `web` intentionally omits** legacy Cordis UI panels and `@xrkseek/client-hmr` (`applyXrkProductBootPolicy` · [ADR-0002](./adr/0002-no-embed-upstream.md)). This is a deliberate UX choice, not a missing dist.

When editing **`packages/client/*`** client plugins:

| Step | Command |
|------|---------|
| 1 | Terminal A: `pnpm dev:web` (watches `src/client` and runs `client:bundle`) |
| 2 | Terminal B: `node apps/cli/dist/bin.js web --workspace .` (or `xrkh web`) |
| 3 | **Hard-refresh** the Host URL in the browser (product boot has no HMR row; see [testing.md](./testing.md)) |

For **`apps/web` shell** or `boot.json` graph changes, also run `pnpm web:build` · `pnpm web:assemble`. Maintainer Face console: `apps/console` (`?console=1`), **not** the product entry.

Legacy DSH full Cordis scaffold + browser HMR soak: `apps/web/tests/hmr-live.e2e.ts` (**not** in `pnpm test:web` / `pnpm check`).

## Development vs production

| Dimension | Development (local) | Production (public Host) |
|-----------|---------------------|--------------------------|
| Host auth | Leave `XRK_API_KEY` **empty** → `/api/*` unauthenticated | **Must** set a non-empty `XRK_API_KEY` |
| CORS | Default `*` is acceptable | Set `XRK_CORS_ORIGIN` to the real frontend origin |
| Bind | `127.0.0.1:8787` | Reverse proxy + TLS; CLI rejects `0.0.0.0` |
| LLM keys | **Settings → Credentials** (or `.xrk/.credentials.yaml`); env is a bypass only | Same; keys are **runtime-only**; never commit |
| Session | `~/.xrk/sessions/sessions.db` | Back up the user home; `XRK_HOME` may override |
| Source tree | `.xrk/` gitignored | Separate deploy workspace; do not ship a developer `.xrk` |

Credentials and precedence: [configuration.md](./configuration.md).

## Connect a live model

Prefer the product shell — no env setup required first:

1. **Settings → Models**: pick provider / model  
2. **Settings → Credentials**: enter the API key (written to `~/.xrk/.credentials.yaml`)

Optional: copy `.xrk/.credentials.yaml.example` and edit the file, or use a brand `apiKeyEnv` (for example `DEEPSEEK_API_KEY`) for headless/CI. Brand map: [llm-provider-presets.md](./llm-provider-presets.md). Preset selection: [profiles.md](./profiles.md).

## Common settings (no env required)

After starting `web`:

| Goal | Path |
|------|------|
| Model and keys | **Settings → Models** · **Settings → Credentials** |
| MCP / search / shell / agent loop / workspace inject | **Settings → Plugins → Plugin configuration** |
| Default permission preset | **Settings → Permissions**; in-session Access chip or `/permission` |
| Soft budget · spill · bash output cap | Plugin configuration → **Agent loop** / **Shell** |

Environment variables are for Host listen/auth and CI — not day-to-day tuning. Details: [configuration.md](./configuration.md).

## MCP (optional)

Default is **deny**. Enable in-shell: **Settings → Plugins → MCP** (allow connect and save). Use `XRK_MCP_ALLOW=1` only for headless/CI. See [modules/mcp.md](./modules/mcp.md).

## Community client plugins (optional)

```bash
xrkh plugin add dsh-wallet
xrkh plugin add @liustack/modsearch
xrkh restart
```

| Item | Notes |
|------|-------|
| Disk | `~/.xrk/plugins` (`XRK_HOME` · `XRK_PLUGINS_DIR`) |
| Host | `serve` / `web` load the built-in adapter (`extensions/dsh-compat`) |
| Boundary | Host, persistence, and gating are first-party XRK; see [community-plugins](./community-plugins.md) |

| Doc | Content |
|-----|---------|
| [community-plugins.md](./community-plugins.md) | Host contracts · Implemented / Planned |
| [plugin-loader.md](./plugin-loader.md) | `plugin add` · discover · `host.mjs` |
| [plugin-development.md](./plugin-development.md) | Author `tools` / client overlays |

Audit installed packages: `node scripts/dsh-community-audit.mjs` (Node ≥26).

## Next steps

| Goal | Doc |
|------|-----|
| Capability boundaries | [status.md](./status.md) |
| Community plugins | [community-plugins.md](./community-plugins.md) |
| Full configuration | [configuration.md](./configuration.md) |
| HTTP / Face | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| Publishing | [publishing.md](./publishing.md) |
| Troubleshooting | [troubleshooting.md](./troubleshooting.md) |
