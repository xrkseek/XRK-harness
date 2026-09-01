# Module: `@xrkseek/server-face`

> **读者**：贡献者 · 维护者；产品契约见 [host-face.md](../host-face.md)

Host Face：Unary RPC + mux/host 双 WebSocket。规格：[host-face.md](../host-face.md)。

## 职责边界

| 做 | 不做 |
| --- | --- |
| 把 Host wire 接到 session / agent / policy | 不实现业务 agent loop（用 `resolveAgent`） |
| 诚实 `not-implemented` / 空 inventory stub | 不静默假成功；选目录取消才 `path: null` |
| wire 投影（inbox / tool view / queue） | 不把 AgentHandle 当 transcript 真源 |

## 调用链（排障顺序）

```text
HTTP/WS (attach-http)
  → wire/（信封 · 错误码 · /api/respond · 路径）
  → dispatchFaceMethod (dispatch)
  → handler
      → SessionStore / AgentHandle / policy / projections
  → mux/host 帧（bus · seq · adapt/*）
```

## 文件地图

### 接线层（`wire/`）— 对产品壳的协议面

| 文件 | 作用 | 关键契约 |
| --- | --- | --- |
| `wire/envelope.ts` | unary 解析 · ok/err · `server-request` | 错误必含 `details` |
| `wire/rpc-error.ts` | XRK code → 产品壳闭集 | 未知码折 `internal` |
| `wire/paths.ts` | `/api/<method>` · WS · `/api/respond` | 点号 unary；Typert `ns/method` 白名单 |
| `wire/loopback.ts` | 回环地址判定 | 产品壳同源免 API key |
| `wire/respond.ts` | 解析 `client-response` · 审批后提问 | 回执 `accepted` / `reason`；`cancelled` 走提问 |
| `wire/http-io.ts` | readBody / sendJson | |
| `wire/index.ts` | 接线导出 | |

### 入口与运行时

| 文件 | 作用 | 关键契约 |
| --- | --- | --- |
| `index.ts` | 包导出 | 对外 API 面 |
| `types.ts` | `FaceRpcResult` · 帧类型 | handler=`FaceRpcFail`；线上=`FaceRpcError` |
| `context.ts` | `FaceRuntime` 形状 | drain · store · maps · policy 可选 |
| `runtime.ts` | `createFaceRuntime` | 组装 bus/seq/projections/approvals/questions |
| `dispatch.ts` | **RPC 路由表** | 未知 method → NI；新方法在此登记 |
| `handlers/` | 按域 handler | `session` · `host` · `catalog` · `remotes` · `cordis-stub` · `session-added` |
| `attach-http.ts` | HTTP 挂载 + WS · mux 重连基线 | pending 补 queue / 审批 / 提问 |
| `bus.ts` | mux/host 订阅扇出 | `publishMux(frame, rpcId?)` 审批用稳定 id |
| `seq.ts` | Face 1-based seq 时钟 | 与 history 对齐 |

### 会话 / 队列 / 审批

| 文件 | 作用 | 关键契约 |
| --- | --- | --- |
| `queue.ts` | `session/queue` 项形：`{id,placement,message}` | 勿退回扁平 `content` |
| `approvals.ts` | policy ask · `approvalRequestedFrame` | 稳定 rpcId；`session.respondApproval` 仍可用 |
| `questions.ts` | 用户提问 · `bindAskUserTool` | `question/requested`；`questions[]` + `question`；respond 先审批后提问 |
| `slash.ts` | recipe catalog · `commands/execute` | 插件 command 优先；内建 `/compact` · `/export` · `/feedback` · `/goal` · `/permission` · `/plan`；miss → `undefined`（当普通 prompt；skill 斜杠在 loop `resolveSlash`） |
| `plugin-inventory.ts` | `pluginInventory/list` 投影 | 进程插件 + boot；cordis = failed |
| `session-search.ts` | `session.search` | query 1..500 · 禁 NUL · 最多 20 · 最近活动优先 · 含 admit/safety/command/todo/feedback |
| `skill-list.ts` | `skill.list` | 扫已存在的 `.xrk|.claude|.cursor|.agents|.codex/skills`（及用户主目录同名）；不强制建目录；模型加载走 `skill` 工具 |
| `presets-catalog.ts` | agentPreset 列表常量 | `read` 只读；创作面仍 NI |
| `message-feedback.ts` | `messageFeedback/list/put/delete` | 进程内 CAS；Typert 嵌套 ok；非 transcript |
| `goal-store.ts` | `goals/*` + `/goal` | 投影 sidecar；turn/end 续轮；`goals.json` |
| `json-sidecar.ts` | JSON 旁路落盘 | `writeTextFileAtomicSync`；失败不抛进 Face RPC |
| `session-export.ts` | `GET/HEAD /api/session.export` | ZIP store；忽略客户端任意 path |
| `zip-store.ts` | 无压缩 ZIP | 条目名剥 `..`；无第三方 zip 依赖 |

### Host 本地 / 工作区 / 设置

| 文件 | 作用 | 关键契约 |
| --- | --- | --- |
| `host-directory.ts` | list/createDirectory · `fullyQualified` | 绝对路径；条目上限 |
| `host-open-path.ts` | `host.openPath` · `canOpenNativePath` | 仅绝对路径；Win/mac/Linux 可开 |
| `remote-event.ts` | `host/remote-event` 白名单转发 | 无 Cordis inspect/run |
| `host-pick-directory.ts` | `host.pickDirectory` | 系统选目录；取消 `null`；缺 picker 用 `directory-picker-unavailable` |
| `workspace-face.ts` | workspace.* Face | 路径不得逃出 root |
| `workspace-registry.ts` | 工作区注册表（壳侧栏形） | `workspaceIdOf`；delete 发 removed；insertBefore 发 order |
| `settings-credentials.ts` | settings.* · credentials.* | 密钥不入库；openDocument 忽略客户端 path；`mcp.servers` 落盘（禁 env）；`connected` overlay |
| `face-schema.ts` | settings namespace schemastery 信封 | `{ uid, refs }`；JSON Schema 壳读不了 |
| `settings-schemas.ts` | Face 产品 namespace base / schema | `llm-pi-ai` · `llm-deepseek` · mcp … |
| `llm-provider-context.ts` | 路由 · 凭据 · **声明路由合成 binding** | 产品面禁止裸 `registry.resolve`；保留 `baseURL`/`baseUrl` |
| `llm-resolve.ts` | selection → adapter | `resolveLlmForSelection` / session routing |
| `model-catalog.ts` | `session.models` 目录 · 默认 selection | brand + 声明路由；`routeServed` |

### Wire 适配（`adapt/`）

| 文件 | 作用 | 关键契约 |
| --- | --- | --- |
| `adapt/inbox-wire.ts` | `prompt/*` → `agent/inbox/spliced` | 坐标按 pending **重放**，禁止瞎编 start |
| `adapt/wire-event.ts` | session 事件 → 壳 wire | |
| `adapt/wire-ids.ts` | 稳定数字 id 映射 | |
| `adapt/tool-view.ts` | 工具卡 lookup | `presentCall` / `presentResult` 在工具上；Face `viewFor` 软失败 |
| `adapt/job-view.ts` | `JobView` / `jobViews` | mux `session/jobs`；基线非空才发；变更可推 `[]` |
| `adapt/index.ts` | 适配导出 | |

### 投影（`projections/`）

驱动注册表在 `@xrkseek/session-projection`（规格：[session-projection.md](./session-projection.md)）（双表 `SessionProjectionStateMap` / `SessionProjectionMap`；单元可选 `wire`；`snapshot` 只出视图；`stateOf` / `checkpoint` 可读 host 折叠态）。Face `projections/` 贡献默认单元并作为 mux / history 载体。

| 文件 | 作用 |
| --- | --- |
| `registry.ts` | Face 薄封装 → `@xrkseek/session-projection`（`stateOf` · wire-only snapshot） |
| `title-controller.ts` / `title-normalize.ts` | 标题 |
| `units/*` · `parse-int.ts` | StatsLine / ContextMeter / **turnOutline** 等默认单元；整数 parse 共用 |
| `install-defaults.ts` | 默认安装 |
| `../permissions.ts` | 预设表 · pin · `/permission` 写 knobs |
| `../plan-mode.ts` | `/plan` 选择预览 · idle 提交 `plan/mode` |

## RPC 登记纪律（防 bug）

1. **新方法**：在 `dispatch.ts` `HANDLERS` 增加一项（实现放 `handlers/`）；能跑 / 软降级 / NI 三选一写进 `host-face.md`。
2. **注释**：对象字面量里的块注释**禁止**写含 `*/` 的 glob（如 `skills/*/x`），会截断注释导致语法炸。用行注释或写 `<id>`。
3. **payload**：先校验再动 store；失败用稳定 `error.code`。
4. **副作用**：prompt admit 前钉 `rpcId`↔`admitId`（inbox / queue 依赖）。

## 测试锚点

| 测 | 覆盖 |
| --- | --- |
| `tests/harness-path.test.ts` | prompt → tool → cancel → ask |
| `tests/session-search.test.ts` | search 校验 / 命中 / 近因 / FTS 候选 |
| `tests/open-path-skills.test.ts` | canOpenPath 三端 · skill.list |
| `tests/pick-directory.test.ts` | 三端 picker 命令 / 取消 null / 注入 RPC |
| `tests/message-feedback.test.ts` | list/put/delete CAS · 嵌套 Typert |
| `tests/goals.test.ts` | create/pause CAS · `/goal` · `goal.create` 点号 |
| `tests/face-fidelity.test.ts` | preset `agent-preset-read-only` · 信封形 |
| `tests/native-paths.test.ts` | `/api/goal.create` · dual WS |
| `tests/session-export.test.ts` | HEAD/GET ZIP · 子会话 · 附件 |
| `tests/mux-baseline.test.ts` | 重连 queue |
| `tests/inbox-wire.test.ts` | splice 投影 |
| `tests/tool-view.test.ts` | lookup only；无 getTool 则没 view |
| `tests/standing-tools.test.ts` | 冷 history 用 standing registry，不 wake agent |
| `tests/jobs.test.ts` | `session/jobs` 基线非空才发；变更可推 `[]` |
| `tests/commands.test.ts` | `commands/list` · `commands/execute` · `/compact` · `/export` · `/feedback` · `pluginInventory/list` · Cordis stub |
| `tests/wire.test.ts` | respond 解析 · 路径 |
| `tests/rpc-error.test.ts` | 错误码映射 |
| `tests/approval.test.ts` | ask → respondByRpcId |
| `tests/questions.test.ts` | question/requested · cancelled · ask_user bind · mux 重连 |
| `tests/subagent.test.ts` | create-with-parent · list/history/prompt/interrupt · fork 登记 |
| `tests/workspace.test.ts` | list/create/rename/archive · delete/insert* |
| `tests/host-frames.test.ts` | session-added 子会话字段 · workspace-removed / order-changed · fork · `host/remote-event` |
| `tests/projections.test.ts` | title · list metadata · todos 站立计划（write 后 turn/start 清 null）· **turnOutline** mux（draft 静默 / turn/end 提交） |
| `tests/turn-outline.test.ts` | turnOutline 折叠：wire 号 · seq · prompt/response · FaceWireIdMaps 对齐 |
| `tests/session-stats.test.ts` | sessionStats：step/end 计数 · llm/ttft/tool 墙钟 · usage→decode · 取消不计入 llmMs |
| `tests/token-usage.test.ts` | tokenUsage 同 step 替换；contextPressure surface projected；contextBreakdown；toolCalls；shadowedTokenCount 缩小 |
| `tests/permissions.test.ts` | pin · `/permission` · never 自动放行 · read-only deny |
| `tests/settings-credentials.test.ts` | settings mutate · MCP · **自定义 provider → selectModel** |
| `tests/llm-resolve.test.ts` | settings + vault → live adapter |

## 已知诚实拒绝 / 空面

- agentPreset 创作面（copy / remove / openDocument）→ `agent-preset-read-only`
- `dynamicCordisRunner/*` → 空 inventory / no-op（不嵌 Cordis Host）

---

# Module: `@xrkseek/server-face`

> **Audience**: Contributors · Maintainers; product contract: [host-face.md](../host-face.md)

Host Face: unary RPC + mux/host dual WebSocket. Spec: [host-face.md](../host-face.md).

## Responsibility boundary

| Does | Does not |
| --- | --- |
| Wire Host to session / agent / policy | Implement the business agent loop (uses `resolveAgent`) |
| Honest `not-implemented` / empty inventory stubs | Silent fake success; directory cancel returns `path: null` only |
| Wire projections (inbox / tool view / queue) | Treat AgentHandle as the transcript source of truth |

## Call chain (troubleshooting order)

```text
HTTP/WS (attach-http)
  → wire/ (envelope · error codes · /api/respond · paths)
  → dispatchFaceMethod (dispatch)
  → handler
      → SessionStore / AgentHandle / policy / projections
  → mux/host frames (bus · seq · adapt/*)
```

## File map

### Wire layer (`wire/`) — protocol surface for the product shell

| File | Role | Critical contract |
| --- | --- | --- |
| `wire/envelope.ts` | unary parse · ok/err · `server-request` | Errors must include `details` |
| `wire/rpc-error.ts` | XRK code → product-shell closed set | Unknown codes fold to `internal` |
| `wire/paths.ts` | `/api/<method>` · WS · `/api/respond` | Dot unary; Typert `ns/method` allowlist |
| `wire/loopback.ts` | Loopback address check | Same-origin product shell skips API key |
| `wire/respond.ts` | Parse `client-response` · approval then question | Ack `accepted` / `reason`; `cancelled` goes to questions |
| `wire/http-io.ts` | readBody / sendJson | |
| `wire/index.ts` | Wire exports | |

### Entry and runtime

| File | Role | Critical contract |
| --- | --- | --- |
| `index.ts` | Package exports | Public API surface |
| `types.ts` | `FaceRpcResult` · frame types | handler=`FaceRpcFail`; wire=`FaceRpcError` |
| `context.ts` | `FaceRuntime` shape | drain · store · maps · optional policy |
| `runtime.ts` | `createFaceRuntime` | Assembles bus/seq/projections/approvals/questions |
| `dispatch.ts` | **RPC route table** | Unknown method → NI; register new methods here |
| `handlers/` | Domain handlers | `session` · `host` · `catalog` · `remotes` · `cordis-stub` · `session-added` |
| `attach-http.ts` | HTTP mount + WS · mux reconnect baseline | Pending fills queue / approvals / questions |
| `bus.ts` | mux/host fan-out | `publishMux(frame, rpcId?)` uses stable ids for approvals |
| `seq.ts` | Face 1-based seq clock | Aligned with history |

### Session / queue / approval

| File | Role | Critical contract |
| --- | --- | --- |
| `queue.ts` | `session/queue` item shape `{id,placement,message}` | Do not flatten back to `content` |
| `approvals.ts` | policy ask · `approvalRequestedFrame` | Stable rpcId; `session.respondApproval` still works |
| `questions.ts` | User questions · `bindAskUserTool` | `question/requested`; `questions[]` + `question`; respond approvals before questions |
| `slash.ts` | recipe catalog · `commands/execute` | Plugin commands first; built-ins `/compact` · `/export` · `/feedback` · `/goal` · `/permission` · `/plan`; miss → `undefined` (plain prompt; skill slash in loop `resolveSlash`) |
| `plugin-inventory.ts` | `pluginInventory/list` projection | Process plugins + boot; cordis = failed |
| `session-search.ts` | `session.search` | query 1..500 · no NUL · max 20 · recent activity first · admits admit/safety/command/todo/feedback |
| `skill-list.ts` | `skill.list` | Scan existing `.xrk|.claude|.cursor|.agents|.codex/skills` (and home peers); do not create dirs; model load uses `skill` tool |
| `presets-catalog.ts` | agentPreset list constants | `read` only; authoring surface still NI |
| `message-feedback.ts` | `messageFeedback/list/put/delete` | In-process CAS; nested Typert ok; not transcript |
| `goal-store.ts` | `goals/*` + `/goal` | Projection sidecar; turn/end continues; `goals.json` |
| `json-sidecar.ts` | JSON sidecar persist | `writeTextFileAtomicSync`; failures do not throw into Face RPC |
| `session-export.ts` | `GET/HEAD /api/session.export` | ZIP store; ignore client-supplied paths |
| `zip-store.ts` | Uncompressed ZIP | Strip `..` from entry names; no third-party zip dep |

### Host local / workspace / settings

| File | Role | Critical contract |
| --- | --- | --- |
| `host-directory.ts` | list/createDirectory · `fullyQualified` | Absolute paths; entry caps |
| `host-open-path.ts` | `host.openPath` · `canOpenNativePath` | Absolute only; Win/mac/Linux openable |
| `remote-event.ts` | `host/remote-event` allowlisted forward | No Cordis inspect/run |
| `host-pick-directory.ts` | `host.pickDirectory` | System picker; cancel `null`; missing picker → `directory-picker-unavailable` |
| `workspace-face.ts` | workspace.* Face | Paths must not escape root |
| `workspace-registry.ts` | Workspace registry (shell sidebar shape) | `workspaceIdOf`; delete emits removed; insertBefore emits order |
| `settings-credentials.ts` | settings.* · credentials.* | Secrets stay out of git; openDocument ignores client path; `mcp.servers` persists (no env); `connected` overlay |
| `face-schema.ts` | settings namespace schemastery envelope | `{ uid, refs }`; JSON Schema shell cannot read it |
| `settings-schemas.ts` | Face product namespace base / schema | `llm-pi-ai` · `llm-deepseek` · mcp … |
| `llm-provider-context.ts` | Route · credentials · **declared-route binding synthesis** | Product path forbids bare `registry.resolve`; keep `baseURL`/`baseUrl` |
| `llm-resolve.ts` | selection → adapter | `resolveLlmForSelection` / session routing |
| `model-catalog.ts` | `session.models` catalog · default selection | brand + declared routes; `routeServed` |

### Wire adapters (`adapt/`)

| File | Role | Critical contract |
| --- | --- | --- |
| `adapt/inbox-wire.ts` | `prompt/*` → `agent/inbox/spliced` | Coordinates **replay** from pending; do not invent start |
| `adapt/wire-event.ts` | session events → shell wire | |
| `adapt/wire-ids.ts` | Stable numeric id map | |
| `adapt/tool-view.ts` | Tool-card lookup | `presentCall` / `presentResult` on tools; Face `viewFor` soft-fails |
| `adapt/job-view.ts` | `JobView` / `jobViews` | mux `session/jobs`; emit only when baseline non-empty; changes may push `[]` |
| `adapt/index.ts` | Adapter exports | |

### Projections (`projections/`)

Driver registry lives in `@xrkseek/session-projection` (spec: [session-projection.md](./session-projection.md)) (dual maps `SessionProjectionStateMap` / `SessionProjectionMap`; units may carry `wire`; `snapshot` emits views only; `stateOf` / `checkpoint` can read host fold state). Face `projections/` contributes default units and carries mux / history.

| File | Role |
| --- | --- |
| `registry.ts` | Thin Face wrapper → `@xrkseek/session-projection` (`stateOf` · wire-only snapshot) |
| `title-controller.ts` / `title-normalize.ts` | Title |
| `units/*` · `parse-int.ts` | StatsLine / ContextMeter / **turnOutline** default units; shared int parse |
| `install-defaults.ts` | Default install |
| `../permissions.ts` | Preset table · pin · `/permission` writes knobs |
| `../plan-mode.ts` | `/plan` selection preview · idle commits `plan/mode` |

## RPC registration discipline

1. **New methods**: add to `dispatch.ts` `HANDLERS` (implement under `handlers/`); document Working / soft-degrade / NI in `host-face.md`.
2. **Comments**: block comments inside object literals must **not** contain `*/` globs (e.g. `skills/*/x`) — they truncate the comment and break syntax. Use line comments or `<id>`.
3. **Payload**: validate before mutating the store; fail with stable `error.code`.
4. **Side effects**: pin `rpcId`↔`admitId` before prompt admit (inbox / queue depend on it).

## Test anchors

| Test | Coverage |
| --- | --- |
| `tests/harness-path.test.ts` | prompt → tool → cancel → ask |
| `tests/session-search.test.ts` | search validation / hits / recency / FTS candidates |
| `tests/open-path-skills.test.ts` | canOpenPath three platforms · skill.list |
| `tests/pick-directory.test.ts` | three-platform picker / cancel null / injected RPC |
| `tests/message-feedback.test.ts` | list/put/delete CAS · nested Typert |
| `tests/goals.test.ts` | create/pause CAS · `/goal` · `goal.create` dotted |
| `tests/face-fidelity.test.ts` | preset `agent-preset-read-only` · envelope shape |
| `tests/native-paths.test.ts` | `/api/goal.create` · dual WS |
| `tests/session-export.test.ts` | HEAD/GET ZIP · child sessions · attachments |
| `tests/mux-baseline.test.ts` | reconnect queue |
| `tests/inbox-wire.test.ts` | splice projection |
| `tests/tool-view.test.ts` | lookup only; no getTool → no view |
| `tests/standing-tools.test.ts` | cold history uses standing registry; does not wake agent |
| `tests/jobs.test.ts` | `session/jobs` emits only when baseline non-empty; changes may push `[]` |
| `tests/commands.test.ts` | `commands/list` · `commands/execute` · `/compact` · `/export` · `/feedback` · `pluginInventory/list` · Cordis stub |
| `tests/wire.test.ts` | respond parse · paths |
| `tests/rpc-error.test.ts` | error-code mapping |
| `tests/approval.test.ts` | ask → respondByRpcId |
| `tests/questions.test.ts` | question/requested · cancelled · ask_user bind · mux reconnect |
| `tests/subagent.test.ts` | create-with-parent · list/history/prompt/interrupt · fork registry |
| `tests/workspace.test.ts` | list/create/rename/archive · delete/insert* |
| `tests/host-frames.test.ts` | session-added child fields · workspace-removed / order-changed · fork · `host/remote-event` |
| `tests/projections.test.ts` | title · list metadata · todos standing plan (cleared null on turn/start after write) · **turnOutline** mux (quiet draft / commit at turn/end) |
| `tests/turn-outline.test.ts` | turnOutline fold: wire number · seq · prompt/response · FaceWireIdMaps alignment |
| `tests/session-stats.test.ts` | sessionStats: step/end counts · llm/ttft/tool wall clock · usage→decode · cancel excluded from llmMs |
| `tests/token-usage.test.ts` | tokenUsage same-step replace; contextPressure surface projected; contextBreakdown; toolCalls; shadowedTokenCount shrink |
| `tests/permissions.test.ts` | pin · `/permission` · never auto-allow · read-only deny |
| `tests/settings-credentials.test.ts` | settings mutate · MCP · **custom provider → selectModel** |
| `tests/llm-resolve.test.ts` | settings + vault → live adapter |

## Known honest rejects / empty surfaces

- agentPreset authoring (copy / remove / openDocument) → `agent-preset-read-only`
- `dynamicCordisRunner/*` → empty inventory / no-op (does not embed a Cordis Host)
