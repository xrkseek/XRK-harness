/** Xiangyang skill body: 主线 pin + 支线 tips for Qichuang. */
export const ID = "xrk-mainline-sideline";

export const BODY = `---
name: xrk-mainline-sideline
description: >-
  Keep 主线 (thread pin) and 支线 (presence tips) meaningful while
  orchestrating from Xiangyang. Use when starting multi-session work,
  pinning peers, or when catalog titles look empty / duplicated.
---

# 主线 · 支线

| Concept | Tool | Role |
|---------|------|------|
| 主线 | \`thread_upsert\` / \`thread_list\` / \`thread_delete\` | Discovery pin on collab board |
| 支线 | \`presence_set\` tips / \`sideline_set\` | One-line "now" in sidebar |
| Mail | \`thread_message\` | Any parent↔parent (pin **not** required) |
| Dispatch | \`workspace_session_prompt\` | Open/continue coding peer; returns \`session_id\` |

主线 accelerates discovery — it is not a messaging gate. Skipping pins still leaves zero-foundation users with anonymous sidebars.

## Pin

1. After \`workspace_session_prompt\` → \`thread_upsert({ title, brief, session_id, workspace_id })\`.
2. \`title\` = short task; \`brief\` = one line others understand.
3. No empty brief, no \`mainline-a\` spam, no progress-log pins.
4. Own work: \`thread_upsert({ title, brief })\`; done + unused → \`thread_delete\`.
5. \`thread_list\` periodically — empty / test / dup → fix.

## Sideline

Start / blocked / waiting / done → \`presence_set({ tips })\`. Progress detail → \`todo_write\`, not 主线.

## With demand-translate

After picking a coding workspace, dispatch **must** pin 主线 + update 支线.

## Anti

- Prompt without \`thread_upsert\`.
- One 主线 per micro-task.
- Assume no pin ⇒ cannot \`thread_message\`.
`;
