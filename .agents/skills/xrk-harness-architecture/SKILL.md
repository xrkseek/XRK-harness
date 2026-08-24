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

## 与 XRK-AGT 区别

| AGT | Harness |
|-----|---------|
| `core/workspace-Core/plugin/*.js` | `extensions/*/plugin.mjs` + `createPlugin()` |
| PluginBase 事件 | ToolDefinition |
| `agents/skills/` 产品 skill | **`.agents/skills/`** |

## 下一步

- 写插件 → **`xrk-harness-monorepo`**
- 改内核 → 停止；说明需维护者角色
