# @xrkseek/code-runtime

Experimental Code Mode: `run_code`.

**Default off.** Enable with `--presentation code` or an experimental preset.

## Paths

| Bridge | Runner | Nested tools |
| --- | --- | --- |
| Yes (`createRegistryCodeToolBridge`) | In-process AsyncFunction + `tools` Proxy | `await tools.name(args)` → live pipeline |
| No | Worker thread (or SSH `CodeRuntime`) | Snippet only |

Bounds (overridable on `createWorkerCodeRuntime` / `runCodeWithTools`):

| Cap | Default |
| --- | --- |
| `timeoutMs` / `maxTimeoutMs` | 120s / 600s (per-call `timeoutMs` clamped) |
| `maxOutputBytes` | 64MiB UTF-8 |
| `maxOldGenerationSizeMb` | 512 (Worker `resourceLimits`; unused while bridged) |
