# `@xrkseek/a2a`

> **读者**：集成者 · 维护者

可选 **A2A（Agent-to-Agent）** 客户端：对标 Hermes `plugins/platforms/a2a` 的出站工具集核心——`context_id` 磁盘持久、历史召回、环路上限。

## 能力

| 面 | 行为 |
|----|------|
| 持久 | `{XRK_HOME}/a2a_conversations/<context>.jsonl`（可用 `XRK_A2A_CONVERSATIONS_DIR`） |
| 历史 | `a2a_history(context_id)` / `loadConversation` |
| 环路 | `TurnTracker` + `XRK_A2A_MAX_PINGPONG_TURNS`（默认 5，硬顶 20） |
| 工具 | `a2a_discover` · `a2a_call` · `a2a_list` · `a2a_history` |

## 启用

进程插件：`extensions/a2a`（`XRK_PLUGINS_DIR=./extensions` 或 `xrkh plugin add`）。

```bash
# 对等体
set XRK_A2A_AGENTS={"researcher":{"url":"http://127.0.0.1:9900","auth":{"token":"…"}}}
# 环路上限（可选）
set XRK_A2A_MAX_PINGPONG_TURNS=5
```

或写 `{XRK_HOME}/a2a_agents.json`。

## 未做（本切片）

SSE `message/stream`、tasks CRUD / subscribe、push notifications、orchestrate — 见 Hermes DESIGN。

## 入站（opt-in）

`XRK_A2A_INBOUND=1` 时 Host 挂载：

| 路径 | 行为 |
|------|------|
| `GET /.well-known/agent-card.json`（兼 `agent.json`） | A2A v1.0 Agent Card |
| `POST /a2a` | JSON-RPC `message/send`：持久化 + **Face 会话注入**（`wrapA2aInboundText` → `session.prompt`；等助手正文；超时见 `XRK_A2A_INBOUND_TIMEOUT_MS`） |
| `GET /a2a/health` | 健康检查 |

会话映射：默认 `a2a-<contextId>`；`XRK_A2A_INBOUND_SESSION` 可钉死单一会话。无 bearer / peer token 时仅环回语义可用（仍建议本机）；设 `XRK_A2A_BEARER_TOKEN` 或 `XRK_A2A_PEER_TOKENS` 启用鉴权。`XRK_A2A_PUBLIC_URL` 覆盖 Card 上的 url。
