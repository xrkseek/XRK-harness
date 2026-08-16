# Host Face

产品规格。`@xrkseek/server-face`：Unary RPC + 双 WebSocket，与 REST `/api/sessions` **并行**，共用 session 真源。

## 目标

1. **Unary RPC**：`POST /api/<method>`（method 含 `.`，如 `session.prompt`）；亦支持 `/api/face/<method>`  
2. **双 WS 下行**：`/api/events.mux` · `/api/events.host`（及 `/api/face/events.*`）  
3. **认证**：`XRK_API_KEY`（Bearer / `x-api-key`）  
4. 未实现 method → `ok: false` + 稳定 `error.code`（如 `not-implemented`），禁止假成功  

## 信封

| 方向 | 形状 |
|------|------|
| Client → Host | `{ rpcId, payload }` |
| Host → Client（unary） | `{ rpcId, result: { ok: true, value } \| { ok: false, error } }` |
| Host → Client（WS） | `{ rpcId, payload }` mux / host 帧 |

## 已实现 RPC（摘要）

| 域 | 方法 |
|----|------|
| Host | `host.describe` |
| Session | `create` · `list` · `history` · `prompt` · `cancel` · `models` · `selectModel` · `rename` · `updateQueue` · `fork` · `respondApproval` |
| Agent preset | `agentPreset.list` · `agentPreset.select` |
| Workspace | `workspace.describe` · `listProduct` · `previewInject` · `syncSeeds` |
| Settings / credentials | `settings.get` · `settings.set` · `credentials.list` · `credentials.set` |
| LLM catalog | `llm.providers` · `llm.models` |

**仍未实现：** `attachment` · `search` · subagent* · goal* · skill* · agentPreset 创作面 · `llm.discoverModels`

Policy：`XRK_POLICY_FILE` → Face `provider.use`；ask → `approval/*` + `session.respondApproval`。见 [policy.md](./policy.md)。

## `session.prompt`

```text
mode: queue | steer
→ admit（slash 走 recipe，不进模型）
→ wake drain（非阻塞）
→ mux session/event 流式下行
```

禁止 Face 内部阻塞调用整轮 `/api/chat` 再返回。

## 与 REST 共存

| 面 | 用途 |
|----|------|
| `/api/sessions` · admit · chat · SSE | CLI、脚本、测例 |
| Face RPC + WS | AppShell / Face 客户端 |

REST 路径**不含点**，不会与 `session.prompt` 冲突。

## Boot

- `XRK_WEB_DIST` 托管 SPA；index 注入 `__XRK_BOOT__`  
- `apps/web` AppShell + Face console（`?console=1`）  

## 相关

[http-api.md](./http-api.md) · [session-api.md](./session-api.md) · [protocol-events.md](./protocol-events.md) · [session-delivery.md](./session-delivery.md) · [status.md](./status.md)
