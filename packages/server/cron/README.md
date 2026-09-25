# @xrkseek/server-cron

Host scheduled tasks (Hermes-inspired): unattended agent turns, script-only jobs, result delivery.

- **Store**: `{productHome}/cron/jobs.json`
- **Run ledger**: `{productHome}/cron/executions.jsonl` (≤1000)
- **Schedules**: `every` (≥60s) · `at` (ISO one-shot) · `cron` (5-field UTC)
- **Runs**: `agent` (injectable runner; composition released after the turn) · `script` (shell spawn)
- **Delivery**: `none` · `webhook` POST · `file` append
- **Tool**: `cronjob` (create / list / pause / resume / run / remove / **runs**)

Disable via Settings → Plugins → **Cron**, or CI env `XRK_CRON=0`. See [docs/cron.md](../../../docs/cron.md).
