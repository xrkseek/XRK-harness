# HTTP API

Base URL: `http://127.0.0.1:8787` (override with `XRK_HOST` / `XRK_PORT`).

语义总览：[session-api.md](./session-api.md)、[session-latch.md](./session-latch.md)、[session-delivery.md](./session-delivery.md)。

## Auth

- `/health` — **public**
- REST `/api/sessions` · `/api/chat` — `Authorization: Bearer <XRK_API_KEY>` or `x-api-key` when `XRK_API_KEY` is set
- Face `/api/<method>` · `/api/respond` · WS `/api/events.*` — 同上；本机回环且无头时放行（DSH Web 同源）
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

无 `message` 时 promote 下一条 pending admit（**steer 优先**，否则最老 queue）。无 pending → **`400`**.

### `POST /api/chat` — 便利 continueTurn

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

同一 `sessionId` 若已有 turn 在飞 → **`409`** `{ "error": "session busy", … }`。

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

## Host Face（DeepSeek 兼容 · U1）

并行协议面（与上表 REST 共存），挂在同一 `serve`：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/face/<method>` | 前缀路径 |
| `POST` | `/api/<method>` | DeepSeek 原生：点号（`session.prompt`）或 Typert（`commands/execute`） |
| `GET` / `HEAD` | `/api/session.export` | 会话 ZIP（`sessionId` · `includeDescendants`）；壳先 HEAD |
| WS | `/api/face/events.*` 或 `/api/events.*` | mux / host 只下行 |

信封：`{ rpcId, payload }` → `{ rpcId, result }`。  
U1 methods：`host.describe` · `session.create|list|history|prompt|cancel|models|selectModel` · `llm.providers|models|discoverModels`。详见 [host-face.md](./host-face.md)。

Web：默认托管 `apps/web-static`（DSH 产品壳）。`apps/web` 为 Face console（`?console=1`）。

```bash
node apps/cli/dist/bin.js serve --preset minimal --workspace .
# open http://127.0.0.1:8787/
```

index.html 由 host 注入 `__DSH_BOOT__` / `__XRK_BOOT__`（`boot.json`；可再 merge `{XRK_PLUGINS_DIR}/web/boot.json`）。缺失的 `/plugins/…` 返回 404（不回退 SPA）。

## Env

| Var | Meaning |
|-----|---------|
| `XRK_API_KEY` | API key for `/api/*` |
| `XRK_HOST` | bind host |
| `XRK_PORT` | bind port |
| `XRK_WORKSPACE` | workspace root |
| `XRK_PRESET` | `minimal` \| `harness` \| `server` |
| `XRK_CORS_ORIGIN` | CORS origin (`*` default) |
| `XRK_RATE_LIMIT` | requests / IP / minute |
| `XRK_PLUGINS_DIR` | optional plugin root → `loadAll` + factory `plugins` → preset `wireCompositionTools`；`web/` 为客户端叠加 |
| `XRK_LLM_PRESET` | Provider Registry brand id (`openrouter`, `deepseek`, …) — see [llm-provider-registry.md](./llm-provider-registry.md) |
| `XRK_LLM_MODEL` | optional model override when preset set |
| `XRK_LLM_BASE_URL` | optional baseUrl override (required for `custom` / `newapi` / …) |
| `XRK_WEB_DIST` | SPA dist root（默认 `apps/web-static`）；public GET + boot inject |
| `XRK_SESSIONS_DIR` | JSONL 会话目录（省略 = 内存）；旁路 `subagents.json` · `goals.json` |
| `XRK_POLICY_FILE` | policy JSON |
| `XRK_MCP_SERVERS` | MCP 服务器 JSON（`command` 或 `url`） |
| `XRK_MCP_ALLOW` | `1`/`true` → 本进程 `mcp.connect` allow |

## CLI

```bash
node apps/cli/dist/bin.js serve --preset minimal --workspace .
```
