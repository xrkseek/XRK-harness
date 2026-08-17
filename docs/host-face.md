# Host Face

`@xrkseek/server-face`：Unary RPC + 双 WebSocket，与 REST `/api/sessions` 并行，共用 session 真源。

基础契约对照 XRKbar DSH：[upstream/deepseek-harness/api-gateway.zh.md](./upstream/deepseek-harness/api-gateway.zh.md)。

## 目标

1. Unary：`POST /api/<method>`（含 `.`）或 `/api/face/<method>`
2. WS：`/api/events.mux` · `/api/events.host`（及 `/api/face/events.*`）
3. 认证：`XRK_API_KEY`（Bearer / `x-api-key`）
4. 未实现 → `ok: false` + 稳定 `error.code`（禁止假成功）

## 信封

| 方向 | 形状 |
|------|------|
| Client → Host | `{ type?: "client-request", rpcId, payload }` |
| Host → Client（unary） | `{ type: "server-response", rpcId, result }` |
| Host → Client（WS） | `{ rpcId, payload }` mux / host 帧 |

## RPC 状态

| 状态 | 方法 |
|------|------|
| 能跑 | `host.describe` · `host.listDirectory` · `host.createDirectory` · `session.create/list/history/prompt/cancel/models/selectModel/rename/updateQueue/fork/respondApproval` · `agentPreset.list/select` · `workspace.list/create/rename/archiveSession` · `workspace.describe/listProduct/previewInject/syncSeeds` · `settings.get/set/describe/mutate/update/replace` · `credentials.list/describe/set/unset` · `llm.providers/models` |
| 软降级 | `host.pickDirectory` → `{ path: null }`（browse 用 listDirectory）· `skill.list` / `subagent.list` → 空目录 |
| 未做（NI） | `host.openPath` · `session.attachment/search` · `settings.openDocument` · `workspace.delete/insert*` · `agentPreset` 创作面 · `llm.discoverModels` · `goal.*` · subagent 写路径 |

Wire：`session/queue` = DSH `QueuedInboxItem`（`message` 块）；`prompt/*` → mux/history `agent/inbox/spliced`（坐标按 bar `inbox.ts` 投影）。

Policy：`XRK_POLICY_FILE` → `provider.use`；ask → `approval/*` + `session.respondApproval`。见 [policy.md](./policy.md)。

## `session.prompt`

```text
mode: queue | steer → admit（slash → recipe）→ wake drain（非阻塞）→ mux 流式
```

## Boot

- 优先 `vendor/dsh-web-static`（`boot.json` + `/plugins`）；`XRK_WEB_DIST` 可覆盖
- 产品壳：XRKbar `deepseek-harness` → `pnpm web:dsh:capture`
- `apps/web`：landing + `?console=1` Face console

## 相关

[http-api.md](./http-api.md) · [status.md](./status.md) · Canvas `xrk-harness-polish-learn`
