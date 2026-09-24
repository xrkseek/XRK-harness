# @xrkseek/im-gateway-contract

> **Audience**: Integrators · Sidecar authors · Maintainers

Typed **Host ↔ IM gateway sidecar** wire for [ADR-0006](../../docs/adr/0006-im-long-lived-gateway.md).

This package freezes:

| Surface | Detail |
|--------|--------|
| Env | `XRK_IM_GATEWAY_URL` · `XRK_IM_GATEWAY_TOKEN` |
| Sidecar | `GET /health` → `{ ok, status?, contractVersion }` |
| Host | `POST /api/im/gateway/relay` body `{ channel, botId?, text?, … }` |
| Auth | Bearer / `x-im-gateway-token`, or loopback when token unset |
| States | `bridge` · `sidecar-configured` · `sidecar-reachable` · `sidecar-unreachable` |

**Not in scope:** Telegram / Discord / Slack / Feishu / … native SDKs. Face still lists nine channel *ids* for discover; they are stubs until a sidecar (or webhook) feeds `channel`.

## Mock sample (one platform)

```bash
# Terminal A — Host
xrkh serve   # or web

# Terminal B — mock sidecar (channel id: mock)
node packages/im-gateway-contract/examples/mock-sidecar.mjs --once "hello from mock"
# or long-running: node …/mock-sidecar.mjs
# then: curl -s -X POST http://127.0.0.1:9471/simulate -H "content-type: application/json" -d "{\"text\":\"hi\"}"
```

Point Host at the mock with:

```text
XRK_IM_GATEWAY_URL=http://127.0.0.1:9471
XRK_IM_GATEWAY_TOKEN=secret   # optional for loopback relay
```

## API

```ts
import {
  IM_GATEWAY_CONTRACT_VERSION,
  parseRelayBody,
  assertRelayAuthorized,
  readImGatewaySidecarConfig,
  sidecarHealthResponse,
} from "@xrkseek/im-gateway-contract";
```

Host wiring lives in `@xrkseek/server-http` (`im-gateway-sidecar.ts`).
