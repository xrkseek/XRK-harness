# Exec seams

## Triad: Definition / Provider / Consumer

| Layer | Role | Example (fs) |
|-------|------|----------------|
| **Definition** | Stable interface | `FsService`（read/write/edit/stat/mkdir/**glob/grep**） |
| **Provider** | Concrete backend | `createFsLocalProvider({ root })` |
| **Consumer** | Tools / agents | `createFsTools(fs)` — 不直接 `import "node:fs"` |

```ts
const tools = createFsTools(stubFs); // 换 Provider，工具 schema 不变
```

Built-in search（无 shell `rg`）：`fs.glob` / `fs.grep` → 工具名 `glob` / `grep`。

## Dependency graph

```text
exec-fs  (independent)
exec-subprocess
    └── exec-shell   → createBashTools
exec-sandbox         → createSandboxWrapGuard → pipeline guards
```

## Sandbox

`wrapArgv(argv) → argv'`。推荐栈：`WorkspaceSandbox(DenyList(Permissive))`。  
接入：`pipeline.onGuard(createSandboxWrapGuard(sandbox))`。

## Background jobs

`startJob` / `listJobs` / `killJob` — see [shell-jobs.md](./shell-jobs.md).

`createBashTools` exposes `bash` (`background?`) · `bash_jobs` · `bash_kill`.

## 扩展

1. 新 IO：先扩 Definition，再 Provider，最后 Consumer 工具。  
2. 单测：stub Provider + 逃逸用例（见 `packages/exec/fs/tests`）。  
3. 不要在 `core-agent` 里 import exec 实现（依赖纪律）。
