# 定时任务（Cron）

> **读者**：集成者 · 贡献者

`@xrkseek/server-cron`：Host 进程内调度器。支持无人值守开新回合（agent）、仅脚本（script）、结果回投（webhook / 文件）。对标 Hermes cron 的「工具 + ticker」形态，不是 OS crontab。

## 启用

Host spawn 时默认启动 ticker（`~/.xrk/cron/jobs.json`）。`XRK_CRON=0` 关闭。

模型工具 `cronjob`（action：`create` · `list` · `pause` · `resume` · `run` · `remove`）在 Host 注入 scheduler 时登记。Cron 自己开的 agent 回合**不**再挂 `cronjob`，避免递归调度。

## 调度

| `schedule_kind` | 含义 |
|-----------------|------|
| `every` | 固定间隔秒数（≥60） |
| `at` | ISO-8601 一次性；触发后自动 disable |
| `cron` | 五段 UTC：`分 时 日 月 周` |

## 运行

| `run_kind` | 行为 |
|------------|------|
| `agent` | 新建 session，`continueTurn` 注入 prompt，结果文本可回投 |
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
| `XRK_CRON` | `0` 关闭 Host ticker |
| （无） | 默认开启 |

---

# Scheduled tasks (Cron)

> **Audience**: Integrators · Contributors

`@xrkseek/server-cron` is an in-process Host scheduler for unattended agent turns, script-only jobs, and result delivery (webhook / file). Hermes-style tool + ticker — not OS crontab.

## Enable

Host spawn starts the ticker by default (`~/.xrk/cron/jobs.json`). Set `XRK_CRON=0` to disable.

The model tool `cronjob` (actions: `create` · `list` · `pause` · `resume` · `run` · `remove`) registers when the Host injects the scheduler. Agent turns opened by cron do **not** mount `cronjob`, to avoid recursive scheduling.

## Schedule

| `schedule_kind` | Meaning |
|-----------------|------|
| `every` | Fixed interval in seconds (≥60) |
| `at` | ISO-8601 one-shot; auto-disables after fire |
| `cron` | Five-field UTC: `min hour dom mon dow` |

## Run

| `run_kind` | Behavior |
|------------|------|
| `agent` | New session, `continueTurn` with prompt; text may be delivered |
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
| `XRK_CRON` | `0` disables the Host ticker |
| (unset) | Enabled by default |
