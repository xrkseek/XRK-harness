# @xrkseek/server-http

Node `http` surface for session admit / turn / chat / SSE.

## Endpoints (summary)

- `GET /health`
- `POST /api/sessions` · `POST .../admit` · `POST .../turn`
- `POST /api/chat` · `POST /api/chat/stream`
- `GET /api/sessions/:id` · `GET .../events?stream=1`

Admit body may include `delivery: "steer" | "queue"` (see `docs/session-delivery.md` / `docs/http-api.md`).

## Non-goals

Auth beyond API key · TLS · framework adapters.
