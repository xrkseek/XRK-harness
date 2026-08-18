# Module maps

包文件地图。规格在上一级 `docs/`；此处只标实现落点。

## 怎么用

1. 先看 [status.md](../status.md) 该域是否「能跑」。  
2. 契约看规格列。  
3. 排障打开对应笔记（有则读文件表，无则读包 README + `src/index.ts`）。

## 有独立文件地图的包

| 包 | 笔记 | 规格 |
| --- | --- | --- |
| `@xrkseek/server-face` | [server-face.md](./server-face.md) | [host-face.md](../host-face.md) |
| `@xrkseek/server-host` | [server-host.md](./server-host.md) | [host-preset.md](../host-preset.md) · [http-api.md](../http-api.md) |
| `@xrkseek/server-loader` | [server-loader.md](./server-loader.md) | [plugin-loader.md](../plugin-loader.md) |
| `@xrkseek/server-config` | env 见 host 笔记 | [http-api.md](../http-api.md) |
| `@xrkseek/mcp` | [mcp.md](./mcp.md) | [policy.md](../policy.md) |
| `@xrkseek/attachment` | [attachment.md](./attachment.md) | [protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) |

## 全包索引（33）

路径相对 `packages/`。未单列笔记的包以 README + `src/index.ts` 为准。

| 路径 | npm | 规格 / 入口 |
| --- | --- | --- |
| `kernel/` | `@xrkseek/kernel` | [architecture.md](../architecture.md) |
| `protocol/` | `@xrkseek/protocol` | [protocol-events.md](../protocol-events.md) |
| `compose/` | `@xrkseek/compose` | [compose.md](../compose.md) |
| `core/session/` | `@xrkseek/core-session` | [session.md](../session.md) |
| `core/agent/` | `@xrkseek/core-agent` | [session-api.md](../session-api.md) |
| `core/agent-loop/` | `@xrkseek/core-agent-loop` | [tool-pipeline.md](../tool-pipeline.md) |
| `core/tools/` | `@xrkseek/core-tools` | [tool-pipeline.md](../tool-pipeline.md) · [tool-settlement.md](../tool-settlement.md) |
| `core/system-prompt/` | `@xrkseek/core-system-prompt` | [workspace-inject.md](../workspace-inject.md) |
| `llm/llm/` | `@xrkseek/llm` | [llm-provider-registry.md](../llm-provider-registry.md) |
| `llm/openai-compatible/` | `@xrkseek/llm-openai-compatible` | [llm-openai-compatible.md](../llm-openai-compatible.md) |
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

apps：`cli` · `web`（壳底稿）· `console`（Face 验证台）；捕获 `web-static`（gitignore）。`packages/client` 与 `apps/web` 成对。presets：`minimal` · `harness` · `server`。

## 术语

| 术语 | 含义（本仓） |
| --- | --- |
| Session 真源 | `SessionStore` 事件日志 |
| Face | Unary RPC + mux/host WS |
| Wire 投影 | 内部事件 → 壳协议 |
| Process 插件 | `server-loader` 的 `RegisteredPlugin` |
| soft 降级 | 空/null 成功形，不是 NI |
| NI | `ok:false` + `error.code: not-implemented`（或专用码） |
