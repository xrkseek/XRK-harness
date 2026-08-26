# ADR-0006: IM 长连接网关

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-08-26
- **Tags:** im, community-plugins, dsh-compat

## 背景

社区 client `@xmanrui/dsh-im` 与九路 IM 厂商（钉钉 · 飞书 · 企业微信 · QQ · Telegram · Discord · WhatsApp · Slack · 微信）期望 Host 提供：

1. **Connector 快照** — bot 列表 · OAuth provision · `connection.test`  
2. **消息面** — `message.send` / `message.list` · webhook 入站  
3. **长连接网关** — 厂商云端推送 / 持久隧道（非单次 HTTP）

XRK-Harness 今日在 `packages/server/http/src/dsh-compat/` 已实现 **(1)(2) 的本地 bridge**（`im-channels.ts` · `im-messaging-bridge.ts`）：凭据与 bot 状态落 `~/.xrk`；出站 ack 与入站 webhook 走短请求；客户端可用 HTTP poll 或 SSE snapshot（`/api/im/{channel}/stream`）。**未嵌入**厂商原生长连接 SDK 或云端 relay。

[community-plugins.md](../community-plugins.md) 与 [status.md](../status.md) 将「云端长连接网关」标为待补；本 ADR 界定边界与后续实现路径。

## 决策（提议）

### 分层

| 层 | 职责 | 今日落点 |
| --- | --- | --- |
| **Bridge（短请求）** | OAuth 快照 · send/list · webhook · poll/SSE | `im-channels` · `im-messaging-bridge` |
| **Gateway（长连接）** | 厂商 push · 保活 · 重连 · 会话 resume | `im-long-lived-gateway.ts` · `im-vendor-ws-client.ts` · `im-gateway-sidecar.ts` |

Bridge 与 Gateway **并存**：未配置 WS/sidecar 时默认 `state: bridge`（webhook + poll）；配置 `XRK_IM_GATEWAY_WS_URL` 或 sidecar 后 gateway RPC 返回 `ws-configured` / `ws-connected` / `sidecar`。

### 厂商列表

与 `im-channels.ts` 一致：`dingtalk` · `feishu` · `wecom` · `qq` · `telegram` · `discord` · `whatsapp` · `slack` · `weixin`。

### 与 `message.send` / `message.list` 的关系

- **Send/list 真源（bridge）**：消息持久化在 `~/.xrk/im-messaging/messages.json`；RPC 与 REST（`/api/im/{channel}/send|messages|webhook`）共用同一 store。  
- **Gateway 职责**：把厂商 push 事件 **写入同一 store**（等价于今日 `ingestImWebhook`），并向上游 client 发 stream 通知；**不**另起一套 transcript。  
- **Outbound**：gateway 在线时可转发至厂商 API；离线时 bridge send 仍返回本地 ack（与今日行为一致）。

### 保活 · 重连 · 凭据

- 凭据：`~/.xrk` IM connector 文档（与 bridge 共用）；不入库。  
- 保活：gateway 进程负责 vendor heartbeat；Host HTTP 层不阻塞 turn。  
- 重连：指数退避 + jitter；状态写入 `im-channels/{channel}/state.json` 的 bot `state` 字段（如 `gateway-connected` / `gateway-reconnecting`）。  
- 鉴权：生产环境沿用 `XRK_API_KEY`；webhook 路径应可配置 shared secret（后续）。

### 传输层（D-2 方向）

符合 [ADR-0001](./0001-typescript-only-host.md)：**Host 核心仍 TypeScript**；gateway 可为 **可选 sidecar**（WebSocket 客户端连厂商）或外接 relay。候选：

| 选项 | 说明 |
| --- | --- |
| **Sidecar WS client** | Node 子进程 / 独立包；经 Unix socket 或 localhost RPC 向 Host 投递 inbound |
| **SSE 出口** | 已有 snapshot SSE；gateway 可 fan-in 至同一 stream 路径 |
| **外接 relay** | 用户自运维；Host 仅配置 upstream URL + token |

不在内核嵌入 Rust/Go 厂商 SDK 树。

### 参考模式（不嵌入上游）

对照仓 **codex** `codex-rs/exec-server` 可借鉴（见 D-3）：

- WebSocket transport + **pong watchdog**（空闲断线检测）  
- **Session resume** / 版本 skew 测试  
- **Noise relay** 式中继：Host 与 relay 分离，凭据不经过浏览器  

记录于 [modules/references.md](../modules/references.md)；**不** vendoring codex 源码。

## 后果

- `im-long-lived-gateway` matrix 行 `bridge`；in-process WS client + sidecar relay + webhook/poll 已能跑。  
- RPC 契约稳定后同步 `community-plugins.md` · `security-checklist.md`（webhook 暴露面）。  
- Face `processChannels/list` 已暴露 `wired: sidecar` 与 gateway paths；社区 client UI 可选。

## 相关

[community-plugins.md](../community-plugins.md) · [status.md](../status.md) · `im-gateway-sidecar.ts` · `im-messaging-bridge.ts`

---

# ADR-0006: IM long-lived gateway

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-08-26
- **Tags:** im, community-plugins, dsh-compat

## Context

Community client `@xmanrui/dsh-im` and nine IM vendors (DingTalk · Feishu · WeCom · QQ · Telegram · Discord · WhatsApp · Slack · WeChat) expect the Host to provide:

1. **Connector snapshot** — bot list · OAuth provision · `connection.test`  
2. **Messaging** — `message.send` / `message.list` · webhook ingress  
3. **Long-lived gateway** — vendor cloud push / persistent tunnel (not one-shot HTTP)

XRK-Harness today implements **(1)(2) as a local bridge** under `packages/server/http/src/dsh-compat/` (`im-channels.ts` · `im-messaging-bridge.ts`): credentials and bot state under `~/.xrk`; outbound ack and inbound webhook via short requests; clients may HTTP poll or SSE snapshot (`/api/im/{channel}/stream`). **No** vendor-native long-connection SDK or cloud relay is embedded.

[community-plugins.md](../community-plugins.md) and [status.md](../status.md) mark the cloud long-lived gateway as not done; this ADR defines boundaries and a forward path.

## Decision (proposed)

### Layers

| Layer | Role | Today |
| --- | --- | --- |
| **Bridge (short requests)** | OAuth snapshot · send/list · webhook · poll/SSE | `im-channels` · `im-messaging-bridge` |
| **Gateway (long-lived)** | Vendor push · keepalive · reconnect · session resume | `im-long-lived-gateway.ts` · `im-vendor-ws-client.ts` · `im-gateway-sidecar.ts` |

Bridge and gateway **coexist**: without WS/sidecar, default `state: bridge` (webhook + poll); with `XRK_IM_GATEWAY_WS_URL` or sidecar, gateway RPC returns `ws-configured` / `ws-connected` / `sidecar`.

### Vendor list

Same as `im-channels.ts`: `dingtalk` · `feishu` · `wecom` · `qq` · `telegram` · `discord` · `whatsapp` · `slack` · `weixin`.

### Relationship to `message.send` / `message.list`

- **Send/list source of truth (bridge)**: messages persist under `~/.xrk/im-messaging/messages.json`; RPC and REST (`/api/im/{channel}/send|messages|webhook`) share one store.  
- **Gateway role**: map vendor push events **into the same store** (same as today’s `ingestImWebhook`) and notify upstream clients on the stream; **no** second transcript.  
- **Outbound**: when gateway is online, forward to vendor APIs; when offline, bridge send still returns local ack (today’s behavior).

### Keepalive · reconnect · credentials

- Credentials: `~/.xrk` IM connector docs (shared with bridge); never committed.  
- Keepalive: gateway process owns vendor heartbeat; Host HTTP must not block turns.  
- Reconnect: exponential backoff + jitter; state written to bot `state` in `im-channels/{channel}/state.json` (e.g. `gateway-connected` / `gateway-reconnecting`).  
- Auth: production keeps `XRK_API_KEY`; webhook paths should support configurable shared secrets (later).

### Transport (D-2 direction)

Per [ADR-0001](./0001-typescript-only-host.md): **Host core stays TypeScript**; gateway may be an **optional sidecar** (WebSocket client to vendors) or external relay. Options:

| Option | Notes |
| --- | --- |
| **Sidecar WS client** | Node subprocess / separate package; deliver inbound to Host via localhost RPC |
| **SSE egress** | Snapshot SSE exists; gateway can fan-in on the same stream path |
| **External relay** | User-operated; Host configures upstream URL + token only |

Do not embed Rust/Go vendor SDK trees in the kernel.

### Reference patterns (do not embed upstream)

Reference repo **codex** `codex-rs/exec-server` (D-3):

- WebSocket transport + **pong watchdog**  
- **Session resume** / version skew tests  
- **Noise relay** separation: Host vs relay; credentials not exposed to the browser  

Documented in [modules/references.md](../modules/references.md); **no** codex source vendoring.

## Consequences

- Matrix row `im-long-lived-gateway` is `bridge`; in-process WS client + sidecar relay + webhook/poll works today.    
- After RPC contracts stabilize, sync `community-plugins.md` · `security-checklist.md` (webhook exposure).  
- Face `processChannels/list` surfaces `wired: sidecar` and gateway paths; community client UI optional.

## Related

[community-plugins.md](../community-plugins.md) · [status.md](../status.md) · `im-gateway-sidecar.ts` · `im-messaging-bridge.ts`
