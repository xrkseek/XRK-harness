/** Xiangyang skill body: merge overlapping skills across layers. */
export const ID = "xrk-skill-merge";

export const BODY = `---
name: xrk-skill-merge
description: >-
  Merge overlapping skills across ~/.xrk/skills and workspace layers.
  Use when the catalog is noisy, duplicates conflict, or triggers misfire.
---

# 技能合并

Layers (low → high; product inject wins on conflict):

| Layer | Path |
|-------|------|
| Home | \`~/.xrk/skills/<id>/SKILL.md\` |
| Xiangyang | \`~/.xrk/xiangyang-workspace/.xrk/skills/\` |
| Workspace | \`{ws}/.xrk/skills/\` · \`{ws}/.agents/skills/\` |

Catalog = frontmatter \`name\` + \`description\` only. Body via \`skill\` / \`/name\`.

## Steps

1. Find dup \`name\` / near-identical descriptions.
2. One truth: project → workspace; cross-project → home; orch playbooks → Xiangyang.
3. Tighten kept \`description\` triggers; delete/shrink dups (ask before overwriting user edits).
4. Spot-check: \`skill\` / \`/skills\` / new-session catalog.
5. Stale product seed → Host restart refreshes by body diff; user ids never overwritten.

## Anti

- Full copies of the same skill in two layers.
- Long manuals in \`description\`.
- Rewrite user SKILL.md without consent.
`;
