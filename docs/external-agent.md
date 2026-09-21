# 外部 Agent 运行时委托

> **读者**：集成者 · Agent 作者

`subagent` 默认仍是 **进程内** Face 子会话。可选 `runtime` 把**单次回合**交给外部子进程；不创建 Face 子会话，也不走同一 drain。

| `runtime` | 启动 | 协议 |
|-----------|------|------|
| （省略） / `in-process` | Face `session.create` / `fork` | 原路径 |
| `acp` | `XRK_ACP_AGENT`（必填，如 `xrkh acp`） | NDJSON ACP：`initialize` · `session/new` · `session/prompt` |
| `app-server` | `XRK_CODEX_APP_SERVER`（默认 `codex app-server`） | Codex app-server JSON-RPC：`thread/start` · `turn/start` |
| `claude-code` | `XRK_CLAUDE_CODE`（默认 `claude`） | `claude -p <prompt>`，读 stdout |

约束：外部路径 **不支持** `run_in_background`；缺二进制 / 缺 env 时工具 **诚实失败**（不静默回落进程内）。本进程作 ACP **服务端**见 [acp.md](./acp.md)；本页是反方向（本进程作 client）。

---

# External agent-runtime delegation

> **Audience**: Integrators · Agent authors

`subagent` still defaults to an **in-process** Face child. Optional `runtime` hands a **one-shot turn** to an external subprocess; no Face child session and no shared drain.

| `runtime` | Launch | Protocol |
|-----------|--------|----------|
| (omit) / `in-process` | Face `session.create` / `fork` | Existing path |
| `acp` | `XRK_ACP_AGENT` (required, e.g. `xrkh acp`) | NDJSON ACP: `initialize` · `session/new` · `session/prompt` |
| `app-server` | `XRK_CODEX_APP_SERVER` (default `codex app-server`) | Codex app-server JSON-RPC: `thread/start` · `turn/start` |
| `claude-code` | `XRK_CLAUDE_CODE` (default `claude`) | `claude -p <prompt>`, read stdout |

Constraints: external path does **not** support `run_in_background`; missing binary / env fails the tool **honestly** (no silent fall-back to in-process). This process as ACP **server**: [acp.md](./acp.md). This page is the reverse (this process as client).
