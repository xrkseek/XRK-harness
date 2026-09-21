# xrk-harness（Python）

> **读者**：集成者

Python 客户端，调用已运行的 XRK-Harness HTTP Host。宿主仍是 TypeScript（`@xrkseek/harness` / CLI）。本包不启动 Agent、不写 `sessions.db`。

契约：[docs/http-api.md](../../docs/http-api.md)。

```python
from xrk_harness import HarnessClient

client = HarnessClient("http://127.0.0.1:8787", api_key=None)
print(client.health())
created = client.create_session()
result = client.chat("ping", session_id=created["sessionId"])
print(result["text"])
```

设置了 `XRK_API_KEY` 时把同一密钥传给 `api_key`（请求头 `Authorization: Bearer`）。另有 `admit`、`turn`、`chat_stream`（SSE：`session` · `session_event` · `done`）。`409` 等非 2xx 抛 `HarnessError`（`status` · `body`）。

安装（本仓）：`pip install -e sdks/python`。依赖仅标准库。

## stdio 轮次

`StdioHarnessClient` 拉起本机 `xrkh acp`（newline JSON-RPC），做 `initialize` · `session/new` · `session/prompt`。回合仍在那个 TypeScript 进程里跑。HTTP `HarnessClient` 保留。

```python
from xrk_harness import StdioHarnessClient

with StdioHarnessClient() as client:
    result = client.run("ping", cwd=".")
print(result["text"], result["stopReason"])
```

`text` 是本轮 `session/update` 里 `agent_message_chunk` 的拼接。协议见 [docs/acp.md](../../docs/acp.md)。

---

# xrk-harness (Python)

> **Audience**: Integrators

Python client for a running XRK-Harness HTTP host. The host stays TypeScript (`@xrkseek/harness` / CLI). This package does not start an agent and does not write `sessions.db`.

Contract: [docs/http-api.md](../../docs/http-api.md).

```python
from xrk_harness import HarnessClient

client = HarnessClient("http://127.0.0.1:8787", api_key=None)
print(client.health())
created = client.create_session()
result = client.chat("ping", session_id=created["sessionId"])
print(result["text"])
```

When `XRK_API_KEY` is set, pass the same secret as `api_key` (`Authorization: Bearer`). Also `admit`, `turn`, and `chat_stream` (SSE: `session` · `session_event` · `done`). Non-2xx responses, including `409`, raise `HarnessError` (`status` · `body`).

Install from this repo: `pip install -e sdks/python`. Standard library only.

## stdio turns

`StdioHarnessClient` spawns the local `xrkh acp` process (newline-delimited JSON-RPC) and calls `initialize`, `session/new`, and `session/prompt`. The turn still runs in that TypeScript process. HTTP `HarnessClient` stays.

```python
from xrk_harness import StdioHarnessClient

with StdioHarnessClient() as client:
    result = client.run("ping", cwd=".")
print(result["text"], result["stopReason"])
```

`text` is the `agent_message_chunk` pieces from this turn's `session/update` notifications. Protocol: [docs/acp.md](../../docs/acp.md).
