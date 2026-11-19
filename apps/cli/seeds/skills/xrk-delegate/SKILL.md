---
name: xrk-delegate
description: >-
  Manager-kind parents only (coding / 向阳 / IM): spawn, team_save/import/ready,
  team_home. Not for agent-kind identity seats or delegated children — they
  follow playbook + <seat_identity>. Triggers: 开子代理 / 并行 / Team / 建干员 /
  开家 / Frugal·Shallow subagent questions.
---

# 委派子代理

Each child = a full model session. Prefer doing it yourself.

**Load here:** manager-kind parent. **Skip:** agent-kind seat / subagent (playbook + `<seat_identity>` `report`/`ui`/`lane`).

**Parity:** `team_*` = Team UI. Settings → `xrk-capability-attach`. Habits → `xrk-create-skill`.

## Two kinds · two dispatch faces

Names follow Settings titles (`<seat_identity>`). Do not invent seat words.

| Face | When | Call | cwd |
|------|------|------|-----|
| Agent-kind home | Specialty / human speaks | `team_home` → `workspace_session_prompt` | agent-home |
| Manager-kind spawn | Parallel slice in coding lead seat | `subagent member_id=` (ready) | **parent manager-kind** |

Roster member ≠ agent-kind home. `team_save` / import / `team_ready` do **not** mint homes — only `team_home` / UI.

Children: **no** `workspace_*` / TTS·ASR — parent opens peers. Tool map → `xrk-tool-surfaces`.

```
- [ ] 1. Badge: Frugal/minimal/shell = no spawn; Shallow depth≤1; Harness nests
- [ ] 2. Prefer team_list → member_id; else role
- [ ] 3. Standalone prompt (paths · acceptance); do not re-paste playbook
- [ ] 4. Default continuable; one-shot only if user asked to wait
- [ ] 5. Caps: ≤2 live, depth ≤2 — Settings → Plugins → Agent loop
```

## Roster ecology (manager-kind parents)

| Type | Has | Spawn cwd |
|------|-----|-----------|
| **thin** | name + playbook（+ inject/tools） | parent workspace |
| **advanced** | playbook.md · **公文包**（`workspace/` · `skills/` · `env/SETUP.md`） | parent + briefcase inject |

| Intent | Call |
|--------|------|
| Mint thin / advanced | `team_save`（高级 + skills/files/env_prep） |
| Open agent-kind home / human speak | reuse mem_ → `team_home` → prompt（禁无故再 mint advanced） |
| Import | `team_import` → envPrep → `team_ready` → need home → `team_home` |
| Revise / export / remove | `team_save id=` / `team_export` / `team_remove` |
| Parallel inside manager-kind | `subagent member_id=`（须 ready） |

```
- [ ] Playbook = repeatable flow you wrote — not auto-trained from chat
- [ ] Advanced only has 公文包; thin does not
- [ ] Advanced playbook must name briefcase contents
- [ ] Do not use propose_skill as a roster member
```

## Playbook (parent template)

**Authority:** playbook header + `<seat_identity>`. Do not paste parent `XRK.md` into children. Disk map → **`xrk-product-home`**.

**Thin：**

```text

# Role
…
# Steps
…
# Constraints
…
# Acceptance
…
```

**Advanced — 同上 + 公文包 (briefcase) 说明（主会话必须知情）：**

```text
# 公文包 (briefcase)
- materials (workspace/): …
- skills: <id>（references/：…）
- env/SETUP.md: …
# Role / Steps / Constraints / Acceptance
…
```

| 参数 | 用途 |
|------|------|
| `skills` | → `skills/<id>/`（整树含 references/） |
| `files` | → `workspace/`（公文包材料，**不是**会话工作区） |
| `env_prep` | → `env/SETUP.md`（GitHub 链接、安装说明等；从不自动执行） |

派生后：cwd = 父工作区；turn-start / preamble **只**注入短句：`公文包 (briefcase)` · `pack_home` · `skills_dir` ·（可选）`materials` —— **不**枚举每条 skill 绝对路径。包内 skills 经 `extraSkillDirs` 进子会话 **skill catalog**（name+description），正文用 `skill` 工具按名加载。分享 zip 用相对路径（Host 会补短 `## Paths (portable)`）。

**Example — 收到 zip**

1. `team_import pack=…`（成员 only，无家）
2. `team_list` 看 envPrep / packHome
3. envPrep → `team_ready`
4. `team_home` → `workspace_session_prompt(homeWorkspaceId)` 或 `subagent member_id=…`
5. 加料：`team_save id=…`；分享：`team_export id=…`

## When / Shape（委派）

| Do | Don't |
|----|-------|
| Independent research / scoped impl | Continue earlier work without inherit_context |
| Continuable companion (default) | one-shot expecting later human chat |
| Prefer member_id | Absolute host paths in shared playbooks |

| Intent | Call |
|--------|------|
| Default / long | omit or `run_in_background:true` |
| Wait this turn | `run_in_background:false` |
| Continue parent turns | `inherit_context:true` |
| Isolated git | `worktree:true`（与 公文包/briefcase 无关） |

Face prefixes parent/child id · mode · role · cwd. Tool `description` + capability win. Badge: [docs/profiles.md](../../../docs/profiles.md).
