# `@xrkseek/exec-environment`

Pluggable **execution world** providers (Hermes-style terminal environments).

- **Definition**: `ExecEnvironmentProvider` → `ExecWorld` (`fs` + `subprocess`)
- **Providers**: `local` (default) · `http` (serverless sample sidecar)
- **Not**: `SandboxService.confine` / `createSandboxStack` docker·bwrap·windows

Select via `resolveExecEnvironment` / `XRK_EXEC_ENVIRONMENT=local|http` (+ `XRK_EXEC_ENVIRONMENT_URL`).

SSH stays `createSshExecutionWorld` on Host `remoteExecution` — same *shape*, separate dial.

HTTP sample contract:

| Method | Path | Body / result |
|--------|------|----------------|
| `GET` | `/health` | `{ ok: true }` |
| `POST` | `/v1/exec` | `{ argv, cwd?, env?, timeoutMs? }` → `{ stdout, stderr, exitCode, … }` |
| `POST` | `/v1/fs` | `{ op, path, … }` → op-specific JSON |

See [docs/sandbox.md](../../../docs/sandbox.md) · [docs/seams.md](../../../docs/seams.md).
