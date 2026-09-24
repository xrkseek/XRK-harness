# @xrkseek/exec-fs

Workspace-rooted `FsService` + tools:

- `read_file` / `write_file` / `apply_edit` / `apply_patch` (Codex `*** Begin Patch` format)
- `glob` / `grep` (built-in; no shell rg)

Provider: `createFsLocalProvider`. Consumer: `createFsTools(fs)`.
`apply_patch` shares the session cwd (including managed subagent worktrees);
folding a worktree branch back into the parent repo is Face
`ManagedWorktreeManager.mergeIntoParent` (ff-only), not this package.
See `docs/seams.md` · `docs/status.md`.
