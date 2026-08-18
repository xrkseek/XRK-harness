# @xrkseek/exec-pty

Persistent PTY capability seam + six model-facing terminal tools.

- **Definition**: `TerminalSessionService` — spawn / send / read / signal / kill / list / `hasActivity`
- **Provider**: `node-pty@1.2.0-beta.15` (optional NAPI prebuilds) + bash backend (`TERM=dumb`, `name: "dumb"`, OSC `133;D;`, prompt `xrk> `) + scrubbed child env + process inspector (Linux/macOS; Windows no-op) + host-exit `terminateForHostExit`
- **Consumer**: `createPtyTools` — `terminal_open/send/read/signal/close/list` (`terminal_send` writes presentation `meta`; `run_in_background` → composition `pty-send` jobs)

One composition, one registry (no Cordis Agent owner). Tools stay registered when `node-pty` is missing; `terminal_open` returns `isError`. Background sends need a jobs bridge (`ShellService.startManagedJob`); harness wires it by default.

See [docs/pty-tools.md](../../../docs/pty-tools.md) · [docs/seams.md](../../../docs/seams.md).
