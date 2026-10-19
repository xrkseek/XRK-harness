/** Xiangyang skill body: layered curated memory care. */
export const ID = "xrk-memory-polish";

export const BODY = `---
name: xrk-memory-polish
description: >-
  Polish layered curated memory (scope=global|workspace|session|agent).
  Use when memory is noisy, still flat after upgrades, or the user asks
  to prune / move project facts into workspace memory.
---

# 记忆完善

Same \`memory\` tool; pick **\`scope\`** (default often global). Pre-upgrade entries may all sit in global — migrate on request.

| scope | Write | Where |
|-------|-------|-------|
| \`global\` | Cross-project prefs / identity | \`~/.xrk/memories/\` |
| \`workspace\` | Project facts for one ws | \`…/workspaces/<wsId>/\` |
| \`session\` | This-session constraints | \`…/sessions/<sid>/\` |
| \`agent\` | 干员 private notes | \`…/agents/<id>/\` |

Factual "who the user is" → \`memory\` target \`user\` (\`USER.md\`), not a scope row.

## Steps

1. \`memory({ action:"list", target:"memory", scope:"global" })\` then list relevant \`workspace\` (ids from \`workspace_list\`).
2. Soft-delete noise: one-off debug, format orders, job shards, stale paths.
3. Migrate project facts → \`scope:"workspace"\` then \`remove\` from global.
4. Repo truth (\`.agents\` / skills) → one pointer line; no pasted manuals.
5. Never: secrets, absolute machine noise, unrelated session orders.
6. Report by scope: pruned / moved.

## Anti

- Heap project manuals into global without \`scope\`.
- Re-add workspace facts to global.
- \`rm -rf memories/\` (cleanup skill territory).
`;
