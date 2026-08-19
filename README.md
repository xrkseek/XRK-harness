<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

可组装的 Node 宿主 · session 事件为对话真源 · Host Face 对接产品壳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D26-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9-blue.svg)](https://pnpm.io/)
[![GitHub](https://img.shields.io/badge/github-xrkseek%2FXRK--harness-black.svg)](https://github.com/xrkseek/XRK-harness)

[文档中心](./docs/README.md) · [能力矩阵](./docs/status.md) · [配置](./docs/configuration.md) · [贡献](./CONTRIBUTING.md)

</div>

---

## 这是什么

XRK-Harness（npm scope **`@xrkseek/*`**）是纯 **TypeScript / Node ≥26** 的 Agent 运行时与 Server Kit：

| 能力 | 说明 |
|------|------|
| **Session 为真源** | 对话与工具调用以 append-only 事件日志重建；turn / loop 短寿 |
| **可组装** | `minimal` / `harness` / `server` preset **只接线、不写业务** |
| **Host + Face** | HTTP / Unary RPC / 双 WebSocket；产品壳随 CLI（`product-web/`） |
| **MCP** | stdio 与 streamable-http；Settings 落盘后可热挂载 |

两条用法：**CLI**（`run`）或 **Web**（`web` / `serve`）。没有第三套「说明书页」UI。

能力边界：[docs/status.md](./docs/status.md)。

---

## 运行

需要 **Node.js ≥26**。

### 安装

```sh
mkdir my-workspace && cd my-workspace
npx @xrkseek/harness-cli web
# 或：npx @xrkseek/harness-cli run --preset minimal --prompt "ping"
```

工作目录即 workspace；首次运行会在 `{workspace}/.xrk/` 创建本地设置与会话（**不入库**）。Packages / 发行版见 [docs/publishing.md](./docs/publishing.md)。从零步骤：[docs/getting-started.md](./docs/getting-started.md)。

### 从源码

```sh
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

`serve` / `web` 缺 `apps/web/dist` 时代编三步；打发行版与包：`pnpm release:stage` / `pnpm release`。

仓库根 `.xrk/` 为本地 workspace 数据（gitignore）；示例见 `.xrk/*.example`。无密钥 smoke：

```sh
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

示例：[examples/hello-agent](./examples/hello-agent)。逐步说明：[docs/getting-started.md](./docs/getting-started.md)。

### 接真模型

Settings → Credentials（推荐），或复制 `.xrk/.credentials.yaml.example`，或 env：

```sh
export DEEPSEEK_API_KEY=…
npx @xrkseek/harness-cli serve --preset harness --workspace .
```

见 [docs/configuration.md](./docs/configuration.md) · [docs/getting-started.md](./docs/getting-started.md)。

---

## 状态摘要

| 域 | 状态 |
|----|------|
| Kernel · Compose · Session · Agent · Exec · HTTP · Host Face · MCP | **能跑** |
| LLM Registry R1（Anthropic / OpenAI Responses / Gemini） | **能跑** |
| 产品 Web · Host-serve E2E | **未稳**（`pnpm test:web`，不进 `pnpm check`） |
| CLI 发行 | **能跑**（`@xrkseek/harness-cli` · GitHub Release + Packages） |

---

## 如果你是第一次接触

| 你想… | 打开 |
|-------|------|
| 安装 / 跑 | 上文 · [getting-started](./docs/getting-started.md) |
| 能正式用多少 | [status](./docs/status.md) |
| 环境变量 | [configuration](./docs/configuration.md) |
| HTTP / Face | [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) |
| 写工具 | [tool-pipeline](./docs/tool-pipeline.md) · [seams](./docs/seams.md) |
| 排障 | [troubleshooting](./docs/troubleshooting.md) |
| 贡献 / Agent | [CONTRIBUTING](./CONTRIBUTING.md) · [AGENTS.md](./AGENTS.md) |
| 全索引 | [docs/README.md](./docs/README.md) |

---

## 仓库布局

```text
apps/cli · apps/web              CLI（对外只发 harness-cli）· 壳源码（打进 CLI product-web）
packages/client                  壳客户端（组装进 product-web；不单独发）
packages/* · presets/*           运行时库与 preset（仓内 private）
docs/                            规格 · ADR · 模块地图
```

---

## 测试与质量

`pnpm check`（Node ≥26）：`tsc -b` · eslint · vitest · kernel coverage ≥90%。

| 可选 | 命令 |
|------|------|
| 产品壳硬刷 | `pnpm test:web` |
| 发行 | `pnpm release:stage` · `pnpm release`（Release + Packages） |

---

## 常见问题

**Q: `serve` 没有 UI？**  
A: 发行包应自带 `product-web/`；源码仓先 `web:build && client:bundle && web:assemble`。

**Q: MCP 连不上？**  
A: 默认 deny → `XRK_MCP_ALLOW=1` 或 Settings → Plugins → MCP。

**Q: 怎么发布？**  
A: `pnpm release` → GitHub Release 附件 + Packages（`@xrkseek/harness-cli`）。见 [publishing](./docs/publishing.md)。

更多：[troubleshooting](./docs/troubleshooting.md)。

---

## 贡献

[CONTRIBUTING.md](./CONTRIBUTING.md) · [AGENTS.md](./AGENTS.md)

## 许可证

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)
