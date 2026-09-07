---
name: xrk-capability-attach
description: >-
  Attach or edit MCP / Host Settings via settings_mutate (global ~/.xrk).
  Use when the user asks to install MCP, fix MCP args/proxy, change Settings,
  switch light/dark theme, or 「装 MCP」「改设置」「白天模式」「夜间模式」.
---

# Host Settings + MCP

**真源**：本 skill 随 `xrkh web`/`serve` **指纹种子**装到 **`~/.xrk/skills/`**（未改过的家目录副本可随 CLI 刷新；用户改过的永不覆盖）。配置也在 **`~/.xrk`**，与当前工作区无关。

- `settings_get` — 列 ns / 读当前值  
- `settings_mutate` — 与 Settings UI Save 同路径；多数 ns **live**（含 `ui-theme`）；`ns=mcp` 等 remount/connect  

MCP：增删改 `servers[]`、`args`、`cwd`；代理用 `env.HTTP_PROXY` 等（仅代理键）。密钥 → Credentials。  
外观：`/theme light|dark|system` 或 `ns=ui-theme` · `preference`。

验证：`/mcp` · `mcp__…`；policy deny → park。
