# 模块地图

> **读者**：贡献者 · 维护者

包文件地图。规格在上一级 `docs/`；此处只标实现落点。身份标准见 [audiences.md](../audiences.md)。

## 怎么用

1. 先看 [status.md](../status.md) 该域是否「能跑」。  
2. 契约看规格列。  
3. 排障打开对应笔记（有则读文件表，无则读包 README + `src/index.ts`）。

## 有独立文件地图的包

| 包 | 笔记 | 规格 |
| --- | --- | --- |
| `@xrkseek/session-projection` | [session-projection.md](./session-projection.md) | 投影驱动缝（状态/视图） |
| `@xrkseek/server-face` | [server-face.md](./server-face.md) | [host-face.md](../host-face.md) |
| `@xrkseek/server-host` | [server-host.md](./server-host.md) | [host-preset.md](../host-preset.md) · [http-api.md](../http-api.md) |
| `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) | [plugin-loader.md](../plugin-loader.md) |
| `@xrkseek/server-config` | env 见 host 笔记 | [http-api.md](../http-api.md) |
| `@xrkseek/mcp` | [mcp.md](./mcp.md) | [policy.md](../policy.md) |
| `@xrkseek/attachment` | [attachment.md](./attachment.md) | [protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) |
| `@xrkseek/xrk-file-reference` 等 | [references.md](./references.md) | [host-face.md](../host-face.md) · `packages/context/*` |

## 全包索引（37）

路径相对 `packages/`。未单列笔记的包以 README + `src/index.ts` 为准。

| 路径 | npm | 规格 / 入口 |
| --- | --- | --- |
| `kernel/` | `@xrkseek/kernel` | [architecture.md](../architecture.md) |
| `protocol/` | `@xrkseek/protocol` | [protocol-events.md](../protocol-events.md) |
| `compose/` | `@xrkseek/compose` | [compose.md](../compose.md) |
| `session/session-projection/` | `@xrkseek/session-projection` | [session-projection.md](./session-projection.md) |
| `core/session/` | `@xrkseek/core-session` | [session.md](../session.md) · [session-compaction.md](../session-compaction.md) |
| `core/agent/` | `@xrkseek/core-agent` | [session-api.md](../session-api.md) |
| `core/agent-loop/` | `@xrkseek/core-agent-loop` | [tool-pipeline.md](../tool-pipeline.md) |
| `core/tools/` | `@xrkseek/core-tools` | [tool-pipeline.md](../tool-pipeline.md) · [tool-settlement.md](../tool-settlement.md) |
| `core/system-prompt/` | `@xrkseek/core-system-prompt` | [workspace-inject.md](../workspace-inject.md) |
| `llm/llm/` | `@xrkseek/llm` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/openai-compatible/` | `@xrkseek/llm-openai-compatible` | [llm-openai-compatible.md](../llm-openai-compatible.md) |
| `llm/openai-responses/` | `@xrkseek/llm-openai-responses` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/anthropic/` | `@xrkseek/llm-anthropic` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/gemini/` | `@xrkseek/llm-gemini` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/deepseek/` | `@xrkseek/llm-deepseek` | [llm-deepseek.md](../llm-deepseek.md) |
| `llm/replay/` | `@xrkseek/llm-replay` | 测试夹具 |
| `llm/registry/` | `@xrkseek/llm-registry` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `mcp/` | `@xrkseek/mcp` | [mcp.md](./mcp.md) · [policy.md](../policy.md) |
| `attachment/` | `@xrkseek/attachment` | [attachment.md](./attachment.md) |
| `exec/fs/` | `@xrkseek/exec-fs` | [seams.md](../seams.md) |
| `exec/web/` | `@xrkseek/exec-web` | [web-tools.md](../web-tools.md) · [seams.md](../seams.md) |
| `exec/lsp/` | `@xrkseek/exec-lsp` | [lsp-tools.md](../lsp-tools.md) · [seams.md](../seams.md) |
| `exec/pty/` | `@xrkseek/exec-pty` | [pty-tools.md](../pty-tools.md) · [seams.md](../seams.md) |
| `exec/subprocess/` | `@xrkseek/exec-subprocess` | [seams.md](../seams.md) |
| `exec/shell/` | `@xrkseek/exec-shell` | [shell-jobs.md](../shell-jobs.md) |
| `exec/sandbox/` | `@xrkseek/exec-sandbox` | [seams.md](../seams.md) · [policy.md](../policy.md) |
| `workspace/` | `@xrkseek/workspace` | [workspace-inject.md](../workspace-inject.md) · [slash-recipes.md](../slash-recipes.md) |
| `policy/` | `@xrkseek/policy` | [policy.md](../policy.md) |
| `code-runtime/` | `@xrkseek/code-runtime` | [code-mode.md](../code-mode.md) |
| `web-runtime/` | `@xrkseek/web-runtime` | 验证台算法（非产品壳） |
| `server/http/` | `@xrkseek/server-http` | [http-api.md](../http-api.md) |
| `server/loader/` | `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) |
| `server/host/` | `@xrkseek/server-host` | [server-host.md](./server-host.md) |
| `server/config/` | `@xrkseek/server-config` | [http-api.md](../http-api.md) |
| `server/face/` | `@xrkseek/server-face` | [server-face.md](./server-face.md) |
| `sdk/` | `@xrkseek/harness` | 包 README |
| `testkit/` | `@xrkseek/testkit` | [testing.md](../testing.md) |

apps：`cli` · `web`（产品壳）· `console`（Face 验证台）。`packages/client` 与 `apps/web` 成对。presets：`minimal` · `harness` · `server`。

## 术语

| 术语 | 含义（本仓） |
| --- | --- |
| Session 真源 | `SessionStore` 事件日志 |
| Face | Unary RPC + mux/host WS |
| Wire 投影 | 内部事件 → 壳协议 |
| Process 插件 | `server-loader` 的 `RegisteredPlugin` |
| soft 降级 | 空/null 成功形，不是 NI |
| NI | `ok:false` + `error.code: not-implemented`（或专用码） |

---

# Module Maps

> **Audience**: Contributors · Maintainers

Package file maps. Contracts live in parent `docs/`; this page only points to implementation. Audience standard: [audiences.md](../audiences.md).

## How to use

1. Check [status.md](../status.md) whether the domain is Working.  
2. Read the contract column.  
3. For triage, open the matching note (file table if present; else package README + `src/index.ts`).

## Packages with dedicated maps

| Package | Note | Spec |
| --- | --- | --- |
| `@xrkseek/session-projection` | [session-projection.md](./session-projection.md) | Projection drive seam (state/view) |
| `@xrkseek/server-face` | [server-face.md](./server-face.md) | [host-face.md](../host-face.md) |
| `@xrkseek/server-host` | [server-host.md](./server-host.md) | [host-preset.md](../host-preset.md) · [http-api.md](../http-api.md) |
| `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) | [plugin-loader.md](../plugin-loader.md) |
| `@xrkseek/server-config` | env in host note | [http-api.md](../http-api.md) |
| `@xrkseek/mcp` | [mcp.md](./mcp.md) | [policy.md](../policy.md) |
| `@xrkseek/attachment` | [attachment.md](./attachment.md) | [protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) |
| `@xrkseek/xrk-file-reference` etc. | [references.md](./references.md) | [host-face.md](../host-face.md) · `packages/context/*` |

## Full package index (37)

Paths relative to `packages/`. Packages without a dedicated note use README + `src/index.ts`.

| Path | npm | Spec · entry |
| --- | --- | --- |
| `kernel/` | `@xrkseek/kernel` | [architecture.md](../architecture.md) |
| `protocol/` | `@xrkseek/protocol` | [protocol-events.md](../protocol-events.md) |
| `compose/` | `@xrkseek/compose` | [compose.md](../compose.md) |
| `session/session-projection/` | `@xrkseek/session-projection` | [session-projection.md](./session-projection.md) |
| `core/session/` | `@xrkseek/core-session` | [session.md](../session.md) · [session-compaction.md](../session-compaction.md) |
| `core/agent/` | `@xrkseek/core-agent` | [session-api.md](../session-api.md) |
| `core/agent-loop/` | `@xrkseek/core-agent-loop` | [tool-pipeline.md](../tool-pipeline.md) |
| `core/tools/` | `@xrkseek/core-tools` | [tool-pipeline.md](../tool-pipeline.md) · [tool-settlement.md](../tool-settlement.md) |
| `core/system-prompt/` | `@xrkseek/core-system-prompt` | [workspace-inject.md](../workspace-inject.md) |
| `llm/llm/` | `@xrkseek/llm` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/openai-compatible/` | `@xrkseek/llm-openai-compatible` | [llm-openai-compatible.md](../llm-openai-compatible.md) |
| `llm/openai-responses/` | `@xrkseek/llm-openai-responses` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/anthropic/` | `@xrkseek/llm-anthropic` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/gemini/` | `@xrkseek/llm-gemini` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/deepseek/` | `@xrkseek/llm-deepseek` | [llm-deepseek.md](../llm-deepseek.md) |
| `llm/replay/` | `@xrkseek/llm-replay` | Test fixtures |
| `llm/registry/` | `@xrkseek/llm-registry` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `mcp/` | `@xrkseek/mcp` | [mcp.md](./mcp.md) · [policy.md](../policy.md) |
| `attachment/` | `@xrkseek/attachment` | [attachment.md](./attachment.md) |
| `exec/fs/` | `@xrkseek/exec-fs` | [seams.md](../seams.md) |
| `exec/web/` | `@xrkseek/exec-web` | [web-tools.md](../web-tools.md) · [seams.md](../seams.md) |
| `exec/lsp/` | `@xrkseek/exec-lsp` | [lsp-tools.md](../lsp-tools.md) · [seams.md](../seams.md) |
| `exec/pty/` | `@xrkseek/exec-pty` | [pty-tools.md](../pty-tools.md) · [seams.md](../seams.md) |
| `exec/subprocess/` | `@xrkseek/exec-subprocess` | [seams.md](../seams.md) |
| `exec/shell/` | `@xrkseek/exec-shell` | [shell-jobs.md](../shell-jobs.md) |
| `exec/sandbox/` | `@xrkseek/exec-sandbox` | [seams.md](../seams.md) · [policy.md](../policy.md) |
| `workspace/` | `@xrkseek/workspace` | [workspace-inject.md](../workspace-inject.md) · [slash-recipes.md](../slash-recipes.md) |
| `policy/` | `@xrkseek/policy` | [policy.md](../policy.md) |
| `code-runtime/` | `@xrkseek/code-runtime` | [code-mode.md](../code-mode.md) |
| `web-runtime/` | `@xrkseek/web-runtime` | Console algorithms (not product shell) |
| `server/http/` | `@xrkseek/server-http` | [http-api.md](../http-api.md) |
| `server/loader/` | `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) |
| `server/host/` | `@xrkseek/server-host` | [server-host.md](./server-host.md) |
| `server/config/` | `@xrkseek/server-config` | [http-api.md](../http-api.md) |
| `server/face/` | `@xrkseek/server-face` | [server-face.md](./server-face.md) |
| `sdk/` | `@xrkseek/harness` | Package README |
| `testkit/` | `@xrkseek/testkit` | [testing.md](../testing.md) |

apps: `cli` · `web` (product shell) · `console` (Face verification bench). `packages/client` pairs with `apps/web`. presets: `minimal` · `harness` · `server`.

## Terms

| Term | Meaning (this repo) |
| --- | --- |
| Session source of truth | `SessionStore` event log |
| Face | Unary RPC + mux/host WS |
| Wire projection | Internal events → shell protocol |
| Process plugin | `server-loader` `RegisteredPlugin` |
| soft degrade | Empty/null success shape, not NI |
| NI | `ok:false` + `error.code: not-implemented` (or a dedicated code) |
