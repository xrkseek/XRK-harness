# @xrkseek/exec-fs

Workspace-rooted `FsService` + tools:

- `read_file` / `write_file` / `apply_edit`
- `glob` / `grep` (built-in; no shell rg)

Provider: `createFsLocalProvider`. Consumer: `createFsTools(fs)`.
See `docs/seams.md`.
