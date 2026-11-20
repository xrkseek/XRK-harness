# 插件表面地图

> **读者**：维护者 · 插件作者

XRK Plug（`@xrkseek/plug`）下，壳与扩展的落点分类。写插件认本表；加载社区 Host 包见 [community-plugins.md](./community-plugins.md)。

## 表面分级

| 类 | 含义 | 例子 |
|----|------|------|
| **P0 平台种子** | boot 必载、不可卸 | `ui-slots` · `ui-primitives` · `ui-layout` · `ui-theme` · `runtime` · conversation 骨架 |
| **P1 默认可停产品面** | 随产品分发；**停用入口仅限 Plugins → 插件列表里 `managed: true` 的安装项**（用户/推荐装）。boot 种子包（`ui-plan` / `ui-goal` 等）在列表可见但无停用开关 | `ui-plan`（概况）· `ui-goal` · `ui-jobs` · `ui-schedule` · `ui-release-notes` |
| **P2 可选第一方** | 设置一键装 | `xrkh-better-sidebar` · `xrkh-better-sidebar-plugin-office` · `xrk-sunflower-free` · `xrk-phone-bridge` |
| **P3 金样** | 作者模板 | 进程：`example-tools` · `example-prompt` · `example-commands` · `example-policy` · `example-hooks` · `example-llm` · `example-channel`；client：`example-composer-action` · `example-theme-tokens` · `example-shell-wallpaper` · `example-shell-pet` |

## 常用槽位

| 槽位 | 用途 |
|------|------|
| `shell.overlay` | 全壳叠层（壁纸 · 宠物） |
| `conversation.session.header.utilities` | 会话头工具钮 |
| `conversation.input.right` | 输入区右侧动作 |
| `settings.plugin.item` | Settings 插件行扩展卡 |
| `betterSidebar.registerTab` / `registerFileViewer` | 第一方侧栏扩展（P2） |

常量入口：`XRK_PLUG.slots`（`@xrkseek/plug`）。

## 几何与 DOM 契约（第一方）

| 真源 | 说明 |
|------|------|
| `data-xrk-frame` | 壳根锚点；第一方 CSS 只选它 |
| `--xrkh-workbench-width` / `--xrkh-workbench-height` | 浮动工作台几何；插件只写这对 |
| `--xrk-layout-inset-*` / `ctx.layout.insets` | 壳已占宽度（左栏 · 概况 · 底栏）；浮动层只读，用于推挤地板 |
| `XRK_PLUG.layoutFloors` · `xrkPlugPushFloor` | 建议推挤地板与算法入口（见 [sidebar-workbench](./sidebar-workbench.md)） |
| Host inbound mirror | Host 可双戳社区别名 / 镜像 `--dsh-sidebar-*`，**插件不要双写** |

`pnpm verify:first-party-plug` 门禁扫 `extensions/*`（除 inbound 适配器）禁 `dsh.client` / `@deepseek-ai/` / 遗留 `dsh-plugin-*`。

## Settings 卡 chrome

Plugins 设置卡统一：`PluginCard` 折叠/展开 + 可选标题栏 `masterSwitch`（有 `enabled` / `mode` / MCP `allowConnect` 的卡必须带）。配置-only 卡（bash 限额等）只折叠，不造假开关。表情球卡同节奏。MCP：卡片头总开关热装卸；`mcp:*` 行在「插件列表」单开（菜单仅启停）。

## 热更

| 半部 | 路径 |
|------|------|
| 进程 | Settings reconcile（unload / register 成对） |
| Client | soft remount（装 / 启 / 更 / 重载）· soft unload（停用 / 删除） |
| 失败 UX | 分提示：软卸载失败 vs 软重挂失败；再硬刷新 |
| 完整 HMR | 不在产品路径（仅 `pnpm dev:web`） |

## 第一方审计（CSS / 作者面）

| 包 | DOM / CSS | 作者面 |
|----|-----------|--------|
| `xrkh-better-sidebar` | 只写 `--xrkh-workbench-*`；选 `data-xrk-frame` | `xrk.client` · zh/en/ja |
| `xrkh-better-sidebar-plugin-office` | 同上侧栏扩展点 | `xrk.client` · zh/en/ja |
| `xrk-sunflower-free` · `xrk-phone-bridge` | 无社区几何双写 | XRK Plug |
| `example-shell-*` · `example-theme-tokens` | 金样只示范 XRK 槽位 / token | XRK Plug |

## 首个安全抽离（设计）

| 候选 | 现状 | 条件 |
|------|------|------|
| `ui-release-notes` | P1 默认可停 | 文档面独立、无 layout 耦合 → **优先**升独立可选包 |
| `ui-schedule` / `ui-goal` | P1 | 需确认无 conversation 硬依赖 |
| `dsh-compat` Host 夹 | 内置适配 | 产品线 **0.9** 整夹迁 `@xrkseek/dsh-compat`（另表） |

抽离前：表面地图改类 → status 标「未做/进行中」→ 再动 boot 清单。细节见 [status.md](./status.md)。

---

# Plugin surface map

> **Audience**: Maintainers · Plugin authors

Under XRK Plug (`@xrkseek/plug`), where shell and extensions land. Author against this map; loading community Host packages is [community-plugins.md](./community-plugins.md).

## Surface classes

| Class | Meaning | Examples |
|-------|---------|----------|
| **P0 platform seed** | Boot-required, not unloadable | `ui-slots` · `ui-primitives` · `ui-layout` · `ui-theme` · `runtime` · conversation skeleton |
| **P1 default-on product** | Shipped; **disable only for `managed: true` rows in Plugins → Plugin list** (user/recommended installs). Boot seeds (`ui-plan` / `ui-goal` …) appear in the list without a stop switch | `ui-plan` · `ui-goal` · `ui-jobs` · `ui-schedule` · `ui-release-notes` |
| **P2 optional first-party** | One-click install | `xrkh-better-sidebar` · office · `xrk-sunflower-free` · `xrk-phone-bridge` |
| **P3 gold samples** | Author templates | Process: `example-tools` · `example-prompt` · `example-commands` · `example-policy` · `example-hooks` · `example-llm` · `example-channel`; client: `example-composer-action` · `example-theme-tokens` · `example-shell-wallpaper` · `example-shell-pet` |

## Common slots

| Slot | Use |
|------|-----|
| `shell.overlay` | Full-shell overlays (wallpaper · pet) |
| `conversation.session.header.utilities` | Session-header utility buttons |
| `conversation.input.right` | Composer right-side actions |
| `settings.plugin.item` | Settings plugin-row cards |
| `betterSidebar.registerTab` / `registerFileViewer` | First-party sidebar extensions (P2) |

Constants: `XRK_PLUG.slots` (`@xrkseek/plug`).

## Geometry / DOM contract (first-party)

| Source | Rule |
|--------|------|
| `data-xrk-frame` | Shell root; first-party CSS selects this only |
| `--xrkh-workbench-width` / `--xrkh-workbench-height` | Floating workbench geometry; plugins write this pair only |
| `--xrk-layout-inset-*` / `ctx.layout.insets` | Shell-occupied width (rail · Overview · bottom); floating layers read only, for push floors |
| `XRK_PLUG.layoutFloors` · `xrkPlugPushFloor` | Advisory push floors + algorithm entry (see [sidebar-workbench](./sidebar-workbench.md)) |
| Host inbound mirror | Host may dual-stamp community aliases / mirror `--dsh-sidebar-*`; **plugins must not dual-write** |

`pnpm verify:first-party-plug` scans `extensions/*` (except the inbound adapter) and rejects `dsh.client` / `@deepseek-ai/` / legacy `dsh-plugin-*`.

## Settings card chrome

Plugins cards share `PluginCard` expand/collapse plus optional header `masterSwitch` (required when the Face field is `enabled` / `mode` / MCP `allowConnect`). Config-only cards (bash limits, …) fold only — no fake switch. Presence card matches the same rhythm. MCP: card-header master hot mount/unload; per-server `mcp:*` toggles live on Plugin list (enable/disable menu only).

## Hot path

| Half | Path |
|------|------|
| Process | Settings reconcile (unload / register pairing) |
| Client | soft remount (install / enable / update / reload) · soft unload (disable / delete) |
| Failure UX | Distinct hints: soft-unload failure vs soft-remount failure; then hard refresh |
| Full HMR | Not on the product path (`pnpm dev:web` only) |

## First-party audit (CSS / author face)

| Package | DOM / CSS | Author face |
|---------|-----------|-------------|
| `xrkh-better-sidebar` | Writes `--xrkh-workbench-*` only; selects `data-xrk-frame` | `xrk.client` · zh/en/ja |
| `xrkh-better-sidebar-plugin-office` | Same sidebar extension points | `xrk.client` · zh/en/ja |
| `xrk-sunflower-free` · `xrk-phone-bridge` | No community geometry dual-write | XRK Plug |
| `example-shell-*` · `example-theme-tokens` | Samples demonstrate XRK slots / tokens only | XRK Plug |

## First safe extract (design)

| Candidate | Today | Gate |
|-----------|-------|------|
| `ui-release-notes` | P1 default-on | Doc-only surface, no layout coupling → **prefer** optional package |
| `ui-schedule` / `ui-goal` | P1 | Confirm no hard conversation dependency |
| `dsh-compat` Host folder | Built-in adapter | Product **0.9** whole-folder extract to `@xrkseek/dsh-compat` (separate track) |

Before extracting: reclassify on this map → mark status → then change boot lists. See [status.md](./status.md).
