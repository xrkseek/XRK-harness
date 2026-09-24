# 侧栏工作台（Host + 首方 / 社区）

> **读者**：集成者 · 贡献者

产品壳把「右侧」拆成两条轨道，**不要**把 dsh 的 `ui-dockkit` / `ui-sidebar-right` 族整树迁进首方：

| 轨道 | 用途 | 落点 |
|------|------|------|
| 流内 `details` | 会话 **Status**（子代理 · jobs · timeline · cost · 通道；与 `/status` 同源）· 任务 / 计划 / Office | `@xrkseek/client-ui-plan` |
| 浮动工作台 | 文件树 · 预览 · 终端 · 浏览器 · git | Host **`/sidebar/*`** + 社区 **`xrkh-better-sidebar`**（建议 ≥ 0.18.7） |
| 首方薄壳 | 无社区侧栏时的 Host 文件树 + 预览；`ctx.workbench` | `@xrkseek/client-ui-workbench` |

## 契约

- Host 拥有 `/sidebar/api/*` · `/sidebar/file` · PTY / agent-opens WS（见 [community-plugins](./community-plugins.md) · [http-api](./http-api.md)）。
- 壳发布 `LayoutInsets`（`--xrk-layout-inset-details` 等），浮动层用 CSS 变量让位 Status 栏。
- 聊天 `openFile`：先 `ctx.workbench.openPath`；返回 false 再 `workspaces.openPath`（社区侧栏通常 wrap 后者）。
- 社区插件若占用工作台，应提供 `ctx.betterSidebar`，首方面板让位。

## 不做（本仓首方）

- 不迁 `ui-dockkit` 分栏引擎作产品默认右栏。
- 不把 `details` 改回工具 Detail / 文件预览列（已 demoted）。

安装社区侧栏：

```bash
xrkh plugin add xrkh-better-sidebar@0.18.7
```

---

# Sidebar workbench (Host + first-party / community)

> **Audience**: Integrators · Contributors

The product shell splits the right side into two tracks. Do **not** treat a full dsh `ui-dockkit` / `ui-sidebar-right` port as the default first-party rightbar:

| Track | Role | Owner |
|-------|------|--------|
| In-flow `details` | Session **Status** (subagents · jobs · timeline · cost · channels; same as `/status`) · todos / plan / Office | `@xrkseek/client-ui-plan` |
| Floating workbench | File tree · preview · terminal · browser · git | Host **`/sidebar/*`** + community **`xrkh-better-sidebar`** (prefer ≥ 0.18.7) |
| First-party thin shell | Host tree + preview when no community sidebar; `ctx.workbench` | `@xrkseek/client-ui-workbench` |

## Contract

- Host owns `/sidebar/api/*` · `/sidebar/file` · PTY / agent-opens WS (see [community-plugins](./community-plugins.md) · [http-api](./http-api.md)).
- The shell publishes `LayoutInsets` (`--xrk-layout-inset-details`, …); floating chrome offsets with those CSS variables.
- Chat `openFile`: try `ctx.workbench.openPath` first; on false, `workspaces.openPath` (community sidebars usually wrap the latter).
- Community workbenches should provide `ctx.betterSidebar` so the builtin panel yields.

## Out of scope (first-party)

- No product-default `ui-dockkit` docking engine.
- Do not restore the demoted Detail / file-preview `details` column.

Install the community sidebar:

```bash
xrkh plugin add xrkh-better-sidebar@0.18.7
```
