# Host Face 协议

> **读者**：集成者 · 贡献者

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
| 能跑 | `host.describe` · `host.pickDirectory` · `host.listDirectory` · `host.createDirectory` · `host.openPath` · `session.create/list/history/search/prompt/cancel/models/selectModel/rename/updateQueue/fork/respondApproval` · `session.attachment`（须附件仓 + 事件引用） · `GET/HEAD /api/session.export`（ZIP：JSONL + 子会话 + 附件；HEAD 先探活） · `agentPreset.list/select/read` · `workspace.list/create/rename/archiveSession/delete/insertBefore/insertSessionBefore` · `workspace.describe/listProduct/previewInject` · `settings.get/set/describe/mutate/update/replace/openDocument` · `credentials.list/describe/set/unset` · `llm.providers/models/discoverModels` · `skill.list` · `commands/list` · `commands/execute`（内建 `/compact` · `/export` · `/feedback` · `/goal` · `/permission` · `/plan` · 进程 `kind: commands` 优先，否则 workspace recipe → `command/run`+`command/done`） · `pluginInventory/list`（进程插件 + 产品壳 `boot.json` 条目；`kind: cordis` 为 `enabled: false` / `fiberPhase: failed`） · `fileReferences/list` · `sessionReferenceResolver/candidates`（产品壳 `@file` / `@session` 补全；会话候选仅 id/cwd/title 元数据，不含跨会话 prepare） · `subagent.list/history/prompt/interrupt`（`session.create({ parentSessionId })` 或 `session.fork` 登记子会话；无 ACP 外挂） · `messageFeedback/list/put/delete`（进程内 CAS；`messageId` = `{turnId}:{stepId}`） · `goals/create|edit|pause|resume|complete|clear` 与点号别名 `goal.*`（投影 `goal`；`turn/end` 在 armed 时续 admit，达 `maxGoalRounds` 则 `blocked`；Host 旁路 `{XRK_SESSIONS_DIR}/goals.json`） · `dynamicCordisRunner/*` 空 inventory / no-op（不 `apply` Cordis） |
| 诚实拒绝 | `agentPreset.copy/remove/openDocument` → `agent-preset-read-only`（`authorable: false`；壳侧按钮已禁用） |

### Wire 与流行为

Wire：`session/queue` 带完整 `message` 块；`prompt/*` → mux/history `agent/inbox/spliced`；mux 重连对有 pending 的 session 补发 queue 基线。后台任务：`session/jobs` 全量快照（有 registry 才发；基线只在非空时发；清空仍推 `[]`）。Host 流：`host/session-added` 含 `sessionListFields`（子会话带 `parentSessionId` + `origin: "subagent"`；`blank` 看有无 `turn/start`）；`workspace.delete` 发 `host/workspace-removed`；`workspace.insertBefore` 发 `host/workspace-order-changed`（全量 id 序）。凭据 / 设置 mutate / preset select 发 `host/remote-event`（壳 `ctx.remote.$dispatch`；不转发 Cordis inspect/run）。无 session dispose，故不发 `host/session-removed`。

### 审批与提问

审批：mux `approval/requested`（稳定 rpcId）→ `POST /api/respond`（`client-response`）；亦保留 `session.respondApproval`。提问：mux `question/requested`（rpcId 即问题 id）→ 同一 `/api/respond`（先审批后提问；`result.ok:false` + `error.code: cancelled` 取消）；`ask_user` 支持 `question` 与 `questions[]`（options / multi_select / `intent.kind: plan-review`），Face / Host bind 到 broker。错误信封必含 `details`。

### 搜索、技能与目录选择

`session.search` 扫 `user/message` + `assistant/message` + `prompt/admitted` + `safety/notice` + `command/run|done` + `todo/write` + `feedback/record`，按最近活动降序，上限 20，`hasMore`（JSONL 仓 eager load，同一扫描；不是 SQLite FTS）。`skill.list` 读工作区 `.xrk/skills/*/SKILL.md`。`host.pickDirectory`：系统选目录；取消 `{ path: null }`；不可用 `directory-picker-unavailable`（macOS `osascript` · Linux zenity→kdialog · Win PowerShell STA `FolderBrowserDialog`；单测注入 picker）。

### 设置、MCP 与斜杠命令

终端用户调参优先 **设置 → 模型 / 凭据 / 插件 / 权限**（经 Face `settings.*` / `credentials.*`）。`settings.describe` 的 namespace schema 是 schemastery `{ uid, refs }`（`permission` / `llm` / `ui-theme` / `locale` / `ui-onboarding` / `mcp`）；mutate 回同一 envelope。`mcp.servers` 为 desired 草稿（禁 `env`，落 `{productDir}/host-settings.json`，`applies: restart`）；`connected` 是已连接 `mcp:*` overlay。`session.prompt` 斜杠：成功才带 `command.kind: "success"`；未知 `/name` 当普通消息；失败 `command-error`。`/compact` idle 时写 `context/compaction`（`reason: manual`）；无历史 success；带参数 usage error。`/export` 只入账「Session log download requested.」（壳 `command/executed` 后 HEAD `/api/session.export`）；带路径 usage error。`/feedback` 写 `feedback/record`（log-only；`command/run` 不落 `args`）；无分享后端，成功文案带「Session sharing is not configured.」；空参 usage error。

### 打开路径、模型发现与预设

`host.openPath` / `settings.openDocument`：Win `cmd start` · macOS `open` · Linux `xdg-open`（桌面 `canOpenPath: true`；openDocument 忽略客户端 path，优先 `XRK_POLICY_FILE`，否则写 redacted `host-settings.json`）。`llm.discoverModels`：draft 探测 openai-chat `GET /models`（`settingsNs` = `llm` 或 `llm-pi-ai`）；失败 `model-discovery-failed`，details 不含密钥；不落盘。`agentPreset.read` 只读 catalog（`trust: system`）；创作面因 `authorable: false` 回 `agent-preset-read-only`（不是 `internal`）。`goal.*` 与 `goals/*` 同一套 handler。Cordis 面板 `dynamicCordisRunner/inventory` 回空数组，不嵌 `apply(ctx)`。

### 工具卡与投影

工具卡：mux/history `view` 来自工具自己的 `presentCall` / `presentResult`（Face 只 lookup；抛错 / 缺 pairing / 无 presenter → 没 view，壳 generic；不写进 session 日志）。投影默认含 `todos`（`todo/write` 站立计划；下一 `turn/start` 清 null）、`permissions` · `plan`；有 AttachmentStore 时再登记 **`imageLimits`**（壳侧 InputBar 摄入预检：`maxImageBytes` / `maxImagesPerMessage` / `maxMessageImageBytes` / `maxImagePixels` / `mediaTypes`；boot 常量，只靠 history 尾页 / 列表基线携带，**不**推 `session/projection` 变更帧；无仓则键缺席）。投影驱动见 `@xrkseek/session-projection`（状态/视图分离；[session-projection.md](./modules/session-projection.md)）。

### Host MCP

Host MCP：`XRK_MCP_SERVERS` JSON（数组或 Cursor `{ mcpServers }`；`command` stdio 或 `url` streamable-http）+ `XRK_MCP_ALLOW=1`（或 policy allow）→ 注册为 `kind: tools` 插件。日常也可在 **设置 → 插件 → 插件配置** 编辑 `mcp.servers`（文件真源）。env/config 为空时读 `~/.xrk/host-settings.json` 的 `mcp.servers`（文件里的 `env` 忽略），并在 Face `settings.mutate` 后 `reconcileMcpToolPlugins` 热挂载（`applies: live`；**policy deny 时 park**，真实连接失败进 `connectFailures`）；env/config 非空则赢过文件且无 live sync。stdio/**HTTP** 在首次成功 connect 后有界进程重连；HTTP 另保留 SDK SSE `reconnectionOptions`。`tools/list_changed` / health 刷新工具表并 `invalidateAll`；health 变推 `settings/document-updated` 刷新 Face overlay `connected[].status`。Host spawn 把 preset standing 工具表交给 Face（`createStandingToolRegistry`：minimal = fs+std，harness/server 再加 bash）；冷 history 的 `viewFor` 不 resume agent（`assistant/message.reasoning` 与 bash/pty 卡可从 standing 表回放）。

### Policy

Policy：`XRK_POLICY_FILE` → `provider.use`；ask → `approval/*` + `session.respondApproval`。见 [policy.md](./policy.md)。

## `session.prompt`

```text
mode: queue | steer → admit（slash → recipe / skill 写入 user）→ wake drain（非阻塞）→ mux 流式
```

含图：须 `attachments` + `inputModalities` 含 `image`；先 `saveImages` 再 admit（失败不入账）。Host Face 默认 `text+image`。官方 DeepSeek 适配器未声明 `image` → loop 仍 `UnsupportedContentError`。`session.attachment` 仅返回本 session 事件引用过的 id。

## Boot

- 静态资源：`XRK_WEB_DIST` → CLI `product-web/` → monorepo `apps/web/dist`
- CLI monorepo 缺默认 dist 时代跑 `web:build` + `client:bundle` + `web:assemble`
- `apps/web`：产品壳源码；发行时拷进 `@xrkseek/harness-cli` 的 `product-web/`

## 相关

[http-api.md](./http-api.md) · [status.md](./status.md) · **[modules/server-face.md](./modules/server-face.md)**（文件地图）· [modules/server-host.md](./modules/server-host.md)

---

# Host Face Protocol

> **Audience**: Integrators · Contributors

`@xrkseek/server-face`: Unary RPC plus dual WebSockets, parallel to REST `/api/sessions`, sharing the same session source of truth.

## Goals

1. Unary: `POST /api/<method>` (dot form such as `session.prompt`, or Typert `commands/execute`) or `/api/face/<method>`
2. WS: `/api/events.mux` · `/api/events.host` (and `/api/face/events.*`)
3. Auth: `XRK_API_KEY` (Bearer / `x-api-key`); product-shell same-origin loopback may omit headers
4. Unimplemented → `ok: false` + stable `error.code` (no fake success)

## Envelope

| Direction | Shape |
|-----------|-------|
| Client → Host | `{ type?: "client-request", rpcId, payload }` |
| Host → Client (unary) | `{ type: "server-response", rpcId, result }` |
| Host → Client (WS) | `{ rpcId, payload }` mux / host frames |

## RPC status

| Status | Methods |
|--------|---------|
| Runnable | `host.describe` · `host.pickDirectory` · `host.listDirectory` · `host.createDirectory` · `host.openPath` · `session.create/list/history/search/prompt/cancel/models/selectModel/rename/updateQueue/fork/respondApproval` · `session.attachment` (requires attachment store + event refs) · `GET/HEAD /api/session.export` (ZIP: JSONL + child sessions + attachments; HEAD probes first) · `agentPreset.list/select/read` · `workspace.list/create/rename/archiveSession/delete/insertBefore/insertSessionBefore` · `workspace.describe/listProduct/previewInject` · `settings.get/set/describe/mutate/update/replace/openDocument` · `credentials.list/describe/set/unset` · `llm.providers/models/discoverModels` · `skill.list` · `commands/list` · `commands/execute` (built-ins `/compact` · `/export` · `/feedback` · `/goal` · `/permission` · `/plan` · process `kind: commands` first, else workspace recipe → `command/run`+`command/done`) · `pluginInventory/list` (process plugins + product-shell `boot.json` entries; `kind: cordis` → `enabled: false` / `fiberPhase: failed`) · `fileReferences/list` · `sessionReferenceResolver/candidates` (product-shell `@file` / `@session` completion; session candidates are id/cwd/title metadata only, no cross-session prepare) · `subagent.list/history/prompt/interrupt` (child sessions via `session.create({ parentSessionId })` or `session.fork`; no ACP sidecar) · `messageFeedback/list/put/delete` (in-process CAS; `messageId` = `{turnId}:{stepId}`) · `goals/create|edit|pause|resume|complete|clear` and dotted aliases `goal.*` (projection `goal`; armed `turn/end` continues admit; `blocked` at `maxGoalRounds`; Host sidecar `{XRK_SESSIONS_DIR}/goals.json`) · `dynamicCordisRunner/*` empty inventory / no-op (no Cordis `apply`) |
| Honest reject | `agentPreset.copy/remove/openDocument` → `agent-preset-read-only` (`authorable: false`; shell buttons disabled) |

### Wire and stream behavior

Wire: `session/queue` carries a full `message` block; `prompt/*` → mux/history `agent/inbox/spliced`; on mux reconnect, sessions with pending work get a queue baseline. Background jobs: `session/jobs` is a full snapshot (only if a registry exists; baseline only when non-empty; clear still pushes `[]`). Host stream: `host/session-added` includes `sessionListFields` (child sessions carry `parentSessionId` + `origin: "subagent"`; `blank` depends on whether `turn/start` exists); `workspace.delete` emits `host/workspace-removed`; `workspace.insertBefore` emits `host/workspace-order-changed` (full id order). Credential / settings mutate / preset select emit `host/remote-event` (shell `ctx.remote.$dispatch`; Cordis inspect/run is not forwarded). There is no session dispose, so `host/session-removed` is not emitted.

### Approvals and questions

Approvals: mux `approval/requested` (stable rpcId) → `POST /api/respond` (`client-response`); `session.respondApproval` remains. Questions: mux `question/requested` (rpcId is the question id) → the same `/api/respond` (approvals before questions; cancel with `result.ok:false` + `error.code: cancelled`); `ask_user` supports `question` and `questions[]` (options / multi_select / `intent.kind: plan-review`), bound by Face / Host to the broker. Error envelopes must include `details`.

### Search, skills, and directory picker

`session.search` scans `user/message` + `assistant/message` + `prompt/admitted` + `safety/notice` + `command/run|done` + `todo/write` + `feedback/record`, newest activity first, cap 20, with `hasMore` (JSONL store eager-loads the same scan; not SQLite FTS). `skill.list` reads workspace `.xrk/skills/*/SKILL.md`. `host.pickDirectory`: system directory picker; cancel `{ path: null }`; unavailable → `directory-picker-unavailable` (macOS `osascript` · Linux zenity→kdialog · Win PowerShell STA `FolderBrowserDialog`; tests inject a picker).

### Settings, MCP, and slash commands

End-user tuning prefers **Settings → Models / Credentials / Plugins / Permissions** (via Face `settings.*` / `credentials.*`). `settings.describe` namespace schemas are schemastery `{ uid, refs }` (`permission` / `llm` / `ui-theme` / `locale` / `ui-onboarding` / `mcp`); mutate returns the same envelope. `mcp.servers` is a desired draft (`env` forbidden, written to `{productDir}/host-settings.json`, `applies: restart`); `connected` is the connected `mcp:*` overlay. `session.prompt` slash: `command.kind: "success"` only on success; unknown `/name` is a normal message; failure → `command-error`. `/compact` while idle writes `context/compaction` (`reason: manual`); no historical success; args → usage error. `/export` only ledgers “Session log download requested.” (shell HEADs `/api/session.export` after `command/executed`); path args → usage error. `/feedback` writes `feedback/record` (log-only; `command/run` omits `args`); no sharing backend, success copy includes “Session sharing is not configured.”; empty args → usage error.

### Open path, model discovery, and presets

`host.openPath` / `settings.openDocument`: Win `cmd start` · macOS `open` · Linux `xdg-open` (desktop `canOpenPath: true`; openDocument ignores client path, prefers `XRK_POLICY_FILE`, else writes redacted `host-settings.json`). `llm.discoverModels`: draft probe of openai-chat `GET /models` (`settingsNs` = `llm` or `llm-pi-ai`); failure → `model-discovery-failed`, details omit secrets; not persisted. `agentPreset.read` is catalog-only (`trust: system`); authoring surfaces return `agent-preset-read-only` because `authorable: false` (not `internal`). `goal.*` and `goals/*` share handlers. Cordis panel `dynamicCordisRunner/inventory` returns `[]`; Cordis `apply(ctx)` is not embedded.

### Tool cards and projections

Tool cards: mux/history `view` comes from the tool’s own `presentCall` / `presentResult` (Face only looks up; throw / missing pairing / no presenter → no view, shell uses generic; not written to the session log). Default projections include `todos` (`todo/write` standing plan; cleared to null on next `turn/start`), `permissions` · `plan`; with an AttachmentStore, also register **`imageLimits`** (shell InputBar ingest precheck: `maxImageBytes` / `maxImagesPerMessage` / `maxMessageImageBytes` / `maxImagePixels` / `mediaTypes`; boot constants carried only on history tail / list baseline, **no** `session/projection` change frames; key absent without a store). Projection driver: `@xrkseek/session-projection` (state/view split; [session-projection.md](./modules/session-projection.md)).

### Host MCP

Host MCP: `XRK_MCP_SERVERS` JSON (array or Cursor `{ mcpServers }`; `command` stdio or `url` streamable-http) + `XRK_MCP_ALLOW=1` (or policy allow) → registered as `kind: tools` plugins. Day-to-day edits can also use **Settings → Plugins → Plugin config** for `mcp.servers` (file source of truth). When env/config is empty, read `mcp.servers` from `~/.xrk/host-settings.json` (file `env` ignored) and hot-mount via `reconcileMcpToolPlugins` after Face `settings.mutate` (`applies: live`; **park on policy deny**; real connect failures go to `connectFailures`); non-empty env/config wins over the file and skips live sync. stdio/**HTTP** use bounded process reconnect after first successful connect; HTTP also keeps SDK SSE `reconnectionOptions`. `tools/list_changed` / health refresh the tool table and `invalidateAll`; health changes push `settings/document-updated` to refresh Face overlay `connected[].status`. Host spawn passes the preset standing tool table to Face (`createStandingToolRegistry`: minimal = fs+std, harness/server adds bash); cold-history `viewFor` does not resume the agent (`assistant/message.reasoning` and bash/pty cards can replay from the standing table).

### Policy

Policy: `XRK_POLICY_FILE` → `provider.use`; ask → `approval/*` + `session.respondApproval`. See [policy.md](./policy.md).

## `session.prompt`

```text
mode: queue | steer → admit (slash → recipe / skill into user) → wake drain (non-blocking) → mux stream
```

With images: require `attachments` and `inputModalities` including `image`; `saveImages` then admit (failure does not ledger). Host Face defaults to `text+image`. Official DeepSeek adapters that omit `image` still hit `UnsupportedContentError` in the loop. `session.attachment` returns only ids referenced by this session’s events.

## Boot

- Static assets: `XRK_WEB_DIST` → CLI `product-web/` → monorepo `apps/web/dist`
- When monorepo default dist is missing, CLI runs `web:build` + `client:bundle` + `web:assemble`
- `apps/web`: product-shell source; shipped into `@xrkseek/harness-cli` `product-web/`

## Related

[http-api.md](./http-api.md) · [status.md](./status.md) · **[modules/server-face.md](./modules/server-face.md)** (file map) · [modules/server-host.md](./modules/server-host.md)
