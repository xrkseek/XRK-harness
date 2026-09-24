# IM gateway sidecar

> **读者**：集成者 · sidecar 作者 · 维护者

Host ↔ 外置 IM 长连接进程的 **契约**（[ADR-0006](./adr/0006-im-long-lived-gateway.md)）。  
实现包：`@xrkseek/im-gateway-contract`。Host 接线：`packages/server/http` → `im-gateway-sidecar.ts`。

## 做什么 / 不做什么

| 能跑 | 未做 |
|------|------|
| Bridge：webhook · poll/SSE · `message.send/list` | Telegram / Discord / Slack / 飞书 / … 原生长连接 SDK |
| Host 本地 `/api/im/gateway/ws` + `POST /api/im/gateway/relay` | Face 九路 id 的产品级原生推送 |
| 外置 sidecar：`GET /health` · 向 Host relay 投递 | 把九路矩阵标成 Working |

Face `processChannels/list` 里的厂商 id 是 **discover stub**；真正入站靠 webhook、本地 WS，或实现本契约的 sidecar。

## 契约摘要

| 项 | 值 |
|----|-----|
| 版本 | `IM_GATEWAY_CONTRACT_VERSION`（当前 `"1"`） |
| Env | `XRK_IM_GATEWAY_URL` · `XRK_IM_GATEWAY_TOKEN` |
| Sidecar | `GET {url}/health` → `{ ok, status?, contractVersion }` |
| Host relay | `POST /api/im/gateway/relay` · body 必含 `channel` |
| 鉴权 | `Authorization: Bearer …` 或 `x-im-gateway-token`；无 token 时仅 loopback |

## 单平台样板

```bash
node packages/im-gateway-contract/examples/mock-sidecar.mjs --once "hello"
```

通道 id：`mock`。可选进程插件 discover：`extensions/example-im-mock-sidecar`。

---

# IM gateway sidecar

> **Audience**: Integrators · Sidecar authors · Maintainers

**Contract** between the Host and an external IM long-lived process ([ADR-0006](./adr/0006-im-long-lived-gateway.md)).  
Package: `@xrkseek/im-gateway-contract`. Host wiring: `im-gateway-sidecar.ts`.

## In / out of scope

| Working | Not done |
|---------|----------|
| Bridge: webhook · poll/SSE · `message.send/list` | Native Telegram / Discord / Slack / Feishu / … SDKs |
| Host-local `/api/im/gateway/ws` + `POST /api/im/gateway/relay` | Product-grade native push for Face’s nine channel ids |
| External sidecar: `GET /health` · POST to Host relay | Calling the nine-id matrix “Working” |

Face `processChannels/list` vendor ids are **discover stubs**; real ingress is webhook, local WS, or a sidecar that implements this contract.

## Contract summary

| Item | Value |
|------|--------|
| Version | `IM_GATEWAY_CONTRACT_VERSION` (currently `"1"`) |
| Env | `XRK_IM_GATEWAY_URL` · `XRK_IM_GATEWAY_TOKEN` |
| Sidecar | `GET {url}/health` → `{ ok, status?, contractVersion }` |
| Host relay | `POST /api/im/gateway/relay` · body must include `channel` |
| Auth | `Authorization: Bearer …` or `x-im-gateway-token`; loopback only when token unset |

## One-platform sample

```bash
node packages/im-gateway-contract/examples/mock-sidecar.mjs --once "hello"
```

Channel id: `mock`. Optional discover plugin: `extensions/example-im-mock-sidecar`.
