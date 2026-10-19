/** Xiangyang skill body: ~/.xrk and project .xrk reclaim. */
export const ID = "xrk-xrk-cleanup";

export const BODY = `---
name: xrk-xrk-cleanup
description: >-
  Reclaim disk under ~/.xrk and project .xrk with a keep/delete map.
  Use when the user says litter, cache, full disk, tidy .xrk, or Harness feels heavy.
---

# .xrk 清理

Scope: \`~/.xrk\` (or \`XRK_HOME\`) + coding workspaces' \`.xrk\`. This session can do it (full access); large cross-project sweeps may \`workspace_session_prompt\`. List → confirm → delete.

## Rules

1. Inventory first (path + size). Ask before "maybe useful".
2. Prefer large / clearly temp.
3. Never silent-delete hot session DB, credentials, user-edited skills/memory bodies.

## \`~/.xrk\` map

| Path | Default |
|------|---------|
| \`settings.yaml\` · \`host-settings.json\` | keep |
| \`.credentials.yaml\` | keep — never paste into chat |
| \`sessions/\` (\`sessions.db\` · WAL) · \`sessions-archive.db\` | keep — archive via product; do not delete the DB to save space |
| \`workspaces.json\` · \`session-models.json\` · \`session-agent-presets.json\` | keep |
| \`memories/\` | keep bodies; polish via \`xrk-memory-polish\` |
| \`skills/\` · \`xiangyang-workspace/.xrk/skills/\` | keep user edits; product seed may refresh |
| \`plugins/\` | careful uninstall |
| \`spill/\` · \`tmp/\` · \`cache/\` · \`logs/\` | clear |
| \`memory-embeddings/\` · \`pubmed-cache/\` | clear (rebuildable) |
| \`mcp-venvs/\` · \`mcp-cwd/\` | clear idle |
| \`community-plugin-mirror/\` | clear |
| \`run/\` · \`cron/\` | careful |
| \`attachments/\` · \`canvases/\` · \`checkpoints/\` | ask |
| \`xiangyang-workspace/\` | keep dir; clear only clear temp under it |

## Project \`.xrk\`

Clear: empty/stale recipes, obvious temp. Keep: user skills, intentional recipes, workspace AGENTS.

## Steps

1. Candidate list + why.
2. Delete after confirm / explicit "清缓存".
3. After big deletes: remind product archive; VACUUM when Host idle.
4. Short report: deleted / kept / ~bytes freed.

## Anti

- \`rm -rf ~/.xrk\`.
- Delete \`sessions.db\` / credentials as "cleanup".
- Treat \`memories/\` as cache.
`;
