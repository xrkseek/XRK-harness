---
name: xrk-plugin-kind
description: >-
  选 XRK 扩展形态：tools、prompt、commands、MCP、client 叠加。
  用户问「用哪种插件」「要不要 MCP」「改 UI 还是加工具」时使用。
---

# kind 选型

| 用户要什么 | 选 |
|------------|-----|
| 模型多一个函数 | **`kind: tools`** |
| 追加 system 段 | **`kind: prompt`** |
| 斜杠命令 | **`kind: commands`** 或 `.agents/recipes` |
| 已有 MCP 服务器 | Host MCP 设置 + policy |
| 改壳 UI | **`xrk.client`** 叠加 |

简单 JS 逻辑 → **tools 插件**，不要为单函数起 MCP。

下一步：**xrk-plugin-author** · 装完 **xrk-plugin-verify**。
