# @xrkseek/exec-subprocess

Local `SubprocessService`:

- `spawn(argv)` — await exit (stdout/stderr/code; AbortSignal + timeout)  
- `start(argv)` → `SubprocessHandle` (`kill` · `result()`; **no** `pid`)
- Windows: non-terminal children use `windowsHide`; stop uses `taskkill /T /F` (hidden helper)
- Terminal processes keep `pid` on `@xrkseek/exec-pty` `SubprocessTerminalHandle`

Consumer: `@xrkseek/exec-shell`. See `docs/seams.md` · `docs/shell-jobs.md`.
