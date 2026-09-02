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
进程内 JS → **`xrk-plugin-author`** + restart。

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

## UI（与 locales 一致）

设置 → 插件 → 插件配置 → 粘贴 JSON → **添加** → **允许连接** → **保存**  
（English: Settings → Plugins → Plugin config → **Add** → **Allow connect** → **Save**）

未经确认勿 `settings.mutate` ns=`mcp`。勿写 `env` / `connected` overlay。

验证：`mcp__<server>__…`；policy deny → **park**。斜杠 **`/mcp-attach`**。
