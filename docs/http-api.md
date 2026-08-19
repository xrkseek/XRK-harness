# HTTP API

Base URL: `http://127.0.0.1:8787` (override with `XRK_HOST` / `XRK_PORT`).

语义总览：[session-api.md](./session-api.md)、[session-latch.md](./session-latch.md)、[session-delivery.md](./session-delivery.md)。

## Auth

- `/health` — **public**
- REST `/api/sessions` · `/api/chat` — `Authorization: Bearer <XRK_API_KEY>` or `x-api-key` when `XRK_API_KEY` is set
- Face `/api/<method>` · `/api/respond` · WS `/api/events.*` — 同上；本机回环且无头时放行（产品壳同源）
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

## Host Face（U1）

并行协议面（与上表 REST 共存），挂在同一 `serve`：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/face/<method>` | 前缀路径 |
| `POST` | `/api/<method>` | 点号（`session.prompt`）或 Typert（`commands/execute`）；wire 形对齐上游 Session/RPC |
| `GET` / `HEAD` | `/api/session.export` | 会话 ZIP（`sessionId` · `includeDescendants`）；壳先 HEAD |
| WS | `/api/face/events.*` 或 `/api/events.*` | mux / host 只下行 |

信封：`{ rpcId, payload }` → `{ rpcId, result }`。  
U1 methods：`host.describe` · `session.create|list|history|prompt|cancel|models|selectModel` · `llm.providers|models|discoverModels`。详见 [host-face.md](./host-face.md)。

Web：CLI `serve` / `web` 托管产品壳。解析顺序：`XRK_WEB_DIST` → CLI `product-web/` → monorepo `apps/web/dist`（缺则代编三步）。无静态挂载时 `GET /` 为 **404**（不做说明书页）。

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
# 同形：xrk-harness web --port 8080 --open
# open http://127.0.0.1:8787/
```

index.html 由 host 注入 `__XRK_BOOT__`（`boot.json` merge `{XRK_PLUGINS_DIR}/web/boot.json` 后，再 `applyXrkProductBootPolicy` 去掉 Cordis 客户端 id 与 HMR）。缺失的 `/plugins/…` 返回 404（不回退 SPA）。

## Env

运维全集见 [configuration.md](./configuration.md)。本表为 HTTP Host 常用项摘要：

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
| brand `apiKeyEnv` | e.g. `OPENROUTER_API_KEY` · `DEEPSEEK_API_KEY`（见 [llm-provider-presets.md](./llm-provider-presets.md)） |
| `XRK_WEB_DIST` | SPA dist（可选覆盖；缺省见上） |
| `XRK_SESSIONS_DIR` | JSONL 会话目录；CLI `serve` 省略时用 `{workspace}/.xrk/sessions`（`--no-persist` = 内存）；旁路 `subagents.json` · `goals.json` |
| `XRK_POLICY_FILE` | policy JSON |
| `XRK_MCP_SERVERS` | MCP 服务器 JSON（`command` 或 `url`）；空则回退 `.xrk/host-settings.json` |
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
