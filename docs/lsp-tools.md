# LSP tools

`@xrkseek/exec-lsp`：单一模型工具 `lsp`。Harness / server preset 默认登记；minimal 不登记。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `LspService.query` — `goToDefinition` · `findReferences` · `goToImplementation` · `hover` |
| Provider | stdio JSON-RPC（`Content-Length` framing）；`XRK_LSP_COMMAND` 有值才 spawn |
| Consumer | `createLspTools({ workspaceRoot, service })` — Face 卡 `presentCall`（`card: "generic"`, `kind: "search"`） |

Enablement ≠ provider：工具始终可见。无语言服务器时 execute 回 `isError` 明文，不假装有语义导航。

## 操作

模型坐标是 **one-based UTF-16**；缝与协议是 zero-based。`findReferences` 始终 `includeDeclaration: true`。

每次查询：读工作区内源文件 → `didOpen` → 请求 → `didClose`。同一 workspace 复用一个 server 进程。不是产品编辑器，也不是 diagnostics 推送 / workspace symbols。

## Env

| Env | 含义 |
|-----|------|
| `XRK_LSP_COMMAND` | 语言服务器可执行文件（例如 `typescript-language-server`） |
| `XRK_LSP_ARGS` | 可选参数：空白分隔，或 JSON 字符串数组 |

无命令：`Error: LSP is not configured. Set XRK_LSP_COMMAND …`。默认扩展映射：`.ts/.tsx/.js/.jsx` 等 → typescript / javascript。路径必须落在 `workspaceRoot` 内。

## 卡回放

冷 history 靠 Host standing 工具表的 `presentCall`。Face 不按工具名造卡。无 `tool/result.meta`。

相关：[seams.md](./seams.md) · [profiles.md](./profiles.md)
