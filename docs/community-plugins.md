# DSH 社区插件兼容

> **读者**：集成者 · 贡献者（装社区 client / Host 包、对照缺口与 bridge 边界）。

XRK-Harness **不嵌入 Cordis Host 主进程**。社区 DSH 插件经 `extensions/dsh-compat`（`kind: host`）+ `@xrkseek/server-http/dsh-compat` 接入：通用 HTTP/RPC 能力表、底层持久化、`host.mjs` apply、以及下列 **0.1.0 bridge 模块**。边界见 [ADR-0002](./adr/0002-no-embed-upstream.md) · discover 见 [plugin-loader](./plugin-loader.md) · 实现细节见 [`packages/server/http/src/dsh-compat/README.md`](../packages/server/http/src/dsh-compat/README.md)。

## 架构（三层）

```text
社区 client.js / Cordis panel
    → Face wire 或同源 HTTP
        → dsh-compat 能力表 + 底层模块（持久化）
        → bridge 模块（XRK 原生替代 / 子进程 / 启发式）
        → 未覆盖路径：honest-envelope（JSON + incomplete，非 SPA 404）
```

| 层 | 职责 | 代表 |
|----|------|------|
| **底层** | 真实读写 `~/.xrk/…`、诚实 `*-host` 标签 | `wallet` · `im-channels` · `vision` · `xrk-json-store` |
| **Bridge** | DSH 契约形状 ↔ XRK 实现（非 Cordis kernel） | `host-feature-bridge` · `im-provision-bridge` · `cordis-fiber-runner` |
| **兼容器** | 装配、catch-all、registry | `adapter-compose` · `cordis-registry` · `honest-http-catchall` |

## 适配层级（A–J）

装 **产品壳 37 内置 client 之外** 的社区包时，**不按包名写 adapter**，按 client 实际 HTTP/RPC 形状落入层级：

| 层级 | 触发条件 | 行为 |
|------|----------|------|
| **A · 纯 UI** | 只调 Face / 壳 API | 通常可直接用 |
| **B · 全局能力表** | 命中 `DSH_HTTP_CAPABILITIES` | 真实底层（持久化 + 诚实 `*-host`） |
| **C · `*-settings` RPC** | `POST /{pkg}-settings` 等 | `persisted-settings-store` |
| **D · `/_dsh/<pkg>/…`** | 社区通用 Host 前缀 | `generic-dsh-http` 诚实 JSON |
| **E · 单段 slug** | `GET /whale-girl` 等 | `community-root-http` |
| **F · GET 未覆盖** | 其它 GET | `honest-http-catchall` |
| **G · POST 未注册 RPC** | Cordis POST 未命中 | settings fallback / 空 `rpcOk` |
| **H · 显式 manifest** | `xrk.host.json` | 由作者 `provider` 声明 |
| **I · `host.mjs`** | `createHostContribution` / `apply` | 进程内 apply shim；失败时 **I′ · Cordis fiber 子进程** |
| **J · 生产规模 vendor** | 需厂商云端长连接 / 官方 Python 发行版 | [status.md](./status.md)「未做」 | 本地 bridge 已覆盖 wire |

**I′ · Cordis fiber**：`cordis-fiber-runner` 在 **进程内 `host.mjs` apply 失败** 时 fork 隔离 Node 子进程加载同一 `host.mjs`，RPC 经 IPC 转发；`dynamicCordisRunner/stopFromPanel` 会 `stopHostPackageFiber`。

## 0.1.0 bridge 模块（真源：`dsh-compat-matrix.ts`）

| 能力 id | 模块 | 能做什么 | 不能做什么 |
|---------|------|----------|------------|
| `dynamic-cordis-runner` | `cordis-fiber-runner.ts` · `cordis-stub.ts` | inventory · runHostHalf · invoke 转发 · 子进程 RPC | 非 MIT Cordis npm fiber 全量 DI |
| `im-channels` | `im-channels.ts` · `im-provision-bridge.ts` · `im-messaging-bridge.ts` | connector · provision OAuth · **message.send/list** · **webhook ingress** | 厂商云端长连接 |
| `tongflow-canvas` | `tongflow.ts` · `tongflow-node-runtime.ts` | 持久化 · **TS 节点运行时** · `/tongflow/scan` | 厂商 Python 发行版独占节点 |
| `genui-library` | `genui.ts` · `host-feature-bridge.ts` | CRUD · schema/HTML/**React tree** live preview | Cordis npm 组件包动态加载 |
| `vision-persist` | `vision.ts` · `host-feature-bridge.ts` | paste/analyze · **OCR 启发式** · `xrk-local-vision` | 云端 vision LLM 路由 |
| `modsearch-config` | `modsearch.ts` · `host-feature-bridge.ts` | 本地 rg/遍历 · 可选 tavily/exa | — |
| `noema-memory` | `noema.ts` · `host-feature-bridge.ts` | keyword search · runner 启停 | embedding 真宿主 |
| `auto-review-settings` | `auto-review-http.ts` · `host-feature-bridge.ts` | 启发式 classify · slash↔HTTP | 上游 classifier 模型 |

矩阵全表：`DSH_COMPAT_GENERIC_CAPABILITIES` in `dsh-compat-matrix.ts`。

## 仓库测试 fixture（27 包）

来自 `packages/server/http/tests/fixtures/compat-host-suite.json`；供 `dsh-compat-host-plugin` / audit 回归，**不是** npm 唯一可装列表。

| 包 | 典型层级 | 0.1.0 体验摘要 |
|----|----------|----------------|
| `dshmarket` | B · bridge | 市场清单 → XRK inventory |
| `dsh-better-sidebar` | B | FS · git · prefs · sidebar |
| `dsh-mnemon` | B · C | 助记词 RPC + 持久化 |
| `vision-router` · `vision-toolkit` | B · bridge | OCR 启发式 · analyze · model-capabilities |
| `dsh-wallet` | B | wallet revision |
| `dsh-memento` | B | memento 文档 |
| `dsh-modlens` | B · bridge | paste 元数据 |
| `dsh-chat-import` | B | 导入元数据 |
| `dsh-pocket` | B | pocket + mobile 同源 |
| `dsh-genui` | B · I · bridge | CRUD · React tree + HTML live preview |
| `dsh-noema` | B · bridge | memory 索引 · keyword search |
| `dsh-im-weixin` · `@xmanrui/dsh-im` | B · C · bridge | provision · message.send · webhook |
| `dsh-dream-skin` | B | 皮肤 revision |
| `dsh-undo-savepoint` | B | `/api/undo` |
| `dsh-plugin-wallpaper-engine` | B | 壁纸 settings |
| `dsh-skin-market` | B | 皮肤市场 |
| `dsh-tokenledger` | bridge | Face cost-meter 聚合 |
| `dsh-mobile` | B | mobile-access |
| `dsh-tongflow` | B · bridge | 节点运行时 · `/tongflow/scan` |
| `dsh-cost-meter` | bridge | cost-meter 定价/余额 |
| `dsh-context` | Face 投影 | timeline / headers |
| `@liustack/modsearch` | B · bridge | 本地/远程搜索 |
| `@ychris12138/dsh-usage-stats` | bridge | usage-stats |
| `@anionex/dsh-turn-rewind` | B | turn-rewind |
| `@xrkseek/dsh-compat` | I | 内置兼容器 `kind: host` |

## Vendor 缺口（`DSH_COMPAT_KNOWN_GAPS`）

**0.1.0 矩阵为空** — 下列四类能力已由 bridge 覆盖：

| 能力 | 入口 |
|------|------|
| IM 消息 / webhook | RPC `message.send` · `POST /api/im/:channel/webhook` |
| TongFlow 节点 | `/api/task/wait` · 内置 `echo` / `text.template` / `json.*` |
| GenUI React | `POST /preview/:id` → `reactTree` + `componentRegistry` |
| Vision OCR | `/_dsh/vision-router/analyze` · `xrk-local-vision` |

大规模生产部署见 [status.md](./status.md)「未做」。

## 本地审计

对本机插件目录（默认 `~/.xrk/plugins`，或 `XRK_PLUGINS_DIR`）：

```bash
node scripts/dsh-community-audit.mjs
```

对照 `dsh-client-scan` 推断的 RPC 与 `DSH_HTTP_CAPABILITIES`；未入表路径走 honest catch-all，**不会** SPA 404。

## Face：`dynamicCordisRunner/*`

产品壳 Cordis 面板调用 Face RPC（非嵌 Cordis Host）：

| 方法 | 行为 |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | dsh-compat + 可选 fiber 子进程 |
| `invoke` | 转发 `cordisHostBridge.invokeRpc` → registry / fiber |
| `stopFromPanel` | `stopHostPackageFiber` + bridge ack |

规格：[host-face.md](./host-face.md)。

## 相关

- [status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md)
- [ADR-0002](./adr/0002-no-embed-upstream.md)
