# Shell 后台任务

> **读者**：集成者 · 贡献者

进程内 job registry，基于 `@xrkseek/exec-shell` 与 `SubprocessService.start`，并支持托管 producer。

## API

```ts
const shell = createLocalShell({
  subprocess: createLocalSubprocess(),
  maxConcurrentJobs: 10, // running + stopping；默认 10
});

const { id } = await shell.startJob("long-running…"); // kind=bash, id=bash-N
shell.startManagedJob({
  kind: "pty-send",
  label: "pty-1: ls",
  outputLimitBytes: 32_768,
  run: () => ({
    cancel(reason) {},
    done: Promise.resolve({ status: "completed", detail: "wait: stdin_read" }),
    readOutput: () => "chunk",
  }),
}); // id=pty-send-1

await shell.listJobs();
shell.readJobOutput(id); // terminal read → reported
await shell.waitJob(id, 30_000); // 等到终态；超时不杀、不置 reported
await shell.killJob(id); // → stopping + reported，再由 producer settle
await shell.dispose(); // teardown cancel 全量 → reported，清空
```

Host（harness/server）共享一份 root registry；composition 用 `createSessionScopedShell(root, sessionId)` 盖 owner fence（list / kill / read / wait）。`maxConcurrentJobs` 按 **owner 桶**计数。Wire `JobView` **不含** `ownerSessionId` / `reported` / `outputLimitBytes`。

### `reported` / `statusLine` / `outputLimitBytes` / 并发

| 位 | 行为 |
|----|------|
| `reported` | 终态读、等到 settle 的 `wait`、`kill`、`dispose` teardown 置位；有 live waiter 时 settle **先**置位再 `onJobsChanged` |
| `statusLine` | `[status: completed, wait: stdin_read]`（detail 进 trailer） |
| `outputLimitBytes` | producer 可选正整数；`job_output` / Face notice 按 UTF-8 裁 |
| `maxConcurrentJobs` | 默认 10；**按 owner 桶**拒绝超额 `start` |

## Tools（`createBashTools`）

| Tool | Role |
|------|------|
| `bash` | `command` + optional `background: true` → `bash-N`。Foreground：`[stderr]` + 非零 `[exit code: N]`（不是 `isError`） |
| `job_list` | list（含 `pty-send`）：`id [kind] status — label` |
| `job_output` | 末行 `statusLine`；`wait: true` 等到终态或超时 |
| `job_kill` | cancel → `stopping`；已终态则 `already finished` + `statusLine` |

模型面只用 `job_*` 工具。

Harness 登记 `tool:fs-routing` · `tool:shell-routing` · `tool:jobs` 系统提示；composition `dispose()` 调 `shell.dispose()`。

## Completion notice（Face）

| 状态 | 行为 |
|------|------|
| idle 且 wake 预算未用尽（默认 3） | admit + `drain.wake` |
| busy | admit + `drain.wake` |
| idle 且预算用尽 | 只 admit |
| `reported === true`（或 bind 时已 settled） | 跳过 |

文案 `formatJobCompletionNotice`；有 `outputLimitBytes` 时预留 id 前缀与收集指令。

## Limits

- 无 durable / 跨进程 job store  
- `bash` jobs 是管道，不是 PTY → [pty-tools.md](./pty-tools.md)  
- Windows：tree-kill 尽力而为  

参见 [seams.md](./seams.md)。

---

# Shell Background Jobs

> **Audience**: Integrators · Contributors

In-process job registry on `@xrkseek/exec-shell` over `SubprocessService.start`, with managed producers.

## API

```ts
const shell = createLocalShell({
  subprocess: createLocalSubprocess(),
  maxConcurrentJobs: 10, // running + stopping; default 10
});

const { id } = await shell.startJob("long-running…"); // kind=bash, id=bash-N
shell.startManagedJob({
  kind: "pty-send",
  label: "pty-1: ls",
  outputLimitBytes: 32_768,
  run: () => ({
    cancel(reason) {},
    done: Promise.resolve({ status: "completed", detail: "wait: stdin_read" }),
    readOutput: () => "chunk",
  }),
}); // id=pty-send-1

await shell.listJobs();
shell.readJobOutput(id); // terminal read → reported
await shell.waitJob(id, 30_000); // wait for terminal state; timeout does not kill or set reported
await shell.killJob(id); // → stopping + reported, then producer settles
await shell.dispose(); // teardown cancel all → reported, clear
```

Host (harness/server) shares one root registry; compositions use `createSessionScopedShell(root, sessionId)` for an owner fence (list / kill / read / wait). `maxConcurrentJobs` counts **per owner bucket**. Wire `JobView` **omits** `ownerSessionId` / `reported` / `outputLimitBytes`.

### `reported` / `statusLine` / `outputLimitBytes` / concurrency

| Field | Behavior |
|----|------|
| `reported` | Set on terminal read, settled `wait`, `kill`, `dispose` teardown; when a live waiter exists, settle sets it **before** `onJobsChanged` |
| `statusLine` | `[status: completed, wait: stdin_read]` (detail in trailer) |
| `outputLimitBytes` | Optional positive integer from producer; `job_output` / Face notice truncates by UTF-8 |
| `maxConcurrentJobs` | Default 10; reject excess `start` **per owner bucket** |

## Tools (`createBashTools`)

| Tool | Role |
|------|------|
| `bash` | `command` + optional `background: true` → `bash-N`. Foreground: `[stderr]` + non-zero `[exit code: N]` (not `isError`) |
| `job_list` | list (includes `pty-send`): `id [kind] status — label` |
| `job_output` | Last line `statusLine`; `wait: true` waits for terminal or timeout |
| `job_kill` | cancel → `stopping`; already terminal → `already finished` + `statusLine` |

Model-facing surface uses only `job_*` tools.

Harness registers `tool:fs-routing` · `tool:shell-routing` · `tool:jobs` system prompts; composition `dispose()` calls `shell.dispose()`.

## Completion notice (Face)

| State | Behavior |
|------|------|
| idle and wake budget remaining (default 3) | admit + `drain.wake` |
| busy | admit + `drain.wake` |
| idle and budget exhausted | admit only |
| `reported === true` (or already settled at bind) | skip |

Copy via `formatJobCompletionNotice`; with `outputLimitBytes`, reserve id prefix and collect instructions.

## Limits

- No durable / cross-process job store  
- `bash` jobs are pipes, not a PTY → [pty-tools.md](./pty-tools.md)  
- Windows: tree-kill is best-effort  

See [seams.md](./seams.md).
