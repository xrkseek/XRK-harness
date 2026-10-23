---
name: xrk-delegate
description: >-
  When and how to spawn subagents without wasting tokens, and how to write
  干员 playbooks for team_save — including advanced 公文包 (briefcase). Use when
  the user asks to parallelize, spawn agents, 「开子代理」「并行」「delegate」
  「fan out」, 干员/Agent Team 总结经验·建干员·委派·分享·导入·就绪·修订, or
  after Frugal/Shallow badge questions about subagents. For the session that
  manages Team / mints members — not a default load for every spawned 干员.
  Xiangyang fuzzy asks route via xrk-demand-translate.
---

# 委派子代理

Each child = a full model session. Prefer doing it yourself. Spawn only when the task is independent or would pollute this context.

**Who loads this skill：** coding / 向阳 / IM **父会话**在建干员、派活、导入、准备环境、导出时。已派出去的干员默认跟自己的 **playbook** 干活，不必再 `skill xrk-delegate`（除非任务明确要求再建干员）。

**Parity：** `team_*` = Team Roster UI. Settings/MCP → `xrk-home-config` / `xrk-capability-attach`. Skill habits → `xrk-create-skill`（不是干员）.

```
- [ ] 1. Badge: Frugal/minimal/shell = no spawn; Shallow depth≤1; Harness nests
- [ ] 2. Prefer team_list → member_id; else role
- [ ] 3. Standalone prompt (paths · acceptance); short description; do not re-paste playbook
- [ ] 4. Default continuable; one-shot only if user asked to wait
- [ ] 5. Caps: ≤2 live, depth ≤2 — Settings → Plugins → Agent loop
```

## 干员生态（主会话知情）

| 类型 | 有什么 | 会话 cwd |
|------|--------|----------|
| **thin** | name + playbook（+ inject/tools） | 继承父工作区 |
| **advanced** | playbook.md · **公文包 (briefcase)**（`workspace/` 材料）· `skills/<id>/`（含 references/）· `env/SETUP.md` | 仍继承父工作区；公文包路径动态注入 |

现实路径：做完一件事 → 总结进 playbook → `team_save` →（高级）按 `env/SETUP.md` 准备环境 → `team_ready` → `subagent member_id=…`。

| Intent | Call |
|--------|------|
| 建 thin | `team_save` name + playbook（+ inject/tools） |
| 建 **高级** | `team_save` `kind=advanced` + skills/files/env_prep |
| 导入朋友文件 | `team_import` `card=` 或 `pack=` → 读 envPrep → `team_ready` |
| 非法包 | 酌情查看/修复 → 再 `team_import` → 准备 → `team_ready` |
| 修订 / 加料 | `team_save` `id=`（可只改 playbook，或再 merge skills/files/env_prep） |
| 子改自己 | `team_self` |
| 导出给用户 | `team_export` id= [`dir=`]（thin→JSON，advanced→zip） |
| 卸载 | `team_remove` id= + scope= |
| 派活 | `subagent` `member_id=`（须 ready） |

```
- [ ] Playbook = 你总结的可重复流程，不是「从会话自动练」
- [ ] 高级才有 公文包 (briefcase)；thin 没有
- [ ] 主会话写高级 playbook 时写清公文包里有什么（材料 / skills / references）
- [ ] 勿用 propose_skill 代替干员
```

## Playbook 怎么写（主会话模板）

**Authority 注入点（重要）：** 子会话 `audience` 恒为 `subagent` / `minimal`，Host **跳过家目录站立层**（`~/.xrk/AGENTS.md` · `SOUL.md` 不进子上下文，见 `docs/workspace-inject.md`）。所以 standing 里的 `## Instruction authority` 段**干员看不到**。playbook 是子会话唯一稳定读到的 operator 文本 —— 需要权威口径时，把一行 authority 写进 playbook 首部，别指望站立文件穿透。

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

1. `team_import pack=…`（非法则修后再导）
2. `team_list` 看 envPrep / packHome / skills
3. 主会话按 SETUP 准备环境 → `team_ready`
4. 需要加料：`team_save id=… files=[…] skills=[…]` 或改 playbook
5. `subagent member_id=…`；分享：`team_export id=… dir=…`

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
