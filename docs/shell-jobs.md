# Shell background jobs

In-process job registry on `@xrkseek/exec-shell` over `SubprocessService.start`.

## API

```ts
const shell = createLocalShell({ subprocess: createLocalSubprocess() });

const { id } = await shell.startJob("long-running…");
await shell.listJobs(); // [{ id, status: "running"|"exited"|"killed"|"failed", command, … }]
await shell.killJob(id); // no-op if already finished; throws if unknown id
```

`run()` stays foreground (await exit). Jobs are retained up to `maxJobs` (default 64); finished entries prune first when over cap.

## Tools (`createBashTools`)

| Tool | Role |
|------|------|
| `bash` | `command` + optional `background: true` → start job, return id. Foreground 模型文本对齐 DSH：`[stderr]` 段 + 非零 `[exit code: N]`（不是 `isError`） |
| `bash_jobs` | list jobs |
| `bash_kill` | kill by id |

## Subprocess seam

`SubprocessService.start(argv) → SubprocessHandle` (`kill` · `result()`).  
`spawn` = `start(…).result()`.

## Limits

- No durable / cross-process job store  
- No PTY / interactive attach  
- Windows: tree-kill is best-effort (`child.kill`); nested shells may orphan

See [seams.md](./seams.md).
