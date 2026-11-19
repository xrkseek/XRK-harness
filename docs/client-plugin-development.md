# Client 插件开发（原生壳扩展）

> **读者**：集成者 · 贡献者

在产品壳上加 UI、改输入框、叠主题 token，走 **原生 `xrk.client`**，不依赖社区兼容器。进程工具仍见 [plugin-development.md](./plugin-development.md)。社区包形状与 Host 兼容面见 [community-plugins.md](./community-plugins.md)（可选；计划在 **0.9** 将兼容器迁出为独立 npm `@xrkseek/dsh-compat`）。

## 选型

| 目标 | 选 | 文档 / 金样 |
|------|----|-------------|
| 给模型新工具 | 进程 `kind: tools` | [plugin-development](./plugin-development.md) · `extensions/example-tools` |
| 追加 system 段 | 进程 `kind: prompt` | 同上 |
| 斜杠 / 命令面 | 进程 `kind: commands` | 同上 |
| **改输入框 / 槽位 UI** | **`xrk.client`** | 本文 · `extensions/example-composer-action` |
| **改配色 token** | **`xrk.client` + `ThemeRuntime`** | 本文 · `extensions/example-theme-tokens` |
| 接外部 MCP 服务器 | Settings → MCP | [modules/mcp.md](./modules/mcp.md) |
| 装第一方原生（侧栏 / 手机桥 / 向日葵） | **设置 → 插件** 或 `xrkh plugin add <npm>` | 下文「第一方原生产品插件」 |
| 装社区已有壳包 | `xrkh plugin add <npm>` | [community-plugins](./community-plugins.md) |

**不要**用 `tools` 插件改 UI；**不要**把「读当前模型」做成 Host 私有猜测 API——用会话标准工具包。

## 第一方原生产品插件

下列为本仓 / `@xrkseek` 体系**原生**插件（产品能力，不是第三方社区包，也不走 dsh-compat 作者路径）：

| 插件 | 作用 |
|------|------|
| **`xrk-sunflower-free`** | 向日葵免费模型车道（进程插件；Host 内置发现） |
| **`@xrkseek/xrk-phone-bridge`** | 远程 `phone_*` 桥（Host HTTP + client + 技能物化） |
| **`xrkh-better-sidebar`** | 标准浮动工作台（文件 / 预览 / 终端 / git / 浏览器；Host 拥有 `/sidebar/*`） |
| **`xrkh-better-sidebar-plugin-office`** | 侧栏 Office 预览扩展（docx / xlsx / pptx） |

金样（`extensions/example-*`）只教写法；上表是产品面真插件。侧栏契约见 [sidebar-workbench.md](./sidebar-workbench.md)。

## 最小 client 包

```text
my-composer-action/
  package.json          # name · xrk.client · exports["./client"]
  lib/client.js         # window.__ModuleLoader__.load({ id, factory })
```

`package.json` 要点：

```json
{
  "name": "my-composer-action",
  "version": "0.1.0",
  "exports": { "./client": "./lib/client.js" },
  "xrk": {
    "client": {
      "inject": [
        "@xrkseek/client-runtime",
        "@xrkseek/client-ui-conversation",
        "@xrkseek/client-ui-model-selection"
      ],
      "platform": "web"
    }
  }
}
```

`lib/client.js` 用 ModuleLoader 登记工厂；工厂返回 `{ name, inject, apply(ctx) }`。`apply` 里 `ctx.slots.register(...)`。金样：[extensions/example-composer-action](../extensions/example-composer-action/)。

### 安装

```bash
xrkh plugin add ./my-composer-action
```

Client 半部写入 `~/.xrk/plugins/web/`（可用 `XRK_HOME` / `XRK_PLUGINS_DIR`）。**不必**为 client 半部先 `xrkh restart`：若 Host 已在跑，Settings → 插件列表 **安装 / 启停 / 更新 / 重载 / 删除** 会 soft remount 或 soft unload 叠加层；CLI `plugin add` 后也可在同页点「重载」或等 Host reconcile 发 `boot-changed`。

### 作者开发循环（client）

| 步骤 | 做什么 |
|------|--------|
| 1 | 改 `lib/client.js`（或本地包） |
| 2 | Settings → 插件 → 该包 **重载**（或再装同一路径）→ soft remount |
| 3 | 槽位 / 主题未亮起 → **硬刷新**一次；停用 / 删除通常 soft unload，失败时再硬刷新（产品仍省略完整 HMR） |
| 4 | 仅进程半部（`tools` / `prompt` / …）改完 → `xrkh restart` 或 Settings 启停触发 Host reconcile |

源码仓快速试跑也可：`XRK_PLUGINS_DIR=./extensions` 起 `web`，仍建议用 Settings 重载验证 soft remount 路径。

## 会话标准工具包（作者真源）

每个 **session 作用域**槽位组件由壳注入同一套 props（与产品内置插件相同），不必 `ctx.inject(['modelDirectories'])`：

| 成员 | 含义 |
|------|------|
| `sessionId` | 当前会话 |
| `useSession` | 会话快照选择器 |
| `useInput` | 输入机状态（含 `draft`） |
| `inputActions` | `setDraft` · `submit` · `addImages` / `removeImage` / `pruneImages` |
| **`useModelSelection`** | 与 composer 模型座位**同一份**目录：`current` · `routable` · `status` · `groups` · `failures` |
| **`modelSelectionActions`** | 与座位同路径的换模面：`available` · `select(selection)` · `reload()` |

典型读法：

```js
const current = props.useModelSelection((s) => s.current);
const draft = props.useInput((s) => s.draft);
props.inputActions.setDraft(nextText);
// 可选：换模（子代理已寻址时 available=false，select 返回 false）
if (props.modelSelectionActions?.available) {
  await props.modelSelectionActions.select({ provider, model });
}
```

`useModelSelection` / `modelSelectionActions` 由 `@xrkseek/client-ui-model-selection` 经 `sessions.provide` 挂上；**不要**再 `inject(['modelDirectories'])` 去猜私有服务。子代理已寻址会话：目录可读展示，换模不可用。

Owner 份额（父级 `renderSlot` 传入）另有 `InputZone`：`{ session, input }`，与标准工具包并存。

槽位注册可声明 `locale: 'my-ns'`，组件会收到标准 `t`；字典用 `ctx.locale.register(ns, { zh, en, … })`。

## 常用槽位

| 槽位 | 用途 |
|------|------|
| `conversation.input.left` | 工具行左侧（一行高度） |
| `conversation.input.right` | 发送钮左侧（提示词优化类控件放这里） |
| `conversation.input.dock` | 卡片上方整行（如 Goal） |
| `conversation.composer.dock` | 卡片下方（统计等） |
| `conversation.input.overlay` | 浮层（菜单 / 对话框） |
| `conversation.session.header.actions` | 会话头标题旁按钮（list；负 `order` 留给静态上下文） |
| `conversation.session.header.utilities` | 会话头右侧工具（list） |
| `conversation.input.model` | **具名**模型座位（产品占用；勿抢） |
| `conversation.input.plan` | 具名 plan 座位 |

完整 SlotMap 以 `packages/client/ui-conversation` 契约为准；未声明槽位 `register` 会失败。

## 侧栏扩展点（第一方）

装了 **`xrkh-better-sidebar`** 后，其它 client 可 `inject: ['betterSidebar']`，调用：

- `ctx.betterSidebar.registerTab(...)` — 新侧栏页
- `ctx.betterSidebar.registerFileViewer(...)` — 文件预览（Office 插件即此路径）

服务只在 **client 半部**；Host 仍拥有 `/sidebar/*`。细节见侧栏包 `docs/external-plugin-guide.md`（包名以 `xrkh-better-sidebar` 为准）。

## 主题 / 美化（原生）

产品主题服务：`ctx.theme`（`@xrkseek/client-ui-theme`）。

- **`overrideTokens(source, tokens)`**：叠一层 `--dsw-alias-*`（每项须同时给 `light` 与 `dark`）。金样：[extensions/example-theme-tokens](../extensions/example-theme-tokens/)。
- **`register(definition)`**：注册可选主题 id（非 `system`）。
- 基表与别名见包 README；滚动条等消费方读同一套 token。

社区皮肤 / 立绘（`/skin-assets`、skin-center 等）走可选兼容器 HTTP，**不是**写原生插件的前置。

## Settings 配置卡（原生）

要在 **设置 → 插件 → 插件配置** 挂一张卡，注册 keyed 槽位 `settings.plugin.item`（`key` = 命名空间；可选 `store` / `locale` / `inject`）。产品会在 Host `describe` 后派发全部已注册键。

```js
ctx.slots.inject("settings.plugin.item", () =>
  ctx.slots.register(
    { name: "settings.plugin.item", key: "my-plugin", order: 50, locale: "my-ns" },
    MySettingsCard,
  ),
);
```

第一方参考：`packages/client/ui-plan`（Presence 卡）。社区兼容器卡见 [community-plugins.md](./community-plugins.md)；原生作者不必走 dsh-compat。

## 边界

- 禁止依赖 `apps/*` 私有路径；公开面用 `@xrkseek/client-*` · `@xrkseek/xrk-*` · Cordis 薄栈。
- 无完整 HMR；Settings 对叠加层 soft remount（装 / 启 / 更 / 重载）与 soft unload（停用 / 删除）。改源码后优先 **重载**；仍不亮或 unload 失败再硬刷新。
- 兼容器 **不是**原生作者路径；新原生能力落在 `packages/client` / Face，不进 `dsh-compat/`。
- 社区兼容器计划 **0.9** 整夹迁出为 `@xrkseek/dsh-compat`（检查单：[PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md)）。

## 相关

- [plugin-development.md](./plugin-development.md) — 进程插件  
- [plugin-loader.md](./plugin-loader.md) — discover · `plugin add` · `web/` 叠加  
- [community-plugins.md](./community-plugins.md) — 可选社区桥  
- [status.md](./status.md) — 能力诚实  

---

# Client plugin development (native shell)

> **Audience**: Integrators · Contributors

To add UI, composer controls, or theme tokens on the product shell, use a native **`xrk.client`** package. You do not need the community compat adapter. Process tools remain in [plugin-development.md](./plugin-development.md). Community package shapes and Host surfaces: [community-plugins.md](./community-plugins.md) (optional; the compat layer is planned to ship as standalone npm `@xrkseek/dsh-compat` at **0.9**).

## Choose a kind

| Goal | Choose | Docs / sample |
|------|--------|---------------|
| Model-callable tool | Process `kind: tools` | [plugin-development](./plugin-development.md) · `extensions/example-tools` |
| Extra system sections | Process `kind: prompt` | Same |
| Slash / command surface | Process `kind: commands` | Same |
| **Composer / slot UI** | **`xrk.client`** | This page · `extensions/example-composer-action` |
| **Palette tokens** | **`xrk.client` + `ThemeRuntime`** | This page · `extensions/example-theme-tokens` |
| External MCP server | Settings → MCP | [modules/mcp.md](./modules/mcp.md) |
| Install first-party native (sidebar / phone bridge / sunflower) | **Settings → Plugins** or `xrkh plugin add <npm>` | “First-party native product plugins” below |
| Install an existing community shell package | `xrkh plugin add <npm>` | [community-plugins](./community-plugins.md) |

Do **not** use a `tools` plugin to change UI. Do **not** invent a private Host API to read the selected model — use the session standard kit.

## First-party native product plugins

These are **native** plugins in the XRK / `@xrkseek` product line (not third-party community packages; not a dsh-compat authoring path):

| Plugin | Role |
|--------|------|
| **`xrk-sunflower-free`** | Sunflower free LLM lane (process plugin; Host built-in discovery) |
| **`@xrkseek/xrk-phone-bridge`** | Remote `phone_*` bridge (Host HTTP + client + skill materialize) |
| **`xrkh-better-sidebar`** | Standard floating workbench (files / preview / terminal / git / browser; Host owns `/sidebar/*`) |
| **`xrkh-better-sidebar-plugin-office`** | Sidebar Office preview add-on (docx / xlsx / pptx) |

`extensions/example-*` gold samples teach the shape; the table above is product surface. Sidebar contract: [sidebar-workbench.md](./sidebar-workbench.md).

## Minimal client package

```text
my-composer-action/
  package.json          # name · xrk.client · exports["./client"]
  lib/client.js         # window.__ModuleLoader__.load({ id, factory })
```

`package.json` essentials:

```json
{
  "name": "my-composer-action",
  "version": "0.1.0",
  "exports": { "./client": "./lib/client.js" },
  "xrk": {
    "client": {
      "inject": [
        "@xrkseek/client-runtime",
        "@xrkseek/client-ui-conversation",
        "@xrkseek/client-ui-model-selection"
      ],
      "platform": "web"
    }
  }
}
```

`lib/client.js` registers a ModuleLoader factory that returns `{ name, inject, apply(ctx) }`. Inside `apply`, call `ctx.slots.register(...)`. Gold sample: [extensions/example-composer-action](../extensions/example-composer-action/).

### Install

```bash
xrkh plugin add ./my-composer-action
```

The client half lands under `~/.xrk/plugins/web/` (`XRK_HOME` / `XRK_PLUGINS_DIR` may override). You usually **do not** need `xrkh restart` for the client half: with Host already running, Settings → Plugins **install / enable / disable / update / reload / delete** soft-remounts or soft-unloads the overlay; after CLI `plugin add`, use **Reload** on that row (or wait for Host `boot-changed`).

### Author loop (client)

| Step | Action |
|------|--------|
| 1 | Edit `lib/client.js` (or your local package) |
| 2 | Settings → Plugins → **Reload** that package (or re-add the path) → soft remount |
| 3 | If the slot / theme did not light up → **hard refresh** once; disable / delete usually soft-unload — hard-refresh only on failure (product still omits full HMR) |
| 4 | Process-half only (`tools` / `prompt` / …) → `xrkh restart` or Settings enable/disable for Host reconcile |

Monorepo smoke: `XRK_PLUGINS_DIR=./extensions` + `web` still benefits from Settings Reload to exercise soft remount.

## Session standard kit (author contract)

Every **session-scoped** slot component receives the same props the product plugins use. You do not need `ctx.inject(['modelDirectories'])`:

| Member | Meaning |
|--------|---------|
| `sessionId` | Current session |
| `useSession` | Session snapshot selector |
| `useInput` | Input-machine state (includes `draft`) |
| `inputActions` | `setDraft` · `submit` · `addImages` / `removeImage` / `pruneImages` |
| **`useModelSelection`** | The **same** directory as the composer model seat: `current` · `routable` · `status` · `groups` · `failures` |
| **`modelSelectionActions`** | Same-path write face: `available` · `select(selection)` · `reload()` |

Typical reads:

```js
const current = props.useModelSelection((s) => s.current);
const draft = props.useInput((s) => s.draft);
props.inputActions.setDraft(nextText);
if (props.modelSelectionActions?.available) {
  await props.modelSelectionActions.select({ provider, model });
}
```

`useModelSelection` / `modelSelectionActions` come from `@xrkseek/client-ui-model-selection` via `sessions.provide`. Do **not** inject `ctx.modelDirectories` for ordinary authoring. Addressed subagent sessions: directory may paint; switch stays unavailable.

The owner share from the parent `renderSlot` may also pass `InputZone` (`{ session, input }`) alongside the standard kit.

Slot registration may declare `locale: 'my-ns'` so the entry receives the standard `t` seat; register dictionaries with `ctx.locale.register(ns, { zh, en, … })`.

## Common slots

| Slot | Use |
|------|-----|
| `conversation.input.left` | Left tool-row (one-row height) |
| `conversation.input.right` | Left of send (prompt-optimizer-style controls) |
| `conversation.input.dock` | Full-width row above the card (e.g. Goal) |
| `conversation.composer.dock` | Band under the card (stats) |
| `conversation.input.overlay` | Floating UI (menus / dialogs) |
| `conversation.session.header.actions` | Buttons beside the session title (list; negative `order` reserved for static context) |
| `conversation.session.header.utilities` | Right-side session utilities (list) |
| `conversation.input.model` | **Named** model seat (product-owned; do not steal) |
| `conversation.input.plan` | Named plan seat |

The full SlotMap lives in `packages/client/ui-conversation`; registering an undeclared slot fails.

## Sidebar extension points (first-party)

With **`xrkh-better-sidebar`** installed, other clients may `inject: ['betterSidebar']` and call:

- `ctx.betterSidebar.registerTab(...)` — new sidebar page
- `ctx.betterSidebar.registerFileViewer(...)` — file preview (Office uses this)

The service exists on the **client half** only; Host still owns `/sidebar/*`. Details: the sidebar package’s `docs/external-plugin-guide.md` (package id `xrkh-better-sidebar`).

## Theme / styling (native)

Product theme service: `ctx.theme` (`@xrkseek/client-ui-theme`).

- **`overrideTokens(source, tokens)`**: stack `--dsw-alias-*` overrides (each value needs both `light` and `dark`). Sample: [extensions/example-theme-tokens](../extensions/example-theme-tokens/).
- **`register(definition)`**: register an optional theme id (not `system`).
- Base sheets and aliases: package README; scrollbars and other surfaces consume the same tokens.

Community skins / artwork (`/skin-assets`, skin-center, …) use the optional compat HTTP surface and are **not** a prerequisite for native plugins.

## Settings config card (native)

To show a card under **Settings → Plugins → Configurable**, register the keyed slot `settings.plugin.item` (`key` = namespace; optional `store` / `locale` / `inject`). The product dispatches every registered key after Host `describe`.

```js
ctx.slots.inject("settings.plugin.item", () =>
  ctx.slots.register(
    { name: "settings.plugin.item", key: "my-plugin", order: 50, locale: "my-ns" },
    MySettingsCard,
  ),
);
```

First-party reference: `packages/client/ui-plan` (Presence card). Community compat cards: [community-plugins.md](./community-plugins.md); native authors do not need dsh-compat.

## Boundaries

- Do not import private `apps/*` paths; use `@xrkseek/client-*` · `@xrkseek/xrk-*` · the thin Cordis stack.
- No full HMR; Settings soft-remounts the overlay on install / enable / update / reload and soft-unloads on disable / delete. Prefer **Reload** after source edits; hard-refresh if UI stays dark or unload fails.
- Compat is **not** the native authoring path; new native capability lands in `packages/client` / Face, not under `dsh-compat/`.
- The community compat layer is planned to extract at **0.9** as `@xrkseek/dsh-compat` (checklist: [PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md)).

## Related

- [plugin-development.md](./plugin-development.md) — process plugins  
- [plugin-loader.md](./plugin-loader.md) — discover · `plugin add` · `web/` overlay  
- [community-plugins.md](./community-plugins.md) — optional community bridge  
- [status.md](./status.md) — capability honesty  
