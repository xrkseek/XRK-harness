# 定时任务（Cron）

> **读者**：集成者 · 贡献者

`@xrkseek/server-cron`：Host 进程内调度器。支持无人值守开新回合（agent）、仅脚本（script）、结果回投（webhook / 文件）。对标 Hermes cron 的「工具 + ticker」形态，不是 OS crontab。

## 启用

**产品路径**：Settings → Plugins → **Cron**（Face ns `cron`：`enabled` 开/关）。保存后 Host 热启停 ticker，并 `invalidateAgents` 以挂/卸 `cronjob` 工具。非空 `XRK_CRON` 为 CI 旁路（`0` 强制关，其它强制开）。

Host spawn 时默认启动 ticker（`~/.xrk/cron/jobs.json`），除非 Settings 关闭或 env 旁路。

模型工具 `cronjob`（action：`create` · `list` · `pause` · `resume` · `run` · `remove` · `runs`）在 Host 注入 scheduler 时登记。`runs` 读有界执行账本（`~/.xrk/cron/executions.jsonl`，≤1000，Hermes ledger 子集）。Cron 自己开的 agent 回合**不**再挂 `cronjob`，避免递归调度。

## 调度

| `schedule_kind` | 含义 |
|-----------------|------|
| `every` | 固定间隔秒数（≥60） |
| `at` | ISO-8601 一次性；触发后自动 disable |
| `cron` | 五段 UTC：`分 时 日 月 周` |

## 运行

| `run_kind` | 行为 |
|------------|------|
| `agent` | 新建 session，`continueTurn` 注入 prompt，结果文本可回投。回合结束后释放该 session 的 Agent 组合缓存（不常驻堆） |
| `script` | Host shell 执行 `command`（捕获 stdout/stderr） |

## 回投

| `delivery_kind` | 行为 |
|-----------------|------|
| `none` | 只写 jobs.json 的 lastStatus |
| `webhook` | POST JSON（`hookEventName: cron/result`）；可选 `secret_env` HMAC |
| `file` | 追加 JSONL（相对路径相对 workspace） |

## Env

| 变量 | 含义 |
|------|------|
| `XRK_CRON` | CI 旁路 Settings：`0` 强制关 · 非空其它值强制开 — 产品路径用 Settings → Plugins → Cron |
| `XRK_TIME_CONTEXT_REFRESH_MS` | Follow-up 时间注入间隔（毫秒）。未设默认 `60000`；`0`=每步；`off`/负数=关闭 |

---

# Scheduled tasks (Cron)

> **Audience**: Integrators · Contributors

`@xrkseek/server-cron` is an in-process Host scheduler for unattended agent turns, script-only jobs, and result delivery (webhook / file). Hermes-style tool + ticker — not OS crontab.

## Enable

**Product path**: Settings → Plugins → **Cron** (Face ns `cron`: `enabled` on/off). After save, Host hot-starts/stops the ticker and `invalidateAgents` to mount/unmount the `cronjob` tool. Non-empty `XRK_CRON` is the CI bypass (`0` force off, any other force on).

Host spawn starts the ticker by default (`~/.xrk/cron/jobs.json`) unless Settings disables it or env bypasses.

The model tool `cronjob` (actions: `create` · `list` · `pause` · `resume` · `run` · `remove` · `runs`) registers when the Host injects the scheduler. `runs` reads the bounded execution ledger (`~/.xrk/cron/executions.jsonl`, ≤1000 — Hermes ledger subset). Agent turns opened by cron do **not** mount `cronjob`, to avoid recursive scheduling.

## Schedule

| `schedule_kind` | Meaning |
|-----------------|------|
| `every` | Fixed interval in seconds (≥60) |
| `at` | ISO-8601 one-shot; auto-disables after fire |
| `cron` | Five-field UTC: `min hour dom mon dow` |

## Run

| `run_kind` | Behavior |
|------------|------|
| `agent` | New session, `continueTurn` with prompt; text may be delivered. Agent composition for that session is released after the turn (not retained on the heap) |
| `script` | Host shell runs `command` (captures stdout/stderr) |

## Delivery

| `delivery_kind` | Behavior |
|-----------------|------|
| `none` | Only updates lastStatus in jobs.json |
| `webhook` | POST JSON (`hookEventName: cron/result`); optional `secret_env` HMAC |
| `file` | Append JSONL (relative paths vs workspace) |

## Env

| Variable | Meaning |
|------|------|
| `XRK_CRON` | CI bypass over Settings: `0` force off · any other non-empty force on — product path: Settings → Plugins → Cron |
| `XRK_TIME_CONTEXT_REFRESH_MS` | Follow-up time injection interval (ms). Unset defaults to `60000`; `0` = every step; `off` / negative = off |
