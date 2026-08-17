# Module: `@xrkseek/server-face`

Host Face：Unary RPC + mux/host 双 WebSocket。规格：[host-face.md](../host-face.md)。

## 职责边界

| 做 | 不做 |
|----|------|
| 把 Host wire 接到 session / agent / policy | 不实现业务 agent loop（用 `resolveAgent`） |
| 诚实 `not-implemented` / 软降级空目录 | 不静默假成功 |
| wire 投影（inbox / tool view / queue） | 不把 AgentHandle 当 transcript 真源 |

## 调用链（排障顺序）

```text
HTTP/WS (attach-http)
  → dispatchFaceMethod (dispatch)
    → handler（本文件或 *.ts）
      → SessionStore / AgentHandle / policy / projections
  → mux/host 帧（bus · seq · adapt/*）
```

## 文件地图

### 入口与运行时

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | 包导出 | 对外 API 面 |
| `types.ts` | `FaceRpcResult` · 帧类型 | 错误必须 `{ ok:false, error:{code,message} }` |
| `envelope.ts` | 请求解析 · ok/err 响应 | rpcId 回显 |
| `context.ts` | `FaceRuntime` 形状 | drain · store · maps · policy 可选 |
| `runtime.ts` | `createFaceRuntime` | 组装 bus/seq/projections/approvals/inbox |
| `dispatch.ts` | **RPC 路由表** | 未知 method → NI；新方法在此登记 |
| `attach-http.ts` | HTTP 路径 + WS upgrade · mux 重连基线 | pending 时补 `session/queue` |
| `bus.ts` | mux/host 订阅扇出 | |
| `seq.ts` | Face 1-based seq 时钟 | 与 history 对齐 |

### 会话 / 队列 / 审批

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `queue.ts` | `session/queue` 项形：`{id,placement,message}` | 勿退回扁平 `content` |
| `approvals.ts` | policy ask · `respondApproval` | 与 agent `setApprovalHandler` 对齐 |
| `slash.ts` | Face 侧 slash / recipe | |
| `session-search.ts` | `session.search` | query 1..500 · 禁 NUL · 最多 20 · `hasMore` |
| `skill-list.ts` | `skill.list` | 扫 `.xrk/skills/<id>/SKILL.md`；要 `sessionId` |
| `presets-catalog.ts` | agentPreset 列表常量 | authorable 面仍 NI |

### Host 本地 / 工作区 / 设置

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `host-directory.ts` | list/createDirectory · `fullyQualified` | 绝对路径；条目上限 |
| `host-open-path.ts` | `host.openPath` · `canOpenNativePath` | 仅绝对路径；桌面平台可开 |
| `workspace-face.ts` | workspace.* Face | 路径不得逃出 root |
| `workspace-registry.ts` | DSH 形 workspace 注册表 | |
| `settings-credentials.ts` | settings.* · credentials.* | 密钥不入库 |

### Wire 适配（`adapt/`）

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `adapt/inbox-wire.ts` | `prompt/*` → `agent/inbox/spliced` | 坐标按 pending **重放**，禁止瞎编 start |
| `adapt/wire-event.ts` | session 事件 → 壳 wire | |
| `adapt/wire-ids.ts` | 稳定数字 id 映射 | |
| `adapt/tool-view.ts` | 工具卡投影 | |
| `adapt/index.ts` | 适配导出 | |

### 投影（`projections/`）

| 文件 | 作用 |
|------|------|
| `registry.ts` | 投影注册表 · snapshot |
| `title-controller.ts` / `title-normalize.ts` | 标题 |
| `units/title.ts` · `units/session-list-metadata.ts` | 单元 |
| `install-defaults.ts` | 默认安装 |

## RPC 登记纪律（防 bug）

1. **新方法**：在 `dispatch.ts` `HANDLERS` 增加一项；能跑 / 软降级 / NI 三选一写进 `host-face.md`。  
2. **注释**：对象字面量里的块注释**禁止**写含 `*/` 的 glob（如 `skills/*/x`），会截断注释导致语法炸。用行注释或写 `<id>`。  
3. **payload**：先校验再动 store；失败用稳定 `error.code`。  
4. **副作用**：prompt admit 前钉 `rpcId`↔`admitId`（inbox / queue 依赖）。

## 测试锚点

| 测 | 覆盖 |
|----|------|
| `tests/harness-path.test.ts` | prompt → tool → cancel → ask |
| `tests/session-search.test.ts` | search 校验 / 命中 / hasMore |
| `tests/open-path-skills.test.ts` | canOpenPath · skill.list |
| `tests/mux-baseline.test.ts` | 重连 queue |
| `tests/inbox-wire.test.ts` | splice 投影 |
| `tests/dispatch.test.ts` | 路由烟测 |

## 已知 NI / 下一刀

- `session.attachment`：须协议 ContentBlock（`user/message` 现为 string）  
- `llm.discoverModels` · Goal · agentPreset 创作面 · `workspace.delete/insert*`
