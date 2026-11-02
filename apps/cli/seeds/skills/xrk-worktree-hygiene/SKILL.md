---
name: xrk-worktree-hygiene
description: >-
  Keep the session worktree worth snapshoting. Every turn is committed into a
  hidden shadow git repo that `/rollback` reads, so whatever heavy files you
  leave in the tree are paid for on every turn and can never be garbage
  collected. Use before writing build output / archives / media / model weights
  into a workspace, when a workspace feels slow or huge (「工作区太大」
  「快照慢」「磁盘爆了」「/rollback 不生效」), and when deciding where a
  deliverable should land.
---

# Worktree hygiene: every turn is a commit

## What actually happens

Before each turn the Host snapshots the session worktree into a **shadow git
repo** — `{XRK_HOME}/checkpoints/<workspace-id>/git`. It never touches your
own `.git`, never pushes, and `/rollback` reads it.

That makes the worktree **append-only by accident**:

| Fact | Consequence |
|------|-------------|
| Every turn is one `add -A` + commit | each byte you leave behind is a per-turn tax |
| Blobs stay reachable from `HEAD` | `git gc` **cannot** reclaim them |
| Only a policy bump discards the repo | the old `/rollback` points go with it |

Measured on this machine before the gate existed: **9.04 GiB / 320 commits /
~1.5 s per turn** over 26,855 files — of which 24,463 were one deliverable
tree's build output. The snapshot was spending ~99.5% of its budget on files
nobody would ever hand-restore.

## The gate (policy v2) — what is no longer snapshotted

1. **Byte cap** — a single file over 10 MiB is left out
   (`XRK_CHECKPOINT_MAX_FILE_BYTES`, `0` disables).
2. **Suffix gate** — archives, office docs, raster/vector, media, fonts,
   compiled binaries, sqlite/pyc.
3. **Directory segments** — `node_modules`, `dist`, `build`, `.venv`, `venv`,
   `.pytest_cache`, `.mypy_cache`, `.cache`, `.tox`, `__pycache__`,
   `.release`, `coverage`, `.tmp`.

**Excluded ≠ deleted.** Those files stay on disk; even `--prune` will not touch
them. What you lose is *rollback coverage*, and the preview says so
(`Not in this point: …`). A gate that silently shrank the restore set would be
worse than the 9 GiB.

## What it costs (measured — don't guess)

On that same workspace, after the gate: **21.73 MiB / 6,812 files** (from
9,359.56 MiB / 26,855 files, −99.77%), and **still ~1.3 s per turn** — about
what it cost before the gate existed.

Volume was never the cost. `git` still walks all 24,463 paths under `hwgen/`
looking for changes, and no exclude rule can skip that directory because 1,453
of those files are the sources being edited. Reclaiming the 9.14 GiB needed a
policy bump (the blobs were reachable from `HEAD`, so `gc` could not drop
them); it did not need — and did not get — a faster turn.

**So the gate stops the disk from exploding; it does not make the turn
faster.** Only keeping artifacts out of the tree does that. That is why this
skill exists next to the gate instead of replacing it.

## What you do about it

- **Nothing heavy in the tree.** Build output, archives, media, model weights,
  `node_modules` — not near the workspace root. Big payloads already have a
  home: `{XRK_HOME}/spill/`, plus any directory the user names. Write the
  **path** back into the workspace, not the bytes.
- **Deliverables: produce, then move.** Generate a zip / pptx / pdf / mp4
  outside the worktree (or into an ignored dir) and `present` the path. If it
  truly must live in the tree, add it to `.gitignore` **in the same turn** —
  the shadow repo reads the standard exclude chain, so an ignored path costs
  nothing.
- **Write `.gitignore` when you create an artifact dir.** Don't wait to be
  asked. A workspace with no `.gitignore` is exactly the setup that produced a
  9 GiB shadow repo.
- **Say it out loud when you break the rule.** If a big file has to stay, tell
  the user: 「这两个文件超过 10 MiB，`/rollback` 不会覆盖它们」. A silent gap is
  the bug — the store can only report what it knows it skipped.
- **Measure before blaming git.** `du -sh .` and
  `git -C . count-objects -vH` (POSIX), or
  `Get-ChildItem -Recurse -File | Measure-Object Length -Sum` (PowerShell).
  A multi-GiB workspace is a hygiene problem, not a git problem.

## Don't

- Don't run `git gc` / `git prune` inside `{XRK_HOME}/checkpoints/*/git` to try
  to shrink it. Reachable objects survive; you can corrupt a live repo.
- Don't hand-edit `index.json` there — it is derived and merged across Host
  processes.
- Don't set `XRK_CHECKPOINTS=0` to make one slow turn faster. Fix the tree;
  rollback is the safety net for everything else you do.

## Where this is implemented

In the Harness repo: `packages/checkpoint/src/store.ts` —
`EXCLUDED_DIR_SEGMENTS` · `EXCLUDED_SUFFIXES` · `DEFAULT_MAX_FILE_BYTES` ·
`SNAPSHOT_POLICY_VERSION` · `oversizeUntracked()` · `ensurePolicy()`.
Bumping the policy version discards the shadow repo once; that is intended and
it costs the old points. If the current workspace is not the Harness repo,
skip this section — the rules above still apply.
