/** Xiangyang skill body: fuzzy-demand → product actions. */
export const ID = "xrk-demand-translate";

export const BODY = `---
name: xrk-demand-translate
description: >-
  Turn vague beginner asks into concrete XRK product actions (workspace,
  plugin, MCP, memory, cleanup, config, 干员, skill). Use first when the user
  is fuzzy, zero-foundation, or says 「帮我弄一下」「能不能…」「感觉有点乱」
  「建个干员」「作业生成员」「教 agent」「改设置」.
---

# 需求转化（向阳）

Orchestrator · 少问、快落地。Match row → load skill → act.  
**Parity:** anything the human can do in Settings / Team / skill folders, you can do with the matching tools — same write path, no secret second config.

No harness repo required: plugin template + verify live in \`xrk-plugin-dev-care\`; land in the user's coding workspace or \`xrkh plugin add\`.

| User intent | Land | Next |
|-------------|------|------|
| Add capability / API / 「让 AI 会…」 | MCP first; else process plugin | \`xrk-home-config\` or \`xrk-plugin-dev-care\` |
| Write plugin / slash / tools | Coding workspace plugin | \`xrk-plugin-dev-care\` + \`workspace_session_prompt\` |
| Models / keys / theme / MCP / Permissions / Agent loop | Settings + Credentials | \`xrk-home-config\` (deep: global \`xrk-capability-attach\` / \`xrk-models-settings\`) |
| 干员 / 总结经验建干员 / 高级 pack / 分享 | \`team_save\`（高级 +skills/files）· \`team_export\` · \`team_import\` 只装文件 | \`xrk-delegate\` |
| 写 skill / 教 agent / 自我升级 | Skill folders (not 干员) | \`xrk-create-skill\` (global); noisy catalog → \`xrk-skill-merge\` |
| Disk full / .xrk litter | \`~/.xrk\` + project \`.xrk\` | \`xrk-xrk-cleanup\` |
| Memory messy / wrong facts | Curated memory scopes | \`xrk-memory-polish\` |
| Open a project / folder | Workspace + coding session | \`workspace_list\` → create / \`workspace_session_prompt\` |
| Multi-session collab | 主线 + 支线 | \`xrk-mainline-sideline\` |

## 分工（勿抢活）

| Owner | Owns | Does **not** |
|-------|------|----------------|
| **向阳 skills** (this workspace) | Route · Settings hub · 主线/支线 · memory/cleanup · plugin-without-source | Edit coding project as if it were cwd; invent MCP yaml by hand |
| **Global seeds** (\`~/.xrk/skills\` product) | \`xrk-delegate\` 干员 · \`xrk-create-skill\` · deep MCP/models/plugins/canvas | Xiangyang orch playbooks (keep those here) |
| **Coding session** | Repo files · process plugins · tests | Host Settings / Credentials / Team mint (do those in 向阳 or any session with tools) |

干员 ≠ skill：可复用人格+工具面+可选 pack → \`xrk-delegate\`；改决策习惯 → \`xrk-create-skill\`。

## Flow

1. One-line restatement (≤2 clarifying Qs for zero-foundation).
2. \`skill\` / \`/name\` the matching playbook — do not improvise from memory.
3. Act:
   - Config / cleanup / memory / **干员 mint** → this session (奇创 has \`settings_*\` + \`team_*\`).
   - Code / plugin → \`workspace_list\` → \`workspace_session_prompt\` → keep \`session_id\` → \`thread_upsert\` + \`presence_set\`.
4. Deliver: what changed + how to verify (Settings / Team list / \`xrkh plugin list\` / new-session skill catalog).

## Ask / don't

| Ask | Don't |
|-----|-------|
| Which folder/workspace (if many) | Framework / microservice lectures |
| Key already in Credentials? | Paste API keys into chat |
| Thin 干员 vs 高级 pack (files/skills)? | Absolute host paths in shared playbooks |
| MCP package vs small custom tool | 「先读源码」— skills carry steps |

## Anti

- Chat-only; no convert / no dispatch.
- Refuse plugins because harness source is missing.
- Edit business code in Xiangyang cwd.
- Skip 主线/支线 → anonymous sidebar sessions.
- Mint 干员 with \`propose_skill\` / treat pack as a skill layer.
- Hand-edit \`~/.xrk\` yaml when \`settings_mutate\` / Team tools exist.
`;
