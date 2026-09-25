# 外部 Agent 运行时委托

> **读者**：集成者 · Agent 作者

`subagent` 默认仍是 **进程内** Face 子会话。可选 `runtime` 把回合交给外部子进程。

| `runtime` | 启动 | 协议 | 可继续 |
|-----------|------|------|--------|
| （省略） / `in-process` | Face `session.create` / `fork` | 原路径 | `run_in_background` + `followup_task` / `send_message` / `wait_agent` / `interrupt_agent` |
| `acp` | Settings `external-agent.acpAgent` 或 `XRK_ACP_AGENT`（必填其一，如 `xrkh acp`） | NDJSON ACP：`initialize` · `session/new` · `session/prompt` | **支持**：Face 子会话 id 作句柄，进程保活；与进程内同一 list 面 |
| `app-server` | Settings `external-agent.codexAppServer` 或 `XRK_CODEX_APP_SERVER`（默认 `codex app-server`） | Codex app-server JSON-RPC：`thread/start` · `turn/start` · `turn/interrupt` | **支持**：同上 |
| `claude-code` | Settings `external-agent.claudeCode` 或 `XRK_CLAUDE_CODE`（默认 `claude`） | `claude -p <prompt>`，读 stdout | **不支持** `run_in_background`（print 协议） |

约束：缺二进制 / 缺命令时工具 **诚实失败**（不静默回落进程内）。产品路径：**设置 → 插件 → 外部 Agent**。本进程作 ACP **服务端**见 [acp.md](./acp.md)；本页是反方向（本进程作 client）。

后台外部子代理完成后，与进程内一样向父 inbox **steer** 完成通知；`interrupt_agent` 结束保活进程。

### 外部 resume（冷句柄）

`acp` / `app-server` 的 live 句柄会写入 `{XRK_HOME}/…/external-agent-handles.json` sidecar（与 subagent 图同目录）。Host 重启或进程 detach 后 Status 显示 `ext:…/cold`；随后的 `send_message` / `followup_task` 会尝试：

- **app-server**：`thread/resume`（Codex）
- **acp**：`session/load`（失败则诚实失败 / 回落 `session/new`）

硬 interrupt 仍会拆掉 live 进程；sidecar 保留以便 Status 诚实标 cold。

---

# External agent-runtime delegation

> **Audience**: Integrators · Agent authors

`subagent` still defaults to an **in-process** Face child. Optional `runtime` hands turns to an external subprocess.

| `runtime` | Launch | Protocol | Continuable |
|-----------|--------|----------|-------------|
| (omit) / `in-process` | Face `session.create` / `fork` | Existing path | `run_in_background` + `followup_task` / `send_message` / `wait_agent` / `interrupt_agent` |
| `acp` | Settings `external-agent.acpAgent` or `XRK_ACP_AGENT` (one required, e.g. `xrkh acp`) | NDJSON ACP: `initialize` · `session/new` · `session/prompt` | **Yes**: Face child id is the handle; process stays alive; same list surface |
| `app-server` | Settings `external-agent.codexAppServer` or `XRK_CODEX_APP_SERVER` (default `codex app-server`) | Codex app-server JSON-RPC: `thread/start` · `turn/start` · `turn/interrupt` | **Yes**: same as ACP |
| `claude-code` | Settings `external-agent.claudeCode` or `XRK_CLAUDE_CODE` (default `claude`) | `claude -p <prompt>`, read stdout | **No** `run_in_background` (print protocol) |

Constraints: missing binary / command fails the tool **honestly** (no silent fall-back to in-process). Product path: **Settings → Plugins → External agents**. This process as ACP **server**: [acp.md](./acp.md). This page is the reverse (this process as client).

Background external children steer a completion notice to the parent inbox like in-process; `interrupt_agent` tears down the live process.

### External resume (cold handles)

Live `acp` / `app-server` handles are written to `{XRK_HOME}/…/external-agent-handles.json` (sidecar beside the subagent graph). After Host restart or process detach, Status shows `ext:…/cold`; a later `send_message` / `followup_task` attempts:

- **app-server**: `thread/resume` (Codex)
- **acp**: `session/load` (fails honestly / falls back to `session/new`)

Hard interrupt still tears down the live process; the sidecar remains so Status can honestly mark cold.
