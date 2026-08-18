# @xrkseek/exec-shell

`ShellService` over `@xrkseek/exec-subprocess` (bash / cmd / pwsh).

- `run` — foreground
- `startJob` / `startManagedJob` / `listJobs` / `killJob` / `readJobOutput` / `waitJob` / `dispose` — in-process jobs（`stopping` · `reported` · per-owner 并发）
- `createSessionScopedShell` — Host 共享 root 时按 `sessionId` 隔离（CV DSH owner fence）
- `createBashTools` → `bash` · `bash_jobs` · `job_list` · `job_output` · `bash_kill` · `job_kill`
- `JOBS_PROMPT_TEXT` — harness `tool:jobs` section

See `docs/shell-jobs.md` · `docs/seams.md`.
