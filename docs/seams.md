# Exec seams

> **读者**：贡献者 · 能力叶作者

### 三元：Definition / Provider / Consumer

| 层 | 职责 | 示例（fs） |
|----|------|------------|
| **Definition** | 稳定接口 | `FsService`（read/write/edit/stat/mkdir/**glob/grep**） |
| **Provider** | 具体后端 | `createFsLocalProvider({ root })` |
| **Consumer** | 工具 / Agent | `createFsTools(fs)` — 不直接 `import "node:fs"` |

```ts
const tools = createFsTools(stubFs); // Swap Provider; tool schema stays unchanged
```

内置搜索（无 shell `rg`）：`fs.glob` / `fs.grep` → 工具名 `glob` / `grep`。

Web：`@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`；Provider 匿名 HTTP + Tavily/Brave（有密钥）或 **parallel-free → duckduckgo**；Consumer `createWebTools`。规格：[web-tools.md](./web-tools.md)。

LSP：`@xrkseek/exec-lsp` — Definition `LspService`；Provider stdio JSON-RPC；Consumer `createLspTools`。规格：[lsp-tools.md](./lsp-tools.md)。

PTY：`@xrkseek/exec-pty` — Definition `TerminalSessionService`；Provider `node-pty@1.2.0-beta.15`（NAPI prebuild）+ bash + process-inspector；Consumer `createPtyTools`（六件套）。规格：[pty-tools.md](./pty-tools.md)。

### 依赖图

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
后台：`startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md)。

扩展纪律：先 Definition → Provider → Consumer；单测 stub Provider + 逃逸用例。

---

# Exec Seams

> **Audience**: Contributors · Capability-leaf authors

### Triad: Definition / Provider / Consumer

| Layer | Role | Example (fs) |
|-------|------|--------------|
| **Definition** | Stable interface | `FsService` (read/write/edit/stat/mkdir/**glob/grep**) |
| **Provider** | Concrete backend | `createFsLocalProvider({ root })` |
| **Consumer** | Tools / agents | `createFsTools(fs)` — do not import `node:fs` directly |

```ts
const tools = createFsTools(stubFs); // Swap Provider; tool schema stays unchanged
```

Built-in search (no shell `rg`): `fs.glob` / `fs.grep` → tool names `glob` / `grep`.

Web: `@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`; Provider anonymous HTTP + Tavily/Brave (when keyed) or **parallel-free → duckduckgo**; Consumer `createWebTools`. Spec: [web-tools.md](./web-tools.md).

LSP: `@xrkseek/exec-lsp` — Definition `LspService`; Provider stdio JSON-RPC; Consumer `createLspTools`. Spec: [lsp-tools.md](./lsp-tools.md).

PTY: `@xrkseek/exec-pty` — Definition `TerminalSessionService`; Provider `node-pty@1.2.0-beta.15` (NAPI prebuild) + bash + process-inspector; Consumer `createPtyTools` (six-tool set). Spec: [pty-tools.md](./pty-tools.md).

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

`wrapArgv(argv) → argv'`. Recommended stack: `WorkspaceSandbox(DenyList(Permissive))`.  
Background: `startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md).

Extension discipline: Definition → Provider → Consumer first; unit-test with a stub Provider plus escape cases.
