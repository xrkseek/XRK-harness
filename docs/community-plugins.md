# 社区插件与 Host 契约 / Community Plugins and Host Contracts

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors  
> （安装社区 client、对照 Host 已实现能力与待补特性 / Install community clients; compare implemented Host surfaces and planned work）

XRK-Harness 的 **Host、HTTP、持久化与隧道门禁**均为自研。产品壳可加载社区 `client.js`；Host 侧由内置兼容器 `extensions/dsh-compat` 与 `@xrkseek/server-http/dsh-compat` 按 **路径与 RPC 形状**接线，不按包名堆叠适配器。不嵌入第三方 Host 内核（见 [ADR-0002](./adr/0002-no-embed-upstream.md)）。

XRK-Harness **Host, HTTP, persistence, and tunnel gating** are first-party. The product shell may load community `client.js`; the Host side is wired by the built-in adapter `extensions/dsh-compat` and `@xrkseek/server-http/dsh-compat` according to **path and RPC shape**, not per-package adapters. A third-party Host kernel is not embedded ([ADR-0002](./adr/0002-no-embed-upstream.md)).

实现笔记 / Implementation notes：[dsh-compat/README.md](../packages/server/http/src/dsh-compat/README.md) · 发包边界 / Package boundary：[PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md) · 发现 / Discover：[plugin-loader.md](./plugin-loader.md)。

## 架构 / Architecture

```text
community client.js
    → Face wire or same-origin HTTP / RPC
        → capability table + XRK underlying (~/.xrk)
        → bridge (XRK impl / optional subprocess apply)
        → unlisted paths: honest JSON (not SPA 404)
```

| 层 / Layer | 职责 / Responsibility | 代表 / Modules |
|----|------|------|
| **底层 / Underlying** | `~/.xrk` I/O；诚实响应 | `underlying/*` · `wallet` · `im-channels` · `vision` |
| **Bridge** | 社区契约形状 → XRK 实现 | `host-feature-bridge` · `im-messaging-bridge` · `cordis-fiber-runner` |
| **兼容器 / Adapter** | 装配、catch-all、registry | `adapter-compose` · `cordis-registry` |

## 接入层级（A–J） / Integration Tiers (A–J)

安装 **产品壳内置 client 之外**的社区包时，按 client 实际 HTTP/RPC 落入下表。

When installing community packages **beyond the product-shell built-in clients**, map each package by its actual HTTP/RPC surface:

| 层级 / Tier | 触发 / Trigger | Host 行为 / Host behavior |
|------|------|-----------|
| **A** | 仅 Face / 壳 API | 通常可直接使用 / Usually works as-is |
| **B** | 命中全局能力表 | XRK 底层持久化 / First-party persistence |
| **C** | `*-settings` RPC | 设置文档 store / Settings document store |
| **D** | `/_dsh/<pkg>/…` | 通用 JSON / Generic JSON |
| **E** | 单段 slug | `community-root-http` |
| **F** | 其它 GET | 诚实 catch-all / Honest catch-all |
| **G** | 未注册 POST RPC | settings fallback / 空 ok |
| **H** | `xrk.host.json` | 作者声明 provider / Author-declared provider |
| **I** | `host.mjs` | 进程内 apply；失败则 **I′** 子进程 |
| **J** | 外部云端 / 厂商发行版 | 见「待补」 / See Planned work |

## Host 能力 / Host Capabilities

真源 / Source of truth：`dsh-compat-matrix.ts`。

| 能力 / Capability | 已实现 / Implemented | 待补 / Planned (XRK) |
|------|--------|-------------|
| `host.mjs` RPC | inventory · invoke · runHostHalf | 全量第三方 DI（非产品目标） / Full third-party DI (out of scope) |
| IM | connector · OAuth · `message.send/list` · webhook | 云端长连接网关 / Cloud long-lived IM gateway |
| 任务流 / Task flow | 持久化 · TS 节点 · scan | 绑定厂商 Python 发行版 / Vendor Python runtime binding |
| GenUI | CRUD · HTML / React tree 预览 | 动态加载任意 npm 组件 / Dynamic arbitrary npm components |
| Vision | paste/analyze · 本地 OCR | 云端 vision LLM 路由 / Cloud vision LLM routing |
| 检索与记忆 / Search & memory | 本地 rg · keyword · 可选远程 | embedding 宿主 / Embedding host |
| 自动审阅 / Auto-review | 启发式 classify · slash | 可插拔 classifier / Pluggable classifier |
| 上下文浏览器 / Context browser | Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** 计价 | 完整 Cordis Host timeline fold / Full Host timeline fold |
| 移动访问 / Mobile access | 配对 · LAN/WAN PIN · 隧道 HTTP+WS | — |

## 回归 fixture / Regression Fixtures

`packages/server/http/tests/fixtures/compat-host-suite.json` 为测例清单，**不是**唯一可装列表。体验以本页「已实现」为准。

The fixture file is a regression inventory, **not** the exclusive installable set. Product behavior follows **Implemented** above.

## 待补特性 / Planned Work (XRK)

下列写入 [status.md](./status.md)「未做 / Not done」，表示产品后续可自研或外接，**不是**「上游未搬清单」。

The following are product **planned** items in [status.md](./status.md), not an unported-upstream checklist:

| 特性 / Feature | 说明 / Notes |
|------|------|
| IM 长连接网关 / IM long-lived gateway | 当前以 webhook / 短请求为主 / Webhook and short requests today |
| 任务流外部运行时 / External task runtime | 可选接入第三方节点发行版 / Optional third-party node distributions |
| 云端 Vision / Cloud Vision | 路由至已配置的 vision LLM / Route to configured vision LLMs |
| 记忆 embedding / Memory embeddings | 向量索引宿主 / Vector index host |

本地消息、节点、OCR 与 GenUI 预览线已在兼容器内可用。  
Local messaging, nodes, OCR, and GenUI preview are available inside the adapter today.

## 本地审计 / Local Audit

```bash
node scripts/dsh-community-audit.mjs
```

对照 client 扫描路径与能力表；未入表路径仍返回诚实 JSON。  
Compare scanned client paths with the capability table; unlisted paths still return honest JSON.

## Face：`dynamicCordisRunner/*`

面板经 Face RPC 驱动兼容器，不嵌入第三方 Host。  
The panel drives the adapter via Face RPC; no third-party Host is embedded.

| 方法 / Method | 行为 / Behavior |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | 兼容器 + 可选子进程 / Adapter + optional subprocess |
| `invoke` | registry / 子进程 RPC |
| `stopFromPanel` | 停止子进程 + ack / Stop subprocess + ack |

见 / See：[host-face.md](./host-face.md)。

## 相关 / Related

[status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)
