# 社区插件兼容器（dsh-compat） / Community Host Adapter (dsh-compat)

> **读者 / Audience**：维护者 · 贡献者 / Maintainers · Contributors  
> （改 Host 兼容器、能力表、测例 / Edit the Host adapter, capability table, and tests）

本目录为 XRK **自研** Host 侧兼容器：`@xrkseek/server-http` → `src/dsh-compat/`；子路径 `@xrkseek/server-http/dsh-compat`。承接社区 `client.js` 的同源 HTTP/RPC，**不**嵌入第三方 Host 内核。

This directory is the XRK **first-party** Host-side community adapter (`@xrkseek/server-http` → `src/dsh-compat/`; subpath `@xrkseek/server-http/dsh-compat`). It serves same-origin HTTP/RPC expected by community `client.js` and does **not** embed a third-party Host kernel.

发包检查单 / Extraction checklist：[PACKAGE.md](./PACKAGE.md)。集成者 / Integrators：[docs/community-plugins.md](../../../../docs/community-plugins.md)。

**侧栏不在此目录。** `/sidebar/*` 由 Host 原生 `createSidebarPublicHandler`（`../sidebar/` · 子路径 `@xrkseek/server-http/sidebar`）挂载；本包仅 **re-export** 类型与工厂供旧 import，**不**经 dsh-compat 能力表。`underlying/doc-store` 等 primitive 可被侧栏复用，但侧栏不是兼容特性。

**Sidebar is not owned here.** Host mounts `/sidebar/*` via native `createSidebarPublicHandler` (`../sidebar/`, subpath `@xrkseek/server-http/sidebar`). This package only re-exports types/factories for legacy imports — **not** via the dsh-compat capability table. Shared primitives under `underlying/` may be reused by sidebar; sidebar is not a compat feature.

**原则 / Principles**：通用底层 + 薄装配 + 具名 bridge；按路径/RPC 形状扩展；不为单个 npm 包 fork adapter。矩阵真源 / Matrix source：`dsh-compat-matrix.ts`。

## 装配顺序 / Composition Order

```text
1. baselineHttpRoutes + baselineRpcRoutes     # global capability table
2. inventory manifest / infer                 # xrk.host.json + client scan
3. host.mjs apply                             # in-process apply
4. cordis-fiber-runner (optional)             # apply failure → subprocess RPC
5. honest GET catch-all
6. cordis-registry RPC + POST catch-all
7. Host attachExtras (after upgrade prewarm)
8. `bootDshCompatServices` — embedded vector reindex · optional IM WS client (env)
```

`serve` 经 `ensureDshCompatHostPlugin()` 加载 `extensions/dsh-compat`；`prewarmDshCompatAdapters` 在 registry compose 后调用 boot。Host shutdown 经 `shutdownDshCompatServices` 停止 WS 客户端。

`serve` loads `extensions/dsh-compat` via `ensureDshCompatHostPlugin()`; `prewarmDshCompatAdapters` runs boot after registry compose. Host shutdown calls `shutdownDshCompatServices` to stop the WS client.

## 三层 / Three Layers

| 层 / Layer | 代表 / Modules | 职责 / Role |
|----|------|------|
| **底层 / Underlying** | `underlying/*` · `xrk-json-store` · `honest-envelope` · feature modules | XRK primitives + persistence |
| **Bridge** | `host-feature-bridge` · `im-*-bridge` · fiber runner · Face stub | Contract shape → XRK implementation |
| **兼容器 / Adapter** | `adapter-compose` · `adapter-providers` · `cordis-registry` | Composition only |

### 底层 primitive / Underlying primitives

| Primitive | 模块 / Module |
|-----------|------|
| Path / JSON files | `underlying/json-store` |
| Revision documents | `xrk-json-store` · `underlying/doc-store` |
| HTTP JSON | `underlying/http-json` · `http-kit` |
| Mobile-access gate | `underlying/mobile-gate-kit` |
| Public claim | `underlying/public-handler` |
| Settings | `persisted-settings-store` |
| Honest responses | `honest-envelope` |

**写法 / Conventions**：`createXrkDocStore` → `patch` / `read`；mutating POST 仅用 `parseJsonBody`；缺口用 `honest-envelope`；`adapter-providers` 不写业务规则。

### Bridge（节选） / Bridge (selected)

| 文件 / File | 职责 / Responsibility |
|------|------|
| `host-feature-bridge.ts` | Search · GenUI · vision · noema · auto-review · task-flow scan |
| `im-provision-bridge.ts` · `im-messaging-bridge.ts` | OAuth · messaging · webhook |
| `tongflow-node-runtime.ts` | Built-in node execution |
| `cordis-fiber-runner.ts` · `host-apply-bridge.ts` | `host.mjs` apply / subprocess |

## 社区 client 契约形状 / Community Client Contract Shapes

| 形状 / Shape | XRK 落点 / XRK landing |
|------|----------|
| `fetch("/api/…")` · `/_dsh/…` | Global capability table |
| `POST /{channel}` · `*-settings` | Settings store |
| `client.js` paths / channels | `dsh-client-scan` inference |
| Unlisted GET/POST | Honest JSON |
| Panel `dynamicCordisRunner/*` | Face `cordis-stub` |

## 与产品壳插件的关系 / Relation to Product-Shell Plugins

`status` 中的产品壳 plugin 计数指 `@xrkseek/client-*` boot，**不是**本兼容器能力表条目数。社区包走能力表 / manifest / apply；内置壳走 Face。

The product-shell plugin count in `status` refers to `@xrkseek/client-*` boot entries, **not** adapter capability-table rows. Community packages use the capability table / manifest / apply; the built-in shell uses Face.

## 待补特性 / Planned Work

主路径（IM · Vision · 记忆 · GenUI npm · TongFlow Python/external）已在 [community-plugins.md](../../../../docs/community-plugins.md)「已实现」列。后续仅列 **XRK 产品路线**增量（如 GenUI 浏览器端 bundle），不以「上游未搬」表述。

Main path items are **Working** in [community-plugins.md](../../../../docs/community-plugins.md). Further items are **XRK roadmap** only (e.g. GenUI browser bundle), not an unported-upstream inventory.

## 扩展入口 / Extension Entry

`extensions/dsh-compat`：`kind: host` 进程入口（`private`）；实现可整夹迁出（见 `PACKAGE.md`）。  
`extensions/dsh-compat` is the `kind: host` process entry (`private`); the implementation may be extracted as a whole folder (see `PACKAGE.md`).
