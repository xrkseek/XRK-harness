# Shell background jobs

In-process job registry on `@xrkseek/exec-shell` over `SubprocessService.start`，并支持托管 producer（CV DSH `jobs.start` / `jobs-local`）。

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

Host（harness/server）共享一份 root registry；composition 用 `createSessionScopedShell(root, sessionId)` 盖 owner fence（list / kill / read / wait）。`maxConcurrentJobs` 按 **owner 桶**计数（与 DSH `maxConcurrentJobsPerOwner` 同语义）。Wire `JobView` **不含** `ownerSessionId` / `reported` / `outputLimitBytes`。

### `reported` / `statusLine` / `outputLimitBytes` / 并发

| 位 | 行为 |
|----|------|
| `reported` | 终态读、等到 settle 的 `wait`、`kill`、`dispose` teardown 置位；有 live waiter 时 settle **先**置位再 `onJobsChanged` |
| `statusLine` | `[status: completed, wait: stdin_read]`（detail 进 trailer） |
| `outputLimitBytes` | producer 可选正整数；`job_output` / Face notice 按 UTF-8 裁 |
| `maxConcurrentJobs` | 默认 10；**按 owner 桶**拒绝超额 `start` |

## Tools (`createBashTools`)

| Tool | Role |
|------|------|
| `bash` | `command` + optional `background: true` → `bash-N`。Foreground：`[stderr]` + 非零 `[exit code: N]`（不是 `isError`） |
| `bash_jobs` | list（含 `pty-send`）：本仓历史名 |
| `job_list` | DSH 名：`id [kind] status — label` |
| `job_output` | 末行 `statusLine`；`wait: true` 等到终态或超时 |
| `bash_kill` / `job_kill` | cancel → `stopping`；已终态则 `already finished` + `statusLine` |

Harness 登记 `tool:jobs` 系统提示；composition `dispose()` 调 `shell.dispose()`。

## Completion notice（Face）

| 状态 | 行为 |
|------|------|
| idle 且 wake 预算未用尽（默认 3） | admit + `drain.wake` |
| busy | admit + `drain.wake` |
| idle 且预算用尽 | 只 admit |
| `reported === true`（或 bind 时已 settled） | 跳过 |

文案 `formatJobCompletionNotice`（CV DSH `fitCompletionNotice`）；有 `outputLimitBytes` 时预留 id 前缀与收集指令。

## Limits

- No durable / cross-process job store  
- `bash` jobs are pipes, not a PTY → [pty-tools.md](./pty-tools.md)  
- Windows: tree-kill is best-effort  

See [seams.md](./seams.md).
