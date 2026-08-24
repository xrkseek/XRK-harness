# LSP 工具 / LSP Tools

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

`@xrkseek/exec-lsp`：单一模型工具 `lsp`。Harness / server preset 默认登记；minimal 不登记。

`@xrkseek/exec-lsp` exposes a single model tool `lsp`. Harness and server presets register it by default; minimal does not.

## 缝 / Seams

| 层 / Layer | 内容 / Content |
|----|------|
| Definition | `LspService.query` — `goToDefinition` · `findReferences` · `goToImplementation` · `hover` |
| Provider | stdio JSON-RPC（`Content-Length` framing）；`XRK_LSP_COMMAND` 有值才 spawn |
| Consumer | `createLspTools({ workspaceRoot, service })` — Face 卡 `presentCall`（`card: "generic"`, `kind: "search"`） |

Enablement ≠ provider：工具始终可见。无语言服务器时 execute 回 `isError` 明文，不假装有语义导航。

Enablement is not the same as a provider: the tool stays visible. Without a language server, execute returns a clear `isError` string and does not pretend to provide semantic navigation.

## 操作 / Operations

模型坐标是 **one-based UTF-16**；缝与协议是 zero-based。`findReferences` 始终 `includeDeclaration: true`。

Model coordinates are **one-based UTF-16**; the seam and protocol are zero-based. `findReferences` always uses `includeDeclaration: true`.

每次查询：读工作区内源文件 → `didOpen` → 请求 → `didClose`。同一 workspace 复用一个 server 进程。不是产品编辑器，也不是 diagnostics 推送 / workspace symbols。

Each query: read a source file in the workspace → `didOpen` → request → `didClose`. One server process is reused per workspace. This is not a product editor and not diagnostics push / workspace symbols.

## Env

| Env | 含义 / Meaning |
|-----|------|
| `XRK_LSP_COMMAND` | 语言服务器可执行文件（例如 `typescript-language-server`） |
| `XRK_LSP_ARGS` | 可选参数：空白分隔，或 JSON 字符串数组 / Optional args: whitespace-separated or JSON string array |

无命令：`Error: LSP is not configured. Set XRK_LSP_COMMAND …`。默认扩展映射：`.ts/.tsx/.js/.jsx` 等 → typescript / javascript。路径必须落在 `workspaceRoot` 内。

Without a command: `Error: LSP is not configured. Set XRK_LSP_COMMAND …`. Default extension map: `.ts/.tsx/.js/.jsx` and similar → typescript / javascript. Paths must stay under `workspaceRoot`.

## 卡回放 / Card replay

冷 history 靠 Host standing 工具表的 `presentCall`。Face 不按工具名造卡。无 `tool/result.meta`。

Cold history uses `presentCall` from the Host standing tool table. Face does not invent cards by tool name. There is no `tool/result.meta`.

相关 / Related：[seams.md](./seams.md) · [profiles.md](./profiles.md)
