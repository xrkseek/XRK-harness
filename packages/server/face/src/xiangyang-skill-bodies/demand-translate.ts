/** Xiangyang skill body: fuzzy-demand → product actions. */
export const ID = "xrk-demand-translate";

export const BODY = `---
name: xrk-demand-translate
description: >-
  Turn vague beginner asks into concrete XRK product actions (workspace,
  plugin, MCP, memory, cleanup, config). Use first when the user is fuzzy,
  zero-foundation, or says 「帮我弄一下」「能不能…」「感觉有点乱」.
---

# 需求转化（向阳）

Orchestrator · 少问、快落地。Match row → load skill → act. No harness repo required: plugin template + verify live in \`xrk-plugin-dev-care\`; land in the user's coding workspace or \`xrkh plugin add\`.

| User intent | Land | Next |
|-------------|------|------|
| Add capability / API / 「让 AI 会…」 | MCP first; else process plugin | \`xrk-home-config\` or \`xrk-plugin-dev-care\` |
| Write plugin / slash / tools | Coding workspace plugin | \`xrk-plugin-dev-care\` + \`workspace_session_prompt\` |
| Disk full / .xrk litter | \`~/.xrk\` + project \`.xrk\` | \`xrk-xrk-cleanup\` |
| Memory messy / wrong facts | Curated memory scopes | \`xrk-memory-polish\` |
| Models / keys / theme / MCP | Settings + Credentials | \`xrk-home-config\` |
| Skill catalog noise | Layer merge | \`xrk-skill-merge\` |
| Open a project / folder | Workspace + coding session | \`workspace_list\` → create / \`workspace_session_prompt\` |
| Multi-session collab | 主线 + 支线 | \`xrk-mainline-sideline\` |

## Flow

1. One-line restatement (≤2 clarifying Qs for zero-foundation).
2. \`skill\` / \`/name\` the matching playbook — do not improvise from memory.
3. Act:
   - Config / cleanup / memory → this session (full access).
   - Code / plugin → \`workspace_list\` → \`workspace_session_prompt\` → keep \`session_id\` → \`thread_upsert\` + \`presence_set\`.
4. Deliver: what changed + how to verify (\`xrkh plugin list\` / new session tool name / Settings).

## Ask / don't

| Ask | Don't |
|-----|-------|
| Which folder/workspace (if many) | Framework / microservice lectures |
| Key already in Credentials? | Paste API keys into chat |
| MCP package vs small custom tool | 「先读源码」— skills carry steps |

## Anti

- Chat-only; no convert / no dispatch.
- Refuse plugins because harness source is missing.
- Edit business code in Xiangyang cwd.
- Skip 主线/支线 → anonymous sidebar sessions.
`;
