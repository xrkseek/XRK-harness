---
name: xrk-capability-attach
description: >-
  Monorepo overlay: Host Settings / MCP / appearance via settings_mutate (global ~/.xrk).
  Product default seed is apps/cli/seeds/skills/xrk-capability-attach.
  Use when attaching MCP or switching light/dark theme while this repo is the workspace.
---

# Host Settings + MCP（工作区对照）

**产品默认**在 **`apps/cli/seeds/skills/xrk-capability-attach`** → `~/.xrk/skills/`（指纹刷新）。  
本文件仅在 **本仓作工作区** 时覆盖/对照；改产品行为请先改 CLI seeds。

- `settings_get` / `settings_mutate`（全局 `~/.xrk`）
- MCP 代理：`env.HTTP_PROXY` 等；密钥 → Credentials  
- 外观：`/theme light|dark|system` 或 `ns=ui-theme`（live）  
- 验证：`/mcp`
