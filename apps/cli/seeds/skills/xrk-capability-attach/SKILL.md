---
name: xrk-capability-attach
description: >-
  Attach or edit MCP servers and Host Settings via settings_mutate (global
  ~/.xrk). Use when the user asks to install MCP, fix MCP args/proxy, change
  Settings, switch light/dark theme, or 「装 MCP」「改设置」「白天模式」「夜间模式」.
---

# Host Settings + MCP

配置在 **`~/.xrk`**，与当前工作区无关。改设置走与 Settings UI **同一写入路径**。

```
- [ ] 1. `settings_get`：确认 ns / 当前值（勿盲写）
- [ ] 2. `settings_mutate`：改目标字段；多数 ns **live**（含 `ui-theme`）
- [ ] 3. MCP：改 `servers[]` / `args` / `cwd` / 代理 env 后等 remount
- [ ] 4. 验证：`/mcp` 或看工具名 `mcp__…`；policy deny → park，别硬刷
```

## 何时用

| 用 | 不用 |
|----|------|
| 装 / 改 / 删 MCP | 写进程插件（→ **`xrk-plugin-kind`**） |
| 改 Host Settings 字段 | 改工作区源码里的业务配置 |
| 切 light / dark / system | 用文件工具手改 yaml（除非用户明确要求） |

## 工具

| 工具 | 作用 |
|------|------|
| `settings_get` | 列 ns 或读当前快照 |
| `settings_mutate` | 与 UI Save 同路径 |

- MCP：只动需要的 `servers[]` 项；代理用 `env.HTTP_PROXY` 等**代理键**  
- 密钥 → **Credentials**，不进 settings 明文、不进 skill  
- 外观：`/theme light|dark|system` 或 `ns=ui-theme` · `preference`

## 反模式

- 未 `settings_get` 就整表覆盖  
- 把 API key 写进 MCP `args` / skill / AGENTS  
- MCP 连不上却不停 restart，不看 Settings 行状态与 deny
