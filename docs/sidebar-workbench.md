# 侧栏工作台（Host + 首方 / 社区）

> **读者**：集成者 · 贡献者

产品壳把「右侧」拆成两条轨道，不迁移 dsh 的 `ui-dockkit` / `ui-sidebar-right` 族整树：

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

## 边界（首方）

- 不迁 `ui-dockkit` 分栏引擎作产品默认右栏。
- `details` 不作为工具 Detail / 文件预览列（职责已由 Status / 工作台承担）。
- 首方薄壳**不含**：终端 · 浏览器 · git UI · 多级展开树 · MD/代码高亮 / Office 预览（这些由社区 `xrkh-better-sidebar` 或 Host API 承载）。
- 打开入口：会话头 **文件** 按钮 → `ctx.workbench.show()`；聊天路径 → `openPath`；有 `ctx.betterSidebar` 时按钮与面板均让位。

安装社区侧栏：

```bash
xrkh plugin add xrkh-better-sidebar@0.18.7
```

---

# Sidebar workbench (Host + first-party / community)

> **Audience**: Integrators · Contributors

The product shell splits the right side into two tracks; it does not port the full dsh `ui-dockkit` / `ui-sidebar-right` tree:

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

## Boundaries (first-party)

- No product-default `ui-dockkit` docking engine.
- `details` is not a tool Detail / file-preview column (that role belongs to Status / workbench).
- The thin shell **does not** ship: terminal · browser · git UI · deep expandable tree · MD/code highlight / Office preview (those stay on community `xrkh-better-sidebar` or Host APIs).
- Open entry: session-header **Files** → `ctx.workbench.show()`; chat paths → `openPath`; both the toggle and panel yield when `ctx.betterSidebar` is present.

Install the community sidebar:

```bash
xrkh plugin add xrkh-better-sidebar@0.18.7
```
