# @xrkseek/server-cron

Host scheduled tasks (Hermes-inspired): unattended agent turns, script-only jobs, result delivery.

- **Store**: `{productHome}/cron/jobs.json`
- **Schedules**: `every` (≥60s) · `at` (ISO one-shot) · `cron` (5-field UTC)
- **Runs**: `agent` (injectable runner) · `script` (shell spawn)
- **Delivery**: `none` · `webhook` POST · `file` append
- **Tool**: `cronjob` (create / list / pause / resume / run / remove)

Disable with `XRK_CRON=0`. See [docs/cron.md](../../../docs/cron.md).
