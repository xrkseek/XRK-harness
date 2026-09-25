# PTY 工具

> **读者**：集成者 · 贡献者

`@xrkseek/exec-pty`：六件套 `terminal_open` / `terminal_send` / `terminal_read` / `terminal_signal` / `terminal_close` / `terminal_list`。Harness / server preset 默认登记；minimal 不登记。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `TerminalSessionService` — spawn · startSend · read · signal · kill · list · `hasActivity` |
| Provider | `node-pty@1.2.0-beta.15`（optional；**NAPI prebuild**）+ bash backend：`TERM=dumb`、`name: "dumb"`、OSC `133;D;`、受控 prompt `xrk> `；spawn 前 `scrubbedParentEnv` + 显式 `XRK_*` |
| Consumer | `createPtyTools({ workspaceRoot, service, jobs? })` — 模型文本仍 `render*`；结构化值进 `result.meta`（open / send / read / signal / list；background send 为 `{ kind: "background", jobId }`） |

一 composition 一 registry（没有 Cordis Agent owner；`hasActivity` = 已发布会话 ∪ 未发布 spawn）。Enablement ≠ provider：工具始终可见。无 `node-pty` 时 `terminal_open` 回 `isError` 明文。

Host（harness/server）共享一份 PTY registry：跨 agent invalidate 仍保留会话，供 `/permission` 沙箱 fence 使用。PTY id 形如 `pty-1`；勿把 volatile 里的聊天 `sess_…` 当成 terminal sessionId（会 `NO_SESSION` 并提示）。

`bash` 仍是一次性管道 job（[shell-jobs.md](./shell-jobs.md)）。持久会话走本包。`terminal_send.run_in_background` 经 composition `ShellService.startManagedJob` 登记 `pty-send`，用 `job_output` / `job_kill` 收集或取消。

## Scrollback 截断 · 分页 · 内存上限

| 旋钮 | 默认 | 作用 |
|------|------|------|
| `scrollbackMaxBytes` | 4 MiB | 会话保留历史的 UTF-8 字节硬顶（分块环形保留尾部；追加时摊销驱逐；超大写入先按 UTF-16 安全边界拆块，避免单块长期钉住超大字符串） |
| `scrollbackLines` | 10_000 | 行数硬顶（与字节顶同时生效） |
| `maxReadBytes` | 256 KiB | 单次 `terminal_read` / 结算 send 返回的字节上限（≤ `scrollbackMaxBytes`） |

`terminal_read` 按**相对最新行**分页：`offset`（默认 0）+ `count`（默认 500）；结果带 `[lines: begin-end of total]`，上游或本页裁剪时附 `[output truncated]`。模型面渲染再经 `maxResultBytes` 尾部保留（同 DSH output-retention 语义）。超限历史**不**整份 spill 进会话；需要全文时写入工作区文件再 `read_file`。

## Native

本仓 `optionalDependencies` 钉 `node-pty@1.2.0-beta.15`（含 `prebuilds/`）；`postinstall` 跑 `scripts/ensure-spawn-helper.mjs` 恢复 Linux/mac `spawn-helper` 可执行位。

网络受限时在**本机**配置 npm/Git 代理；勿把固定端口或路径写进仓库文档或测试。

## Env scrub

`scrubbedParentEnv` / `childEnv`：移除凭据形名（`KEY|PASSWORD|SECRET|TOKEN`）与 ambient `XRK_*`；显式 overrides（`XRK_SHELL` · `XRK_PTY_SESSION_ID` · 可选 `XRK_SESSION_ID`）在 scrub 之后合并。Host `exit` 时对 live handle 调 `terminateForHostExit`（同步终止进程树，尽力而为）。

## 就绪与 inspector

`terminal_send` 默认提交 Enter，等到下列之一：

| `waitReason` | 含义 |
|--------------|------|
| `stdin_read` | OSC prompt 或 stdin wait（Linux `/proc` · macOS `ps` tpgid） |
| `inferred_idle` | 输出静默 |
| `timeout` | 到达 `timeoutMs`（默认 30s） |
| `session_exit` | shell 退出 |

前台探测走 process-inspector（`@xrkseek/exec-pty`）。

| 平台 | 行为 |
|------|------|
| **Linux** | `/proc`：tid 级 fdinfo · 多 ABI syscall 表 · 按 shell TTY 过滤 stdin-wait，避免管道成员误判「可 settle」 |
| **macOS** | `/bin/ps`；一次就绪/teardown 轮询共用一份 **`ProcessSnapshot`**（进程表最多读一次），代价不随后代数量放大；`isAlive` 仍读当前态作信号围栏 |
| **Windows** | **no-op inspector**（`inspectForeground` → `undefined`）；就绪主要靠 OSC prompt / 静默 / 超时——`useConpty: true` 隐藏 ConPTY 控制台闪窗；会话仍能跑，不假装有 `/proc` |

`processTree` / `processSession` 是 `snapshot()` 的便利包装；同一次轮询里问多项时应用 `snapshot()`。

terminate：descendant SIGTERM→grace→SIGKILL，再杀 shell；拒绝对 shell 本体 `SIGKILL`（用 `terminal_close`）。

`run_in_background`：返回 `started background job pty-send-N`，`meta: { kind: "background", jobId }`；经 `startManagedJob({ outputLimitBytes: maxResultBytes })` 登记。Face `session/jobs` 可见；`job_output` 消费 `readOutput` 游标（可 `wait: true`）；`job_kill` 调 `operation.cancel()`。`terminal_open` 把 composition session id 写入子进程 `XRK_SESSION_ID`。

## 路径 / 沙箱

`cwd` 必须落在 `workspaceRoot` 内。harness 在 `workspace-write` 下把 spawn argv 交给 `SandboxService.confine`（可取消）。`read-only` 拒绝 `terminal_open/send/signal/close`（list/read 仍可）。

有 open / pending **Agent** `terminal_*` PTY 时，`/permission` 拒绝改 `sandbox/mode`（与终端 bash fence 同文案）。侧栏用户终端（`/sidebar/ws/terminal`）走系统用户权限、**不**套 Agent sandbox，也**不**参与该 fence。

## 卡回放

冷 history 靠 Host standing 工具表的 `presentCall`。`terminal_send` 前台：`card: "terminal"`；`meta` 供 Face presentation 回放。Face 不按工具名造卡。

相关：[seams.md](./seams.md) · [profiles.md](./profiles.md) · [shell-jobs.md](./shell-jobs.md)

---

# PTY Tools

> **Audience**: Integrators · Contributors

`@xrkseek/exec-pty` provides six tools: `terminal_open` / `terminal_send` / `terminal_read` / `terminal_signal` / `terminal_close` / `terminal_list`. Harness and server presets register them by default; minimal does not.

## Seams

| Layer | Content |
|----|------|
| Definition | `TerminalSessionService` — spawn · startSend · read · signal · kill · list · `hasActivity` |
| Provider | `node-pty@1.2.0-beta.15` (optional; **NAPI prebuild**) + bash backend: `TERM=dumb`, `name: "dumb"`, OSC `133;D;`, controlled prompt `xrk> `; before spawn, `scrubbedParentEnv` + explicit `XRK_*` |
| Consumer | `createPtyTools({ workspaceRoot, service, jobs? })` — model text still via `render*`; structured values in `result.meta` (open / send / read / signal / list; background send is `{ kind: "background", jobId }`) |

One registry per composition (no Cordis Agent owner; `hasActivity` = published sessions ∪ unpublished spawns). Enablement ≠ provider: tools stay visible. Without `node-pty`, `terminal_open` returns a clear `isError` string.

Host (harness/server) shares one PTY registry: sessions survive agent invalidate for `/permission` sandbox fence. PTY ids look like `pty-1`; do not treat volatile chat `sess_…` as a terminal sessionId (yields `NO_SESSION` with a hint).

`bash` remains a one-shot pipe job ([shell-jobs.md](./shell-jobs.md)). Persistent sessions use this package. `terminal_send.run_in_background` registers `pty-send` via composition `ShellService.startManagedJob`, collected or cancelled with `job_output` / `job_kill`.

## Scrollback truncation · pagination · memory caps

| Knob | Default | Role |
|------|---------|------|
| `scrollbackMaxBytes` | 4 MiB | Hard UTF-8 byte ceiling for retained history (chunked ring keeps the tail; eviction is amortized on append; oversized writes are split on UTF-16-safe boundaries so one giant chunk cannot pin a multi-MiB string) |
| `scrollbackLines` | 10_000 | Line ceiling (with the byte cap) |
| `maxReadBytes` | 256 KiB | Cap for one `terminal_read` / settled send (≤ `scrollbackMaxBytes`) |

`terminal_read` pages **newest-relative** lines: `offset` (default 0) + `count` (default 500); results include `[lines: begin-end of total]` and `[output truncated]` when scrollback or the page was clipped. Model-facing render applies a further `maxResultBytes` tail retain (same retention idea as DSH output-retention). Oversized history is **not** spilled whole into the session; write a workspace file and `read_file` when the full body is needed.

## Native

This repo pins `node-pty@1.2.0-beta.15` in `optionalDependencies` (includes `prebuilds/`); `postinstall` runs `scripts/ensure-spawn-helper.mjs` to restore Linux/mac `spawn-helper` execute bits.

When the network is restricted, configure npm/Git proxy **on the machine**; do not commit fixed ports or paths into docs or tests.

## Env scrub

`scrubbedParentEnv` / `childEnv`: drop credential-shaped names (`KEY|PASSWORD|SECRET|TOKEN`) and ambient `XRK_*`; explicit overrides (`XRK_SHELL` · `XRK_PTY_SESSION_ID` · optional `XRK_SESSION_ID`) merge after scrub. On Host `exit`, live handles call `terminateForHostExit` (sync best-effort tree kill).

## Readiness and inspector

`terminal_send` submits Enter by default and waits for one of:

| `waitReason` | Meaning |
|--------------|------|
| `stdin_read` | OSC prompt or stdin wait (Linux `/proc` · macOS `ps` tpgid) |
| `inferred_idle` | Output silence |
| `timeout` | Hit `timeoutMs` (default 30s) |
| `session_exit` | Shell exited |

Foreground probe uses the process-inspector in `@xrkseek/exec-pty`.

| Platform | Behavior |
|----------|----------|
| **Linux** | `/proc`: tid-scoped fdinfo · multi-ABI syscall tables · TTY-filtered stdin-wait so pipeline members do not false-settle |
| **macOS** | `/bin/ps`; one readiness/teardown poll shares a **`ProcessSnapshot`** (at most one table read) so cost does not grow with descendant count; `isAlive` still reads current state for the signal fence |
| **Windows** | **no-op inspector** (`inspectForeground` → `undefined`); readiness relies on OSC prompt / silence / timeout — `useConpty: true` hides ConPTY console flashes; sessions still run; the product does not pretend `/proc` exists |

`processTree` / `processSession` are convenience wrappers over `snapshot()`; prefer `snapshot()` when asking several questions in one poll.

Terminate: descendant SIGTERM→grace→SIGKILL, then kill the shell; rejects `SIGKILL` on the shell itself (use `terminal_close`).

`run_in_background`: returns `started background job pty-send-N`, `meta: { kind: "background", jobId }`; registered via `startManagedJob({ outputLimitBytes: maxResultBytes })`. Visible on Face `session/jobs`; `job_output` consumes the `readOutput` cursor (optional `wait: true`); `job_kill` calls `operation.cancel()`. `terminal_open` writes the composition session id into child env `XRK_SESSION_ID`.

## Paths / sandbox

`cwd` must stay under `workspaceRoot`. Under harness `workspace-write`, spawn argv goes through `SandboxService.confine` (cancellable). `read-only` rejects `terminal_open/send/signal/close` (list/read still OK).

With open / pending **Agent** `terminal_*` PTYs, `/permission` refuses changes to `sandbox/mode` (same copy as the terminal bash fence). Sidebar user terminals (`/sidebar/ws/terminal`) run with system-user permissions, **without** Agent sandbox confine, and **do not** participate in that fence.

## Card replay

Cold history uses `presentCall` from the Host standing tool table. Foreground `terminal_send`: `card: "terminal"`; `meta` feeds Face presentation replay. Face does not invent cards by tool name.

Related: [seams.md](./seams.md) · [profiles.md](./profiles.md) · [shell-jobs.md](./shell-jobs.md)
