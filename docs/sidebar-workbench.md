# 侧栏工作台（Host + 社区）

> **读者**：集成者 · 贡献者

产品壳把「右侧」拆成两条轨道：

| 轨道 | 用途 | 落点 |
|------|------|------|
| 流内 `details` | 会话 **Status**（子代理 · jobs · timeline · cost · 通道；与 `/status` 同源）· **改动审阅** · **Canvas**（工作区看板）· 任务 / 上下文 | `@xrkseek/client-ui-plan`（`ctx.changesReview` 由 ui-deliverables 提供；Canvas 经 Face `canvas.list`/`get`） |
| 浮动工作台 | 文件树 · 预览 · 终端 · 浏览器 · git | Host **`/sidebar/*`** + 社区 **`xrkh-better-sidebar`**（建议 ≥ 0.18.20） |

浮动文件/终端工作台由社区插件提供，不在首方壳内置。推荐在 **设置 → 插件** 从目录安装 `xrkh-better-sidebar`（卡片可见，点安装即可）。

## 契约

- Host 拥有 `/sidebar/api/*` · `/sidebar/file` · PTY / agent-opens WS（见 [community-plugins](./community-plugins.md) · [http-api](./http-api.md)）。
- 壳发布 `LayoutInsets`（`--xrk-layout-inset-details` 等），浮动层用 CSS 变量让位 Status 栏。
- 聊天 `openFile`：有 `ctx.betterSidebar` 时先 `openTab`（可带 path），再 `workspaces.openPath`；未装社区侧栏时走系统打开。
- 社区插件若占用工作台，应提供 `ctx.betterSidebar`。

## 边界（首方）

- 不迁 `ui-dockkit` 分栏引擎作产品默认右栏。
- `details` 不作为工具 Detail / 文件预览列（职责已由 Status / 社区工作台承担）。
- 终端 · 浏览器 · git UI · 多级展开树 · Office 预览由社区 `xrkh-better-sidebar` 或 Host API 承载。

---

# Sidebar workbench (Host + community)

> **Audience**: Integrators · Contributors

The product shell splits the right side into two tracks:

| Track | Role | Owner |
|-------|------|--------|
| In-flow `details` | Session **Status** (subagents · jobs · timeline · cost · channels; same as `/status`) · **Changes review** · **Canvas** (workspace boards) · todos / context | `@xrkseek/client-ui-plan` (`ctx.changesReview` from ui-deliverables; Canvas via Face `canvas.list`/`get`) |
| Floating workbench | File tree · preview · terminal · browser · git | Host **`/sidebar/*`** + community **`xrkh-better-sidebar`** (prefer ≥ 0.18.20) |

Floating file/terminal chrome is a community plugin, not first-party. Install **`xrkh-better-sidebar`** from **Settings → Plugins** (catalog card; click Install).

## Contract

- Host owns `/sidebar/api/*` · `/sidebar/file` · PTY / agent-opens WS (see [community-plugins](./community-plugins.md) · [http-api](./http-api.md)).
- The shell publishes `LayoutInsets` (`--xrk-layout-inset-details`, …); floating chrome offsets with those CSS variables.
- Chat `openFile`: when `ctx.betterSidebar` is present, call `openTab` (optional `path`) then `workspaces.openPath`; without the community sidebar, open via the OS.
- Community workbenches should provide `ctx.betterSidebar`.

## Boundaries (first-party)

- No product-default `ui-dockkit` docking engine.
- `details` is not a tool Detail / file-preview column (that role belongs to Status / the community workbench).
- Terminal · browser · git UI · deep expandable tree · Office preview stay on community `xrkh-better-sidebar` or Host APIs.
