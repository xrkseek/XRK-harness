<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

可组装的 Node 宿主 · session 事件为对话真源 · Host Face 对接产品壳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D26-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9-blue.svg)](https://pnpm.io/)
[![GitHub](https://img.shields.io/badge/github-xrkseek%2FXRK--harness-black.svg)](https://github.com/xrkseek/XRK-harness)

[文档中心](./docs/README.md) · [能力矩阵](./docs/status.md) · [快速开始](./docs/getting-started.md) · [配置](./docs/configuration.md) · [贡献](./CONTRIBUTING.md)

</div>

---

## 目录

- [这是什么](#这是什么)
- [如果你是第一次接触](#如果你是第一次接触)
- [状态摘要](#状态摘要)
- [快速开始](#快速开始)
- [核心能力（按域）](#核心能力按域)
- [仓库布局](#仓库布局)
- [文档与开发指南](#文档与开发指南)
- [测试与质量](#测试与质量)
- [常见问题](#常见问题)
- [贡献](#贡献)
- [许可证](#许可证)

---

## 这是什么

XRK-Harness（npm scope **`@xrkseek/*`**）是纯 **TypeScript / Node ≥26** 的 Agent 运行时与 Server Kit：

| 能力 | 说明 |
|------|------|
| **Session 为真源** | 对话与工具调用以 append-only 事件日志重建；turn / loop 短寿 |
| **可组装** | `minimal` / `harness` / `server` preset **只接线、不写业务**；能力经 compose 与工具瀑布组合 |
| **Host + Face** | HTTP / Unary RPC / 双 WebSocket；产品壳 = `apps/web` + `packages/client` |
| **MCP** | stdio 与 streamable-http；文件真源下 Settings 落盘后可热挂载 |

当前以 **clone 本仓** 使用为主。npm 公开发布尚未完成（全仓 `"private": true`）。能正式用到哪一层，见 **[docs/status.md](./docs/status.md)**（Tier A / B / C）。

---

## 如果你是第一次接触

| 你想… | 从这里开始 |
|--------|------------|
| **先跑起来**（无 API key） | 下文 [快速开始](#快速开始) · [docs/getting-started.md](./docs/getting-started.md) |
| **知道能正式用多少** | [docs/status.md](./docs/status.md) |
| **接真模型 / MCP / 端口** | [docs/configuration.md](./docs/configuration.md) |
| **懂架构与包平面** | [docs/architecture.md](./docs/architecture.md) |
| **接 HTTP / Face wire** | [docs/http-api.md](./docs/http-api.md) · [docs/host-face.md](./docs/host-face.md) |
| **写工具 / 守卫 / 插件** | [docs/tool-pipeline.md](./docs/tool-pipeline.md) · [docs/seams.md](./docs/seams.md) · [docs/plugin-loader.md](./docs/plugin-loader.md) |
| **改产品壳 UI** | `apps/web` + `packages/client` · [docs/host-face.md](./docs/host-face.md) |
| **排障** | [docs/troubleshooting.md](./docs/troubleshooting.md) |
| **贡献 / Coding Agent** | [CONTRIBUTING.md](./CONTRIBUTING.md) · **[AGENTS.md](./AGENTS.md)** |
| **全索引** | [docs/README.md](./docs/README.md) |

---

## 状态摘要

以 [docs/status.md](./docs/status.md) 为准。摘要：

| 域 | 状态 |
|----|------|
| Kernel · Compose · Session · Agent · Exec · HTTP · Host Face | **能跑** |
| MCP（stdio · HTTP · 热挂载 · Plugins 卡）· Attachment | **能跑** |
| 产品 Web 全量组装 · 浏览器 E2E | **未稳**（需 `web:build` + `client:bundle` + `web:assemble`） |
| Registry 官方协议扩展 · npm 公开发布 | **未做** |

诚实分层：**A** clone 即用（CLI + Face + replay）· **B** 组装产品壳 · **C** npm registry 尚不可用。

---

## 快速开始

### 1. 前置

| 项 | 要求 |
|----|------|
| Node.js | **≥ 26**（`engines` / `.nvmrc`） |
| 包管理 | **pnpm 9**（根 `packageManager` 锁定） |

```bash
node -v    # ≥ v26
pnpm -v
```

### 2. 克隆与安装

```bash
git clone --depth=1 https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
pnpm install
pnpm build
```

### 3. 第一条命令（无 API key）

`minimal` preset 使用 **replay LLM**，不需要密钥：

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

示例说明：[examples/hello-agent](./examples/hello-agent)。

### 4. 起 Host（HTTP + Face）

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
# 等价：pnpm serve
```

- 默认监听见 [docs/http-api.md](./docs/http-api.md)（常用 `127.0.0.1:8787`）
- **未**编出 `apps/web/dist` → 回退 Face 验证台 `apps/console`
- **已**组装产品壳 → 托管完整 Web UI

健康检查：`GET /health` → `{ "ok": true }`。

### 5. 接真模型（可选）

```bash
export XRK_LLM_PRESET=openrouter
export OPENROUTER_API_KEY=…    # 密钥名由 brand 的 apiKeyEnv 决定；见配置文档
node apps/cli/dist/bin.js serve --preset harness --workspace .
```

全集：[docs/configuration.md](./docs/configuration.md) · [docs/llm-provider-presets.md](./docs/llm-provider-presets.md)。

### 6. 产品壳（可选，Tier B）

```bash
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js serve --preset server --workspace .
```

逐步说明与 MCP 开关：[docs/getting-started.md](./docs/getting-started.md)。

---

## 核心能力（按域）

| 域 | 你得到什么 | 规格 |
|----|------------|------|
| **Kernel / Compose** | 短寿 loop · C0–C2 组合叶 · 子会话 realm | [architecture](./docs/architecture.md) · [compose](./docs/compose.md) |
| **Session / Agent** | JSONL 仓 · admit / turn · 可重建消息 | [session](./docs/session.md) · [session-api](./docs/session-api.md) |
| **Tools / Exec** | 工具瀑布 · fs / bash / web / lsp / `terminal_*` · jobs | [tool-pipeline](./docs/tool-pipeline.md) · [seams](./docs/seams.md) |
| **Policy** | tool / provider / mcp 门禁；默认 MCP deny | [policy](./docs/policy.md) |
| **LLM** | Provider Registry（R0 openai-chat brands） | [llm-provider-registry](./docs/llm-provider-registry.md) |
| **HTTP / Host / Face** | REST · SSE · Face RPC · mux/host 双流 | [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) |
| **MCP** | stdio/HTTP · 重连 · Settings 热挂载 · Plugins 卡 | [modules/mcp](./docs/modules/mcp.md) |
| **产品壳** | `apps/web` + `packages/client`（serve → `dist`） | [host-face](./docs/host-face.md) · [status](./docs/status.md) |
| **CLI** | `run` · `serve` · `web` · `doctor` · `dump-config` | [apps/cli/README](./apps/cli/README.md) |
| **Presets** | minimal / harness / server（只组合） | [profiles](./docs/profiles.md) |

内核主路径可当日常 harness 用；**不是** DeepSeek Harness 二百插件全集。外壳二次创作在本仓，内核不嵌 Cordis Host。

---

## 仓库布局

```text
apps/cli · apps/web · apps/console     CLI · 产品壳 · Face 验证台
packages/client                        壳客户端包（与 apps/web 成对）
packages/*                             @xrkseek 库（kernel · compose · core* · llm · mcp · server · …）
presets/                               minimal | harness | server
extensions/                            进程插件示例
docs/                                  规格 · ADR · 模块地图
examples/                              最小端到端示例
```

包平面与依赖边：[docs/architecture.md](./docs/architecture.md) · [docs/modules/](./docs/modules/README.md)。

---

## 文档与开发指南

**文档中心**：[docs/README.md](./docs/README.md)（属性分层 ·「我想…」 · 全量索引）

| 领域 | 文档 |
|------|------|
| 入门 / 运维 | [getting-started](./docs/getting-started.md) · [configuration](./docs/configuration.md) · [troubleshooting](./docs/troubleshooting.md) · [status](./docs/status.md) |
| Session / Host | [session*](./docs/session.md) · [http-api](./docs/http-api.md) · [host-face](./docs/host-face.md) · [host-preset](./docs/host-preset.md) · [plugin-loader](./docs/plugin-loader.md) |
| LLM | [llm-provider-registry](./docs/llm-provider-registry.md) · [llm-openai-compatible](./docs/llm-openai-compatible.md) · [llm-deepseek](./docs/llm-deepseek.md) |
| Tools / Workspace | [tool-pipeline](./docs/tool-pipeline.md) · [seams](./docs/seams.md) · [web/lsp/pty/shell-jobs](./docs/web-tools.md) · [policy](./docs/policy.md) · [workspace-inject](./docs/workspace-inject.md) |
| 架构 / 决策 | [architecture](./docs/architecture.md) · [compose](./docs/compose.md) · [adr/](./docs/adr/README.md) |
| 质量 / 发布 | [testing](./docs/testing.md) · [security-checklist](./docs/security-checklist.md) · [publishing](./docs/publishing.md) |
| 包地图 | [modules/](./docs/modules/README.md) · [learn](./docs/learn.md)（已落地要点短读） |

**Coding Agent / 维护者约定**（改哪里、红线、完成定义）：**[AGENTS.md](./AGENTS.md)** — 不替代产品文档。

---

## 测试与质量

门禁与 CI 一致：`pnpm check`（需 **Node ≥26**）。

| 步 | 命令 | 含义 |
|----|------|------|
| 类型 | `tsc -b` | 项目引用 |
| 风格 | `eslint .` | 含 no-explicit-any、floating promises |
| 单测 | `vitest run` | 全仓行为回归 |
| 覆盖 | kernel ≥ 90% | `vitest.kernel.config.ts` |

| 可选 | 命令 | 说明 |
|------|------|------|
| 产品壳硬刷 | `pnpm test:web` | Host-serve Playwright；**不进** `pnpm check`；需 `apps/web/dist` + Chromium |
| 发包烟测 | `pnpm pack:smoke` | 抽样 pack；不发布、不改 `private` |

详见 [docs/testing.md](./docs/testing.md) · [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 常见问题

**Q: `serve` 打开后是简陋页面？**  
A: 未组装 `apps/web/dist`，Host 回退 `apps/console`。产品壳：`pnpm web:build && pnpm client:bundle && pnpm web:assemble`。

**Q: 如何接 OpenRouter / DeepSeek？**  
A: 设 `XRK_LLM_PRESET` + 对应 `apiKeyEnv`（如 `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY`）。见 [configuration](./docs/configuration.md)。

**Q: MCP 连不上？**  
A: 默认 deny。开发可 `XRK_MCP_ALLOW=1`，或经 Settings → Plugins → MCP 落盘（文件真源时可热挂载）。见 [modules/mcp](./docs/modules/mcp.md)。

**Q: 能 `npm install @xrkseek/harness` 吗？**  
A: 尚不可用（Phase 0 全仓 private）。见 [publishing](./docs/publishing.md)。

**Q: Node 版本报错 / PATH 里是 22？**  
A: 换系统 Node ≥26；勿让 IDE 自带 Node 抢 PATH。见 [troubleshooting](./docs/troubleshooting.md)。

更多症状表：[docs/troubleshooting.md](./docs/troubleshooting.md)。

---

## 贡献

欢迎 Issue / PR / 文档改进。

- 环境与门禁：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 切片完成定义与依赖纪律：[AGENTS.md](./AGENTS.md)
- 改契约时同步对应 `docs/*.md` + [status.md](./docs/status.md)

---

## 许可证

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)
