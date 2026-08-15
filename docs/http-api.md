# HTTP API

Base URL: `http://127.0.0.1:8787` (override with `XRK_HOST` / `XRK_PORT`).

语义总览：[session-api.md](./session-api.md)、[session-latch.md](./session-latch.md)、[session-delivery.md](./session-delivery.md)。

## Auth

- `/health` — **public**
- `/api/*` — requires `Authorization: Bearer <XRK_API_KEY>` or `x-api-key` when `XRK_API_KEY` is set
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
| `POST` | `/api/<method>` | DeepSeek 原生（`method` 含 `.`，如 `session.prompt`） |
| WS | `/api/face/events.*` 或 `/api/events.*` | mux / host 只下行 |

信封：`{ rpcId, payload }` → `{ rpcId, result }`。  
U1 methods：`host.describe` · `session.create|list|history|prompt|cancel|models|selectModel` · `llm.providers|models`。详见 [host-face.md](./host-face.md)。

Web：`apps/web` Face console。生产同端口托管：

```bash
pnpm --filter @xrkseek/harness-web build
XRK_WEB_DIST=apps/web/dist pnpm exec … serve
# open http://127.0.0.1:8787/
```

index.html 由 host 注入 `__DSH_BOOT__` / `__XRK_BOOT__`（Face console 花名册）。

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
| `XRK_PLUGINS_DIR` | optional plugin root → `loadAll` + factory `plugins` → preset `wireCompositionTools` |
| `XRK_LLM_PRESET` | Provider Registry brand id (`openrouter`, `deepseek`, …) — see [llm-provider-registry.md](./llm-provider-registry.md) |
| `XRK_LLM_MODEL` | optional model override when preset set |
| `XRK_LLM_BASE_URL` | optional baseUrl override (required for `custom` / `newapi` / …) |
| `XRK_WEB_DIST` | SPA dist root (e.g. `apps/web/dist`); public GET + boot inject |

## CLI

```bash
node apps/cli/dist/bin.js serve --preset minimal --workspace .
```
