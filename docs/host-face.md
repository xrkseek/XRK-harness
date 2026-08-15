# XRK Host Face（规格 · 最强轨）

> **产品契约草案。** 实现未开。浏览器侧说 DeepSeek Harness **apiproxy** 形状；本仓 session 为真源。  
> 学习：[learn/deepseek-web-ui.md](./learn/deepseek-web-ui.md) · 设计：[design/2026-08-15-providers-and-web-ui.md](./design/2026-08-15-providers-and-web-ui.md)  
> 上游契约真源：`deepseek-harness/packages/host/apiproxy`（`rpc-map.ts` · `sessions.ts` · `events.ts`）

## 1. 目标

在 `serve`（或并列 Host 进程）上提供与 DeepSeek Web 客户端兼容的：

1. **Unary RPC**：`POST /api/<method>`（method = `RpcMethodMap` 键，如 `session.prompt`）  
2. **双 WebSocket 下行**：`/api/events.mux` · `/api/events.host`（只下行）  
3. **握手**：两条 WS 就绪 + `host.describe`  
4. **认证**：保留 `XRK_API_KEY`（Bearer / `x-api-key`）；另采纳 loopback / `trustedHosts` 栅栏精华（防 DNS rebinding）

**不做：** 薄 REST UI；改每个 `ui-*`；把 Cordis 并入 agent kernel。

包名意向（待定）：`@xrkseek/host-face` 或 `server` 子面——依赖 `core-session` / `core-agent` / protocol / Provider Registry；**禁止**依赖具体 llm 厂商 SDK（经 registry）。

## 2. 传输与信封

对齐上游窄形（精神一致；字段以实现测例锁死）：

| 方向 | 形状 |
|------|------|
| Client → Host | `{ rpcId, payload }` |
| Host → Client（unary 响应） | `{ rpcId, result: { ok: true, value } \| { ok: false, error } }` |
| Host → Client（WS 帧） | `{ rpcId, payload: MuxFrame \| HostFrame }` |
| Client → Host（答审批等） | `POST /api/respond` 回显同一 `rpcId`（U1 可先拒未支持） |

未实现的 method：`ok: false` + 稳定 `error.code`（如 `not-implemented`），**禁止**假成功。

## 3. U1 必实现方法（对话主路径）

| RPC | 本仓映射 | 备注 |
|-----|----------|------|
| `host.describe` | 版本 · `XRK_WORKSPACE` cwd · Registry 默认 provider/model · attached 计数 · `canOpenPath: false`（无桌面则 false） | 连接就绪必需 |
| `session.create` | `newSession`；`agentPreset` → preset id（unknown → `agent-preset-not-found`） | 可预分配 sessionId |
| `session.list` | 枚举已知名 session + 摘要 | `blank` / `running` 从事件与 latch 推导 |
| `session.history` | 读 store 事件窗；`beforeSeq` / `maxMessages`；返回 `projections: { asOfSeq, values }`（title · sessionListMetadata） | Face 投影仓快照 |
| `session.prompt` | 见 §4 | slash 真 recipe；rpcId 钉到 `user/message` |
| `session.cancel` | 中止在飞 turn（AbortSignal / latch） | pending inbox 保留语义对齐 delivery |
| `session.models` | Registry → `SessionModels` | `routable` 独立于 catalog |
| `session.selectModel` | 绑定 session → provider/model | 写入可恢复配置（非密钥） |
| `session.rename` | 写 log-only `session/title`（source=user）→ 投影 `title` | 空标题 → `title-invalid` |
| `session.updateQueue` | edit / remove / steer pending admits | `prompt/withdrawn` + 权威 `session/queue` |
| `agentPreset.list` | Face 花名册 minimal/harness/server | 无业务逻辑 |
| `agentPreset.select` | 绑定 session → preset；invalidate agent cache | unknown → `agent-preset-not-found` |

### U2 工作区（本仓 workspace 真源）

| RPC | 本仓映射 | 备注 |
|-----|----------|------|
| `workspace.describe` | `workspaceRoot` · productDir（默认 `.xrk`）· 是否存在 · 已登记 seed 模板名 | `canOpenPath: false` |
| `workspace.listProduct` | 枚举 product 树（深度/条数封顶） | 路径逃逸 → `path-escape` |
| `workspace.previewInject` | `resolveWorkspaceInject` → block 摘要 / 可选短 preview | 预算截断事件透出 |
| `workspace.syncSeeds` | `createWorkspaceInjector.syncSeeds` | `template` 查 `seedTemplateDirs`；或 `seedDir` under root |
| `settings.get` | ui / host / llm scopes | host·llm 只读；见 [lc24](./learn/face-settings-credentials.md) |
| `settings.set` | 仅 `ui`（theme/locale） | 其它 scope → `settings-readonly` |
| `credentials.list` | 槽位元数据（无明文） | env 或 vault · `configured`/`source` |
| `credentials.set` | 进程内存 vault | 永不写 session / 磁盘 |

### U2.1 fork · policy 门

| RPC / 路径 | 本仓映射 | 备注 |
|------------|----------|------|
| `session.fork` | `forkSession(store, …)` | `beforeSeq`（1-based 含）· 可选 `newSessionId`；复制 model/preset 绑定 |
| `session.selectModel` + policy | `assertPolicyAllow(provider.use)` | Host `XRK_POLICY_FILE` → Face `policy`；deny → `policy-denied` |
| `session.respondApproval` | Face `approvals.respond` | `allow`\|`deny`；写 `approval/decided`；解开 pipeline ask |

U2/U3 **仍 not-implemented**：`attachment` · `search` · subagent* · goal* · skill* · agentPreset 创作面 · `llm.discoverModels`

详见 [learn/face-workspace.md](./learn/face-workspace.md)（lc23）· [learn/face-settings-credentials.md](./learn/face-settings-credentials.md)（lc24）· [policy.md](./policy.md)。

U1 历史显式清单中的 `workspace*` 已由上表覆盖。

U3+ 按 lc17 §4 加宽；每加一域先补本节表与测例。

## 4. `session.prompt` 往返（U0 对照结论）

### 4.1 上游语义

```text
payload: { sessionId, mode: 'queue'|'steer', content: PromptContentPart[], clientTimeZone? }
→ { accepted: true, command?: { kind: 'success', text? } }
```

- `mode`：`queue` → send/queue；`steer` → steer（对齐本仓 delivery）  
- 单 text 且以 `/` 开头 → **slash 命令**，不进模型（本仓 slash recipes）  
- 用户消息事件可带 **rpcId**（乐观 UI 对齐）

### 4.2 本仓映射（最强 · 不得偷懒成「只 chat」）

```text
session.prompt(mode, content)
  1. 规范化 content → 文本（U1：仅 text；image → not-implemented 或明确错误）
  2. 若 slash → 执行 recipe / command 面；返回 command 槽；不 admit 模型轮
  3. 否则：
       admitPrompt({ content, delivery: mode })     // prompt/admitted
       wake 或 resume drain（产品默认：wake 非阻塞，与 UI 流式一致）
  4. 在写入 user/message 时（promote/runTurn）把 rpcId 放入可投影元数据
       （协议扩展或 Face 侧旁路表：rpcId ↔ admitId/turnId；不得丢乐观对齐）
  5. 返回 { accepted: true }；后续靠 mux session/event
```

对照本仓 HTTP：

| Face | 近似 REST | 差异 |
|------|-----------|------|
| prompt(queue/steer) | `admit` + `delivery` + `wake` | Face 一次完成；REST 拆端点 |
| 流式可见性 | `/api/chat/stream` 的 `session_event` | Face 用 **mux WS**，非 SSE |

**禁止：** Face 内部只调 `/api/chat` 阻塞等到整轮结束再返回（破坏流式壳）。

### 4.3 事件投影（mux）

本仓 `@xrkseek/protocol` 事件 → 上游 `MuxFrame`：

| 本仓 `SessionEvent.type` | mux | 说明 |
|--------------------------|-----|------|
| （任意 append） | `session/event` | 透传本仓事件 + 可选 Host `view`（tool 卡） |
| 投影单元变化 | `session/projection` | `{ key, value, seq }`；客户端 `ProjectionStore.apply` |
| turn 开始/结束、running | 另推 `host/session-status` | 见 host 流 |
| `prompt/admitted` 后 inbox | `session/queue` 快照 | `{ id, placement, content, rpcId? }` |
| `tool/call` · `tool/result` | `session/event` + `view` | Host `presentToolView`；log 无 view |
| `approval/asked` · `approval/decided` | `session/event` + `session/approvals` | Face broker；AppShell Allow/Deny |

同构表：[learn/face-event-isomorphism.md](./learn/face-event-isomorphism.md)

**投影单元（Face 默认）**

| key | 来源 | 说明 |
|-----|------|------|
| `title` | `session/title`（fallback 首条 user/message · user rename） | `string \| null`；user 钉死后 fallback 不覆盖 |
| `sessionListMetadata` | `turn/start` · `user/message` | `{ blank, lastPromptAt }` |

订阅基线：WS 打开后对每个 attached session 发 `session/subscribed{ lastSeq }`，再可选重放 pending approval（无则跳过）。

**seq：** Face 用 append 单调序号（1-based 日志下标）作为 `lastSeq` / history 游标——**Face 拥有 seq 空间**，与投影 `seq` 同一时钟。

### 4.4 Host 流

| HostFrame | 何时 |
|-----------|------|
| `host/session-added` | create 后；`blank: true` |
| `host/session-status` | turn 飞起/落定 → `running` |
| `host/session-removed` | （若有销毁 API） |
| `host/agent-error` | 无 turn 位的失败 |

## 5. 与现有 REST 共存

| 面 | 用途 |
|----|------|
| 现有 `/api/sessions` · admit · chat · SSE | CLI、脚本、测例、非 DeepSeek 客户端 |
| Host Face `/api/face/*` + WS | DeepSeek 兼容协议面（U1） |

两者共用同一 `core-session` 真源；Face **不是** REST 的别名层，是并行协议面。

U1 / U1.1 wire 路径（与 REST 共存）：

| 面 | Unary | WS |
|----|-------|-----|
| 前缀（仍支持） | `POST /api/face/<method>` | `/api/face/events.mux` · `/api/face/events.host` |
| **DeepSeek 原生** | `POST /api/<method>`（method **必须含 `.`**，如 `session.prompt`） | `/api/events.mux` · `/api/events.host` |

REST `/api/sessions` · `/api/chat` **不含点**，不会被 Face 抢走。  
实现计划：[superpowers/plans/2026-08-15-host-face-u1.md](./superpowers/plans/2026-08-15-host-face-u1.md)

## 6. Boot / 静态

- [x] `XRK_WEB_DIST` → host 托管 SPA dist（`@xrkseek/server-http` `webStatic`）  
- [x] index tap 注入 `__DSH_BOOT__` / `__XRK_BOOT__`（默认 `XRK_APP_SHELL_BOOT`）  
- [x] XRK BootComposition 花名册 + SlotRegistry chrome（[lc22](./learn/xrk-app-shell.md)）  
- [ ] DeepSeek Cordis composition / Logo 资源（非本仓内核目标）  
- [x] apps/web AppShell + Face console（`?console=1`）可 `vite build`  

## 7. 测例要求（实现时）

- 契约测：每个 U1 method 的 ok / 错误码  
- prompt：queue + steer → 本仓 `prompt/admitted.delivery`  
- mux：admit→turn 过程中至少收到 `session/event` 与 `host/session-status`  
- 未实现 method → `not-implemented`  
- 带 `XRK_API_KEY` 时未授权 → 403  

## 8. 实现勾选

- [x] 包骨架 + 路由 + WS（`@xrkseek/server-face` · `/api/face/*` + DeepSeek 原生 `/api/<method>`）  
- [x] U1 方法表  
- [x] 事件 seq + 投影（mux session/event）  
- [x] apps/web AppShell（BootComposition + chrome）+ Face console 验证器 + boot 注入缝  
- [x] docs/status 更新  
- [x] 与 Registry 的 `session.models` / `llm.providers` 对接  
- [x] `session/projection` + title/listMetadata 单元 + `session.rename`  
- [x] apps/web 接 `FaceSessionView` / `SlotRegistry`  
- [x] prompt 真 slash · rpcId 钉 `user/message` · `session.updateQueue`  
- [x] tool `view` 适配 + isomorphism 夹具  
- [x] `agentPreset.list` / `select`  
- [x] Face U2 `workspace.*`（describe / listProduct / previewInject / syncSeeds）+ AppShell 面板  
- [x] Face U2 `settings.*` / `credentials.*`（ui 可写 · vault 不入库）+ AppShell 面板  
- [x] `session.fork` · `XRK_POLICY_FILE` → Face `provider.use` 门  

## Related

- [http-api.md](./http-api.md) · [session-api.md](./session-api.md) · [protocol-events.md](./protocol-events.md) · [session-delivery.md](./session-delivery.md)
