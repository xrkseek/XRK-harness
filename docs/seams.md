# Exec seams（XRK 落点）

> **能力缝基础规格：读 DSH 原文，不要用本页当精简替代。**  
> [upstream/deepseek-harness/capability-seams.zh.md](./upstream/deepseek-harness/capability-seams.zh.md)

## 本仓实现对照

### Triad: Definition / Provider / Consumer

| Layer | Role | Example (fs) |
|-------|------|----------------|
| **Definition** | Stable interface | `FsService`（read/write/edit/stat/mkdir/**glob/grep**） |
| **Provider** | Concrete backend | `createFsLocalProvider({ root })` |
| **Consumer** | Tools / agents | `createFsTools(fs)` — 不直接 `import "node:fs"` |

```ts
const tools = createFsTools(stubFs); // 换 Provider，工具 schema 不变
```

Built-in search（无 shell `rg`）：`fs.glob` / `fs.grep` → 工具名 `glob` / `grep`。

### Dependency graph

```text
exec-fs  (independent)
exec-subprocess
    └── exec-shell   → createBashTools
exec-sandbox         → createSandboxWrapGuard → pipeline guards
```

### Sandbox / jobs

`wrapArgv(argv) → argv'`。推荐栈：`WorkspaceSandbox(DenyList(Permissive))`。  
Background：`startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md)。

扩展纪律：先 Definition → Provider → Consumer；单测 stub Provider + 逃逸用例。
