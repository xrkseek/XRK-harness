# Host Face

`@xrkseek/server-face`：Unary RPC + 双 WebSocket，与 REST `/api/sessions` 并行，共用 session 真源。

## 目标

1. Unary：`POST /api/<method>`（点号如 `session.prompt`，或 Typert `commands/execute`）或 `/api/face/<method>`
2. WS：`/api/events.mux` · `/api/events.host`（及 `/api/face/events.*`）
3. 认证：`XRK_API_KEY`（Bearer / `x-api-key`）；产品壳同源回环可无头
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
| 能跑 | `host.describe` · `host.listDirectory` · `host.createDirectory` · `host.openPath` · `session.create/list/history/search/prompt/cancel/models/selectModel/rename/updateQueue/fork/respondApproval` · `session.attachment`（须附件仓 + 事件引用） · `GET/HEAD /api/session.export`（ZIP：JSONL + 子会话 + 附件；HEAD 先探活） · `agentPreset.list/select/read` · `workspace.list/create/rename/archiveSession/delete/insertBefore/insertSessionBefore` · `workspace.describe/listProduct/previewInject/syncSeeds` · `settings.get/set/describe/mutate/update/replace/openDocument` · `credentials.list/describe/set/unset` · `llm.providers/models/discoverModels` · `skill.list` · `commands/list` · `commands/execute`（内建 `/goal` · 进程 `kind: commands` 优先，否则 workspace recipe → `command/run`+`command/done`） · `pluginInventory/list`（进程插件 + 产品壳 `boot.json` 条目；`kind: cordis` 为 `enabled: false` / `fiberPhase: failed`） · `subagent.list/history/prompt/interrupt`（`session.create({ parentSessionId })` 或 `session.fork` 登记子会话；无 ACP 外挂） · `messageFeedback/list/put/delete`（进程内 CAS；`messageId` = `{turnId}:{stepId}`） · `goals/create|edit|pause|resume|complete|clear` 与 DSH 点号别名 `goal.*`（投影 `goal`；`turn/end` 在 armed 时续 admit，达 `maxGoalRounds` 则 `blocked`；Host 旁路 `{XRK_SESSIONS_DIR}/goals.json`） · `dynamicCordisRunner/*` 空 inventory / no-op（不 `apply` Cordis） |
| 软降级 | `host.pickDirectory` → `{ path: null }`（browse 用 listDirectory） |
| 诚实拒绝 | `agentPreset.copy/remove/openDocument` → `agent-preset-read-only`（`authorable: false`；壳侧按钮已禁用） |

Wire：`session/queue` 带完整 `message` 块；`prompt/*` → mux/history `agent/inbox/spliced`；mux 重连对有 pending 的 session 补发 queue 基线。审批：mux `approval/requested`（稳定 rpcId）→ `POST /api/respond`（`client-response`）；亦保留 `session.respondApproval`。错误信封必含 DSH `details`。`session.search` 扫 `user/message` + `assistant/message` + `prompt/admitted` + `safety/notice`，按最近活动降序，上限 20，`hasMore`（JSONL 仓 eager load，同一扫描；不是 SQLite FTS）。`skill.list` 读工作区 `.xrk/skills/*/SKILL.md`。`host.openPath` / `settings.openDocument`：Win `cmd start` · macOS `open` · Linux `xdg-open`（桌面 `canOpenPath: true`；openDocument 忽略客户端 path，优先 `XRK_POLICY_FILE`，否则写红acted `host-settings.json`）。`llm.discoverModels`：draft 探测 openai-chat `GET /models`（`settingsNs` = `llm` 或 `llm-pi-ai`）；失败 `model-discovery-failed`，details 不含密钥；不落盘。`agentPreset.read` 只读 catalog（`trust: system`）；创作面因 `authorable: false` 回 `agent-preset-read-only`（不是 `internal`）。`goal.*` 与 `goals/*` 同一套 handler。Cordis 面板 `dynamicCordisRunner/inventory` 回空数组，不嵌 `apply(ctx)`。

Host MCP：`XRK_MCP_SERVERS` JSON（`command` stdio 或 `url` streamable-http）+ `XRK_MCP_ALLOW=1`（或 policy allow）→ 注册为 `kind: tools` 插件。`tools/list_changed` 刷新工具表并 `invalidateAll` agent 缓存。

Policy：`XRK_POLICY_FILE` → `provider.use`；ask → `approval/*` + `session.respondApproval`。见 [policy.md](./policy.md)。

## `session.prompt`

```text
mode: queue | steer → admit（slash → recipe）→ wake drain（非阻塞）→ mux 流式
```

含图：须 `attachments` + `inputModalities` 含 `image`；先 `saveImages` 再 admit（失败不入账）。Host Face 默认 `text+image`。官方 DeepSeek 适配器未声明 `image` → loop 仍 `UnsupportedContentError`。`session.attachment` 仅返回本 session 事件引用过的 id。

## Boot

- 静态资源：`XRK_WEB_DIST` 可覆盖；未设置时 `serve` 自动寻找可用的 web dist
- `apps/web-static`：产品聊天壳（DSH Web 捕获）；`apps/web`：`?console=1` Face console（无 capture 时才回退）

## 相关

[http-api.md](./http-api.md) · [status.md](./status.md) · **[modules/server-face.md](./modules/server-face.md)**（文件地图）· [modules/server-host.md](./modules/server-host.md)
