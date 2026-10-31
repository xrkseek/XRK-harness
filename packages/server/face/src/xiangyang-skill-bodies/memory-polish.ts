/** Xiangyang skill body: layered curated memory care + curation hub. */
export const ID = "xrk-memory-polish";

export const BODY = `---
name: xrk-memory-polish
description: >-
  Curate layered memory (scope=global|workspace|session|agent). Use when global
  MEMORY is noisy with one-off trial notes, release debug, or project facts that
  belong in workspace/repo skills — Xiangyang owns the split so global stays thin.
---

# 记忆统筹（向阳）

Same \`memory\` tool; pick **\`scope\`**. Xiangyang is the **curation seat**: keep
global small, park project truth in workspace / \`.agents\`, drop trial shards.

| scope | Write | Where |
|-------|-------|-------|
| \`global\` | Cross-project prefs / identity only | \`~/.xrk/memories/\` |
| \`workspace\` | Project facts for one ws | \`…/workspaces/<wsId>/\` |
| \`session\` | This-session constraints | \`…/sessions/<sid>/\` |
| \`agent\` | 干员 private notes | \`…/agents/<id>/\` |

Factual "who the user is" → \`memory\` target \`user\` (\`USER.md\`), not a scope row.

**Budget:** global \`MEMORY.md\` is injected into every workspace. One release-chain
or try-error dump can burn a large share while helping only one project — prefer
repo \`.agents/\` (or workspace memory) and leave global a one-line pointer.

## Steps

1. \`memory({ action:"list", target:"memory", scope:"global" })\` then list relevant
   \`workspace\` (ids from \`workspace_list\`).
2. Soft-delete noise: one-off debug, format orders, job shards, stale paths,
   release try-error that already lives in a skill / docs.
3. Migrate project facts → \`scope:"workspace"\` then \`remove\` from global.
4. Repo truth (\`.agents\` / skills) → one pointer line in global; no pasted manuals.
5. Never: secrets, absolute machine noise, unrelated session orders.
6. Report by scope: pruned / moved / left-as-pointer.

## When to run

- User asks to clean / curate / 统筹 memory.
- Global feels crowded after a release or long try-error session.
- Facts about one repo keep reappearing in every workspace's prompt.

## Anti

- Heap project manuals or release runbooks into global without \`scope\`.
- Re-add workspace facts to global after a migrate.
- \`rm -rf memories/\` (cleanup skill territory).
- Duplicate a full skill body into MEMORY — point at the skill instead.
`;
