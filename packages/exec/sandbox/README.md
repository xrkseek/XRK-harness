# @xrkseek/exec-sandbox

`SandboxService.wrapArgv` (sync) · `confine(argv, cwd?, signal?)` (cancellable async).

Providers (same Definition):

| Provider | Role |
|----------|------|
| Permissive · Workspace · DenyList | Default Host stack |
| **Docker** | `docker run --rm` + workspace bind mount (`XRK_SANDBOX_BACKEND=docker`) |
| **bubblewrap** | Linux `bwrap` (`XRK_SANDBOX_BACKEND=bwrap`) |

`createSandboxStack` builds the chain from options / env. `createSandboxWrapGuard` plugs into tool pipeline guards. Shell / PTY spawn paths prefer `confine`.

See [docs/sandbox.md](../../../docs/sandbox.md) · [docs/seams.md](../../../docs/seams.md).
