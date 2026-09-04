# HTTP 接口

> **读者**：集成者

Base URL：`http://127.0.0.1:8787`（可用 `XRK_HOST` / `XRK_PORT` 覆盖）。

语义总览：[session-api.md](./session-api.md)、[session-latch.md](./session-latch.md)、[session-delivery.md](./session-delivery.md)。Face 契约全文：[host-face.md](./host-face.md)。

## 认证

- `GET /health` — **公开**
- REST `/api/sessions` · `/api/chat` — 当设置了 `XRK_API_KEY` 时需 `Authorization: Bearer <XRK_API_KEY>` 或 `x-api-key`
- Face `/api/<method>` · `/api/respond` · WS `/api/events.*` — 同上；本机回环且无头时放行（产品壳同源）
- 空 `XRK_API_KEY` 关闭认证（仅开发）

## 端点

### `GET /health`

```json
{ "ok": true }
```

### `POST /api/sessions` — newSession

```json
{ "sessionId": "optional" }
```

→ `201 { "sessionId": "…" }`

### `POST /api/sessions/:id/admit` — admit / admit+run

```json
{ "message": "…", "delivery": "queue", "resume": false, "wake": false }
```

| 字段 | 含义 |
|------|------|
| `message` | 必填；只记账，不进模型可见历史 |
| `delivery` | 可选 `"steer"` \| `"queue"`（省略 = queue）。非法值 → **`400`** |
| `resume` | `true` → admit 后 **await** drain（**`200`** chat 结果） |
| `wake` | `true`（且非 resume）→ admit 后 **wake** drain，不阻塞（**`202`** + `scheduled`） |

默认（无 resume/wake）→ **`202`** `{ sessionId, admitId, delivery, pending }`。  
响应里的 `delivery` 为生效值（省略入参时为 `"queue"`）。

Promote 规则：有 pending **steer** 时优先于更早的 queue（见 [session-delivery.md](./session-delivery.md)）。

### `POST /api/sessions/:id/turn` — continueTurn

```json
{ "message": "optional" }
```

无 `message` 时 promote 下一条 pending admit（**steer 优先**，否则最老 queue）。无 pending → **`400`**。

### `POST /api/chat` — 便利 continueTurn

```json
{ "sessionId": "optional", "message": "ping" }
```

响应：

```json
{
  "sessionId": "sess_…",
  "turnId": "turn_…",
  "text": "…",
  "steps": 1
}
```

同一 `sessionId` 若已有 turn 在飞 → **`409`** `{ "error": "session busy", … }`。

### `POST /api/chat/stream`

请求体与 `/api/chat` 相同。SSE 事件：

- `session` — `{ sessionId }`
- `session_event` — append-only session event
- `done` — 与 `/api/chat` 响应同字段

### `GET /api/sessions/:id`

```json
{ "sessionId": "…", "events": [ /* SessionEvent[] */ ] }
```

### `GET /api/sessions/:id/events?stream=1`

会话事件的 SSE 流（先回放历史，再实时）。

## Host Face（U1）

并行协议面（与上表 REST 共存），挂在同一 `serve`：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/face/<method>` | 前缀路径 |
| `POST` | `/api/<method>` | 点号（`session.prompt`）或 Typert（`commands/execute`）；wire 形为 Session/RPC 信封 |
| `POST` | `/api/respond` | 客户端应答（审批 / 提问：`client-response`） |
| `GET` / `HEAD` | `/api/session.export` | 会话 ZIP（`sessionId` · `includeDescendants`）；壳先 HEAD |
| WS | `/api/face/events.*` 或 `/api/events.*` | mux / host 只下行 |

信封：`{ rpcId, payload }` → `{ rpcId, result }`（unary 常带 `type: "server-response"`）。  
未实现方法 → `ok: false` + 稳定 `error.code`（禁止假成功）。

能跑的方法族（摘要；完整表与行为见 [host-face.md](./host-face.md)）：

- Host：`host.describe` · `host.pickDirectory` · `host.listDirectory` · `host.createDirectory` · `host.openPath`
- Session：`session.create` · `list` · `history` · `search` · `prompt` · `cancel` · `models` · `selectModel` · `rename` · `updateQueue` · `fork` · `respondApproval` · `attachment` · `export`（HTTP GET/HEAD）
  - `session.history` **尾页**可带 `projections`（含 **`turnOutline`** 等）；带 `beforeSeq` 的更旧页省略整块。见 [session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md)
- LLM：`llm.providers` · `llm.models` · `llm.discoverModels`
- 工作区 / 设置 / 凭据：`workspace.*` · `settings.*` · `credentials.*` · `agentPreset.list|select|read`
- 其它：`skill.list` · `commands/list` · `commands/execute` · `pluginInventory/list` · `fileReferences/list` · `sessionReferenceResolver/candidates` · `subagent.*` · `messageFeedback.*` · `goals.*` / `goal.*`

Web：CLI `serve` / `web` 托管产品壳。解析顺序：`XRK_WEB_DIST` → CLI `product-web/` → monorepo `apps/web/dist`（缺则代编三步）。无静态挂载时 `GET /` 为 **404**（不做说明书页）。

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
# 同形：xrkh web --port 8080 --open
# open http://127.0.0.1:8787/
```

index.html 由 host 注入 `__XRK_BOOT__`（`boot.json` merge `{XRK_PLUGINS_DIR}/web/boot.json` 后，再 `applyXrkProductBootPolicy` 去掉 Cordis 客户端 id 与 HMR）。缺失的 `/plugins/…` 返回 404（不回退 SPA）。

## 环境变量

运维全集见 [configuration.md](./configuration.md)。本表为 HTTP Host 常用项摘要：

| 变量 | 含义 |
|------|------|
| `XRK_API_KEY` | `/api/*` 的 API key |
| `XRK_HOST` | 绑定主机 |
| `XRK_PORT` | 绑定端口 |
| `XRK_WORKSPACE` | 工作区根 |
| `XRK_PRESET` | `minimal` \| `shell` \| `frugal` \| `plan` \| `shallow` \| `harness` \| `server` |
| `XRK_CORS_ORIGIN` | CORS origin（默认 `*`） |
| `XRK_RATE_LIMIT` | 每 IP 每分钟请求数 |
| `XRK_PLUGINS_DIR` | 可选插件根 → `loadAll` + factory `plugins` → preset `wireCompositionTools`；`web/` 为客户端叠加 |
| `XRK_LLM_PRESET` | Provider Registry brand id（`openrouter`, `deepseek`, …）— 见 [llm-provider-registry.md](./llm-provider-registry.md) |
| `XRK_LLM_MODEL` | 设 preset 时的可选模型覆盖 |
| `XRK_LLM_BASE_URL` | 可选 baseUrl 覆盖（`custom` / `newapi` / … 必填） |
| brand `apiKeyEnv` | 如 `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY`（见 [llm-provider-presets.md](./llm-provider-presets.md)） |
| `XRK_WEB_DIST` | SPA dist（可选覆盖；缺省见上） |
| `XRK_SESSIONS_DIR` | 会话持久化目录（`sessions.db`）；CLI `serve` 省略时用 `~/.xrk/sessions`（`--no-persist` = 内存）；旁路 `subagents.json` · `goals.json` |
| `XRK_POLICY_FILE` | policy JSON |
| `XRK_MCP_SERVERS` | MCP 服务器 JSON（`command` 或 `url`）；空则回退 `~/.xrk/host-settings.json` |
| `XRK_MCP_ALLOW` | `1`/`true` → 本进程 `mcp.connect` allow |
| `XRK_TAVILY_API_KEY` | Tavily 搜索；缺省时 `web_search` 仍登记、execute 失败 |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave Search；与 Tavily 都有且未钉 provider 时用 Tavily |
| `XRK_WEB_SEARCH_PROVIDER` | 可选 `tavily` \| `brave` |
| `XRK_LSP_COMMAND` | 语言服务器可执行文件；缺省时 `lsp` 仍登记、execute 失败 |
| `XRK_LSP_ARGS` | 可选参数（空白分隔或 JSON 字符串数组） |

## CLI

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
node apps/cli/dist/bin.js web --open
```

索引：[docs/README.md](./README.md)。

---

# HTTP API

> **Audience**: Integrators

Base URL: `http://127.0.0.1:8787` (override with `XRK_HOST` / `XRK_PORT`).

Semantics overview: [session-api.md](./session-api.md), [session-latch.md](./session-latch.md), [session-delivery.md](./session-delivery.md). Full Face contract: [host-face.md](./host-face.md).

## Auth

- `GET /health` — **public**
- REST `/api/sessions` · `/api/chat` — require `Authorization: Bearer <XRK_API_KEY>` or `x-api-key` when `XRK_API_KEY` is set
- Face `/api/<method>` · `/api/respond` · WS `/api/events.*` — same; loopback without headers is allowed (product-shell same-origin)
- Empty `XRK_API_KEY` disables auth (dev only)

## Endpoints

### `GET /health`

```json
{ "ok": true }
```

### `POST /api/sessions` — newSession

```json
{ "sessionId": "optional" }
```

→ `201 { "sessionId": "…" }`

### `POST /api/sessions/:id/admit` — admit / admit+run

```json
{ "message": "…", "delivery": "queue", "resume": false, "wake": false }
```

| Field | Meaning |
|------|---------|
| `message` | Required; ledger only, not model-visible history |
| `delivery` | Optional `"steer"` \| `"queue"` (omit = queue). Invalid → **`400`** |
| `resume` | `true` → **await** drain after admit (**`200`** chat result) |
| `wake` | `true` (and not resume) → **wake** drain after admit, non-blocking (**`202`** + `scheduled`) |

Default (no resume/wake) → **`202`** `{ sessionId, admitId, delivery, pending }`.  
Response `delivery` is the effective value (`"queue"` when the input omitted it).

Promote rule: a pending **steer** wins over an older queue (see [session-delivery.md](./session-delivery.md)).

### `POST /api/sessions/:id/turn` — continueTurn

```json
{ "message": "optional" }
```

Without `message`, promote the next pending admit (**steer first**, else oldest queue). No pending → **`400`**.

### `POST /api/chat` — convenience continueTurn

```json
{ "sessionId": "optional", "message": "ping" }
```

Response:

```json
{
  "sessionId": "sess_…",
  "turnId": "turn_…",
  "text": "…",
  "steps": 1
}
```

If the same `sessionId` already has a turn in flight → **`409`** `{ "error": "session busy", … }`.

### `POST /api/chat/stream`

Same body as `/api/chat`. SSE events:

- `session` — `{ sessionId }`
- `session_event` — append-only session event
- `done` — same fields as `/api/chat` response

### `GET /api/sessions/:id`

```json
{ "sessionId": "…", "events": [ /* SessionEvent[] */ ] }
```

### `GET /api/sessions/:id/events?stream=1`

SSE stream of session events (replays history, then live).

## Host Face (U1)

A parallel protocol surface (coexists with REST above), on the same `serve`:

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/face/<method>` | Prefixed path |
| `POST` | `/api/<method>` | Dot form (`session.prompt`) or Typert (`commands/execute`); wire shape is the Session/RPC envelope |
| `POST` | `/api/respond` | Client reply (approvals / questions: `client-response`) |
| `GET` / `HEAD` | `/api/session.export` | Session ZIP (`sessionId` · `includeDescendants`); shell HEADs first |
| WS | `/api/face/events.*` or `/api/events.*` | mux / host downlink only |

Envelope: `{ rpcId, payload }` → `{ rpcId, result }` (unary often includes `type: "server-response"`).  
Unimplemented methods → `ok: false` + stable `error.code` (no fake success).

Runnable method families (summary; full table and behavior in [host-face.md](./host-face.md)):

- Host: `host.describe` · `host.pickDirectory` · `host.listDirectory` · `host.createDirectory` · `host.openPath`
- Session: `session.create` · `list` · `history` · `search` · `prompt` · `cancel` · `models` · `selectModel` · `rename` · `updateQueue` · `fork` · `respondApproval` · `attachment` · `export` (HTTP GET/HEAD)
  - `session.history` **tail** may carry `projections` (including **`turnOutline`**); older pages with `beforeSeq` omit the whole block. See [session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md)
- LLM: `llm.providers` · `llm.models` · `llm.discoverModels`
- Workspace / settings / credentials: `workspace.*` · `settings.*` · `credentials.*` · `agentPreset.list|select|read`
- Other: `skill.list` · `commands/list` · `commands/execute` · `pluginInventory/list` · `fileReferences/list` · `sessionReferenceResolver/candidates` · `subagent.*` · `messageFeedback.*` · `goals.*` / `goal.*`

Web: CLI `serve` / `web` hosts the product shell. Resolution order: `XRK_WEB_DIST` → CLI `product-web/` → monorepo `apps/web/dist` (missing dist triggers the three assemble steps). With no static mount, `GET /` is **404** (no brochure page).

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
# equivalent: xrkh web --port 8080 --open
# open http://127.0.0.1:8787/
```

The host injects `__XRK_BOOT__` into index.html (`boot.json` merged with `{XRK_PLUGINS_DIR}/web/boot.json`, then `applyXrkProductBootPolicy` strips Cordis client ids and HMR). Missing `/plugins/…` returns 404 (no SPA fallback).

## Env

Full ops set: [configuration.md](./configuration.md). This table summarizes common HTTP Host vars:

| Var | Meaning |
|-----|---------|
| `XRK_API_KEY` | API key for `/api/*` |
| `XRK_HOST` | Bind host |
| `XRK_PORT` | Bind port |
| `XRK_WORKSPACE` | Workspace root |
| `XRK_PRESET` | `minimal` \| `shell` \| `frugal` \| `plan` \| `shallow` \| `harness` \| `server` |
| `XRK_CORS_ORIGIN` | CORS origin (`*` default) |
| `XRK_RATE_LIMIT` | Requests / IP / minute |
| `XRK_PLUGINS_DIR` | Optional plugin root → `loadAll` + factory `plugins` → preset `wireCompositionTools`; `web/` is client overlay |
| `XRK_LLM_PRESET` | Provider Registry brand id (`openrouter`, `deepseek`, …) — see [llm-provider-registry.md](./llm-provider-registry.md) |
| `XRK_LLM_MODEL` | Optional model override when preset set |
| `XRK_LLM_BASE_URL` | Optional baseUrl override (required for `custom` / `newapi` / …) |
| brand `apiKeyEnv` | e.g. `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY` (see [llm-provider-presets.md](./llm-provider-presets.md)) |
| `XRK_WEB_DIST` | SPA dist (optional override; default above) |
| `XRK_SESSIONS_DIR` | Session persistence dir (`sessions.db`); CLI `serve` defaults to `~/.xrk/sessions` (`--no-persist` = memory); sidecars `subagents.json` · `goals.json` |
| `XRK_POLICY_FILE` | policy JSON |
| `XRK_MCP_SERVERS` | MCP servers JSON (`command` or `url`); empty falls back to `~/.xrk/host-settings.json` |
| `XRK_MCP_ALLOW` | `1`/`true` → this-process `mcp.connect` allow |
| `XRK_TAVILY_API_KEY` | Tavily search; without it `web_search` still registers but execute fails |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave Search; when both set and provider not pinned, Tavily wins |
| `XRK_WEB_SEARCH_PROVIDER` | Optional `tavily` \| `brave` |
| `XRK_LSP_COMMAND` | Language-server executable; without it `lsp` still registers but execute fails |
| `XRK_LSP_ARGS` | Optional args (whitespace-separated or JSON string array) |

## CLI

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
node apps/cli/dist/bin.js web --open
```

Index: [docs/README.md](./README.md).
