# @xrkseek/plug — XRK Plug

> **读者**：插件作者 · 集成者

XRK-Harness 的**作者面插件运行时**门面。第一方与金样插件认 **XRK Plug**（`@xrkseek/plug`）。

| 半部 | 怎么写 |
|------|--------|
| 进程插件 | `xrk.plugin.json` + `kind: tools\|prompt\|commands\|host\|channel\|policy\|llm` |
| Client 半部 | `package.json` → `xrk.client` → `lib/client.js` |
| 侧栏扩展 | `ctx.betterSidebar.registerTab` / `registerFileViewer` |
| 常量 | `XRK_PLUG`（kinds · locales · frame · workbench / LayoutInsets CSS · `layoutFloors` · slots） |
| 浮动工作台推挤 | 只写 `--xrkh-workbench-*`；读 `ctx.layout.insets` / `--xrk-layout-inset-*`；地板用 `xrkPlugPushFloor` / `XRK_PLUG.layoutFloors` · [sidebar-workbench](../../docs/sidebar-workbench.md) |

教科书：[docs/plugin-development.md](../../docs/plugin-development.md) · [docs/client-plugin-development.md](../../docs/client-plugin-development.md) · [docs/plugin-surface-map.md](../../docs/plugin-surface-map.md)。

门禁：`pnpm verify:first-party-plug`（第一方 `extensions/*` 禁社区作者标记）。

---

# @xrkseek/plug — XRK Plug

> **Audience**: Plugin authors · Integrators

Author-facing **plugin runtime** facade for XRK-Harness. First-party and gold-sample plugins use **XRK Plug** (`@xrkseek/plug`).

| Half | How to author |
|------|----------------|
| Process plugin | `xrk.plugin.json` + `kind: tools\|prompt\|commands\|host\|channel\|policy\|llm` |
| Client half | `package.json` → `xrk.client` → `lib/client.js` |
| Sidebar extensions | `ctx.betterSidebar.registerTab` / `registerFileViewer` |
| Constants | `XRK_PLUG` (kinds · locales · frame · workbench / LayoutInsets CSS · `layoutFloors` · slots) |
| Floating workbench push | Write only `--xrkh-workbench-*`; read `ctx.layout.insets` / `--xrk-layout-inset-*`; floors via `xrkPlugPushFloor` / `XRK_PLUG.layoutFloors` · [sidebar-workbench](../../docs/sidebar-workbench.md) |

Textbooks: [docs/plugin-development.md](../../docs/plugin-development.md) · [docs/client-plugin-development.md](../../docs/client-plugin-development.md) · [docs/plugin-surface-map.md](../../docs/plugin-surface-map.md).

Gate: `pnpm verify:first-party-plug` (first-party `extensions/*` must not ship community author markers).
