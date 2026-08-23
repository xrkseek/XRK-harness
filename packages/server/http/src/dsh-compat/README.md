# dsh-compat

> **读者**：维护者 · 贡献者（改 Host 兼容器、社区 bridge、矩阵与测例）。

DSH 社区 Host **兼容器**（`@xrkseek/server-http`），**不是** Cordis Host 主进程。

设计原则：**通用底层 + 薄 adapter + 具名 bridge 模块**，不按社区包名逐个写兼容。能力矩阵真源：`dsh-compat-matrix.ts`。集成者说明书：[docs/community-plugins.md](../../../../docs/community-plugins.md)。

## 装配顺序（真源）

```text
1. baselineHttpRoutes + baselineRpcRoutes       # 全局能力表（一次挂载）
2. inventory manifest（xrk.host.json / infer）   # 显式 XRK 扩展 + RPC 推断
3. host.mjs apply bridge                         # createHostContribution / apply shim
4. cordis-fiber-runner（按需）                   # 进程内 apply 失败 → 子进程 RPC
5. honest GET catch-all                          # 未入表 GET 仍 JSON
6. cordis-registry RPC + POST catch-all          # settings fallback / rpcOk
7. Host attachExtras                             # attachDshCompatUpgrades（prewarm 后）
```

`serve` 经 `ensureDshCompatHostPlugin()` 加载 `extensions/dsh-compat`（`kind: host`）；HTTP 实现在本目录。

## 三层

| 层 | 代表模块 | 职责 |
|----|----------|------|
| **底层** | `json-store` · `xrk-json-store` · `honest-envelope` · `wallet` · `im-channels` · `vision` · `tongflow` · … | 持久化 + 诚实 `*-host` |
| **Bridge** | `host-feature-bridge` · `im-provision-bridge` · `cordis-fiber-runner` · Face `cordis-stub` · Host cost-meter / harness-connector | DSH 契约 ↔ XRK 实现 |
| **兼容器** | `adapter-compose` · `adapter-providers` · `cordis-registry` | 只装配；`wire/*` 复用 `honest-envelope` |

### Bridge 模块（0.1.0）

| 文件 | 职责 |
|------|------|
| `host-feature-bridge.ts` | modsearch · GenUI HTML · vision 元数据 · noema keyword · auto-review 启发式 · TongFlow inventory scan |
| `im-provision-bridge.ts` | `provision.*` OAuth · authCode 落盘 |
| `im-messaging-bridge.ts` | `message.send` / `messages.list` · `POST /api/im/:channel/webhook` |
| `tongflow-node-runtime.ts` | 内置 TongFlow 节点执行 · scan registry 合并 |
| `cordis-fiber-runner.ts` | fork 子进程加载 `host.mjs`；IPC `invoke`；`stopCordisFiber` |
| `cordis-fiber-worker.ts` | 子进程入口（`XRK_CORDIS_FIBER_WORKER=1`） |
| `host-apply-bridge.ts` | boot / `runHostHalf` apply；fiber fallback；`stopHostPackageFiber` |

### 底层 framework primitives（XRK 自有）

| Primitive | 模块 | 用途 |
|-----------|------|------|
| 路径真源 | `json-store.dataPath` | `~/.xrk/…` 或 `XRK_HOME` |
| Revision 文档 | `xrk-json-store` · `underlying/doc-store` | `{ revision, updatedAt, data }` |
| HTTP kit | `underlying/http-kit` | `parseJsonBody`（只读一次 body） |
| Settings 文档 | `persisted-settings-store` | Cordis `*-settings` RPC |
| 诚实 envelope | `honest-envelope` | `ready` / `*-host` 统一形态 |

### 底层模块写法（标准）

1. `createXrkDocStore(["namespace", "file.json"], default)` — 业务入口。
2. RPC/HTTP 用 `patch` / `read`；响应可带 `revision`。
3. POST/PUT 用 `parseJsonBody` — **禁止**先 `readBody` 再 `parseJsonBody`。
4. 诚实缺口用 `honest-envelope`，不散落 `incomplete` 字符串。
5. `adapter-providers` 只 `match` + 传 `xrkHome`，不写业务规则。

新能力：优先扩 **全局能力表**（`dsh-path-capabilities`）+ **具名底层/bridge 模块**，不为单个 npm 包 fork adapter。

## 学习 DSH（社区 client 契约摘要）

| 模式 | DSH 习惯 | XRK 底层 |
|------|----------|----------|
| 同源 HTTP | `fetch("/api/wallet/…")` · `/_dsh/<pkg>/…` | `DSH_HTTP_CAPABILITIES` |
| Settings RPC | `POST /{channel}` · `*-settings` | `persisted-settings-store` |
| 专用 RPC | `/office` · `/modsearch` | `SPECIAL_RPC` baseline |
| Cordis envelope | `{ ok, value }` / RPC envelope | `dsh-envelope.ts` |
| client 扫描 | `client.js` 路径/channel | `dsh-client-scan`（RPC infer） |
| 诚实缺口 | Host 不可用仍 JSON | `honest-envelope` · catch-all |
| Cordis panel | `dynamicCordisRunner/*` | `face/handlers/cordis-stub.ts` |

推断顺序：`dsh-community-infer.ts` · [plugin-loader.md](../../../../docs/plugin-loader.md)。

## 与产品壳「35 插件」的关系

`docs/status.md` 的 **35** = 产品壳 boot 图（`@xrkseek/client-*`），**不是** 社区 Host 能力表条目数。

| 来源 | dsh-compat 怎么接 |
|------|-------------------|
| 产品壳内置 client | Face wire；一般不额外要 Host HTTP |
| `plugin add` 社区包 | 适配层级 A–J（见 [community-plugins.md](../../../../docs/community-plugins.md)） |
| `xrk.host.json` / `host.mjs` | 显式 manifest 或 apply / fiber |

## 社区插件适配层级（A–J）

| 层级 | 触发条件 | 行为 |
|------|----------|------|
| **A · 纯 UI** | 无自定义 Host 路径 | 通常可直接用 |
| **B · 全局能力表** | 命中 `DSH_HTTP_CAPABILITIES` | 真实底层 |
| **C · `*-settings` RPC** | `*-settings` channel | 持久化 settings |
| **D · `/_dsh/<pkg>/…`** | 社区 Host 前缀 | `generic-dsh-http` |
| **E · 单段 slug** | `GET /whale-girl` 等 | `community-root-http` |
| **F · GET 未覆盖** | 任意其它 GET | `honest-http-catchall` |
| **G · POST 未注册 RPC** | 未命中 channel | settings fallback |
| **H · 显式 manifest** | `xrk.host.json` | provider 声明 |
| **I · `host.mjs`** | `createHostContribution` | 进程内 apply |
| **I′ · fiber 子进程** | 进程内 apply 失败 | `cordis-fiber-runner` |
| **J · 生产规模** | 厂商云端服务 | [status.md](../../../../docs/status.md)「未做」 |

## 通用已覆盖（节选）

`DSH_COMPAT_GENERIC_CAPABILITIES`：`xrk-json-store` · `honest-envelope` · `dynamic-cordis-runner` · `im-channels` · `im-messaging-bridge` · `tongflow-node-runtime` · `genui-library` · `vision-persist` · …

能力表前缀：`DSH_HTTP_CAPABILITIES` in `dsh-path-capabilities.ts`。

## Vendor 缺口（`DSH_COMPAT_KNOWN_GAPS`）

**0.1.0 为空** — 四类 vendor wire 已由 bridge 模块覆盖；大规模官方服务见教科书 [status.md](../../../../docs/status.md)。

**有** `host.mjs` apply shim + **可选** Cordis fiber 子进程；**不是** Cordis kernel 嵌入主进程。

## `extensions/dsh-compat`

内置 **`kind: host`** 插件（`xrk.plugin.json` + `host.mjs`）。`private: true`；HTTP 实现仍在本包。
