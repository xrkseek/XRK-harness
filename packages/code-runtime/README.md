# @xrkseek/code-runtime

Experimental Code Mode: `run_code` via worker_threads.

**Default off.** Enable only with `--presentation code` or an experimental preset.

Bounds (overridable on `createWorkerCodeRuntime`):

| Cap | Default |
| --- | --- |
| `timeoutMs` / `maxTimeoutMs` | 120s / 600s (per-call `timeoutMs` clamped) |
| `maxOutputBytes` | 64MiB UTF-8 |
| `maxOldGenerationSizeMb` | 512 (Worker `resourceLimits`) |
