<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

向阳而生，驭光而行 · 可组装的 Node 宿主 · session 事件为对话真源 · Host Face 对接产品壳

Grow toward the sun · Assembled Node host · Session events as dialogue source of truth · Host Face for the product shell

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D26-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-blue.svg)](https://pnpm.io/)
[![GitHub](https://img.shields.io/badge/github-xrkseek%2FXRK--harness-black.svg)](https://github.com/xrkseek/XRK-harness)
[![npm](https://img.shields.io/npm/v/@xrkseek/harness-cli?label=npm)](https://www.npmjs.com/package/@xrkseek/harness-cli)

[入门 / Getting started](./docs/getting-started.md) · [配置 / Configuration](./docs/configuration.md) · [能力矩阵 / Status](./docs/status.md) · [文档中心 / Docs hub](./docs/README.md) · [v0.1.15 发行说明 / Release notes](./docs/releases/v0.1.15.md)

</div>

---

## 这是什么 / What this is

XRK-Harness（npm **`@xrkseek/*`**）是纯 **TypeScript / Node ≥26** 的 Agent 运行时与 Server Kit。

XRK-Harness (npm **`@xrkseek/*`**) is a pure **TypeScript / Node ≥26** Agent runtime and Server Kit.

| 能力 / Capability | 说明 / Description |
|------|------|
| **Session 为真源 / Session as source of truth** | 对话与工具写在 append-only 事件日志里，可重建；turn / loop 短寿 / Dialogue and tools live in an append-only event log and are rebuildable; turn / loop are short-lived |
| **可组装 / Composable** | preset `minimal` / `harness` / `server` 只接线、不写业务逻辑 / Presets only wire packages; they contain no business logic |
| **Host + Face** | HTTP、Unary RPC、双 WebSocket；浏览器产品壳随 CLI 提供（**37** boot 插件） / HTTP, unary RPC, dual WebSocket; the browser product shell ships with the CLI (**37** boot plugins) |
| **@ 引用 / Mentions** | 输入框 `@file` / `@session` 补全（Face 发现 remotes；跨会话 prepare 见 status） / Composer `@file` / `@session` completion (Face discovers remotes; cross-session prepare: see status) |
| **附件 / Attachments** | composer 附件栏与消息图片；本地规范化与视觉上传管线 / Composer attachment bar and message images; local normalize and vision upload pipeline |
| **社区 client / Community clients** | `plugin add` 装 npm 社区包；自研 Host 兼容器（见 [community-plugins](./docs/community-plugins.md)） / Install npm community packages with `plugin add`; first-party Host adapter ([community-plugins](./docs/community-plugins.md)) |
| **MCP** | stdio / streamable-http；可在设置里配置并热挂载 / Configurable in Settings with hot mount |
| **压缩与用量 / Compaction & usage** | 长会话可换窗压缩；壳上可看 token / 上下文压力 / Long sessions can compact; the shell shows token / context pressure |

用法 / Usage：**命令行**（`xrkh run`，bin 亦名 `xrk-harness`）或 **网页**（`xrkh web` / `serve`）。能力边界见 [docs/status.md](./docs/status.md)。

Use the **CLI** (`xrkh run`, also `xrk-harness`) or the **web shell** (`xrkh web` / `serve`). Capability boundaries: [docs/status.md](./docs/status.md).

---

## 怎么跑 / How to run

需要 **Node.js ≥26**。 / Requires **Node.js ≥26**.

### 直接用（推荐） / Direct use (recommended)

```sh
mkdir my-workspace && cd my-workspace
npx @xrkseek/harness-cli@0.1.15 web
# 全局安装后日常用缩写：xrkh web
```

默认 **harness** preset（含 `web_search` / `web_fetch`）。仅要 fs 烟测时加 `--preset minimal`。

The default preset is **harness** (includes `web_search` / `web_fetch`). For an fs-only smoke test, add `--preset minimal`.

无界面 / Headless：

```sh
npx @xrkseek/harness-cli run --preset minimal --prompt "ping"
```

当前目录即 workspace。首次运行会在 `{workspace}/.xrk/` 写下本地设置与会话（勿提交进 git）。细节：[docs/getting-started.md](./docs/getting-started.md)。

The current directory is the workspace. The first run writes local settings and sessions under `{workspace}/.xrk/` (do not commit secrets). Details: [docs/getting-started.md](./docs/getting-started.md).

### 从本仓库源码跑 / Run from this repository

```sh
npm install -g pnpm@11.22.0   # 与 package.json → packageManager 对齐
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

无密钥自检 / Keyless smoke：

```sh
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

插件样例 / Plugin sample：[extensions/example-tools](./extensions/example-tools)；工作区 Agent 入口 / workspace agent entry：[.agents/AGENTS.md](./.agents/AGENTS.md)。

### 接真模型 / Connect a real model

网页壳 **Settings → Credentials**，或复制 `.xrk/.credentials.yaml.example` / 设环境变量：

Use the web shell **Settings → Credentials**, or copy `.xrk/.credentials.yaml.example` / set environment variables:

```sh
export DEEPSEEK_API_KEY=…
npx @xrkseek/harness-cli serve --preset harness --workspace .
```

说明 / Details：[docs/configuration.md](./docs/configuration.md)。

---

## 现在能用到什么程度 / Current maturity

| 域 / Domain | 状态 / Status |
|----|------|
| 内核 · Session · Agent · 工具 · HTTP · Host Face · MCP | **能跑 / Working** |
| 多厂商 LLM Registry / Multi-provider LLM Registry | **能跑 / Working** |
| 社区 client（自研兼容器） / Community clients (first-party adapter) | **能跑 / Working**（云端长连接等见 status「未做 / Not done」） |
| 产品网页与浏览器 E2E / Product web & browser E2E | **未稳 / Unstable**（有测，但不挡日常 `pnpm check`） |
| 对外 CLI 包 `@xrkseek/harness-cli` | **能跑 / Working**（**v0.1.15**；主 bin **`xrkh`**，亦 **`xrk-harness`**） |

完整说明 / Full matrix：[docs/status.md](./docs/status.md)。

---

## 还想看什么 / Where next

| 目的 / Goal | 文档 / Doc |
|------|------|
| 从零安装 / Install from scratch | [getting-started](./docs/getting-started.md) |
| 环境变量、落盘路径 / Env & paths | [configuration](./docs/configuration.md) |
| 接 HTTP / Face · `@` 引用 | [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) · [references](./docs/modules/references.md) |
| 装社区 client 包 / Install community clients | [community-plugins](./docs/community-plugins.md) · [plugin-loader](./docs/plugin-loader.md) |
| Session、压缩、投影、事件契约 | [session](./docs/session.md) · [session-compaction](./docs/session-compaction.md) · [session-projection](./docs/modules/session-projection.md) · [protocol-events](./docs/protocol-events.md) |
| 自己写工具 / 进程插件 / Tools & process plugins | [tool-pipeline](./docs/tool-pipeline.md) · [plugin-development](./docs/plugin-development.md) |
| 排障 / Troubleshoot | [troubleshooting](./docs/troubleshooting.md) |
| 短要点总览 / Short digest | [learn](./docs/learn.md) |
| 版本发行说明 / Release notes | [releases](./docs/releases/)（正式 [v0.1.15](./docs/releases/v0.1.15.md) · 预览 [v0.0.11](./docs/releases/v0.0.11.md)） |
| 全部专题索引 / Full index | [docs/README.md](./docs/README.md) |

---

## 仓库里有什么 / Repository layout

```text
apps/cli          CLI entry (@xrkseek/harness-cli; primary bin xrkh)
apps/web          Product shell source (assembled into CLI product-web)
packages/client   Browser plugins (ui-conversation · ui-reference · …)
packages/context  @file / @session mention contracts (Face discovery path)
packages/*        Runtime libraries (mostly private in-repo)
presets/*         Wiring compositions
docs/             Usage and contract docs
```

---

## 常见问题 / FAQ

**打开 `web` / `serve` 没有界面？ / No UI after `web` / `serve`?**  
发行版 CLI 应自带产品壳。本仓库源码需先完成 `web:build` · `client:bundle` · `web:assemble`。  
Released CLI builds ship the product shell. From this repository, run `web:build` · `client:bundle` · `web:assemble` first.

**MCP 连不上？ / MCP will not connect?**  
默认拒绝连接。在设置里配置并放行，或设 `XRK_MCP_ALLOW=1`。见 [configuration](./docs/configuration.md) · [MCP](./docs/modules/mcp.md)。  
Connections are denied by default. Configure and allow in Settings, or set `XRK_MCP_ALLOW=1`.

**对话太长、上下文爆了？ / Context overflow on long chats?**  
可用压缩（loop 配置或壳内 `/compact`）。见 [session-compaction](./docs/session-compaction.md)。  
Use compaction (loop config or in-shell `/compact`).

**装了社区插件但面板报 incomplete？ / Community plugin panel shows incomplete?**  
多数路径已有自研兼容器；云端 IM 长连接、外部任务运行时等见 [community-plugins](./docs/community-plugins.md) 与 [status](./docs/status.md)「未做 / Not done」。  
Most paths are covered by the first-party adapter; cloud IM gateways and external task runtimes are listed as planned work.

更多 / More：[troubleshooting](./docs/troubleshooting.md)。

---

## 许可证 / License

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)

---

## 开发与贡献 / Development & contributing

| 文档 / Doc | 用途 / Purpose |
|------|------|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 环境、`pnpm check`、契约同步 / Environment, check, contract sync |
| [docs/maintainer.md](./docs/maintainer.md) | 日常命令 · 交接 / Day-to-day · handoff |
| [docs/publishing.md](./docs/publishing.md) | npmjs + GitHub Release |
| [docs/audiences.md](./docs/audiences.md) | 文档读者分层 / Doc audience standard |
| [AGENTS.md](./AGENTS.md) | 改码角色与红线 / Coding roles and red lines |
