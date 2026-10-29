---
name: xrk-product-home
description: >-
  Map of product home `{XRK_HOME}` (~/.xrk) vs workspace `.xrk`: sessions,
  spill, attachments, canvases, skills, settings, credentials, agent-homes.
  Use when finding Harness data on disk, 「.xrk 在哪」「XRK_HOME」「家目录」
  「spill」「找会话文件」, or before shelling under the product home.
---

# Product home (`{XRK_HOME}`)

| Root | Meaning |
|------|---------|
| **Product home** | Machine-wide Harness data. Resolve: inject **`## Product home`** (absolute path) → else env `XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME` → else **`~/.xrk`**. |
| **`{workspace}/.xrk`** | Optional project overlays (persona / skills / recipes). Not auto-created. Industry AGENTS/rules/context → `{workspace}/.agents/`. |

Trust inject over guessing env or drive letters.

## Map + how to touch

Paths under product home. Prefer the listed tool; do not archaeology SQLite / hand-write managed trees.

| Path | Role | Access |
|------|------|--------|
| `AGENTS.md` · `SOUL.md` | Seeded standing (fingerprint) | Read; custom voice → workspace `.xrk/SOUL.md` |
| `skills/<name>/` | Seeds + user installs | `skill` / catalog; seed-named dirs refresh on establish |
| `recipes/*.yaml` | Slash `/id` | `/id` or matching skill |
| `sessions/` | Session DB | `session_search` · `inspect` · `read` — **keep** DB |
| `session-threads/` | 主线 pins | `thread_*` → `xrk-thread-pin` |
| `agent-homes/` · `agent-rosters/` | 干员家 / roster | `team_*` / `subagent` → `xrk-delegate` |
| `canvases/<wsId>/` | Canvas docs | `canvas_*` → `xrk-canvas` |
| `attachments/v1/` | Content-addressed | id + tools → `xrk-attachment` |
| `spill/` · `tmp/` · `logs/` · `cache/` | Overflow / temp / rebuildable | Read tool-given paths; OK to clear when reclaiming |
| `checkpoints/` | Workspace shadows | Ask before delete |
| `settings.yaml` · `host-settings.json` | Face / MCP desired | `settings_*` → `xrk-capability-attach` |
| `.credentials.yaml` · `mcp-tokens/` | Secrets | Never into chat; Credentials / product APIs |
| `workspaces.json` · `session-models.json` | Sidebar / model picks | UI / product tools |
| `plugins/` | Process plugins | `xrkh plugin` · `xrk-plugin-verify` |
| `cron/` | Cron jobs + runs | Settings → Plugins → Cron |
| `memories/` | Curated memory | `memory` when bound — not cache |
| `xiangyang-workspace/` | Xiangyang tree | Orch only; coding seats rarely need it |

## Reclaim

Inventory size first → clear `spill/` · `tmp/` · `cache/` · `logs/` → **ask** before `attachments/` · `canvases/` · `checkpoints/`. Never wipe product home, `sessions.db`, credentials, or memory bodies to “save space”.
