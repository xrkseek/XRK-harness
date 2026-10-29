---
name: xrk-skill-merge
description: >-
  Merge overlapping skills across ~/.xrk/skills and workspace layers.
  Use when the catalog is noisy, duplicates conflict, or triggers misfire.
  Not for 干员 packs (agent-rosters/packs) — those are Team, not skills.
---

# 技能合并

Layers (low → high; product inject wins on conflict):

| Layer | Path | Typical content |
|-------|------|-----------------|
| Home product | `~/.xrk/skills/<id>/` | Global seeds (`xrk-delegate`, `xrk-create-skill`, …) — Host may refresh by fingerprint |
| Xiangyang | `…/xiangyang-workspace/.xrk/skills/` | Orch playbooks only (`xrk-demand-translate`, `xrk-home-config`, …) |
| Workspace | `{ws}/.xrk/skills/` · `{ws}/.agents/skills/` | Project habits |

Catalog = frontmatter `name` + `description` only. Body via `skill` / `/name`.

**Not skills:** advanced 干员 packs (`agent-rosters/packs/` · `.xrk-agent-pack`) — mint/share via `xrk-delegate` / Team UI. Do not copy pack trees into skill layers.

## Steps

1. Find dup `name` / near-identical descriptions.
2. One truth: project → workspace; cross-project habit → home **custom** id; orch → Xiangyang; keep product seed names unless user forks.
3. Tighten kept `description` triggers; delete/shrink dups (ask before overwriting user edits).
4. Spot-check: `skill` / `/skills` / new-session catalog.
5. Stale product / Xiangyang seed → Host restart refreshes by body diff; unknown user ids never overwritten.

## Anti

- Full copies of the same skill in two layers.
- Long manuals in `description`.
- Rewrite user SKILL.md without consent.
- Merge 干员 zip / `workspace/` homework into `skills/`.
- Delete Xiangyang orch skills to "dedupe" with global seeds — different jobs.
