# Host Face

`@xrkseek/server-face`：Unary RPC + 双 WebSocket，与 REST `/api/sessions` 并行，共用 session 真源。

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
| 能跑 | `host.describe` · `host.listDirectory` · `host.createDirectory` · `host.openPath` · `session.create/list/history/search/prompt/cancel/models/selectModel/rename/updateQueue/fork/respondApproval` · `session.attachment`（须附件仓 + 事件引用） · `agentPreset.list/select` · `workspace.list/create/rename/archiveSession` · `workspace.describe/listProduct/previewInject/syncSeeds` · `settings.get/set/describe/mutate/update/replace` · `credentials.list/describe/set/unset` · `llm.providers/models` · `skill.list` |
| 软降级 | `host.pickDirectory` → `{ path: null }`（browse 用 listDirectory）· `subagent.list` → 空目录 |
| 未做（NI） | `settings.openDocument` · `workspace.delete/insert*` · `agentPreset` 创作面 · `llm.discoverModels` · `goal.*` · subagent 写路径 |

Wire：`session/queue` 带完整 `message` 块；`prompt/*` → mux/history `agent/inbox/spliced`；mux 重连对有 pending 的 session 补发 queue 基线。`session.search` 为内存扫 `user/message` + `assistant/message`（上限 20，`hasMore`）。`skill.list` 读工作区 `.xrk/skills/*/SKILL.md`。`host.openPath` 调 OS 默认打开（桌面平台 `canOpenPath: true`）。

Host MCP：`XRK_MCP_SERVERS` JSON + `XRK_MCP_ALLOW=1`（或 policy allow）→ 注册为 `kind: tools` 插件。

Policy：`XRK_POLICY_FILE` → `provider.use`；ask → `approval/*` + `session.respondApproval`。见 [policy.md](./policy.md)。

## `session.prompt`

```text
mode: queue | steer → admit（slash → recipe）→ wake drain（非阻塞）→ mux 流式
```

含图：须 `attachments` + `inputModalities` 含 `image`；先 `saveImages` 再 admit（失败不入账）。默认 Host 为 text-only → `unsupported-modality`。`session.attachment` 仅返回本 session 事件引用过的 id。

## Boot

- 静态资源：`XRK_WEB_DIST` 可覆盖；未设置时 `serve` 自动寻找可用的 web dist
- `apps/web`：自研聊天壳（默认）+ `?console=1` Face console；无 `dist` 时 `serve` 回退 `apps/web-static`

## 相关

[http-api.md](./http-api.md) · [status.md](./status.md) · **[modules/server-face.md](./modules/server-face.md)**（文件地图）· [modules/server-host.md](./modules/server-host.md)
