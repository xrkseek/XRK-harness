# @xrkseek/exec-subprocess

Local `SubprocessService`:

- `spawn(argv)` — await exit (stdout/stderr/code; AbortSignal + timeout)  
- `start(argv)` → `SubprocessHandle` (`kill` · `result()`)

Consumer: `@xrkseek/exec-shell`. See `docs/seams.md` · `docs/shell-jobs.md`.
