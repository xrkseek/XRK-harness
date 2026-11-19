/** Xiangyang skill: curation hub — zone map lives in shared seed. */
export const ID = "xrk-memory-polish";

export const BODY = `---
name: xrk-memory-polish
description: >-
  向阳策展席：扫全局 MEMORY 噪声、跨工作区挪事实。区划真源 → skill xrk-curated-memory。
  Use when global MEMORY noisy / trial notes / release shards clog inject.
---

# 记忆统筹（向阳）

Load **\`xrk-curated-memory\`** for four-axis map. Here: **you curate**.

1. \`memory({ action:"list", target:"memory", scope:"global" })\` then list relevant \`workspace\` (\`workspace_list\` ids).
2. Soft-delete one-off debug / try-error / format orders already in skills·docs.
3. Move project facts → \`scope:"workspace"\` (or repo \`.agents/\`); leave global a thin pointer.
4. Never paste secrets. USER.md = human-edited identity, not tool dump.

Budget: global injects **every** workspace — keep it thin.
`;
