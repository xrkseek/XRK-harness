---
name: xrk-capability-attach
description: >-
  Attach external tools via MCP in XRK-Harness Settings (paste mcpServers JSON,
  allow connect, confirm before mutate). Use when the user asks to install MCP,
  add tools, connect a server, attach Playwright/filesystem/browser MCP, or
  「装 MCP」「挂工具」「接服务器」「attach」「加工具」.
---

# Attach capability (MCP)

默认新工具走 **Settings → Plugins → Plugin config**（数据在 `~/.xrk/host-settings.json`）。  
进程内 JS → process plugin + **`plugin add`** + restart。

```
- [ ] 1. MCP vs 进程插件
- [ ] 2. 收集 id + command/url
- [ ] 3. 给出可粘贴 JSON（无 env）
- [ ] 4. 引导 UI 或经确认 mutate
- [ ] 5. 看行状态 + 工具 inventory
```

## JSON 示例

```json
{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest"]}}}
```

## UI

Settings → Plugins → Plugin config → paste JSON → **Add** / **添加** → **Allow connect** → **Save**

Never mutate `mcp` without confirmation. No `env` on servers.

Verify `mcp__<server>__…`; policy deny → **park**.
