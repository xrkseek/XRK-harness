# 社区插件与 Host 契约

> **读者**：集成者 · 贡献者（安装社区 client、对照 Host 已实现能力与待补特性）

产品壳可加载社区 `client.js`。Host 侧由内置适配器 `extensions/dsh-compat` 与 `@xrkseek/server-http/dsh-compat` 按 **路径与 RPC 形状**接线，落盘与会话走 `~/.xrk`。实现笔记：[dsh-compat/README.md](../packages/server/http/src/dsh-compat/README.md) · 发包边界：[PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md) · 发现：[plugin-loader.md](./plugin-loader.md)。

## 怎么安装与使用

1. 装 CLI 后打开工作区：`npx @xrkseek/harness-cli web`（或源码 `xrkh web`）。
2. 安装社区 client 包（落到用户插件目录）：

```bash
xrkh plugin add <包名>
xrkh restart
```

示例包名：`dsh-wallet` · `@liustack/modsearch` 等（以 npm 实际包为准）。装完须 **`xrkh restart`** 重载 Host。

3. 日常开关与配置优先 **设置 → Plugins**（及各插件自有面板）；Host/CI 无头场景再用 env / 落盘文件。
4. 免补 `xrk.host.json`：loader 用能力表 + `client.js` 扫描 + 约定 infer（见 [plugin-loader.md](./plugin-loader.md)）。作者也可声明 `xrk.host.json` 或提供 `host.mjs`。
5. 能用什么、待补什么以本页「Host 能力」与 [status.md](./status.md) 为准。

## 架构

```text
community client.js
    → Face wire or same-origin HTTP / RPC
        → capability table + XRK underlying (~/.xrk)
        → bridge (XRK impl / optional subprocess apply)
        → unlisted paths: honest JSON (not SPA 404)
```

| 层 | 职责 | 代表模块 |
|----|------|------|
| **底层** | `~/.xrk` I/O；诚实响应 | `underlying/*` · `wallet` · `im-channels` · `vision` |
| **Bridge** | 社区契约形状 → XRK 实现 | `host-feature-bridge` · `im-messaging-bridge` · `cordis-fiber-runner` |
| **适配器** | 装配、catch-all、registry | `adapter-compose` · `cordis-registry` |

## 接入层级（A–J）

安装 **产品壳内置 client 之外**的社区包时，按 client 实际 HTTP/RPC 落入下表：

| 层级 | 触发 | Host 行为 |
|------|------|-----------|
| **A** | 仅 Face / 壳 API | 通常可直接使用 |
| **B** | 命中全局能力表 | XRK 底层持久化 |
| **C** | `*-settings` RPC | 设置文档 store |
| **D** | `/_dsh/<pkg>/…` | 通用 JSON |
| **E** | 单段 slug | `community-root-http` |
| **F** | 其它 GET | 诚实 catch-all |
| **G** | 未注册 POST RPC | settings fallback / 空 ok |
| **H** | `xrk.host.json` | 作者声明 provider |
| **I** | `host.mjs` | 进程内 apply；失败则 **I′** 子进程 |
| **J** | 外部云端 / 厂商发行版 | 可选 sidecar env（IM · 向量库）；`xrkh serve` boot 自动接线 |

## Host 能力

真源：`dsh-compat-matrix.ts`。

| 能力 | 已实现 | 待补 |
|------|--------|------|
| `host.mjs` RPC | inventory · invoke · runHostHalf | 全量第三方 DI（非产品目标） |
| IM | connector · OAuth · `message.send/list` · webhook · poll/SSE · sidecar relay · **in-process WS client** · **本地 WS ingress**（`/api/im/gateway/ws`，无需 `XRK_IM_GATEWAY_*`）；契约包 `@xrkseek/im-gateway-contract`（**非**九路 SDK） | 厂商原生长连接 SDK |
| 任务流 | 持久化 · TS 节点 · scan · `external` 子进程 · **Python bridge**（`XRK_TONGFLOW_PYTHON`） | — |
| GenUI | CRUD · HTML / React tree 预览 · **npm 组件 registry/resolve** · **浏览器 runtime**（`/dsh-genui/runtime.js` mount · CE） | — |
| Vision | paste/analyze · 本地 OCR · OpenAI-compatible · **anthropic-messages** · **gemini-generate** | — |
| 检索与记忆 | 本地 rg · keyword · **`embedding.search` embedded host** · optional `XRK_MEMORY_EMBED_*` sidecar · **Mnemon 文档引擎**（keyword search · mention graph · bodies） | — |
| 自动审阅 | 启发式 classify（默认）· **可替换 classifier**（`options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL`）· slash | — |
| 上下文浏览器 | Face **`contextTimeline`**（requests 分项 · usage 盖章 · events）/ **`contextHeaders`** · **`costUsage`** 计价 | — |
| 移动访问 | 配对 · LAN/WAN PIN · 隧道 HTTP+WS | — |
| **侧栏（`xrkh-better-sidebar`）** | Host 原生 `createSidebarPublicHandler`（见下节；非 dsh-compat 能力表）；含 `git.worktrees` · `changes.ops` · agent-opens/terminals 真推送 | prefs 默认关；**设置 → 通用** 可开 `agentOpenTools` / `agentTerminalTools`（写 `~/.xrk/sidebar/prefs.json`），开后模型可 `sidebar_open` / `terminal_create` |

本地消息、节点、OCR 与 GenUI 预览线已在适配器内可用。

## 侧栏插件契约（Host 原生，client 只挂 UI）

标准侧栏包 **`xrkh-better-sidebar`**（`kind: client`，建议 **≥ 0.18.7**）只向壳注入 `lib/client.js`。`/sidebar/*` 只由 Host 原生 `createSidebarPublicHandler` 挂载（见下节）；插件 Cordis host 半包不提供 `/sidebar/*` 路由。源码工作区克隆到本仓 `extensions/xrkh-better-sidebar`（gitignore，独立 git 仓）。

概况栏（`details`）默认 **Status** 页（子代理图 · jobs · **live `contextTimeline`**（inject 来源 · compact reason/`shadowedTokenCount` · prune/spill）· cost · channels），与斜杠 `/status` / Face `session.status` **同源**（snapshot 摘要 + 概况栏绑投影事件行）；另有任务 / 计划 / Office 页签。概况栏与侧栏工作台**可同时打开**：壳经 `@xrkseek/client-ui-layout` 发布 `LayoutInsets`（`document.documentElement` 上的 `--xrk-layout-inset-*` / `data-xrk-layout-*`，以及 `ctx.layout.insets`）。浮动工作台按这些 CSS 变量让位右上角控件。产品切分与首方薄壳见 [sidebar-workbench](./sidebar-workbench.md)。

产品 Host 通过 **`createSidebarPublicHandler`**（`@xrkseek/server-http/sidebar`）挂载同源 `/sidebar/*`，再经 `attachSidebarPtyUpgrades` 挂终端 WS。这是 **Host 原生表面**，独立于 `dsh-compat` 能力表（目录名 `dsh-compat` 是历史兼容器，不参与侧栏路由）。社区客户端若也调用 `/sidebar/*`，共用同一 Host 契约。

| 表面 | Host 落点 | 插件职责 |
|------|-----------|----------|
| `POST /sidebar/api/<method>` | `packages/server/http/src/sidebar/`（FS · git · prefs · shell · browser · **jobs** · **subagents.live** · **subagents.graph** · **changes.ops** · **open.external**） | 调 API；勿在 client 里再实现一份 Host |
| `/sidebar/file` · `upload` · `html` · `bundle` | 同上 + 插件目录 `chunks/` | 发布 `lib/client-*.js` 供 bundle 回落 |
| `/sidebar/ws/terminal` | Host `sidebar-pty`（真实 node-pty · session+tab 保活；系统用户权限，**不**套 Agent sandbox / fence） | TerminalView 连同源 WS |
| `/sidebar/ws/agent-terminals` · `agent-opens` | Host 真推送（registry + prefs 门控工具；Settings → 通用开关）；无 registry 时仍空列表保活 | 推送由 Host 提供；插件 host 半包不实现 |
| Face 注入 `sidebarFace` | Host：`openExternal` · jobs · `listSubagentsLive` · rewind `forkSessionAt` | 子代理 / 后台任务 / 外开路径走此桥 |

`subagents.live` 的 wire 形状为嵌套 `tool`：`{ text?; tool?: { name; args } }`（与插件 `LastActivity` / `SidebarSubagentLiveActivity` 一致）。Host 真源：`packages/server/host/src/sidebar-live-line.ts`。

预览契约（先类型、后 UI）：`@xrkseek/protocol` 的 `BrowserEmbedProbe` · `SubagentPreviewSummary` · `PlanPreviewSummary` · `OfficePreviewStatus`；policy 边界 `host.open` · `sidebar.embed` · `sidebar.fs` · `office.connect`（见 [policy](./policy.md)）。**Office 状态仍走 `/office`**（`office.connect` 已门禁 mutation），不挂到 `/sidebar`。计划全文读 Face `plan` 投影；侧栏只消费摘要。

**已移除**：Side Chat（beta）及 Host `sidechat.*`。子代理与后台任务请用 Face `subagent.*` + Sidebar `subagents.live` / `jobs.*`。

扩展新 sidebar RPC：扩 `sidebar-adapter` /（需要 Face 时）`SidebarFaceBridge`，**不要**为单个插件在 Host 堆旁路逻辑，也不要把 `/sidebar/*` 重新并入 dsh-compat 能力表，更不要在 XRK 上启用插件 `host.mjs` 占用同一路径。

## 回归 fixture

`packages/server/http/tests/fixtures/compat-host-suite.json` 是测例清单；可安装列表以本页「已实现」为准。

## 待补特性

真源：`dsh-compat-matrix.ts` 的 `DSH_COMPAT_KNOWN_GAPS`。当前三条已核实缺口：

| id | 覆盖 | 形状 |
| --- | --- | --- |
| `web-panel-global-registry` | missing | DSH 0.1.5-alpha.2+ 插件经 `sidebar.panellist` / `main`（`main.conversation`）注册全局面板；XRK shell 只声明 sidebar/conversation/details/shell.overlay 四 seat，panellist 注册无落点（SlotCore 对未知 seat 直接抛错） |
| `cordis-dual-half-inspect` | honest-stub | 官方 `dsh-cordis-host-runner` 的 model-mounted dual-half registry（`cordis_inspect_list`/`cordis_inspect_query` + mount/dispose）按"不嵌入第三方 Host 内核"边界不实现；fiber fallback 保持 apply 驱动 |
| `third-party-di` | honest-stub | 全量第三方 DI 非产品目标；未知 service 引用返回诚实 envelope，绝不伪造 provider |

TongFlow 装包走 `POST /tongflow/plugins`（`spec` / `package` / `name` / `id`），由 `runPluginMutate` 执行 `xrkh plugin add`。已删除的 `/plugins/install` 假 `accepted` 路由不恢复。成功后需要 `xrkh restart` 才进当前进程。

## 可选外接 env（不进仓依赖）

联调自运维 sidecar 时使用；Host 核心不嵌入这些服务。

| 变量 | 用途 |
| --- | --- |
| `XRK_IM_GATEWAY_URL` | 外接 IM relay 基址（HTTP health + WS `/ws` 推导） |
| `XRK_IM_GATEWAY_WS_URL` | 显式 IM WebSocket 网关地址（优先于 URL 推导） |
| `XRK_IM_GATEWAY_TOKEN` | relay / WS 鉴权 Bearer |
| `XRK_MEMORY_EMBED_URL` | 外接向量库 HTTP 基址（如 Qdrant REST）；未接时仍走本地 hash bridge；亦可 Settings → Plugins → 高级 |
| `XRK_MEMORY_EMBED_TOKEN` | 向量库 API key（可选；Credentials / 高级卡） |
| `XRK_MEMORY_EMBED_COLLECTION` | 集合 / index 名（可选；亦可 Settings `memory-embed.collection`） |
| `XRK_AUTO_REVIEW_CLASSIFIER_URL` | 外接 auto-review classifier（POST；未设则启发式；亦可 Settings → Plugins → 高级） |
| `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN` | classifier Bearer（可选；Credentials / 高级卡） |
| `XRK_GENUI_NPM_ALLOWLIST` | 逗号分隔 npm 包名，合并进 GenUI component registry |
| `XRK_TONGFLOW_PYTHON` | 用户 Python 解释器（scan / `kind:python` 节点） |
| `XRK_TONGFLOW_PYTHON_SCAN` | 自定义 `/tongflow/scan` 脚本路径 |
| `XRK_TONGFLOW_PYTHON_RUNNER` | 自定义 Python 节点 runner 脚本 |

Sidecar 契约：`@xrkseek/im-gateway-contract` · `im-gateway-sidecar.ts` · [im-gateway-sidecar.md](./im-gateway-sidecar.md) · `memory-embeddings.ts` · [ADR-0006](./adr/0006-im-long-lived-gateway.md)。

## 本地审计

```bash
node scripts/dsh-community-audit.mjs
```

对照 client 扫描路径与能力表；未入表路径仍返回诚实 JSON。

## Face：`dynamicCordisRunner/*`

面板经 Face RPC 驱动适配器（**不是**产品 SPA `boot.json` 条目；Cordis UI/runner 客户端包已从产品 boot 剥离）。

| 方法 | 行为 |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | 适配器 + 可选子进程 |
| `invoke` | registry / 子进程 RPC |
| `stopFromPanel` | 停止子进程 + ack |

见 [host-face.md](./host-face.md)。

## 相关

[status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)

---

# Community Plugins and Host Contracts

> **Audience**: Integrators · Contributors (install community clients; compare implemented Host surfaces and planned work)

The product shell may load community `client.js`. The Host side is wired by the built-in adapter `extensions/dsh-compat` and `@xrkseek/server-http/dsh-compat` according to **path and RPC shape**, with persistence under `~/.xrk`. Implementation notes: [dsh-compat/README.md](../packages/server/http/src/dsh-compat/README.md) · Package boundary: [PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md) · Discover: [plugin-loader.md](./plugin-loader.md).

## Install and use

1. Start with a workspace: `npx @xrkseek/harness-cli web` (or source `xrkh web`).
2. Install a community client package into the user plugin directory:

```bash
xrkh plugin add <package-name>
xrkh restart
```

Example package names: `dsh-wallet` · `@liustack/modsearch` (use the real npm names). Always **`xrkh restart`** after install so Host reloads.

3. Prefer **Settings → Plugins** (and each plugin’s own panel) for day-to-day toggles; use env / on-disk files for Host/CI headless runs.
4. `xrk.host.json` is optional: the loader uses the capability table + `client.js` scan + convention infer ([plugin-loader.md](./plugin-loader.md)). Authors may still declare `xrk.host.json` or ship `host.mjs`.
5. What works vs what is planned follows **Host capabilities** below and [status.md](./status.md).

## Architecture

```text
community client.js
    → Face wire or same-origin HTTP / RPC
        → capability table + XRK underlying (~/.xrk)
        → bridge (XRK impl / optional subprocess apply)
        → unlisted paths: honest JSON (not SPA 404)
```

| Layer | Responsibility | Modules |
|----|------|------|
| **Underlying** | `~/.xrk` I/O; honest responses | `underlying/*` · `wallet` · `im-channels` · `vision` |
| **Bridge** | Community contract shape → XRK implementation | `host-feature-bridge` · `im-messaging-bridge` · `cordis-fiber-runner` |
| **Adapter** | Composition, catch-all, registry | `adapter-compose` · `cordis-registry` |

## Integration tiers (A–J)

When installing community packages **beyond the product-shell built-in clients**, map each package by its actual HTTP/RPC surface:

| Tier | Trigger | Host behavior |
|------|------|-----------|
| **A** | Face / shell API only | Usually works as-is |
| **B** | Hits global capability table | First-party persistence |
| **C** | `*-settings` RPC | Settings document store |
| **D** | `/_dsh/<pkg>/…` | Generic JSON |
| **E** | Single-segment slug | `community-root-http` |
| **F** | Other GET | Honest catch-all |
| **G** | Unregistered POST RPC | Settings fallback / empty ok |
| **H** | `xrk.host.json` | Author-declared provider |
| **I** | `host.mjs` | In-process apply; on failure **I′** subprocess |
| **J** | External cloud / vendor distribution | Optional sidecar env (IM · vectors); wired on `xrkh serve` boot |

## Host capabilities

Source of truth: `dsh-compat-matrix.ts`.

| Capability | Implemented | Planned |
|------|--------|------|
| `host.mjs` RPC | inventory · invoke · runHostHalf | Full third-party DI (out of scope) |
| IM | connector · OAuth · `message.send/list` · webhook · poll/SSE · sidecar relay · **in-process WS client** · **local WS ingress** (`/api/im/gateway/ws`, no `XRK_IM_GATEWAY_*` required); contract package `@xrkseek/im-gateway-contract` (**not** a nine-vendor SDK) | Vendor-native long-lived SDKs |
| Task flow | Persistence · TS nodes · scan · `external` subprocess · **Python bridge** (`XRK_TONGFLOW_PYTHON`) | — |
| GenUI | CRUD · HTML / React tree preview · **npm component registry/resolve** · **browser runtime** (`/dsh-genui/runtime.js` mount · CE) | — |
| Vision | paste/analyze · local OCR · OpenAI-compatible · **anthropic-messages** · **gemini-generate** | — |
| Search & memory | Local rg · keyword · **`embedding.search` embedded host** · optional `XRK_MEMORY_EMBED_*` sidecar · **Mnemon document engine** (keyword search · mention graph · bodies) | — |
| Auto-review | Heuristic classify (default) · **replaceable classifier** (`options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL`) · slash | — |
| Context browser | Face **`contextTimeline`** (per-request items · usage stamps · events) / **`contextHeaders`** · **`costUsage`** pricing | — |
| Mobile access | Pairing · LAN/WAN PIN · tunnel HTTP+WS | — |
| **Sidebar (`xrkh-better-sidebar`)** | Host owns `/sidebar/*` (see below); includes `git.worktrees` · `changes.ops` · real agent-opens/terminals push | Prefs default off; **Settings → General** toggles `agentOpenTools` / `agentTerminalTools` (`~/.xrk/sidebar/prefs.json`); then model may `sidebar_open` / `terminal_create` |

Local messaging, nodes, OCR, and GenUI preview are available inside the adapter today.

## Sidebar plugin contract (Host owns; client UI only)

The standard sidebar package **`xrkh-better-sidebar`** (`kind: client`, prefer **≥ 0.18.7**) injects `lib/client.js` into the shell only. `/sidebar/*` is mounted solely by the Host's native `createSidebarPublicHandler` (next section); a plugin Cordis host half provides no `/sidebar/*` routes. Clone the plugin into this repo's `extensions/xrkh-better-sidebar` (gitignored, its own git remote).

The session **Status** column (`details`, default tab) shows the subagent graph · jobs · **live `contextTimeline`** (inject sources · compact reason/`shadowedTokenCount` · prune/spill) · cost · channels from Face `session.status` (same snapshot as slash `/status`; overview also binds live projection event rows); todos / plan / Office remain secondary tabs. Status and the sidebar workbench **may stay open together**: the shell publishes `LayoutInsets` from `@xrkseek/client-ui-layout` (`--xrk-layout-inset-*` / `data-xrk-layout-*` on `document.documentElement`, plus `ctx.layout.insets`). Floating workbenches offset chrome with those CSS variables. Product cut and first-party thin shell: [sidebar-workbench](./sidebar-workbench.md).

| Surface | Host landing | Plugin role |
|------|-----------|----------|
| `POST /sidebar/api/<method>` | `sidebar-adapter` (FS · git · prefs · shell · browser · **jobs** · **subagents.live** · **subagents.graph** · **changes.ops** · **open.external**) | Call the API; do not reimplement Host in the client |
| `/sidebar/file` · `upload` · `html` · `bundle` | dsh-compat routes + plugin `chunks/` | Ship `lib/client-*.js` for bundle fallback |
| `/sidebar/ws/terminal` | Host `sidebar-pty` (real node-pty · session+tab reuse; system-user permissions, **not** Agent sandbox / fence) | TerminalView connects same-origin WS |
| `/sidebar/ws/agent-terminals` · `agent-opens` | Host real push (registry + prefs-gated tools; Settings → General toggles); empty-list keepalive without registry | Push is provided by Host; a plugin host half does not implement it |
| Face inject `sidebarFace` | Host: `openExternal` · jobs · `listSubagentsLive` · rewind `forkSessionAt` | Subagents / background jobs / reveal-path use this bridge |

`subagents.live` wire shape uses nested `tool`: `{ text?; tool?: { name; args } }` (matches plugin `LastActivity` / `SidebarSubagentLiveActivity`). Host source: `packages/server/host/src/sidebar-live-line.ts`.

Preview contract (types first, UI later): `@xrkseek/protocol` `BrowserEmbedProbe` · `SubagentPreviewSummary` · `PlanPreviewSummary` · `OfficePreviewStatus`; policy subjects `host.open` · `sidebar.embed` · `sidebar.fs` · `office.connect` (see [policy](./policy.md)). **Office status stays on `/office`** (`office.connect` gates mutations) — do not re-host under `/sidebar`. Plan bodies fold from Face `plan` projection; sidebar consumes summaries only.

**Removed:** Side Chat (beta) and Host `sidechat.*`. Use Face `subagent.*` plus Sidebar `subagents.live` / `jobs.*`.

To add sidebar RPC: extend the capability / adapter / (when Face is needed) `SidebarFaceBridge` — per-plugin Host bypass logic is not layered in, `/sidebar/*` is not merged back into the dsh-compat capability table, and plugin `host.mjs` does not occupy the same paths on XRK.

## Regression fixtures

`packages/server/http/tests/fixtures/compat-host-suite.json` is a regression inventory, **not** the exclusive installable set. Product behavior follows **Implemented** above.

## Planned work

Truth source: `DSH_COMPAT_KNOWN_GAPS` in `dsh-compat-matrix.ts`. Three verified gaps today:

| id | coverage | shape |
| --- | --- | --- |
| `web-panel-global-registry` | missing | DSH 0.1.5-alpha.2+ plugins register global panels via `sidebar.panellist` / `main` (`main.conversation`); the XRK shell only declares sidebar/conversation/details/shell.overlay seats, so panellist registrations have no landing seat (SlotCore throws on unknown seats) |
| `cordis-dual-half-inspect` | honest-stub | The official `dsh-cordis-host-runner` model-mounted dual-half registry (`cordis_inspect_list` / `cordis_inspect_query` + mount/dispose) is out of scope under the "no third-party Host kernel embedding" boundary; fiber fallback stays apply-driven |
| `third-party-di` | honest-stub | Full third-party DI is not a product goal; unknown service references get an honest envelope, never a fake provider |

TongFlow installs go through `POST /tongflow/plugins` (`spec` / `package` / `name` / `id`). `runPluginMutate` runs `xrkh plugin add`. The deleted `/plugins/install` fake `accepted` route stays gone. A successful install still needs `xrkh restart` before the current process sees it.

## Optional external env (not in-repo dependencies)

For self-hosted sidecars; Host core does not embed these services.

| Variable | Purpose |
| --- | --- |
| `XRK_IM_GATEWAY_URL` | External IM relay base (HTTP health; WS `/ws` inferred) |
| `XRK_IM_GATEWAY_WS_URL` | Explicit IM WebSocket gateway URL (overrides inference) |
| `XRK_IM_GATEWAY_TOKEN` | Bearer for relay / WS auth |
| `XRK_MEMORY_EMBED_URL` | External vector DB HTTP base (e.g. Qdrant REST); local hash bridge when unset; also Settings → Plugins → Advanced |
| `XRK_MEMORY_EMBED_TOKEN` | Vector DB API key (optional; Credentials / Advanced card) |
| `XRK_MEMORY_EMBED_COLLECTION` | Collection / index name (optional; also Settings `memory-embed.collection`) |
| `XRK_AUTO_REVIEW_CLASSIFIER_URL` | External auto-review classifier (POST; heuristic when unset; also Settings → Plugins → Advanced) |
| `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN` | Classifier Bearer (optional; Credentials / Advanced card) |
| `XRK_GENUI_NPM_ALLOWLIST` | Comma-separated npm packages merged into GenUI registry |
| `XRK_TONGFLOW_PYTHON` | User Python interpreter (scan / `kind:python` nodes) |
| `XRK_TONGFLOW_PYTHON_SCAN` | Custom `/tongflow/scan` script path |
| `XRK_TONGFLOW_PYTHON_RUNNER` | Custom Python node runner script |

Sidecar contracts: `@xrkseek/im-gateway-contract` · `im-gateway-sidecar.ts` · [im-gateway-sidecar.md](./im-gateway-sidecar.md) · `memory-embeddings.ts` · [ADR-0006](./adr/0006-im-long-lived-gateway.md).

## Local audit

```bash
node scripts/dsh-community-audit.mjs
```

Compare scanned client paths with the capability table; unlisted paths still return honest JSON.

## Face: `dynamicCordisRunner/*`

The panel drives the adapter via Face RPC (**not** product SPA `boot.json` entries; Cordis UI/runner client packages are stripped from product boot).

| Method | Behavior |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | Adapter + optional subprocess |
| `invoke` | Registry / subprocess RPC |
| `stopFromPanel` | Stop subprocess + ack |

See [host-face.md](./host-face.md).

## Related

[status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)
