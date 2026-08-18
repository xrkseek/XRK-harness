# Exec seams

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

Web：`@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`；Provider 匿名 HTTP + 可选 Tavily/Brave；Consumer `createWebTools`。规格：[web-tools.md](./web-tools.md)。

LSP：`@xrkseek/exec-lsp` — Definition `LspService`；Provider stdio JSON-RPC；Consumer `createLspTools`。规格：[lsp-tools.md](./lsp-tools.md)。

PTY：`@xrkseek/exec-pty` — Definition `TerminalSessionService`；Provider `node-pty@1.2.0-beta.15`（NAPI prebuild）+ bash + process-inspector；Consumer `createPtyTools`（六件套）。规格：[pty-tools.md](./pty-tools.md)。

### Dependency graph

```text
exec-fs  (independent)
exec-web (independent)
exec-lsp (independent)
exec-pty (optional node-pty@1.2.0-beta.15 prebuild)
exec-subprocess
    └── exec-shell   → createBashTools
exec-sandbox         → createSandboxWrapGuard → pipeline guards
```

### Sandbox / jobs

`wrapArgv(argv) → argv'`。推荐栈：`WorkspaceSandbox(DenyList(Permissive))`。  
Background：`startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md)。

扩展纪律：先 Definition → Provider → Consumer；单测 stub Provider + 逃逸用例。
