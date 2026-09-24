# @xrkseek/exec-ssh

POSIX SSH providers for a **local Host / remote execution world** (Hermes-style thin transport; DSH-shaped seams).

When Settings General → Remote (`ssh-remote`) or `XRK_SSH_HOST` + `XRK_SSH_WORKSPACE` are set (env host non-empty bypasses Settings), Host/CLI swap `FsService` + `SubprocessService` (and optional `run_code`) onto OpenSSH. Model tools stay `read_file` / `bash` / `run_code` — no `ssh_*` tools. Face `host.listDirectory` / `host.createDirectory` use the same session (`listSshDirectory` / `createSshDirectory`). Interactive PTY and host-local `openPath` / OS folder picker are off (`host.describe.remoteExecution`). Settings changes need a Host restart.

| Env | Meaning |
| --- | --- |
| `XRK_SSH_HOST` | OpenSSH host or `user@host` alias (required with workspace) |
| `XRK_SSH_WORKSPACE` | Absolute remote cwd (required) |
| `XRK_SSH_USER` | Optional user when host is bare |
| `XRK_SSH_PORT` | Optional port (default OpenSSH) |
| `XRK_SSH_KEY` | Optional identity file |
| `XRK_SSH_NODE` | Remote Node for `run_code` (default `node`) |

See `docs/seams.md` · `docs/configuration.md`.
