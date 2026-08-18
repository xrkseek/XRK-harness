# @xrkseek/exec-lsp

LSP capability seam + model-facing `lsp` tool.

- **Definition**: `LspService` — four operations (`goToDefinition` / `findReferences` / `goToImplementation` / `hover`)
- **Provider**: stdio JSON-RPC (`Content-Length` framing); spawn when `XRK_LSP_COMMAND` is set
- **Consumer**: `createLspTools({ workspaceRoot, service })` — Face card via `presentCall` (`card: "generic"`, `kind: "search"`)

Tools stay registered when no language server is configured; execute returns `isError`. Not a product editor, and not a PTY.

See [docs/lsp-tools.md](../../../docs/lsp-tools.md) · [docs/seams.md](../../../docs/seams.md).
