---
name: xrk-harness-architecture
description: >-
  XRK-Harness 仓库结构与架构地图：apps、packages、presets、extensions、docs 各做什么。
  用户问项目结构、代码放哪、和 AGT 区别、刚把工作区设成 harness 仓时使用。
---

# XRK-Harness 架构地图

> 先读本 skill 再动手。契约真源：`docs/architecture.md` · `docs/modules/README.md`。

## 你是谁的工作区

| 用户 | 写哪 | 读哪 |
|------|------|------|
| **插件作者**（大多数） | `extensions/<plugin-id>/` | 本 skill · `xrk-plugin-*` |
| **内核维护者**（少数） | `packages/` · `apps/` · `presets/` | 根 `AGENTS.md` · `.cursor/skills/xrk-*` |

默认假设用户是 **插件作者**。

## 顶层目录

| 路径 | 作用 |
|------|------|
| `apps/cli` | 产品 CLI `xrkh` |
| `apps/web` | 产品壳（静态 dist） |
| `packages/kernel` · `protocol` · `core-*` | 会话 · 工具 · Agent 内核 |
| `packages/server/*` | Host · Face · HTTP · Loader |
| `packages/workspace` | inject · skills · recipes |
| `packages/exec-*` | fs · shell · web · lsp · pty |
| `presets/minimal\|harness\|server` | 组合接线（无业务逻辑） |
| `extensions/` | **进程插件**（用户写这里） |
| `docs/` | 教科书契约 |
| `.agents/` | **产品** skill · context · recipes（自动 inject / catalog） |
| `.cursor/` | **维护者** 笔记（Cursor；Host 不 inject 带 `xrk-inject: false` 的规则） |

## 数据流（插件）

```
extensions/*/xrk.plugin.json
  → server-loader discover
  → preset wireCompositionTools|Prompts|Commands
  → Face inventory + 模型工具面
```

## 与 XRK-AGT 区别（产品路径）

| AGT | Harness |
|-----|---------|
| `core/*/plugin/*.js` | `extensions/*/plugin.mjs` + `createPlugin()` |
| PluginBase 事件 | ToolDefinition + ToolPipeline |
| `agents/skills/` 产品 skill | **`.agents/skills/`** |
| AgentRuntime = **Host** | `server-host` / Face / HTTP |
| AiWorkflow 本地 loop | `core-agent` + `agent-loop` + session 事件 SSOT；AGT 已改为嵌入 SDK |

## AGT 应学习的工程纪律（非功能清单）

| 纪律 | Harness 落点 | AGT 动作 |
|------|--------------|----------|
| 能力诚实三态 | `docs/status.md` | AGT `docs/status.md` |
| 不可逆决策 ADR | `docs/adr/` | AGT `docs/adr/` |
| Host ≠ agent loop | 包平面 / ADR-0003 | ADR-0001（Host ≠ loop） |
| SDK 模块嵌入 | `@xrkseek/harness` | AGT `callAI` / `/v1`+MCP → `continueTurn` |
| 产品 vs 维护者 inject | `.agents/` vs 根 `AGENTS.md` | 已有；ADR-0003 固化 |
| 窄公共面 / 禁深依赖 | `@xrkseek/harness` SDK | AGT `pnpm add @xrkseek/harness` |

模块契约：AGT `docs/harness-module-loop.md` · [docs/integrators/agt-bridge.md](../../../docs/integrators/agt-bridge.md)。

## 下一步

- 写插件 → **`xrk-harness-monorepo`**
- 改内核 → 停止；说明需维护者角色
- 接 AGT → 优先模块 loop；勿把 Cordis UI 当 AGT 产品壳替代品
