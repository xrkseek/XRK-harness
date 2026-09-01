---
name: xrk-plugin-kind
description: >-
  选 XRK 扩展形态：默认 MCP Settings；其次 tools/prompt/commands、client 叠加。
  用户问「用哪种插件」「要不要 MCP」「改 UI 还是加工具」时使用。
---

# kind 选型

**默认**：给模型新外部工具 → **设置 → 插件 → MCP**（skill **`xrk-capability-attach`**），不要一上来脚手架进程插件。

| 用户要什么 | 选 |
|------------|-----|
| 接已有 / 可起的 MCP 服务器 | **MCP Settings** → **`xrk-capability-attach`** |
| 仓库内简单自有 JS 函数 | **`kind: tools`** → **`xrk-plugin-author`** |
| 追加 system 段 | **`kind: prompt`** |
| 斜杠命令 | **`kind: commands`** 或 `.agents/recipes` |
| 改壳 UI | **`xrk.client`** 叠加 |

单函数且已是 MCP 包 → **挂 MCP**，不要再包一层 tools 插件。  
仅当逻辑必须落在本仓 `extensions/`、且不值得起 MCP 进程时 → tools 插件。

装完 MCP：看 Settings 行状态。装完进程插件：**`xrk-plugin-verify`**（须 restart）。
