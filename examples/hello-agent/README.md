# hello-agent

Minimal end-to-end demo using the **minimal** preset (replay LLM, no API key).

## Prerequisites

From the monorepo root:

```bash
pnpm install
pnpm check
```

`pnpm check` builds `apps/cli` via `tsc -b`.

## Run one turn

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

Or after linking / from package:

```bash
pnpm exec xrk-harness run --preset minimal --prompt "ping"
```

Expected stdout roughly:

```text
hello from minimal preset (replay). Tools: read_file, write_file, apply_edit, glob, grep.
```

## Other commands

```bash
node apps/cli/dist/bin.js --help
node apps/cli/dist/bin.js doctor --workspace .
node apps/cli/dist/bin.js dump-config --preset minimal --patch "{\"debug\":true}"
```

Dump session JSONL to stderr:

```bash
# PowerShell
$env:XRK_DUMP_SESSION=1; node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```
