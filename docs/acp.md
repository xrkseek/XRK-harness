# ACP 服务端

> **读者**：集成者 · 编辑器作者

`xrkh acp` 把本进程当成 **stdio ACP server**（newline JSON-RPC）。编辑器 spawn 该命令，stdout 只出协议帧，诊断在 stderr。

## 启动

```text
xrkh acp
xrkh acp --workspace <dir>
```

## 方法

| 方法 | 作用 |
|------|------|
| `initialize` | `protocolVersion: 1` · `agentInfo.name = xrk-harness` |
| `authenticate` | 空成功（凭据仍走 Host / env，不在 ACP 里再登一次） |
| `session/new` | 返回 `sessionId`（cwd 来自 params） |
| `session/prompt` | 跑 harness 回合；期间可发 `session/update`；结束 `stopReason: end_turn` |
| `session/cancel` | 通知（无 id）中止进行中的 prompt |

`session/load` · fork · 图片 prompt **未**做。外部 Agent 委托（本进程作 client，把回合交给 ACP / app-server / Claude Code 子进程）见 [external-agent.md](./external-agent.md)。Python `StdioHarnessClient`（`sdks/python`）只拉起本命令做轮次，不另写宿主。

---

# ACP server

> **Audience**: Integrators · Editor authors

`xrkh acp` runs this process as a **stdio ACP server** (newline-delimited JSON-RPC). Editors spawn the command; stdout is protocol frames only; diagnostics go to stderr.

## Start

```text
xrkh acp
xrkh acp --workspace <dir>
```

## Methods

| Method | Role |
|------|------|
| `initialize` | `protocolVersion: 1` · `agentInfo.name = xrk-harness` |
| `authenticate` | Empty success (credentials stay on Host / env) |
| `session/new` | Returns `sessionId` (cwd from params) |
| `session/prompt` | Runs a harness turn; may emit `session/update`; finishes with `stopReason: end_turn` |
| `session/cancel` | Notification (no id) aborts an in-flight prompt |

`session/load`, fork, and image prompts are **not** shipped. Handing a turn to an external ACP / app-server / Claude Code subprocess (this process as client) is in [external-agent.md](./external-agent.md). Python `StdioHarnessClient` (`sdks/python`) only spawns this command for a turn; it is not another host.

