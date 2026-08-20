<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

可组装的 Node 宿主 · session 事件为对话真源 · Host Face 对接产品壳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D26-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-blue.svg)](https://pnpm.io/)
[![GitHub](https://img.shields.io/badge/github-xrkseek%2FXRK--harness-black.svg)](https://github.com/xrkseek/XRK-harness)

[入门](./docs/getting-started.md) · [配置](./docs/configuration.md) · [能力矩阵](./docs/status.md) · [文档中心](./docs/README.md)

</div>

---

面向**使用本产品**的人：安装、跑起来、接模型、查能力与契约。  
不写「怎么发 GitHub Release」——那是维护者自己的流程，见文末。

---

## 这是什么

XRK-Harness（npm **`@xrkseek/*`**）是纯 **TypeScript / Node ≥26** 的 Agent 运行时与 Server Kit：

| 能力 | 说明 |
|------|------|
| **Session 为真源** | 对话与工具写在 append-only 事件日志里，可重建；turn / loop 短寿 |
| **可组装** | preset `minimal` / `harness` / `server` 只接线、不写业务逻辑 |
| **Host + Face** | HTTP、Unary RPC、双 WebSocket；浏览器产品壳随 CLI 提供 |
| **MCP** | stdio / streamable-http；可在设置里配置并热挂载 |
| **压缩与用量** | 长会话可换窗压缩；壳上可看 token / 上下文压力 |

用法只有两条：**命令行**（`run`）或 **网页**（`web` / `serve`）。

哪些已经稳定、哪些还糙，以 [docs/status.md](./docs/status.md) 为准。

---

## 怎么跑

需要 **Node.js ≥26**，包管理用 **pnpm**（版本见根 `package.json` 的 `packageManager`，当前 **11.22.0**）。

### 直接用（推荐）

```sh
mkdir my-workspace && cd my-workspace
npx @xrkseek/harness-cli web
```

或无界面、打一句 prompt：

```sh
npx @xrkseek/harness-cli run --preset minimal --prompt "ping"
```

当前目录就是 workspace。首次运行会在 `{workspace}/.xrk/` 写下本地设置与会话（勿提交进 git）。

更细的步骤：[docs/getting-started.md](./docs/getting-started.md)。

### 从本仓库源码跑

适合想改壳或跟仓调试的人：

```sh
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

无密钥自检：

```sh
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

示例：[examples/hello-agent](./examples/hello-agent)。

### 接真模型

在网页壳 **Settings → Credentials** 填写密钥（推荐）。  
也可以复制 `.xrk/.credentials.yaml.example`，或设环境变量：

```sh
export DEEPSEEK_API_KEY=…
npx @xrkseek/harness-cli serve --preset harness --workspace .
```

说明：[docs/configuration.md](./docs/configuration.md)。

---

## 现在能用到什么程度

| 域 | 状态 |
|----|------|
| 内核 · Session · Agent · 工具 · HTTP · Host Face · MCP | **能跑** |
| 多厂商 LLM Registry | **能跑** |
| 产品网页与浏览器 E2E | **未稳**（有测，但不挡日常 `pnpm check`） |
| 对外 CLI 包 `@xrkseek/harness-cli` | **能跑** |

完整说明：[docs/status.md](./docs/status.md)。

---

## 还想看什么

| 目的 | 文档 |
|------|------|
| 从零安装 / 开发与生产怎么分 | [getting-started](./docs/getting-started.md) |
| 环境变量、落盘路径 | [configuration](./docs/configuration.md) |
| 接 HTTP / Face | [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) |
| Session、压缩、事件契约 | [session](./docs/session.md) · [session-compaction](./docs/session-compaction.md) · [protocol-events](./docs/protocol-events.md) |
| 自己写工具 | [tool-pipeline](./docs/tool-pipeline.md) · [seams](./docs/seams.md) |
| 排障 | [troubleshooting](./docs/troubleshooting.md) |
| 短要点总览 | [learn](./docs/learn.md) |
| 全部专题索引 | [docs/README.md](./docs/README.md) |

---

## 仓库里有什么（使用视角）

```text
apps/cli          命令行入口（对外包名 harness-cli）
apps/web          产品壳源码（组装进 CLI 的 product-web）
packages/*        运行时库（多数仓内 private）
presets/*         接线组合
docs/             使用与契约说明
```

---

## 常见问题

**打开 `web` / `serve` 没有界面？**  
发行版 CLI 应自带产品壳。若你在本仓库源码里跑，需要先完成 `web:build` · `client:bundle` · `web:assemble`（见上文「从本仓库源码跑」）。

**MCP 连不上？**  
默认拒绝连接。在设置里配置 MCP 并放行，或设 `XRK_MCP_ALLOW=1`。见 [configuration](./docs/configuration.md) · [MCP](./docs/modules/mcp.md)。

**对话太长、上下文爆了？**  
可用压缩（loop 配置或壳内 `/compact`）。见 [session-compaction](./docs/session-compaction.md)。

更多症状表：[troubleshooting](./docs/troubleshooting.md)。

---

## 许可证

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)

---

## 维护本仓（开发者）

终端用户可忽略本节。若你在**改这个仓库、交接或发版**：

| 文档 | 用途 |
|------|------|
| [docs/audiences.md](./docs/audiences.md) | 四种读者 · 文档写作标准 |
| [docs/maintainer.md](./docs/maintainer.md) | **交接清单** · 日常命令 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献与 `pnpm check` |
| [docs/publishing.md](./docs/publishing.md) | Release / Packages |
| [AGENTS.md](./AGENTS.md) | 改码角色与红线（笔记，非用户手册） |
