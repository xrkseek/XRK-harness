# Module: `@xrkseek/server-face`

Host Face：Unary RPC + mux/host 双 WebSocket。规格：[host-face.md](../host-face.md)。

## 职责边界

| 做                                         | 不做                                       |
| ------------------------------------------ | ------------------------------------------ |
| 把 Host wire 接到 session / agent / policy | 不实现业务 agent loop（用 `resolveAgent`） |
| 诚实 `not-implemented` / 空 inventory stub     | 不静默假成功；选目录取消才 `path: null` |
| wire 投影（inbox / tool view / queue）     | 不把 AgentHandle 当 transcript 真源        |

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

### 接线层（`wire/`）— 对 DSH Web 的协议面

| 文件                | 作用                                   | 关键契约                    |
| ------------------- | -------------------------------------- | --------------------------- |
| `wire/envelope.ts`  | unary 解析 · ok/err · `server-request` | 错误必含 `details`          |
| `wire/rpc-error.ts` | XRK code → DSH 闭集                    | 未知码折 `internal`         |
| `wire/paths.ts`     | `/api/<method>` · WS · `/api/respond`  | 点号 unary；Typert `ns/method` 白名单 |
| `wire/loopback.ts`  | 回环地址判定                           | 产品壳同源免 API key               |
| `wire/respond.ts`   | 解析 `client-response` · 结算审批      | 回执 `accepted` / `reason`  |
| `wire/http-io.ts`   | readBody / sendJson                    |                             |
| `wire/index.ts`     | 接线导出                               |                             |

### 入口与运行时

| 文件             | 作用                         | 关键契约                                        |
| ---------------- | ---------------------------- | ----------------------------------------------- |
| `index.ts`       | 包导出                       | 对外 API 面                                     |
| `types.ts`       | `FaceRpcResult` · 帧类型     | handler=`FaceRpcFail`；线上=`FaceRpcError`      |
| `context.ts`     | `FaceRuntime` 形状           | drain · store · maps · policy 可选              |
| `runtime.ts`     | `createFaceRuntime`          | 组装 bus/seq/projections/approvals/inbox        |
| `dispatch.ts`    | **RPC 路由表**               | 未知 method → NI；新方法在此登记                |
| `handlers/`      | 按域 handler                 | `session` · `host` · `catalog` · `remotes` · `cordis-stub` |
| `attach-http.ts` | HTTP 挂载 + WS · mux 重连基线 | 调用 `wire/`；pending 补 queue / 审批           |
| `bus.ts`         | mux/host 订阅扇出            | `publishMux(frame, rpcId?)` 审批用稳定 id       |
| `seq.ts`         | Face 1-based seq 时钟        | 与 history 对齐                                 |

### 会话 / 队列 / 审批

| 文件                 | 作用                                           | 关键契约                                       |
| -------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `queue.ts`           | `session/queue` 项形：`{id,placement,message}` | 勿退回扁平 `content`                           |
| `approvals.ts`       | policy ask · `approvalRequestedFrame`      | 稳定 rpcId；`session.respondApproval` 仍可用 |
| `slash.ts`           | recipe catalog · `commands/execute`            | 插件 command 优先；miss → `undefined`（不入账） |
| `plugin-inventory.ts` | `pluginInventory/list` 投影                    | 进程插件 + boot；cordis = failed |
| `session-search.ts`  | `session.search`                               | query 1..500 · 禁 NUL · 最多 20 · 最近活动优先 · 含 admit/safety |
| `skill-list.ts`      | `skill.list`                                   | 扫 `.xrk/skills/<id>/SKILL.md`；要 `sessionId` |
| `presets-catalog.ts` | agentPreset 列表常量                           | `read` 只读；创作面仍 NI                             |
| `message-feedback.ts` | `messageFeedback/list/put/delete`             | 进程内 CAS；Typert 嵌套 ok；非 transcript |
| `goal-store.ts`       | `goals/*` + `/goal`                            | 投影 sidecar；turn/end 续轮；`goals.json` |
| `json-sidecar.ts`     | JSON 旁路落盘                                  | `writeTextFileAtomicSync`；失败不抛进 Face RPC |
| `session-export.ts`   | `GET/HEAD /api/session.export`                 | ZIP store；忽略客户端任意 path           |
| `zip-store.ts`        | 无压缩 ZIP                                     | 条目名剥 `..`；无第三方 zip 依赖         |

### Host 本地 / 工作区 / 设置

| 文件                      | 作用                                    | 关键契约                 |
| ------------------------- | --------------------------------------- | ------------------------ |
| `host-directory.ts`       | list/createDirectory · `fullyQualified` | 绝对路径；条目上限       |
| `host-open-path.ts`       | `host.openPath` · `canOpenNativePath`   | 仅绝对路径；Win/mac/Linux 可开 |
| `host-pick-directory.ts`  | `host.pickDirectory`                    | 系统选目录；取消 `null`；缺 picker 用 `directory-picker-unavailable` |
| `workspace-face.ts`       | workspace.* Face                        | 路径不得逃出 root        |
| `workspace-registry.ts`   | DSH 形 workspace 注册表                 |                          |
| `settings-credentials.ts` | settings.* · credentials.*              | 密钥不入库；openDocument 忽略客户端 path |
| `dsh-schema.ts`           | settings namespace schemastery 信封     | `{ uid, refs }`；JSON Schema 壳读不了 |

### Wire 适配（`adapt/`）

| 文件                  | 作用                               | 关键契约                                |
| --------------------- | ---------------------------------- | --------------------------------------- |
| `adapt/inbox-wire.ts` | `prompt/*` → `agent/inbox/spliced` | 坐标按 pending **重放**，禁止瞎编 start |
| `adapt/wire-event.ts` | session 事件 → 壳 wire             |                                         |
| `adapt/wire-ids.ts`   | 稳定数字 id 映射                   |                                         |
| `adapt/tool-view.ts`  | 工具卡 lookup                         | `presentCall` / `presentResult` 在工具上；Face `viewFor` 软失败 |
| `adapt/index.ts`      | 适配导出                           |                                         |

### 投影（`projections/`）

| 文件                                                | 作用                  |
| --------------------------------------------------- | --------------------- |
| `registry.ts`                                       | 投影注册表 · snapshot |
| `title-controller.ts` / `title-normalize.ts`        | 标题                  |
| `units/title.ts` · `units/session-list-metadata.ts` | 单元                  |
| `install-defaults.ts`                               | 默认安装              |

## RPC 登记纪律（防 bug）

1. **新方法**：在 `dispatch.ts` `HANDLERS` 增加一项（实现放 `handlers/`）；能跑 / 软降级 / NI 三选一写进 `host-face.md`。
2. **注释**：对象字面量里的块注释**禁止**写含 `*/` 的 glob（如 `skills/*/x`），会截断注释导致语法炸。用行注释或写 `<id>`。
3. **payload**：先校验再动 store；失败用稳定 `error.code`。
4. **副作用**：prompt admit 前钉 `rpcId`↔`admitId`（inbox / queue 依赖）。

## 测试锚点

| 测                               | 覆盖                         |
| -------------------------------- | ---------------------------- |
| `tests/harness-path.test.ts`     | prompt → tool → cancel → ask |
| `tests/session-search.test.ts`   | search 校验 / 命中 / 近因 / JSONL |
| `tests/open-path-skills.test.ts` | canOpenPath 三端 · skill.list     |
| `tests/pick-directory.test.ts`   | 三端 picker 命令 / 取消 null / 注入 RPC |
| `tests/message-feedback.test.ts` | list/put/delete CAS · 嵌套 Typert |
| `tests/goals.test.ts`            | create/pause CAS · `/goal` · `goal.create` 点号 |
| `tests/face-fidelity.test.ts`    | preset `agent-preset-read-only` · 信封形 |
| `tests/native-paths.test.ts`     | `/api/goal.create` · dual WS |
| `tests/session-export.test.ts`   | HEAD/GET ZIP · 子会话 · 附件           |
| `tests/mux-baseline.test.ts`     | 重连 queue                   |
| `tests/inbox-wire.test.ts`       | splice 投影                  |
| `tests/tool-view.test.ts`        | terminal/read/diff/search 卡 · 错误回 generic |
| `tests/commands.test.ts`         | `commands/list` · `commands/execute` · `pluginInventory/list` · Cordis stub |
| `tests/wire.test.ts`             | respond 解析 · 路径                        |
| `tests/rpc-error.test.ts`        | DSH 错误码映射                             |
| `tests/approval.test.ts`         | ask → respondByRpcId                       |
| `tests/subagent.test.ts`         | create-with-parent · list/history/prompt/interrupt · fork 登记 |
| `tests/workspace.test.ts`        | list/create/rename/archive · delete/insert* |

## 已知诚实拒绝 / 空面

- agentPreset 创作面（copy / remove / openDocument）→ `agent-preset-read-only`
- `dynamicCordisRunner/*` → 空 inventory / no-op（不嵌 Cordis Host）
