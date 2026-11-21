# 侧栏工作台（Host + 第一方原生侧栏）

> **读者**：集成者 · 贡献者

产品壳把「右侧」拆成两条轨道：

| 轨道 | 用途 | 落点 |
|------|------|------|
| 流内 `details` | 会话 **Status**（子代理 · jobs · timeline · cost · 通道；与 `/status` 同源）· **改动审阅** · **Canvas**（工作区看板）· 任务 / 上下文 | `@xrkseek/client-ui-plan`（`ctx.changesReview` 由 ui-deliverables 提供；Canvas 经 Face `canvas.list`/`get`） |
| 浮动工作台 | 文件树 · 预览 · 终端 · 浏览器 · git | Host **`/sidebar/*`** + 第一方原生 **`xrkh-better-sidebar`**（建议 ≥ 0.20.9；Office 预览另装 **`xrkh-better-sidebar-plugin-office`**） |

浮动文件/终端工作台由第一方原生插件 **`xrkh-better-sidebar`** 提供（不进产品壳默认 boot，经 **设置 → 插件** 一键安装）。Office 预览装 **`xrkh-better-sidebar-plugin-office`**。二者均为 XRK 原生插件，不是第三方社区包。完整原生清单见 [client-plugin-development.md](./client-plugin-development.md)「第一方原生产品插件」。第三方只学让位、不装完整工作台时走金样 **`example-workbench-push`**（[open-platform.md](./open-platform.md)）。

## 契约

- Host 拥有 `/sidebar/api/*` · `/sidebar/file` · PTY / agent-opens WS（见 [http-api](./http-api.md)；侧栏路径形状亦载于 [community-plugins](./community-plugins.md) 供对照）。
- 壳发布 `LayoutInsets`（`--xrk-layout-inset-details` · `--xrk-layout-inset-sidebar` · `--xrk-layout-inset-bottom` · `ctx.layout.insets`），浮动层用 CSS 变量让位 Status 栏与底栏。概况拖宽只更新 insets，**不清空**已发布的变量。
- **底栏高度（作者真源）**：调用 **`ctx.layout.reserveBottom(px)`**（`0` = 关闭）。壳写入 `--xrk-layout-inset-bottom`，并戳 `--xrkh-workbench-height` 供兼容皮肤；列宽重发**不会**冲掉该预约。
- **侧栏宽度（作者真源）**：调用 **`ctx.layout.reserveSide(px)`**（`0` = 关闭）。壳戳 `--xrkh-workbench-width`，**整框** `margin-right` 让位（对话 / 概况不被固定侧栏盖住）。勿只写 CSS 却指望 Host「自动」有社区 `layout.css`。
- **底栏水平定位**：用公开 insets——`left: var(--xrk-layout-inset-sidebar)`；`right: calc(var(--xrk-layout-inset-details) + var(--xrkh-workbench-width, 0px))`。`--xrkh-center-left` / `--xrkh-center-right` 是部分第一方 UI 的实况测量，**第三方勿当必选契约**。
- **窄窗让步（作者必读）**：三列壳在帧变窄时按「概况 → 左栏 → 对话软底」让步。左栏先收到带标签底宽（`SIDEBAR_MIN`）；再窄则**跳到**图标轨（`SIDEBAR_COLLAPSED`），AppFrame 画纯图标 chrome（不会出现「新 / 设」截断半字）。偏好仍保持打开，回宽后恢复标签列（`computeColumns` / `fitLabeledOrRail` / `DESKTOP_COEXIST_FLOOR` · `CHAT_FLOOR`）。浮动工作台推 `#root` 时用 `xrkPlugPushFloor({ shellOccupied })`（= `max(desktopCoexist, shellOccupied + chatStrip)`）；`shellOccupied` 取 `xrkPlugShellOccupied(ctx.layout.insets)` 或读 `--xrk-layout-inset-*`。视口已小于该底则 **push 0（浮层）**。算法与壳解耦——**不要**依赖产品私有 Host API。
- **手机壳**：`details` 像素可为 0（不占桌面条），但壳仍发布 `detailsOpen` / `data-xrk-layout-details-open`；**`bottom` 强制为 0**（无桌面底栏条）。浮动工作台应隐藏展开 FAB、收起抽屉（必要时隐藏整个 panel host），避免与概况关闭键抢同一角。
- **软键盘**：壳发布 `--xrk-keyboard-inset` 供 sticky 输入抬起。宽屏 / 桌面保持 `0`（避免休眠唤醒后 VV 噪声在底栏上方留空白缝）；手机 chrome / 窄 Web 可抬起。Flutter 薄壳设 `SHELL_KEYBOARD_ATTR` 时由壳自管，VV 绑定器不再改写。
- `/sidebar/api` 的 `cwd` / `repoRoot` 覆盖只能落在会话工作区之下，或作为非盘符根的祖先（嵌套 worktree → 仓库根）；越界覆盖被忽略，仍用会话 cwd 作围栏。
- 概况栏开合与宽度按**会话**记住（`localStorage`），刷新后仍在；与 `xrkh-better-sidebar` 工作台状态互不影响。
- 聊天 / Overview「改动」开文件：有 `ctx.betterSidebar` 时先 `openTab({ type: 'editor', path })`，再 Host `openPath`；未装原生侧栏时只走系统打开。**手机 APK 薄壳**（`XrkShell`）跳过 guest `openPath`，改为 `/sidebar/file?download=1` → Flutter「用其他应用打开 / 分享」。
- `type: 'editor'` 必须落在**侧栏分栏**（`splits`），不得因 `activePane` 在底栏而撑开底部面板；Host 默认 `bottomPanelAutoTerminal: false`（见 `sidebar-prefs-store`）。空底栏分栏打开会得到空白条——由原生工作台填 tab，不是壳崩溃。
- 占用工作台的侧栏插件应提供 `ctx.betterSidebar`。

## 边界（首方）

- 不迁 `ui-dockkit` 分栏引擎作产品默认右栏。
- `details` 不作为工具 Detail / 文件预览列（职责已由 Status / 原生工作台承担）。
- 终端 · 浏览器 · git UI · 多级展开树由原生 `xrkh-better-sidebar` + Host `/sidebar/*` 承载；Office 预览由原生 `xrkh-better-sidebar-plugin-office` 注册。

---

# Sidebar workbench (Host + first-party native sidebar)

> **Audience**: Integrators · Contributors

The product shell splits the right side into two tracks:

| Track | Role | Owner |
|-------|------|--------|
| In-flow `details` | Session **Status** (subagents · jobs · timeline · cost · channels; same as `/status`) · **Changes review** · **Canvas** (workspace boards) · todos / context | `@xrkseek/client-ui-plan` (`ctx.changesReview` from ui-deliverables; Canvas via Face `canvas.list`/`get`) |
| Floating workbench | File tree · preview · terminal · browser · git | Host **`/sidebar/*`** + first-party native **`xrkh-better-sidebar`** (prefer ≥ 0.20.9; Office preview via **`xrkh-better-sidebar-plugin-office`**) |

Floating file/terminal chrome is the first-party native plugin **`xrkh-better-sidebar`** (not in default product boot; one-click Install from **Settings → Plugins**). Office preview: **`xrkh-better-sidebar-plugin-office`**. Both are XRK native plugins, not third-party community packages. Full native inventory: [client-plugin-development.md](./client-plugin-development.md) (“First-party native product plugins”). For yield-only learning without the full workbench, use gold sample **`example-workbench-push`** ([open-platform.md](./open-platform.md)).

## Contract

- Host owns `/sidebar/api/*` · `/sidebar/file` · PTY / agent-opens WS (see [http-api](./http-api.md); path shapes also listed in [community-plugins](./community-plugins.md) for cross-reference).
- The shell publishes `LayoutInsets` (`--xrk-layout-inset-details`, `--xrk-layout-inset-sidebar`, `--xrk-layout-inset-bottom`, `ctx.layout.insets`); floating chrome offsets with those CSS variables. Dragging Overview width updates insets **without** clearing them.
- **Bottom height (canonical):** call **`ctx.layout.reserveBottom(px)`** (`0` = closed). The shell writes `--xrk-layout-inset-bottom` and stamps `--xrkh-workbench-height` for compat skins; column republish does **not** wipe the reservation.
- **Side width (canonical):** call **`ctx.layout.reserveSide(px)`** (`0` = closed). The shell stamps `--xrkh-workbench-width` and yields the **whole frame** via `margin-right` so conversation / Overview are not covered by the fixed side panel. Do not assume a community `layout.css` exists on Host.
- **Bottom strip horizontal edges:** use public insets — `left: var(--xrk-layout-inset-sidebar)`; `right: calc(var(--xrk-layout-inset-details) + var(--xrkh-workbench-width, 0px))`. `--xrkh-center-left` / `--xrkh-center-right` are optional live measures from some first-party UIs — **third parties must not require them**.
- **Narrow yield (shell):** the three-column solver shrinks Overview first, then the left sidebar down to its labeled floor (`SIDEBAR_MIN`); if labels still cannot fit it snaps to the icon rail (`SIDEBAR_COLLAPSED`) and AppFrame paints rail chrome (not truncated「新 / 设」). Preferences stay open — rewiden restores the labeled column. See `@xrkseek/client-ui-layout` `computeColumns` / `fitLabeledOrRail` / `DESKTOP_COEXIST_FLOOR` / `CHAT_FLOOR`.
- **Floating workbench push (plugins):** call `reserveBottom` + `reserveSide`. Cap with `xrkPlugPushFloor({ shellOccupied })` (`max(desktopCoexist, shellOccupied + chatStrip)`); `shellOccupied` from `xrkPlugShellOccupied(ctx.layout.insets)` or the matching CSS vars. When the viewport is already below that floor, float (push 0). Shell-agnostic — any shell that publishes LayoutInsets works.
- **Phone chrome:** Overview may keep `details` at 0px but still publishes `detailsOpen` / `data-xrk-layout-details-open`; **`bottom` is forced to 0** (no desktop bottom strip). Hide expand FABs and collapse drawers (and may hide the panel host) so they do not collide with Overview close.
- **Soft keyboard:** the shell publishes `--xrk-keyboard-inset` for sticky composers. Wide / desktop stays `0` (VV wake noise must not leave a blank band above a bottom workbench); phone chrome / narrow web may lift. Flutter shells that set `SHELL_KEYBOARD_ATTR` own the inset.
- `/sidebar/api` `cwd` / `repoRoot` overrides must stay under the session workspace, or be a non-filesystem-root ancestor (nested worktree → repo root); out-of-fence overrides are ignored and the session cwd remains the fence.
- Overview open bit and width are **per Session** (localStorage) and survive reload; independent of `xrkh-better-sidebar` workbench state.
- Chat / Overview Changes open-file: when `ctx.betterSidebar` is present, call `openTab({ type: 'editor', path })` then Host `openPath`; without the native sidebar, open via the OS only. **Phone APK thin shell** (`XrkShell`) skips guest `openPath` and downloads via `/sidebar/file?download=1` → Flutter share / open-with.
- `type: 'editor'` must land on the **side** split tree (`splits`), never expand the bottom panel because `activePane` is a bottom leaf; Host default `bottomPanelAutoTerminal: false` (see `sidebar-prefs-store`). Opening an empty bottom split yields a blank strip — the native workbench fills tabs; that is not a Host crash.
- Sidebar plugins that occupy the workbench should provide `ctx.betterSidebar`.

## Boundaries (first-party)

- No product-default `ui-dockkit` docking engine.
- `details` is not a tool Detail / file-preview column (that role belongs to Status / the native workbench).
- Terminal · browser · git UI · deep expandable tree stay on native `xrkh-better-sidebar` + Host `/sidebar/*`; Office preview registers via native `xrkh-better-sidebar-plugin-office`.
