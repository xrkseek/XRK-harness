/** Xiangyang skill: orch extras only — playbooks live in shared seeds. */
export const ID = "xrk-mainline-sideline";

export const BODY = `---
name: xrk-mainline-sideline
description: >-
  向阳编排：派活后钉主线、支线跟拍。细则 → skill xrk-thread-pin · xrk-presence。
  Use when multi-session orch / empty peer titles / pin after prompt.
---

# 主线 · 支线（向阳）

Load **\`xrk-thread-pin\`** + **\`xrk-presence\`** for contracts. Here only orch deltas:

1. After \`workspace_session_prompt\` → \`thread_upsert({ title, brief, session_id, workspace_id })\`.
2. Child subagents mint **their own** 主线 (never copy parent pin as search key).
3. Mail = \`thread_message\` (pin **not** required). Follow \`<session_lanes>\` when done → tip / delete unused pin / next todo.

Anti: prompt without pin when discovery matters · one 主线 per micro-task · assume no pin ⇒ cannot message.
`;
