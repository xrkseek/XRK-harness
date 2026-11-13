---
name: xrk-capability-attach
description: >-
  Attach or edit MCP servers and Host Settings via settings_mutate (global
  ~/.xrk). Use when the user asks to install MCP, fix MCP args/proxy, change
  Settings, switch light/dark theme, or 「装 MCP」「改设置」「白天模式」「夜间模式」.
  Coding / Desktop: this is the default MCP + Host Settings path.
---

# Host Settings + MCP

落点 **`~/.xrk`**，和 Settings UI 同一条写路径。深挖 MCP 走奇创 **`xrk-home-config`**。

| 面 | 规则 |
|----|------|
| **配置** | `settings_*` / Settings MCP 卡 → 向阳（奇创） |
| **使用** | 本席 `mcp_mount`：全局 + 会话工作区 + 在席干员家（同名会话赢） |
| **私用** | 干员 MCP 写该干员家 `workspaceId` 的 `.xrk/mcp.json`，别进全局 |

```
- [ ] 1. `settings_get`（勿盲写）
- [ ] 2. `settings_mutate` 只改需要的字段（多数 ns live，含 `ui-theme`）
- [ ] 3. MCP：共享→全局；项目/干员家→`scope=workspace` + workspaceId
- [ ] 4. 本席验证 `mcp__…` / `/mcp`；deny→park，别硬刷
```

## 何时用

| 用 | 不用 |
|----|------|
| 装 / 改 / 删 MCP | 写进程插件（→ **`xrk-plugin`**） |
| 改 Host Settings | 改工作区业务配置 |
| 切 light / dark / system | 手改 yaml（除非用户要求） |
| 干员 / Team | **`xrk-delegate`** |

## 工具

| 工具 | 作用 |
|------|------|
| `settings_get` | 列 ns / 读快照 |
| `settings_mutate` | 与 UI Save 同路径 |

- MCP：只动需要的 `servers[]`；代理用 `env.HTTP_PROXY` 等代理键  
- 密钥 → **Credentials**  
- 外观：`/theme light|dark|system` 或 `ns=ui-theme`

## 反模式

- 未 `settings_get` 就整表覆盖  
- API key 写进 MCP `args` / skill / AGENTS  
- 「配置在奇创」=「只有奇创能调 `mcp__`」  
- 干员私用 MCP 写进全局 `host-settings`  
- MCP 失败却狂 restart，不看行状态 / deny
