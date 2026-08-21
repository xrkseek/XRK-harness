# PTY tools

> **读者**：集成者 · 贡献者。

`@xrkseek/exec-pty`：六件套 `terminal_open` / `terminal_send` / `terminal_read` / `terminal_signal` / `terminal_close` / `terminal_list`。Harness / server preset 默认登记；minimal 不登记。

对照源码：本机 `deepseek-harness` @ `dsh-v0.1.0-rc.8`（`origin/master`）。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `TerminalSessionService` — spawn · startSend · read · signal · kill · list · `hasActivity` |
| Provider | `node-pty@1.2.0-beta.15`（optional；**NAPI prebuild**）+ bash backend：`TERM=dumb`、`name: "dumb"`、OSC `133;D;`、受控 prompt `xrk> `；spawn 前 `scrubbedParentEnv` + 显式 `XRK_*` |
| Consumer | `createPtyTools({ workspaceRoot, service, jobs? })` — 模型文本仍 `render*`；结构化值进 `result.meta`（open / send / read / signal / list；background send 为 `{ kind: "background", jobId }`） |

一 composition 一 registry（没有 Cordis Agent owner；`hasActivity` = 已发布会话 ∪ 未发布 spawn）。Enablement ≠ provider：工具始终可见。无 `node-pty` 时 `terminal_open` 回 `isError` 明文。

Host（harness/server）共享一份 PTY registry：跨 agent invalidate 仍保留会话，供 `/permission` 沙箱 fence 使用。PTY id 形如 `pty-1`；勿把 volatile 里的聊天 `sess_…` 当成 terminal sessionId（会 `NO_SESSION` 并提示）。

`bash` 仍是一次性管道 job（[shell-jobs.md](./shell-jobs.md)）。持久会话走本包。`terminal_send.run_in_background` 经 composition `ShellService.startManagedJob` 登记 `pty-send`，用 `job_output` / `job_kill` 收集或取消。

## Native（对照 DSH）

DSH 钉 `node-pty@1.2.0-beta.15`（带 `prebuilds/`）。本仓同样：`optionalDependencies` 用该 beta；`postinstall` 跑 `scripts/ensure-spawn-helper.mjs` 恢复 Linux/mac `spawn-helper` 可执行位。

网络受限时在**本机**配置 npm/Git 代理；勿把固定端口或路径写进仓库文档或测试。

## Env scrub（CV DSH）

`scrubbedParentEnv` / `childEnv`：丢掉凭据形名（`KEY|PASSWORD|SECRET|TOKEN`）与 ambient `XRK_*` / `DSH_*`；显式 overrides（`XRK_SHELL` · `XRK_PTY_SESSION_ID` · 可选 `XRK_SESSION_ID`）在 scrub 之后合并。Host `exit` 时对 live handle 调 `terminateForHostExit`（同步尽力杀树）。

## 就绪与 inspector

`terminal_send` 默认提交 Enter，等到下列之一：

| `waitReason` | 含义 |
|--------------|------|
| `stdin_read` | OSC prompt 或 stdin wait（Linux `/proc` · macOS `ps` tpgid） |
| `inferred_idle` | 输出静默 |
| `timeout` | 到达 `timeoutMs`（默认 30s） |
| `session_exit` | shell 退出 |

前台探测 CV 自 DSH `subprocess-local` process-inspector。**Windows**：DSH 直接 throw；本仓用 **no-op inspector**（`inspectForeground` → `undefined`），就绪主要靠 OSC prompt / 静默 / 超时——ConPTY 会话仍能跑，不假装有 `/proc`。

terminate：descendant SIGTERM→grace→SIGKILL，再杀 shell；拒绝对 shell 本体 `SIGKILL`（用 `terminal_close`）。

`run_in_background`：返回 `started background job pty-send-N`，`meta: { kind: "background", jobId }`；经 `startManagedJob({ outputLimitBytes: maxResultBytes })` 登记。Face `session/jobs` 可见；`job_output` 消费 `readOutput` 游标（可 `wait: true`）；`job_kill` 调 `operation.cancel()`。`terminal_open` 把 composition session id 写入子进程 `XRK_SESSION_ID`。

## 路径 / 沙箱

`cwd` 必须落在 `workspaceRoot` 内。harness 在 `workspace-write` 下把 spawn argv 交给 `SandboxService.wrapArgv`。`read-only` 拒绝 `terminal_open/send/signal/close`（list/read 仍可）。

有 open / pending PTY 时，`/permission` 拒绝改 `sandbox/mode`（与 DSH terminal-bash fence 同文案）。

## 卡回放

冷 history 靠 Host standing 工具表的 `presentCall`。`terminal_send` 前台：`card: "terminal"`；`meta` 供 Face presentation 回放。Face 不按工具名造卡。

相关：[seams.md](./seams.md) · [profiles.md](./profiles.md) · [shell-jobs.md](./shell-jobs.md)
