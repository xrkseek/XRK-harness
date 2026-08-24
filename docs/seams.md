# Exec seams / Exec Seams

> **读者 / Audience**：贡献者 · 能力叶作者 / Contributors · Capability-leaf authors

### 三元：Definition / Provider / Consumer / Triad: Definition / Provider / Consumer

| 层 / Layer | 职责 / Role | 示例（fs） / Example (fs) |
|-------|------|----------------|
| **Definition** | 稳定接口 / Stable interface | `FsService`（read/write/edit/stat/mkdir/**glob/grep**） |
| **Provider** | 具体后端 / Concrete backend | `createFsLocalProvider({ root })` |
| **Consumer** | 工具 / Agent / Tools / agents | `createFsTools(fs)` — 不直接 `import "node:fs"` / do not import `node:fs` directly |

```ts
const tools = createFsTools(stubFs); // Swap Provider; tool schema stays unchanged
```

内置搜索（无 shell `rg`）：`fs.glob` / `fs.grep` → 工具名 `glob` / `grep`。

Built-in search (no shell `rg`): `fs.glob` / `fs.grep` → tool names `glob` / `grep`.

Web：`@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`；Provider 匿名 HTTP + Tavily/Brave（有密钥）或 **parallel-free → duckduckgo**；Consumer `createWebTools`。规格：[web-tools.md](./web-tools.md)。

Web: `@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`; Provider anonymous HTTP + Tavily/Brave (when keyed) or **parallel-free → duckduckgo**; Consumer `createWebTools`. Spec: [web-tools.md](./web-tools.md).

LSP：`@xrkseek/exec-lsp` — Definition `LspService`；Provider stdio JSON-RPC；Consumer `createLspTools`。规格：[lsp-tools.md](./lsp-tools.md)。

PTY：`@xrkseek/exec-pty` — Definition `TerminalSessionService`；Provider `node-pty@1.2.0-beta.15`（NAPI prebuild）+ bash + process-inspector；Consumer `createPtyTools`（六件套）。规格：[pty-tools.md](./pty-tools.md)。

### 依赖图 / Dependency graph

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

`wrapArgv(argv) → argv'`。推荐栈 / Recommended stack：`WorkspaceSandbox(DenyList(Permissive))`。  
后台 / Background：`startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md)。

扩展纪律：先 Definition → Provider → Consumer；单测 stub Provider + 逃逸用例。

Extension discipline: Definition → Provider → Consumer first; unit-test with a stub Provider plus escape cases.
