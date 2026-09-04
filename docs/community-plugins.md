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
| IM | connector · OAuth · `message.send/list` · webhook · poll/SSE · sidecar relay · **in-process WS client** | — |
| 任务流 | 持久化 · TS 节点 · scan · `external` 子进程 · **Python bridge**（`XRK_TONGFLOW_PYTHON`） | — |
| GenUI | CRUD · HTML / React tree 预览 · **npm 组件 registry/resolve** | — |
| Vision | paste/analyze · 本地 OCR · OpenAI-compatible · **anthropic-messages** · **gemini-generate** | — |
| 检索与记忆 | 本地 rg · keyword · **`embedding.search` embedded host** · optional `XRK_MEMORY_EMBED_*` sidecar | — |
| 自动审阅 | 启发式 classify · slash | 可插拔 classifier |
| 上下文浏览器 | Face **`contextTimeline`**（requests 分项 · usage 盖章 · events）/ **`contextHeaders`** · **`costUsage`** 计价 | — |
| 移动访问 | 配对 · LAN/WAN PIN · 隧道 HTTP+WS | — |
| **侧栏（`xrkh-better-sidebar`）** | Host 原生 `createSidebarPublicHandler`（见下节；非 dsh-compat 能力表） | `changes.ops` · 真实 agent-opens 推送 |

本地消息、节点、OCR 与 GenUI 预览线已在适配器内可用。

## 侧栏插件契约（Host 原生，client 只挂 UI）

标准侧栏包 **`xrkh-better-sidebar`**（`kind: client`）只向壳注入 `lib/client.js`。**不要**指望插件 Cordis host 半包在 XRK 上挂 `/sidebar/*`。

产品 Host 通过 **`createSidebarPublicHandler`**（`@xrkseek/server-http/sidebar`）挂载同源 `/sidebar/*`，再经 `attachSidebarPtyUpgrades` 挂终端 WS。这是 **Host 原生表面**，与 `dsh-compat` 能力表无关；目录名 `dsh-compat` 是历史兼容器，**不**表示侧栏走「DSH 插件流」。社区 DSH 客户端若也调用 `/sidebar/*`，共用同一 Host 契约。

| 表面 | Host 落点 | 插件职责 |
|------|-----------|----------|
| `POST /sidebar/api/<method>` | `packages/server/http/src/sidebar/`（FS · git · prefs · shell · browser · **jobs** · **subagents.live** · **open.external**） | 调 API；勿在 client 里再实现一份 Host |
| `/sidebar/file` · `upload` · `html` · `bundle` | 同上 + 插件目录 `chunks/` | 发布 `lib/client-*.js` 供 bundle 回落 |
| `/sidebar/ws/terminal` | Host `sidebar-pty`（真实 node-pty · session+tab 保活） | TerminalView 连同源 WS |
| `/sidebar/ws/agent-terminals` · `agent-opens` | 空闲 stub（防客户端重连风暴） | 有数据再由 Host 扩展，勿在插件 host 半包假实现 |
| Face 注入 `sidebarFace` | Host：`openExternal` · jobs · `listSubagentsLive` · rewind `forkSessionAt` | 子代理 / 后台任务 / 外开路径走此桥 |

`subagents.live` 的 wire 形状为嵌套 `tool`：`{ text?; tool?: { name; args } }`（与插件 `LastActivity` / `SidebarSubagentLiveActivity` 一致）。Host 真源：`packages/server/host/src/sidebar-live-line.ts`。

**已移除**：Side Chat（beta）及 Host `sidechat.*`。子代理与后台任务请用 Face `subagent.*` + Sidebar `subagents.live` / `jobs.*`。

扩展新 sidebar RPC：扩 `sidebar-adapter` /（需要 Face 时）`SidebarFaceBridge`，**不要**为单个插件在 Host 堆旁路逻辑，也不要把 `/sidebar/*` 重新塞进 dsh-compat 能力表，更不要在 XRK 上启用插件 `host.mjs` 抢同一路径。

## 回归 fixture

`packages/server/http/tests/fixtures/compat-host-suite.json` 为测例清单，**不是**唯一可装列表。产品行为以本页「已实现」为准。

## 待补特性

当前 Host 能力表「已实现」列已覆盖 IM · Vision · 记忆 · GenUI npm · TongFlow Python bridge。后续社区扩展写入 status 时须代码对齐。

| 特性 | 说明 |
|------|------|
| GenUI 浏览器端 bundle | Host 侧 registry/resolve 已能跑；壳内动态 import 由 community client 负责 |

## 可选外接 env（不进仓依赖）

联调自运维 sidecar 时使用；Host 核心不嵌入这些服务。

| 变量 | 用途 |
| --- | --- |
| `XRK_IM_GATEWAY_URL` | 外接 IM relay 基址（HTTP health + WS `/ws` 推导） |
| `XRK_IM_GATEWAY_WS_URL` | 显式 IM WebSocket 网关地址（优先于 URL 推导） |
| `XRK_IM_GATEWAY_TOKEN` | relay / WS 鉴权 Bearer |
| `XRK_MEMORY_EMBED_URL` | 外接向量库 HTTP 基址（如 Qdrant REST）；未接时仍走本地 hash bridge |
| `XRK_MEMORY_EMBED_TOKEN` | 向量库 API key（可选） |
| `XRK_MEMORY_EMBED_COLLECTION` | 集合 / index 名（可选） |
| `XRK_GENUI_NPM_ALLOWLIST` | 逗号分隔 npm 包名，合并进 GenUI component registry |
| `XRK_TONGFLOW_PYTHON` | 用户 Python 解释器（scan / `kind:python` 节点） |
| `XRK_TONGFLOW_PYTHON_SCAN` | 自定义 `/tongflow/scan` 脚本路径 |
| `XRK_TONGFLOW_PYTHON_RUNNER` | 自定义 Python 节点 runner 脚本 |

Sidecar 契约：`im-gateway-sidecar.ts` · `memory-embeddings.ts` · [ADR-0006](./adr/0006-im-long-lived-gateway.md)。

## 本地审计

```bash
node scripts/dsh-community-audit.mjs
```

对照 client 扫描路径与能力表；未入表路径仍返回诚实 JSON。

## Face：`dynamicCordisRunner/*`

面板经 Face RPC 驱动适配器。

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
| IM | connector · OAuth · `message.send/list` · webhook · poll/SSE · sidecar relay · **in-process WS client** | — |
| Task flow | Persistence · TS nodes · scan · `external` subprocess · **Python bridge** (`XRK_TONGFLOW_PYTHON`) | — |
| GenUI | CRUD · HTML / React tree preview · **npm component registry/resolve** | — |
| Vision | paste/analyze · local OCR · OpenAI-compatible · **anthropic-messages** · **gemini-generate** | — |
| Search & memory | Local rg · keyword · **`embedding.search` embedded host** · optional `XRK_MEMORY_EMBED_*` sidecar | — |
| Auto-review | Heuristic classify · slash | Pluggable classifier |
| Context browser | Face **`contextTimeline`** (per-request items · usage stamps · events) / **`contextHeaders`** · **`costUsage`** pricing | — |
| Mobile access | Pairing · LAN/WAN PIN · tunnel HTTP+WS | — |
| **Sidebar (`xrkh-better-sidebar`)** | Host owns `/sidebar/*` (see below) | `changes.ops` · real agent-opens push |

Local messaging, nodes, OCR, and GenUI preview are available inside the adapter today.

## Sidebar plugin contract (Host owns; client UI only)

The standard sidebar package **`xrkh-better-sidebar`** (`kind: client`) injects `lib/client.js` into the shell only. **Do not** expect the plugin Cordis host half to serve `/sidebar/*` on XRK — the product Host already provides that prefix via dsh-compat (**historical folder name**, not a “DSH plugin path”) + `attachSidebarPtyUpgrades`.

| Surface | Host landing | Plugin role |
|------|-----------|----------|
| `POST /sidebar/api/<method>` | `sidebar-adapter` (FS · git · prefs · shell · browser · **jobs** · **subagents.live** · **open.external**) | Call the API; do not reimplement Host in the client |
| `/sidebar/file` · `upload` · `html` · `bundle` | dsh-compat routes + plugin `chunks/` | Ship `lib/client-*.js` for bundle fallback |
| `/sidebar/ws/terminal` | Host `sidebar-pty` (real node-pty · session+tab reuse) | TerminalView connects same-origin WS |
| `/sidebar/ws/agent-terminals` · `agent-opens` | Idle stubs (avoid client reconnect storms) | Extend Host when real data exists; do not fake via plugin host half |
| Face inject `sidebarFace` | Host: `openExternal` · jobs · `listSubagentsLive` · rewind `forkSessionAt` | Subagents / background jobs / reveal-path use this bridge |

`subagents.live` wire shape uses nested `tool`: `{ text?; tool?: { name; args } }` (matches plugin `LastActivity` / `SidebarSubagentLiveActivity`). Host source: `packages/server/host/src/sidebar-live-line.ts`.

**Removed:** Side Chat (beta) and Host `sidechat.*`. Use Face `subagent.*` plus Sidebar `subagents.live` / `jobs.*`.

To add sidebar RPC: extend the capability / adapter / (when Face is needed) `SidebarFaceBridge` — do not paper over one plugin inside Host, and do not let plugin `host.mjs` claim the same paths on XRK.

## Regression fixtures

`packages/server/http/tests/fixtures/compat-host-suite.json` is a regression inventory, **not** the exclusive installable set. Product behavior follows **Implemented** above.

## Planned work

Host **Implemented** covers IM · vision · memory · GenUI npm registry · TongFlow Python bridge. Follow-ons (sync to [status.md](./status.md) only when code-aligned):

| Feature | Notes |
|------|------|
| GenUI browser bundle | Host registry/resolve works; dynamic import stays in community client |

## Optional external env (not in-repo dependencies)

For self-hosted sidecars; Host core does not embed these services.

| Variable | Purpose |
| --- | --- |
| `XRK_IM_GATEWAY_URL` | External IM relay base (HTTP health; WS `/ws` inferred) |
| `XRK_IM_GATEWAY_WS_URL` | Explicit IM WebSocket gateway URL (overrides inference) |
| `XRK_IM_GATEWAY_TOKEN` | Bearer for relay / WS auth |
| `XRK_MEMORY_EMBED_URL` | External vector DB HTTP base (e.g. Qdrant REST); local hash bridge when unset |
| `XRK_MEMORY_EMBED_TOKEN` | Vector DB API key (optional) |
| `XRK_MEMORY_EMBED_COLLECTION` | Collection / index name (optional) |
| `XRK_GENUI_NPM_ALLOWLIST` | Comma-separated npm packages merged into GenUI registry |
| `XRK_TONGFLOW_PYTHON` | User Python interpreter (scan / `kind:python` nodes) |
| `XRK_TONGFLOW_PYTHON_SCAN` | Custom `/tongflow/scan` script path |
| `XRK_TONGFLOW_PYTHON_RUNNER` | Custom Python node runner script |

Sidecar contracts: `im-gateway-sidecar.ts` · `memory-embeddings.ts` · [ADR-0006](./adr/0006-im-long-lived-gateway.md).

## Local audit

```bash
node scripts/dsh-community-audit.mjs
```

Compare scanned client paths with the capability table; unlisted paths still return honest JSON.

## Face: `dynamicCordisRunner/*`

The panel drives the adapter via Face RPC.

| Method | Behavior |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | Adapter + optional subprocess |
| `invoke` | Registry / subprocess RPC |
| `stopFromPanel` | Stop subprocess + ack |

See [host-face.md](./host-face.md).

## Related

[status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)
