<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D26-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-blue.svg)](https://pnpm.io/)
[![GitHub](https://img.shields.io/badge/github-xrkseek%2FXRK--harness-black.svg)](https://github.com/xrkseek/XRK-harness)
[![npm](https://img.shields.io/npm/v/@xrkseek/harness-cli?label=npm)](https://www.npmjs.com/package/@xrkseek/harness-cli)

</div>

---

向阳而生，驭光而行

[入门](./docs/getting-started.md) · [配置](./docs/configuration.md) · [能力矩阵](./docs/status.md) · [文档中心](./docs/README.md) · [v0.1.16 发行说明](./docs/releases/v0.1.16.md)

## 这是什么

XRK-Harness（npm **`@xrkseek/*`**）是纯 **TypeScript / Node ≥26** 的 Agent 运行时与 Server Kit。

| 能力 | 说明 |
|------|------|
| **Session 为真源** | 对话与工具写在 append-only 事件日志里，可重建；turn / loop 短寿 |
| **可组装** | preset `minimal` / `harness` / `server` 只接线、不写业务逻辑 |
| **Host + Face** | HTTP、Unary RPC、双 WebSocket；浏览器产品壳随 CLI 提供（**37** boot 插件） |
| **@ 引用** | 输入框 `@file` / `@session` 补全（Face 发现 remotes；跨会话 prepare 见 status） |
| **附件** | composer 附件栏与消息图片；本地规范化与视觉上传管线 |
| **社区 client** | `plugin add` 装 npm 社区包；自研 Host 兼容器（见 [community-plugins](./docs/community-plugins.md)） |
| **MCP** | stdio / streamable-http；在 **设置 → 插件** 配置并热挂载 |
| **压缩与用量** | 长会话可换窗压缩；壳上可看 token / 上下文压力 |

用法：**命令行**（`xrkh run`，亦名 `xrk-harness`）或 **网页**（`xrkh web` / `serve`）。能力边界见 [docs/status.md](./docs/status.md)。日常调参走 **Web 设置**，不必先配环境变量。

## 怎么跑

需要 **Node.js ≥26**。

### 直接用（推荐）

```sh
mkdir my-workspace && cd my-workspace
npx @xrkseek/harness-cli@0.1.16 web
# 全局安装后日常用缩写：xrkh web
```

默认 **harness** preset（含 `web_search` / `web_fetch`）。仅要 fs 烟测时加 `--preset minimal`。

无界面：

```sh
npx @xrkseek/harness-cli run --preset minimal --prompt "ping"
```

当前目录即 workspace。首次运行会在 `~/.xrk/` 写下用户设置与会话（可用 `XRK_HOME` 改）；`--workspace` 只钉项目根。细节：[docs/getting-started.md](./docs/getting-started.md)。

### 从本仓库源码跑

```sh
npm install -g pnpm@11.22.0   # 与 package.json → packageManager 对齐
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

无密钥自检：

```sh
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

插件样例：[extensions/example-tools](./extensions/example-tools)；工作区 Agent 入口：[.agents/AGENTS.md](./.agents/AGENTS.md)。

### 接真模型

优先：网页壳 **设置 → 模型 / 凭据**。  
可选：复制 `.xrk/.credentials.yaml.example`，或用 brand `apiKeyEnv`（如 `DEEPSEEK_API_KEY`）作无头/CI 旁路。说明：[docs/configuration.md](./docs/configuration.md)。

## 现在能用到什么程度

| 域 | 状态 |
|----|------|
| 内核 · Session · Agent · 工具 · HTTP · Host Face · MCP | **能跑** |
| 多厂商 LLM Registry | **能跑** |
| 社区 client（自研兼容器） | **能跑**（云端长连接等见 status「未做」） |
| 产品网页与浏览器 E2E | **未稳**（有测，但不挡日常 `pnpm check`） |
| 对外 CLI 包 `@xrkseek/harness-cli` | **能跑**（**v0.1.16**；主 bin **`xrkh`**，亦 **`xrk-harness`**） |

完整说明：[docs/status.md](./docs/status.md)。

## 还想看什么

| 目的 | 文档 |
|------|------|
| 从零安装 | [getting-started](./docs/getting-started.md) |
| Settings 与 env / 落盘路径 | [configuration](./docs/configuration.md) |
| 接 HTTP / Face · `@` 引用 | [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) · [references](./docs/modules/references.md) |
| 装社区 client 包 | [community-plugins](./docs/community-plugins.md) · [plugin-loader](./docs/plugin-loader.md) |
| Session、压缩、投影、事件契约 | [session](./docs/session.md) · [session-compaction](./docs/session-compaction.md) · [session-projection](./docs/modules/session-projection.md) · [protocol-events](./docs/protocol-events.md) |
| 自己写工具 / 进程插件 | [tool-pipeline](./docs/tool-pipeline.md) · [plugin-development](./docs/plugin-development.md) |
| 排障 | [troubleshooting](./docs/troubleshooting.md) |
| 短要点总览 | [learn](./docs/learn.md) |
| 版本发行说明 | [releases](./docs/releases/)（正式 [v0.1.16](./docs/releases/v0.1.16.md) · 预览 [v0.0.11](./docs/releases/v0.0.11.md)） |
| 全部专题索引 | [docs/README.md](./docs/README.md) |

## 仓库里有什么

```text
apps/cli          CLI 入口（@xrkseek/harness-cli；主 bin xrkh）
apps/web          产品壳源码（组装进 CLI product-web）
packages/client   浏览器插件（ui-conversation · ui-reference · …）
packages/context  @file / @session 引用契约（Face 发现路径）
packages/*        运行时库（仓内多为 private）
presets/*         接线组合
docs/             用法与契约教科书
```

## 常见问题

**打开 `web` / `serve` 没有界面？**  
发行版 CLI 应自带产品壳。本仓库源码需先完成 `web:build` · `client:bundle` · `web:assemble`。

**MCP 连不上？**  
默认拒绝连接。在 **设置 → 插件 → MCP** 配置并放行；无头/CI 才用 `XRK_MCP_ALLOW=1`。见 [configuration](./docs/configuration.md) · [MCP](./docs/modules/mcp.md)。

**对话太长、上下文爆了？**  
可用压缩（Settings → 插件 → Agent 循环，或壳内 `/compact`）。见 [session-compaction](./docs/session-compaction.md)。

**装了社区插件但面板报 incomplete？**  
多数路径已有自研兼容器；云端 IM 长连接、外部任务运行时等见 [community-plugins](./docs/community-plugins.md) 与 [status](./docs/status.md)「未做」。

更多：[troubleshooting](./docs/troubleshooting.md)。

## 许可证

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)

## 开发与贡献

| 文档 | 用途 |
|------|------|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 环境、`pnpm check`、契约同步 |
| [docs/maintainer.md](./docs/maintainer.md) | 日常命令 · 交接 |
| [docs/publishing.md](./docs/publishing.md) | npmjs + GitHub Release |
| [docs/audiences.md](./docs/audiences.md) | 文档读者分层 |
| [AGENTS.md](./AGENTS.md) | 改码角色与红线 |

---

# English

Grow toward the sun · ride the light

[Getting started](./docs/getting-started.md) · [Configuration](./docs/configuration.md) · [Status](./docs/status.md) · [Docs hub](./docs/README.md) · [v0.1.16 release notes](./docs/releases/v0.1.16.md)

## What this is

XRK-Harness (npm **`@xrkseek/*`**) is a pure **TypeScript / Node ≥26** Agent runtime and Server Kit.

| Capability | Description |
|------------|-------------|
| **Session as source of truth** | Dialogue and tools live in an append-only event log and are rebuildable; turn / loop are short-lived |
| **Composable** | Presets `minimal` / `harness` / `server` only wire packages; they contain no business logic |
| **Host + Face** | HTTP, unary RPC, dual WebSocket; the browser product shell ships with the CLI (**37** boot plugins) |
| **Mentions** | Composer `@file` / `@session` completion (Face discovers remotes; cross-session prepare: see status) |
| **Attachments** | Composer attachment bar and message images; local normalize and vision upload pipeline |
| **Community clients** | Install npm community packages with `plugin add`; first-party Host adapter ([community-plugins](./docs/community-plugins.md)) |
| **MCP** | stdio / streamable-http; configure and hot-mount under **Settings → Plugins** |
| **Compaction & usage** | Long sessions can compact; the shell shows token / context pressure |

Use the **CLI** (`xrkh run`, also `xrk-harness`) or the **web shell** (`xrkh web` / `serve`). Capability boundaries: [docs/status.md](./docs/status.md). Day-to-day knobs live in **Web Settings** — you do not need env vars first.

## How to run

Requires **Node.js ≥26**.

### Direct use (recommended)

```sh
mkdir my-workspace && cd my-workspace
npx @xrkseek/harness-cli@0.1.16 web
# after global install: xrkh web
```

The default preset is **harness** (includes `web_search` / `web_fetch`). For an fs-only smoke test, add `--preset minimal`.

Headless:

```sh
npx @xrkseek/harness-cli run --preset minimal --prompt "ping"
```

The current directory is the workspace. First run writes user settings and sessions under `~/.xrk/` (`XRK_HOME` may override); `--workspace` only pins the project root. Details: [docs/getting-started.md](./docs/getting-started.md).

### Run from this repository

```sh
npm install -g pnpm@11.22.0   # match package.json → packageManager
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

Keyless smoke:

```sh
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

Plugin sample: [extensions/example-tools](./extensions/example-tools); workspace agent entry: [.agents/AGENTS.md](./.agents/AGENTS.md).

### Connect a real model

Prefer: web shell **Settings → Models / Credentials**.  
Optional: copy `.xrk/.credentials.yaml.example`, or use a brand `apiKeyEnv` (e.g. `DEEPSEEK_API_KEY`) for headless/CI. Details: [docs/configuration.md](./docs/configuration.md).

## Current maturity

| Domain | Status |
|--------|--------|
| Kernel · Session · Agent · tools · HTTP · Host Face · MCP | **Working** |
| Multi-provider LLM Registry | **Working** |
| Community clients (first-party adapter) | **Working** (cloud long-lived links etc.: status **Not done**) |
| Product web & browser E2E | **Unstable** (tests exist; not gated by day-to-day `pnpm check`) |
| Public CLI package `@xrkseek/harness-cli` | **Working** (**v0.1.16**; primary bin **`xrkh`**, also **`xrk-harness`**) |

Full matrix: [docs/status.md](./docs/status.md).

## Where next

| Goal | Doc |
|------|-----|
| Install from scratch | [getting-started](./docs/getting-started.md) |
| Settings vs env / on-disk paths | [configuration](./docs/configuration.md) |
| HTTP / Face · `@` mentions | [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) · [references](./docs/modules/references.md) |
| Install community clients | [community-plugins](./docs/community-plugins.md) · [plugin-loader](./docs/plugin-loader.md) |
| Session, compaction, projection, events | [session](./docs/session.md) · [session-compaction](./docs/session-compaction.md) · [session-projection](./docs/modules/session-projection.md) · [protocol-events](./docs/protocol-events.md) |
| Author tools / process plugins | [tool-pipeline](./docs/tool-pipeline.md) · [plugin-development](./docs/plugin-development.md) |
| Troubleshoot | [troubleshooting](./docs/troubleshooting.md) |
| Short digest | [learn](./docs/learn.md) |
| Release notes | [releases](./docs/releases/) (formal [v0.1.16](./docs/releases/v0.1.16.md) · preview [v0.0.11](./docs/releases/v0.0.11.md)) |
| Full index | [docs/README.md](./docs/README.md) |

## Repository layout

```text
apps/cli          CLI entry (@xrkseek/harness-cli; primary bin xrkh)
apps/web          Product shell source (assembled into CLI product-web)
packages/client   Browser plugins (ui-conversation · ui-reference · …)
packages/context  @file / @session mention contracts (Face discovery path)
packages/*        Runtime libraries (mostly private in-repo)
presets/*         Wiring compositions
docs/             Usage and contract docs
```

## FAQ

**No UI after `web` / `serve`?**  
Released CLI builds ship the product shell. From this repository, run `web:build` · `client:bundle` · `web:assemble` first.

**MCP will not connect?**  
Connections are denied by default. Configure and allow under **Settings → Plugins → MCP**; use `XRK_MCP_ALLOW=1` only for headless/CI. See [configuration](./docs/configuration.md) · [MCP](./docs/modules/mcp.md).

**Context overflow on long chats?**  
Use compaction (Settings → Plugins → Agent loop, or in-shell `/compact`). See [session-compaction](./docs/session-compaction.md).

**Community plugin panel shows incomplete?**  
Most paths are covered by the first-party adapter; cloud IM gateways and external task runtimes are listed as planned work in [community-plugins](./docs/community-plugins.md) and [status](./docs/status.md) **Not done**.

More: [troubleshooting](./docs/troubleshooting.md).

## License

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)

## Development & contributing

| Doc | Purpose |
|-----|---------|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Environment, `pnpm check`, contract sync |
| [docs/maintainer.md](./docs/maintainer.md) | Day-to-day · handoff |
| [docs/publishing.md](./docs/publishing.md) | npmjs + GitHub Release |
| [docs/audiences.md](./docs/audiences.md) | Doc audience standard |
| [AGENTS.md](./AGENTS.md) | Coding roles and red lines |
