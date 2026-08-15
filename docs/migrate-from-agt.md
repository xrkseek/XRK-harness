# Migrate from AGT

概念迁移指南——**不复制 AGT 源码**（[ADR-0002](./adr/0002-no-embed-upstream.md)）。

## Workspace seeds

| AGT | XRK-Harness |
|-----|-------------|
| `agents/workspace/SOUL.md` … | `templates/office-agent/` |
| `data/ai-workspace/{id}/` | `.xrk/` via `WorkspaceInjector.syncSeeds` / preset inject |
| Repo `AGENTS.md` (coding) | **Not** injected into product |

```ts
import path from "node:path";
import { createWorkspaceInjector } from "@xrkseek/workspace";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "office-agent"));
```

Preset 默认会把 `.xrk` 注入三层 `workspaceBlocks`——[workspace-inject.md](./workspace-inject.md)。

## Recipes

AGT `agents/recipes/*.yaml` → `templates/office-agent/recipes/`。  
`parseRecipeYaml` / `applyRecipe` 已在 `@xrkseek/workspace`。  
`parseRecipeYaml` / `applyRecipe` / slash 热路径已挂（见 [slash-recipes.md](./slash-recipes.md)）。

## Tools

AGT 工具 → `ToolRegistry` + [tool-pipeline.md](./tool-pipeline.md)。勿抄 Cordis。

## MCP

AGT 的 MCP 门禁是 **产品目标**。本仓 `@xrkseek/mcp` 仍为 **空壳**——迁移期用本地 `ToolDefinition` 注册；勿假设 JSON-RPC MCP Host/Client 已可用（[status.md](./status.md)）。  
调研笔记：[learn/mcp-protocol.md](./learn/mcp-protocol.md)。

## Runtime

AGT Go/TS 双宿主 → **TS-only** `xrk-harness serve`（[http-api.md](./http-api.md)）。
