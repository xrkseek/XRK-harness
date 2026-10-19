---
name: xrk-delegate
description: >-
  When and how to spawn subagents without wasting tokens. Use when the user asks
  to parallelize, spawn agents, 「开子代理」「并行」「delegate」「fan out」, or
  after Frugal/Shallow badge questions about subagents.
---

# 委派子代理

Each child = a full model session (default: same workspace). Prefer doing it yourself. Spawn only when the task is independent or would pollute this context.

```
- [ ] 1. Badge: Frugal/minimal/shell = no spawn (Skill-load); Shallow depth≤1; Harness nests
- [ ] 2. team_list / subagent catalog → member_id; else role
- [ ] 3. Standalone prompt (paths · acceptance · constraints); short description. Do not re-paste playbook
- [ ] 4. Shape: default continuable (omit run_in_background). One-shot only when the user asked to wait: run_in_background:false (10 min salvage)
- [ ] 5. inherit_context:true only for completed parent turns; child identity ≠ AGENTS.md
- [ ] 6. Background: followup_task · send_message · wait_agent · interrupt_agent · list_agents. Caps: child_gap / omitted on capability — never assign stripped tools
- [ ] 7. Concurrency: ≤2 live, depth ≤2 (hard 3) — Settings → Plugins → Agent loop
```

## When

| Do | Don't |
|----|-------|
| Independent research / scoped impl | "Continue earlier work" without inherit_context |
| Read-only review (`xrk-code-review`) | One-step edits |
| Parallel independent slices | Empty progress spawns |
| Continuable companion (default) | one-shot (`false`) expecting later human chat |

## Shape

| Intent | Call |
|--------|------|
| Default / long / chat | omit or `run_in_background:true` → `followup_task` / `send_message` / `close_agent` |
| Wait in this turn | `run_in_background:false` (one-shot; 10 min salvage) |
| Continue parent turns | `inherit_context:true` (completed turns only) |
| Isolated git | `worktree:true` (another checkout of the same repo) |
| Specialist | Prefer `member_id` (tools + inject + playbook); else role worker/researcher/reviewer/lead |
| Reusable roster | Parent `team_save` (scope global|workspace) |

Face prefixes parent/child id · mode · role · cwd. Put the task in `prompt`. Model inherits parent unless `provider`/`model` pinned. Hit depth/active caps → finish or `interrupt_agent` first.

Tool `description` + capability win. Badge table: [docs/profiles.md](../../../docs/profiles.md).
